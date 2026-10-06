import {
  meta,
  MAX_HEADER_BYTES,
  MAX_PDF_BYTES,
  PageRangeError,
  PdfToolError,
  checkPdfFile,
  cleanCopyName,
  formatPageTexts,
} from '@fodt/pdf-text-metadata';
import {
  PDF_TEXT_METADATA_STALL_LIMIT_MS,
  PdfTextMetadataReadError,
  readPdfMetadata,
  readPdfText,
  reopenForCheck,
} from '../lib/run-pdf-text-metadata-reader';
import { PdfTextMetadataRunError, stripInWorker } from '../lib/run-pdf-text-metadata-in-worker';
import {
  defineTool,
  files,
  formatBytes,
  str,
  type OutputBlock,
  type RunContext,
  type ToolResult,
} from '../lib/tool-ui';

const CHARACTER_MAP_NOTE =
  'This PDF asked for a Chinese, Japanese or Korean character map that this page does not carry, so some of its text may be missing.';

/** Text mode: the text of every page asked for, page by page, with a note for anything left out. */
async function showText(file: File, pages: string, ctx: RunContext): Promise<ToolResult> {
  const read = await readPdfText(file, pages, ctx);
  const outputs: OutputBlock[] = [];
  if (read.characterMapNeeded) outputs.push({ kind: 'note', tone: 'info', value: CHARACTER_MAP_NOTE });
  for (const note of read.notes) outputs.push({ kind: 'note', tone: 'warn', value: note });
  const text = formatPageTexts(read.pages);
  outputs.push({ kind: 'code', label: 'Text', value: text, download: 'pdf-text.txt' });
  return {
    outputs,
    stats: [
      ['Pages in the file', String(read.pageCount)],
      ['Pages read', String(read.pages.length)],
      ['Characters', String(read.pages.reduce((sum, page) => sum + page.text.length, 0))],
    ],
  };
}

/** Metadata mode: the document information and the XMP properties, each with a sentence when the file has none. */
async function showMetadata(file: File, ctx: RunContext): Promise<ToolResult> {
  const read = await readPdfMetadata(file, ctx);
  const outputs: OutputBlock[] = [];
  if (read.info.length > 0) {
    outputs.push({ kind: 'keyvalue', label: 'Document information', pairs: read.info });
  } else {
    outputs.push({ kind: 'note', tone: 'info', value: 'This file has no document information.' });
  }
  if (read.xmp.length > 0) {
    outputs.push({
      kind: 'table',
      label: 'XMP metadata',
      table: { headers: ['Property', 'Value'], rows: read.xmp, mono: [0] },
    });
  } else {
    outputs.push({ kind: 'note', tone: 'info', value: 'This file has no XMP metadata.' });
  }
  for (const note of read.notes) outputs.push({ kind: 'note', tone: 'warn', value: note });
  const stats: [string, string][] = [['Pages', String(read.pageCount)]];
  if (read.pdfVersion !== null) stats.push(['PDF version', read.pdfVersion]);
  return { outputs, stats };
}

/**
 * Remove mode: the metadata is removed in a background worker, which also reloads the copy with pdf-lib, and the copy is
 * offered only when two readers (PDF.js on this page, and pdf-lib in that worker) find no document information, no XMP
 * metadata and none of the removed keys in it.
 */
async function removeMetadata(file: File, ctx: RunContext): Promise<ToolResult> {
  const original = new Uint8Array(await file.arrayBuffer());
  let stripped;
  try {
    stripped = await stripInWorker(original, ctx);
  } catch (err) {
    if (ctx.signal.aborted) throw err;
    if (err instanceof PdfTextMetadataRunError && err.kind === 'encrypted') {
      // An encrypted file is refused for removal. Reading it tells the two cases apart: one that needs a password to
      // open gets the password sentence (thrown by the read), one that opens without a password gets the encryption one.
      await readPdfMetadata(file, ctx);
      throw new PdfToolError('encrypted');
    }
    throw err;
  }

  const reread = await reopenForCheck(stripped.bytes, ctx);
  // The second reader, pdf-lib, already reloaded the copy in the removal worker and listed what it still holds.
  if (reread.info.length > 0 || reread.xmp.length > 0 || stripped.left.length > 0) throw new PdfToolError('not-clean');

  const { report } = stripped;
  const nothingFound =
    !report.info &&
    report.metadataStreams === 0 &&
    report.pieceInfo === 0 &&
    report.lastModified === 0 &&
    report.unreachable === 0;
  const outputs: OutputBlock[] = [];
  outputs.push({
    kind: 'note',
    tone: nothingFound ? 'info' : 'success',
    value: nothingFound
      ? 'Nothing was found to remove in this file. The copy below was still checked.'
      : 'Two readers (PDF.js and pdf-lib) found no document information, no XMP metadata and none of the removed entries in the copy.',
  });
  outputs.push({
    kind: 'keyvalue',
    label: 'Removed',
    pairs: [
      ['Document information', report.info ? 'removed' : 'none found'],
      ['Metadata entries', String(report.metadataStreams)],
      ['Piece-info entries', String(report.pieceInfo)],
      ['Last-modified entries', String(report.lastModified)],
      ['Objects nothing referred to', String(report.unreachable)],
    ],
  });
  outputs.push({
    kind: 'files',
    label: 'Copy without metadata',
    files: [{ name: cleanCopyName(file.name), mime: 'application/pdf', content: stripped.bytes }],
  });
  return {
    outputs,
    stats: [
      ['Original', formatBytes(file.size)],
      ['Copy', formatBytes(stripped.bytes.length)],
    ],
  };
}

/** A refusal or a limit as the page's error list: one fixed sentence, never any text from the file. */
function refusal(err: unknown): ToolResult {
  if (err instanceof PageRangeError) {
    return { outputs: [], errors: [{ message: `Pages: ${err.message}`, line: 1, column: err.position }] };
  }
  if (
    err instanceof PdfToolError ||
    err instanceof PdfTextMetadataReadError ||
    err instanceof PdfTextMetadataRunError
  ) {
    return { outputs: [], errors: [{ message: err.message }] };
  }
  return { outputs: [], errors: [{ message: 'Could not read this PDF.' }] };
}

export default defineTool({
  id: 'pdf-text-metadata',
  // A file is read only when Run is pressed, and reading and removal run in background workers, so a Cancel control is
  // offered while either is in flight.
  autoRun: false,
  cancellable: true,
  // The stall limit, as a quiet limit: Text and Metadata stop only after 20 seconds with no page read, and the Remove
  // metadata worker reports no progress, so its 20 second total is the same stop.
  runLimit: { ms: PDF_TEXT_METADATA_STALL_LIMIT_MS, kind: 'quiet' },
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'text',
      options: [
        { value: 'text', label: 'Text' },
        { value: 'metadata', label: 'Metadata' },
        { value: 'remove', label: 'Remove metadata' },
      ],
    },
    {
      name: 'file',
      label: 'PDF file',
      type: 'file',
      accept: 'application/pdf,.pdf',
      help: 'A PDF up to 100 MB. It is read in this page and never sent anywhere.',
    },
    {
      name: 'pages',
      label: 'Pages',
      type: 'text',
      default: '',
      help: 'For example 1-3,5,8-. Leave empty for every page, up to 500.',
      visible: (values) => str(values, 'mode', 'text') === 'text',
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const picked = files(values, 'file');
    if (picked.length === 0) return { outputs: [] };
    const file = picked[0]!;
    const mode = str(values, 'mode', 'text');

    try {
      // A file over the size limit is refused from its reported size before a single byte of it is read.
      const header =
        file.size > MAX_PDF_BYTES
          ? new Uint8Array(0)
          : new Uint8Array(await file.slice(0, MAX_HEADER_BYTES).arrayBuffer());
      checkPdfFile(header, file.size);
      if (mode === 'metadata') return await showMetadata(file, ctx);
      if (mode === 'remove') return await removeMetadata(file, ctx);
      return await showText(file, str(values, 'pages', ''), ctx);
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      return refusal(err);
    }
  },
});

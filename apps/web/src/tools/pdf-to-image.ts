import { meta, FileSignatureError, PdfToImageError, PageRangeError } from '@fodt/pdf-to-image';
import { PDF_STALL_LIMIT_MS, renderPdfInPage } from '../lib/run-pdf-to-image';
import { defineTool, files, num, str, bool, type OutputBlock, type ToolResult } from '../lib/tool-ui';

/** A 2 MB cap on the first-page preview, matching this project's other data: URL preview budgets. */
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export default defineTool({
  id: 'pdf-to-image',
  // A file is read only when Run is pressed, and rendering runs in
  // a background worker, so a Cancel control is offered while it is in
  // flight.
  autoRun: false,
  cancellable: true,
  runLimit: { ms: PDF_STALL_LIMIT_MS, kind: 'quiet' },
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    // No accept filter beyond PDF: this page only ever reads a PDF.
    { name: 'file', label: 'PDF file', type: 'file', accept: 'application/pdf,.pdf' },
    {
      name: 'pages',
      label: 'Pages',
      type: 'text',
      default: '',
      help: 'For example 1-3,5,8-. Leave empty for every page.',
    },
    {
      name: 'format',
      label: 'Format',
      type: 'select',
      default: 'png',
      options: [
        { value: 'png', label: 'PNG' },
        { value: 'jpeg', label: 'JPEG' },
      ],
    },
    {
      name: 'dpi',
      label: 'Resolution (dots per inch)',
      type: 'number',
      default: 150,
      min: 72,
      max: 600,
      step: 1,
      help: 'Higher values give sharper images and larger files.',
    },
    {
      name: 'quality',
      label: 'JPEG quality',
      type: 'number',
      default: 90,
      min: 1,
      max: 100,
      step: 1,
      visible: (v) => v.format === 'jpeg',
    },
    {
      name: 'transparent',
      label: 'Transparent background',
      type: 'checkbox',
      default: false,
      visible: (v) => v.format !== 'jpeg',
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const picked = files(values, 'file');
    if (picked.length === 0) return { outputs: [] };
    const file = picked[0]!;
    const dpi = num(values, 'dpi', 150);
    const format = str(values, 'format', 'png') === 'jpeg' ? 'jpeg' : 'png';
    const quality = num(values, 'quality', 90);
    const transparent = format === 'png' && bool(values, 'transparent', false);
    const pages = str(values, 'pages');

    let result;
    try {
      result = await renderPdfInPage(file, { dpi, format, quality, transparent, pages }, ctx);
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the
      // runner's own cancel handling already owns the single cancel note.
      if (ctx.signal.aborted) throw err;
      if (err instanceof PageRangeError) {
        return { outputs: [], errors: [{ message: err.message, line: 1, column: err.position }] };
      }
      if (err instanceof FileSignatureError || err instanceof PdfToImageError) {
        return { outputs: [], errors: [{ message: `Could not render '${file.name}': ${err.message}.` }] };
      }
      return {
        outputs: [],
        errors: [{ message: `Could not render '${file.name}': ${err instanceof Error ? err.message : String(err)}` }],
      };
    }

    const { pages: rendered, cjkNoteNeeded, documentPageCount } = result;

    const outputs: OutputBlock[] = [];
    if (cjkNoteNeeded) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value:
          'This PDF uses a Chinese, Japanese or Korean font encoding whose data is not included here, so some of that text may not render.',
      });
    }
    outputs.push({
      kind: 'files',
      label: 'Rendered pages',
      files: rendered.map((p) => ({ name: p.name, mime: p.mime, content: p.bytes })),
    });

    const first = rendered[0];
    if (first && first.bytes.length <= MAX_PREVIEW_BYTES) {
      outputs.push({
        kind: 'image',
        label: 'First page',
        src: `data:${first.mime};base64,${bytesToBase64(first.bytes)}`,
        alt: `Page ${first.page} of ${file.name}, rendered at ${dpi} dots per inch`,
        width: first.width,
        height: first.height,
      });
    }

    return {
      outputs,
      stats: [
        ['Document pages', String(documentPageCount)],
        ['Pages rendered', String(rendered.length)],
        ['Resolution', `${dpi} dots per inch`],
        ['Page size', first ? `${first.width} × ${first.height} px` : '—'],
      ],
    };
  },
});

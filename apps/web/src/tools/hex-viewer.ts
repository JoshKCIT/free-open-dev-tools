import {
  DEFAULT_EXPORT_PER_LINE,
  EXPORT_LANGUAGES,
  HexViewerError,
  MAX_EXPORT_PER_LINE,
  MAX_EXPORT_PREVIEW_CHARS,
  MAX_PASTED_BYTES,
  checkSearchSize,
  checkViewSize,
  encodeNeedle,
  exportCodeArray,
  exportRange,
  formatHexRows,
  formatSize,
  identifyFile,
  meta,
  parseHexInput,
  viewWindow,
  type BytesPerRow,
  type SearchResult,
} from '@fodt/hex-viewer';
import { HEX_VIEWER_TIME_LIMIT_MS, hexViewerInWorker, HexViewerRunError } from '../lib/run-hex-viewer-in-worker';
import {
  defineTool,
  bool,
  files,
  formatBytes,
  num,
  str,
  type OutputBlock,
  type ToolIssue,
  type ToolResult,
  type Values,
} from '../lib/tool-ui';

const POSITION_MAX = 2147483647;

const ROWS_PER_PAGE = [16, 64, 256];
const BYTES_PER_ROW: BytesPerRow[] = [8, 16, 32];

/** What was opened: its size, a name when it has one, the start and end of it, and the slice to show. */
interface Opened {
  size: number;
  name?: string;
  head: Uint8Array;
  tail: Uint8Array;
  window: Uint8Array;
  start: number;
}

function choice(values: Values, name: string, allowed: number[], fallback: number): number {
  const picked = Number(str(values, name, String(fallback)));
  return allowed.includes(picked) ? picked : fallback;
}

/** Go to byte as a whole number in its range; anything else is refused naming the field, before any read. */
function positionOf(values: Values): number {
  const position = num(values, 'position', 0);
  if (!Number.isInteger(position) || position < 0 || position > POSITION_MAX) {
    throw new HexViewerError(`Go to byte must be a whole number from 0 to ${POSITION_MAX.toLocaleString('en-US')}.`, {
      field: 'Go to byte',
    });
  }
  return position;
}

/** The pasted bytes: hex read in pairs, or the text as UTF-8. Empty text gives null, which shows nothing. */
function pastedBytes(values: Values, source: string): Uint8Array | null {
  const text = str(values, 'pasted');
  if (source === 'hex') {
    const bytes = parseHexInput(text);
    return bytes.length === 0 ? null : bytes;
  }
  if (text.length === 0) return null;
  // A character is at least one byte, so text longer than the limit is over it before any encoding.
  if (text.length > MAX_PASTED_BYTES) {
    throw new HexViewerError(
      `Pasted bytes: the text is longer than ${formatSize(MAX_PASTED_BYTES)}. The limit is ${formatSize(MAX_PASTED_BYTES)} because it is held in the page while it is shown.`,
      { field: 'Pasted bytes' },
    );
  }
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_PASTED_BYTES) {
    throw new HexViewerError(
      `Pasted bytes: the text is ${formatSize(bytes.length)} as UTF-8. The limit is ${formatSize(MAX_PASTED_BYTES)} because it is held in the page while it is shown.`,
      { field: 'Pasted bytes' },
    );
  }
  return bytes;
}

/** Reads one slice of a file. Only the bytes asked for are read. */
async function readSlice(file: File, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

/** Opens a file for viewing: its name, size, first 512 and last 22 bytes, and the one page of rows asked for. */
async function openFile(file: File, position: number, rowsPerPage: number, bytesPerRow: BytesPerRow): Promise<Opened> {
  checkViewSize(file.size);
  const { start, end } = viewWindow(file.size, position, rowsPerPage, bytesPerRow);
  const [head, tail, window] = await Promise.all([
    readSlice(file, 0, Math.min(file.size, 512)),
    readSlice(file, Math.max(0, file.size - 22), file.size),
    readSlice(file, start, end),
  ]);
  return { size: file.size, name: file.name, head, tail, window, start };
}

/** Opens pasted bytes the same way, so a pasted source follows the same path as a file. */
function openBytes(bytes: Uint8Array, position: number, rowsPerPage: number, bytesPerRow: BytesPerRow): Opened {
  const { start, end } = viewWindow(bytes.length, position, rowsPerPage, bytesPerRow);
  return {
    size: bytes.length,
    head: bytes.subarray(0, 512),
    tail: bytes.subarray(Math.max(0, bytes.length - 22)),
    window: bytes.subarray(start, end),
    start,
  };
}

function describe(opened: Opened, rowsPerPage: number, bytesPerRow: BytesPerRow): OutputBlock[] {
  const kinds = identifyFile(opened.head, opened.tail, opened.size);
  const pairs: [string, string][] = [];
  if (opened.name !== undefined) pairs.push(['Name', opened.name]);
  pairs.push(['Type', kinds.map((kind) => kind.name).join(' or ')]);
  pairs.push(['Evidence', kinds.map((kind) => kind.evidence).join(' ')]);
  const specs = kinds.map((kind) => kind.spec).filter((spec) => spec !== '');
  if (specs.length > 0) pairs.push(['Specification', specs.join(' ')]);
  pairs.push([
    'Size',
    opened.size < 1024
      ? formatBytes(opened.size)
      : `${formatBytes(opened.size)} (${opened.size.toLocaleString('en-US')} bytes)`,
  ]);
  const end = opened.start + opened.window.length;
  pairs.push([
    'Showing bytes',
    opened.window.length === 0
      ? 'none'
      : `${opened.start.toLocaleString('en-US')} to ${(end - 1).toLocaleString('en-US')} of ${opened.size.toLocaleString('en-US')} (${rowsPerPage} rows of ${bytesPerRow})`,
  ]);

  const outputs: OutputBlock[] = [{ kind: 'keyvalue', pairs }];
  if (opened.window.length > 0) {
    outputs.push({
      kind: 'code',
      label: 'Bytes',
      language: 'text',
      value: formatHexRows(opened.window, opened.start, bytesPerRow),
    });
  }
  outputs.push({
    kind: 'note',
    tone: 'info',
    value:
      'A signature is a hint: a file can begin with any bytes, so the type shown is only what its first bytes suggest, not a check of the whole file.',
  });
  return outputs;
}

/** The label of the preview block for each export language. */
const EXPORT_BLOCK_LABELS: Record<string, string> = {
  c: 'C or C++ array',
  rust: 'Rust array',
  go: 'Go slice',
  python: 'Python bytes',
  javascript: 'JavaScript Uint8Array',
};

/** Length as a number, or undefined when the field is empty (to the end of the file). Anything else goes to the range check. */
function exportLengthOf(values: Values): number | undefined {
  const raw = values['exportLength'];
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) return undefined;
  return num(values, 'exportLength', Number.NaN);
}

/**
 * The export blocks, added after every other block: a note, the first part of the text and the whole text as a file.
 * The window is checked against the 4 MiB limit before any byte of a file is read.
 */
async function exportBlocks(
  values: Values,
  searchable: { kind: 'file'; file: File } | { kind: 'bytes'; bytes: Uint8Array },
  language: string,
): Promise<OutputBlock[]> {
  const info = EXPORT_LANGUAGES.find((item) => item.id === language);
  if (info === undefined) return [];
  const size = searchable.kind === 'file' ? searchable.file.size : searchable.bytes.length;
  const { start, end } = exportRange(size, num(values, 'exportFrom', 0), exportLengthOf(values));
  const window =
    searchable.kind === 'file' ? await readSlice(searchable.file, start, end) : searchable.bytes.subarray(start, end);
  const fallback = searchable.kind === 'file' ? searchable.file.name : 'data';
  const result = exportCodeArray(window, {
    language: info.id,
    name: str(values, 'exportName').trim() === '' ? fallback : str(values, 'exportName'),
    perLine: num(values, 'exportPerLine', DEFAULT_EXPORT_PER_LINE),
    upper: bool(values, 'exportUpper', false),
  });

  // The preview ends at a whole line, so a cut never splits a byte.
  let preview = result.text;
  if (preview.length > MAX_EXPORT_PREVIEW_CHARS) {
    preview = preview.slice(0, preview.lastIndexOf('\n', MAX_EXPORT_PREVIEW_CHARS) + 1);
  }
  const cut = preview.length < result.text.length;
  const counted = `${result.bytes.toLocaleString('en-US')} ${result.bytes === 1 ? 'byte' : 'bytes'}`;
  let note = `Exported ${counted} from byte ${start.toLocaleString('en-US')} as ${info.label}.`;
  if (result.bytes === 0 && info.id === 'c') {
    note += ' The array is empty, and an empty initialiser is not standard C.';
  } else if (result.bytes === 0) {
    note += ' The array is empty.';
  }
  if (cut) {
    note += ` The preview shows the first ${preview.length.toLocaleString('en-US')} of ${result.text.length.toLocaleString('en-US')} characters; the saved file holds all of it.`;
  }
  note += ' Nothing is uploaded.';
  return [
    { kind: 'note', tone: 'info', value: note },
    { kind: 'code', label: EXPORT_BLOCK_LABELS[info.id] ?? info.label, language: 'text', value: preview },
    {
      kind: 'files',
      label: 'Saved file',
      files: [
        { name: `${result.identifier}.${result.extension}`, mime: 'application/octet-stream', content: result.text },
      ],
    },
  ];
}

/** The search result as page blocks: how many matches there are, and a table of the first ones. */
function matchBlocks(result: SearchResult): OutputBlock[] {
  const found = result.total.toLocaleString('en-US');
  const capped = result.total > result.offsets.length;
  const outputs: OutputBlock[] = [
    {
      kind: 'note',
      tone: 'info',
      value: `Found ${found} ${result.total === 1 ? 'match' : 'matches'}.${capped ? ` Showing the first ${result.offsets.length.toLocaleString('en-US')}.` : ''}`,
    },
  ];
  if (result.offsets.length > 0) {
    outputs.push({
      kind: 'table',
      label: 'Matches',
      table: {
        headers: ['Offset (hex)', 'Offset'],
        rows: result.offsets.map((offset) => [offset.toString(16).padStart(8, '0'), offset.toString(10)]),
        mono: [0, 1],
      },
    });
  }
  return outputs;
}

export default defineTool({
  id: 'hex-viewer',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  // Viewing reads one slice of the file on the page. Searching streams the whole file, which is real background work, so
  // it runs in a new worker with a 20 second limit (see run-hex-viewer-in-worker.ts's own comment) and offers Cancel.
  cancellable: true,
  runLimit: { ms: HEX_VIEWER_TIME_LIMIT_MS },
  fields: [
    {
      name: 'source',
      label: 'Source',
      type: 'radio',
      default: 'file',
      options: [
        { value: 'file', label: 'A file' },
        { value: 'hex', label: 'Pasted hex' },
        { value: 'text', label: 'Pasted text' },
      ],
    },
    {
      name: 'file',
      label: 'File',
      type: 'file',
      help: 'Any file, up to 2 GiB. Only the rows on screen are read, in your browser, and the file is never uploaded or changed.',
      visible: (v) => str(v, 'source', 'file') === 'file',
    },
    {
      name: 'pasted',
      label: 'Pasted bytes',
      type: 'textarea',
      rows: 8,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'Hex bytes such as 48 65 6c 6c 6f, or text, as chosen above. Up to 5 MiB.',
      visible: (v) => str(v, 'source', 'file') !== 'file',
    },
    {
      name: 'position',
      label: 'Go to byte',
      type: 'number',
      default: 0,
      min: 0,
      max: POSITION_MAX,
      step: 1,
      help: 'The byte number the rows start at, counting from 0.',
    },
    {
      name: 'rowsPerPage',
      label: 'Rows per page',
      type: 'select',
      default: '64',
      options: ROWS_PER_PAGE.map((n) => ({ value: String(n), label: String(n) })),
    },
    {
      name: 'bytesPerRow',
      label: 'Bytes per row',
      type: 'select',
      default: '16',
      options: BYTES_PER_ROW.map((n) => ({ value: String(n), label: String(n) })),
    },
    {
      name: 'search',
      label: 'Search for',
      type: 'text',
      mono: true,
      help: 'Text, or hex bytes when Search as is hex. Searches files up to 1 GiB.',
    },
    {
      name: 'searchAs',
      label: 'Search as',
      type: 'select',
      default: 'text',
      options: [
        { value: 'text', label: 'Text (UTF-8)' },
        { value: 'hex', label: 'Hex bytes' },
      ],
    },
    {
      name: 'matchCase',
      label: 'Match case',
      type: 'checkbox',
      default: true,
      help: 'Off: the letters A to Z match either case. Text search only.',
      visible: (v) => str(v, 'searchAs', 'text') === 'text',
    },
    {
      name: 'exportAs',
      label: 'Export as',
      type: 'select',
      default: 'none',
      options: [
        { value: 'none', label: 'No export' },
        ...EXPORT_LANGUAGES.map((item) => ({ value: item.id, label: item.label })),
      ],
      help: 'Writes the bytes as an array you can paste into source code. Nothing is uploaded.',
    },
    {
      name: 'exportName',
      label: 'Variable name',
      type: 'text',
      mono: true,
      help: 'Cleaned to a legal name, except that in C a keyword (a file named default) stays as xxd -i leaves it. Empty uses the file name, or data for pasted bytes.',
      visible: (v) => str(v, 'exportAs', 'none') !== 'none',
    },
    {
      name: 'exportFrom',
      label: 'Export from byte',
      type: 'number',
      default: 0,
      min: 0,
      max: POSITION_MAX,
      step: 1,
      help: 'The byte number the array starts at, counting from 0.',
      visible: (v) => str(v, 'exportAs', 'none') !== 'none',
    },
    {
      name: 'exportLength',
      label: 'Length',
      type: 'number',
      min: 0,
      max: POSITION_MAX,
      step: 1,
      help: 'How many bytes to export, up to 4 MiB. Empty means to the end; 0 gives an empty array.',
      visible: (v) => str(v, 'exportAs', 'none') !== 'none',
    },
    {
      name: 'exportPerLine',
      label: 'Bytes per line',
      type: 'number',
      default: DEFAULT_EXPORT_PER_LINE,
      min: 1,
      max: MAX_EXPORT_PER_LINE,
      step: 1,
      help: 'From 1 to 256. The xxd -i form uses 12.',
      visible: (v) => str(v, 'exportAs', 'none') !== 'none',
    },
    {
      name: 'exportUpper',
      label: 'Upper-case hex digits',
      type: 'checkbox',
      default: false,
      help: 'The C or C++ form then also writes the prefix as 0X, as xxd -u does.',
      visible: (v) => str(v, 'exportAs', 'none') !== 'none',
    },
  ],
  examples: [
    {
      label: 'PNG header',
      values: {
        source: 'hex',
        pasted: '89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52 00 00 00 20 00 00 00 20 08 06 00 00 00',
        position: 0,
        rowsPerPage: '64',
        bytesPerRow: '16',
      },
    },
    {
      label: 'Text as bytes',
      values: {
        source: 'text',
        pasted: 'Hello, world!\nA second line with an e acute: é\tand a tab.',
        position: 0,
        rowsPerPage: '64',
        bytesPerRow: '16',
      },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    try {
      const source = str(values, 'source', 'file');
      const position = positionOf(values);
      const rowsPerPage = choice(values, 'rowsPerPage', ROWS_PER_PAGE, 64);
      const bytesPerRow = choice(values, 'bytesPerRow', BYTES_PER_ROW, 16) as BytesPerRow;

      // What was opened, and what a search would look through: the picked file itself, or the pasted bytes.
      let opened: Opened;
      let searchable: { kind: 'file'; file: File } | { kind: 'bytes'; bytes: Uint8Array };
      if (source === 'file') {
        const file = files(values, 'file')[0];
        // No file, no output and no worker.
        if (!file) return { outputs: [] };
        opened = await openFile(file, position, rowsPerPage, bytesPerRow);
        searchable = { kind: 'file', file };
      } else {
        const bytes = pastedBytes(values, source);
        if (bytes === null) return { outputs: [] };
        opened = openBytes(bytes, position, rowsPerPage, bytesPerRow);
        searchable = { kind: 'bytes', bytes };
      }

      const outputs = describe(opened, rowsPerPage, bytesPerRow);
      const errors: ToolIssue[] = [];

      // A search that is refused before it starts (hex that is not pairs of digits, a file over 1 GiB) is shown beside
      // the rows, which stay. A search that was started and failed, or stopped at its time limit, shows only its message.
      const term = str(values, 'search');
      const searchAsHex = str(values, 'searchAs', 'text') === 'hex';
      let needle: Uint8Array | null = null;
      if (term !== '') {
        try {
          needle = encodeNeedle(term, searchAsHex ? 'hex' : 'text');
          if (needle.length === 0) needle = null;
          else if (searchable.kind === 'file') checkSearchSize(searchable.file.size);
        } catch (err) {
          if (!(err instanceof HexViewerError)) throw err;
          errors.push({ message: err.message });
          needle = null;
        }
      }
      if (needle !== null) {
        // The Match case box is hidden for a hex search and keeps its value, so it is read only for a text search: a
        // hex search is always exact.
        const matchCase = searchAsHex ? true : bool(values, 'matchCase', true);
        const result = await hexViewerInWorker(
          {
            type: 'hex-viewer-job',
            job:
              searchable.kind === 'file'
                ? { kind: 'file', file: searchable.file, needle, matchCase }
                : { kind: 'bytes', bytes: searchable.bytes, needle, matchCase },
          },
          ctx,
        );
        outputs.push(...matchBlocks(result));
      }

      // Only when an export is chosen is anything read for it. A refusal (a window over 4 MiB, a bad number) is shown
      // beside the rows, which stay.
      const exportAs = str(values, 'exportAs', 'none');
      if (exportAs !== 'none') {
        try {
          outputs.push(...(await exportBlocks(values, searchable, exportAs)));
        } catch (err) {
          if (!(err instanceof HexViewerError)) throw err;
          errors.push({ message: err.message });
        }
      }
      return { outputs, ...(errors.length > 0 ? { errors } : {}) };
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the runner's own cancellation note already owns that
      // message.
      if (ctx.signal.aborted) throw err;
      if (err instanceof HexViewerError || err instanceof HexViewerRunError) {
        return { outputs: [], errors: [{ message: err.message }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});

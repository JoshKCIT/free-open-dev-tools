import {
  HexViewerError,
  MAX_PASTED_BYTES,
  formatHexRows,
  formatSize,
  identifyFile,
  meta,
  parseHexInput,
  type BytesPerRow,
} from '@fodt/hex-viewer';
import { defineTool, formatBytes, num, str, type OutputBlock, type ToolResult, type Values } from '../lib/tool-ui';

const POSITION_MAX = 2147483647;

const ROWS_PER_PAGE = [16, 64, 256];
const BYTES_PER_ROW: BytesPerRow[] = [8, 16, 32];

/** What was opened: its bytes' size, the slice to show, the start and end of the file, and a name when it has one. */
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
      `The pasted text is longer than ${formatSize(MAX_PASTED_BYTES)}. The limit is ${formatSize(MAX_PASTED_BYTES)} because it is held in the page while it is shown.`,
      { field: 'Pasted bytes' },
    );
  }
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_PASTED_BYTES) {
    throw new HexViewerError(
      `The pasted text is ${formatSize(bytes.length)} as UTF-8. The limit is ${formatSize(MAX_PASTED_BYTES)} because it is held in the page while it is shown.`,
      { field: 'Pasted bytes' },
    );
  }
  return bytes;
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

export default defineTool({
  id: 'hex-viewer',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  cancellable: true,
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
      help: 'Text, or hex bytes when Search as is hex.',
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

      // The file source arrives with the file window in the next change; until then it shows nothing.
      if (source === 'file') return { outputs: [] };

      const bytes = pastedBytes(values, source);
      if (bytes === null) return { outputs: [] };
      if (position > bytes.length - 1) {
        throw new HexViewerError(
          `Go to byte is ${position.toLocaleString('en-US')}, which is past the end of ${bytes.length.toLocaleString('en-US')} bytes. Use a number from 0 to ${(bytes.length - 1).toLocaleString('en-US')}.`,
          { field: 'Go to byte' },
        );
      }
      const end = Math.min(bytes.length, position + rowsPerPage * bytesPerRow);
      const opened: Opened = {
        size: bytes.length,
        head: bytes.subarray(0, 512),
        tail: bytes.subarray(Math.max(0, bytes.length - 22)),
        window: bytes.subarray(position, end),
        start: position,
      };
      return { outputs: describe(opened, rowsPerPage, bytesPerRow) };
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      if (err instanceof HexViewerError) return { outputs: [], errors: [{ message: err.message }] };
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});

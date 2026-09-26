import {
  meta,
  measureCompression,
  SIZE_TOLERANCE,
  CompressionTesterError,
  type CompressionFormat,
} from '@fodt/compression-tester';
import {
  defineTool,
  bool,
  str,
  files,
  formatBytes,
  type DownloadableFile,
  type OutputBlock,
  type ToolResult,
} from '../lib/tool-ui';

const EXTENSION: Record<CompressionFormat, string> = { gzip: 'gz', deflate: 'zz', 'deflate-raw': 'deflate' };
const MIME: Record<CompressionFormat, string> = {
  gzip: 'application/gzip',
  deflate: 'application/zlib',
  'deflate-raw': 'application/octet-stream',
};

export default defineTool({
  id: 'compression-tester',
  // Reading a file (or a large paste) is real work; this waits for a
  // deliberate Run press and offers Cancel, streaming progress through ctx.
  autoRun: false,
  cancellable: true,
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'source',
      label: 'Source',
      type: 'radio',
      default: 'text',
      options: [
        { value: 'text', label: 'Typed text' },
        { value: 'file', label: 'A file' },
      ],
    },
    {
      name: 'text',
      label: 'Text',
      type: 'textarea',
      rows: 10,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      visible: (v) => v.source !== 'file',
    },
    { name: 'file', label: 'File', type: 'file', visible: (v) => v.source === 'file' },
    { name: 'gzip', label: 'gzip', type: 'checkbox', default: true },
    { name: 'deflate', label: 'deflate', type: 'checkbox', default: true },
    { name: 'deflateRaw', label: 'deflate-raw', type: 'checkbox', default: true },
  ],
  examples: [{ label: 'Repeated text', values: { source: 'text', text: 'hello hello hello world '.repeat(2000) } }],
  async run(values, ctx): Promise<ToolResult> {
    const source = str(values, 'source', 'text');
    let bytes: Uint8Array;
    let baseName: string;

    if (source === 'file') {
      const picked = files(values, 'file');
      if (picked.length === 0) return { outputs: [] };
      const file = picked[0]!;
      bytes = new Uint8Array(await file.arrayBuffer());
      baseName = file.name.replace(/\.[^./]+$/, '') || 'file';
    } else {
      const text = str(values, 'text');
      if (!text) return { outputs: [] };
      bytes = new TextEncoder().encode(text);
      baseName = 'text';
    }

    const formats: CompressionFormat[] = [];
    if (bool(values, 'gzip', true)) formats.push('gzip');
    if (bool(values, 'deflate', true)) formats.push('deflate');
    if (bool(values, 'deflateRaw', true)) formats.push('deflate-raw');
    if (formats.length === 0) {
      return { outputs: [], errors: [{ message: 'Choose at least one format.' }] };
    }

    try {
      const result = await measureCompression(bytes, { formats, signal: ctx.signal, onProgress: ctx.onProgress });
      return renderResult(result, baseName);
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      if (err instanceof CompressionTesterError) {
        return { outputs: [], errors: [{ message: err.message }] };
      }
      return {
        outputs: [],
        errors: [{ message: err instanceof Error ? err.message : 'This input could not be compressed.' }],
      };
    }
  },
});

interface RenderableFormatResult {
  format: CompressionFormat;
  bytes: number;
  ratio: number;
  output: Uint8Array;
  unsupported: boolean;
}

function renderResult(result: { inputBytes: number; results: RenderableFormatResult[] }, baseName: string): ToolResult {
  const rows: (string | number)[][] = [['(input)', result.inputBytes, '1.00', '0%']];
  const downloadable: DownloadableFile[] = [];

  for (const item of result.results) {
    if (item.unsupported) {
      rows.push([item.format, 'not supported by this browser', '', '']);
      continue;
    }
    const saved = result.inputBytes === 0 ? 0 : 1 - item.bytes / result.inputBytes;
    rows.push([item.format, item.bytes, item.ratio.toFixed(2), `${Math.round(saved * 100)}%`]);
    downloadable.push({
      name: `${baseName}.${EXTENSION[item.format]}`,
      mime: MIME[item.format],
      content: item.output,
    });
  }

  const outputs: OutputBlock[] = [
    { kind: 'table', label: 'Sizes', table: { headers: ['Format', 'Bytes', 'Ratio', 'Saved'], rows, mono: [1] } },
  ];
  if (downloadable.length > 0) {
    outputs.push({ kind: 'files', label: 'Downloads', files: downloadable });
  }
  outputs.push({
    kind: 'note',
    tone: 'info',
    value: `Sizes come from this browser's own compressor. Other compressors and levels can differ slightly; on the engines tested this page stays within ${SIZE_TOLERANCE.percent} percent or ${SIZE_TOLERANCE.bytes} bytes of Node zlib at its default level.`,
  });

  return {
    outputs,
    stats: [
      ['Input size', formatBytes(result.inputBytes)],
      ['Formats', String(result.results.length)],
    ],
  };
}

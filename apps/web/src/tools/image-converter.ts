import { meta, OUTPUT_FORMATS, type OutputFormatId, type ResizeMode } from '@fodt/image-converter';
import { probeEncodersInWorker, convertImageInWorker } from '../lib/run-image-converter-in-worker';
import {
  defineTool,
  bool,
  num,
  str,
  files,
  formatBytes,
  type Field,
  type OutputBlock,
  type ToolResult,
  type Values,
} from '../lib/tool-ui';

const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/bmp';

function resizeModeIs(values: Values, mode: ResizeMode): boolean {
  return str(values, 'resize', 'none') === mode;
}

function formatNeedsQuality(values: Values): boolean {
  const format = str(values, 'format', 'png');
  return format === 'jpeg' || format === 'webp' || format === 'avif';
}

const fields: Field[] = [
  { name: 'file', label: 'Image', type: 'file', accept: ACCEPT },
  {
    name: 'format',
    label: 'Convert to',
    type: 'select',
    default: 'png',
    options: OUTPUT_FORMATS.map((f) => ({ value: f.id, label: f.label })),
  },
  {
    name: 'quality',
    label: 'Quality',
    type: 'number',
    default: 85,
    min: 1,
    max: 100,
    visible: formatNeedsQuality,
    help: 'How closely the output matches the original. Only used for JPEG, WebP and AVIF.',
  },
  {
    name: 'background',
    label: 'Background colour',
    type: 'color',
    default: '#ffffff',
    visible: (values) => str(values, 'format', 'png') === 'jpeg',
    help: 'JPEG has no transparency: a transparent source is composited on this colour.',
  },
  {
    name: 'resize',
    label: 'Resize',
    type: 'radio',
    default: 'none',
    options: [
      { value: 'none', label: 'Keep size' },
      { value: 'percent', label: 'Percent' },
      { value: 'fit', label: 'Fit inside' },
      { value: 'exact', label: 'Exact size' },
    ],
  },
  {
    name: 'percent',
    label: 'Percent of original size',
    type: 'number',
    default: 100,
    min: 1,
    max: 1000,
    visible: (values) => resizeModeIs(values, 'percent'),
  },
  {
    name: 'width',
    label: 'Width',
    type: 'number',
    default: 800,
    min: 1,
    visible: (values) => resizeModeIs(values, 'fit') || resizeModeIs(values, 'exact'),
  },
  {
    name: 'height',
    label: 'Height',
    type: 'number',
    default: 600,
    min: 1,
    visible: (values) => resizeModeIs(values, 'fit') || resizeModeIs(values, 'exact'),
  },
  {
    name: 'keepAspect',
    label: 'Keep aspect ratio (uses width, computes height)',
    type: 'checkbox',
    default: true,
    visible: (values) => resizeModeIs(values, 'exact'),
  },
  {
    name: 'enlarge',
    label: 'Enlarge if the image is already smaller than the box',
    type: 'checkbox',
    default: false,
    visible: (values) => resizeModeIs(values, 'fit'),
  },
];

function writableTable(writable: Record<OutputFormatId, boolean>): [string, string][] {
  return OUTPUT_FORMATS.map((f) => [f.label, writable[f.id] ? 'Yes' : 'No']);
}

/** Turns bytes into a data: URL without spreading the whole array onto the call stack at once. */
function bytesToDataUrl(bytes: Uint8Array, mediaType: string): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${mediaType};base64,${btoa(binary)}`;
}

const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

export default defineTool({
  id: 'image-converter',
  // A picked image is only ever read once the visitor presses Run (D-130,
  // D-10): decoding, resizing and encoding are all real background work.
  autoRun: false,
  cancellable: true,
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields,
  async run(values, ctx): Promise<ToolResult> {
    const picked = files(values, 'file');
    if (picked.length === 0) return { outputs: [] };
    const file = picked[0]!;

    const writable = await probeEncodersInWorker();
    const capabilityOutput: OutputBlock = {
      kind: 'keyvalue',
      label: 'Formats this browser can write',
      pairs: writableTable(writable),
    };

    const options = {
      format: str(values, 'format', 'png') as OutputFormatId,
      quality: num(values, 'quality', 85),
      background: str(values, 'background', '#ffffff'),
      resize: {
        mode: str(values, 'resize', 'none') as ResizeMode,
        percent: num(values, 'percent', 100),
        width: num(values, 'width', 0) || undefined,
        height: num(values, 'height', 0) || undefined,
        keepAspect: bool(values, 'keepAspect', false),
        enlarge: bool(values, 'enlarge', false),
      },
    };

    let result;
    try {
      result = await convertImageInWorker(file, options, ctx);
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the
      // runner's own cancel handling already owns the single cancellation
      // note, matching this project's own established worker-page pattern.
      if (ctx.signal.aborted) throw err;
      return {
        outputs: [capabilityOutput],
        errors: [{ message: `Could not convert '${file.name}': ${err instanceof Error ? err.message : String(err)}` }],
      };
    }

    const outputs: OutputBlock[] = [capabilityOutput];
    outputs.push({
      kind: 'files',
      label: 'Converted image',
      files: [{ name: result.fileName, mime: result.mediaType, content: result.bytes }],
    });
    if (result.bytes.byteLength <= MAX_PREVIEW_BYTES) {
      outputs.push({
        kind: 'image',
        label: 'Preview',
        src: bytesToDataUrl(result.bytes, result.mediaType),
        alt: `Converted preview of ${file.name}`,
        width: result.width,
        height: result.height,
      });
    }

    return {
      outputs,
      warnings: result.warnings,
      stats: [
        [
          'Input',
          `${result.sourceKind.toUpperCase()}, ${formatBytes(file.size)}, ${result.sourceWidth} × ${result.sourceHeight}`,
        ],
        [
          'Output',
          `${options.format.toUpperCase()}, ${formatBytes(result.bytes.byteLength)}, ${result.width} × ${result.height}`,
        ],
      ],
    };
  },
});

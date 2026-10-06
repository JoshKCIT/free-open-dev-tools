import {
  meta,
  OUTPUT_FORMATS,
  FLIPS,
  ROTATIONS,
  type FlipMode,
  type ImageEdits,
  type OutputFormatId,
  type ResizeMode,
  type Rotation,
} from '@fodt/image-converter';
import {
  IMAGE_CONVERTER_STALL_LIMIT_MS,
  probeEncodersInWorker,
  convertImageInWorker,
  type ConvertImageResult,
} from '../lib/run-image-converter-in-worker';
import { rasterizeSvgFile, type SvgConvertResult } from '../lib/image-converter-svg';
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

/** Crop sides are whole pixels from 0 to this many. */
const CROP_MAX = 100_000;

function transformIsEdit(values: Values): boolean {
  return str(values, 'transform', 'none') === 'edit';
}

/**
 * Reads the crop, rotation and flip fields, only when Crop, rotate or flip is chosen (a hidden field never changes a
 * result). A crop value outside its range or not a whole number is refused naming the field, never replaced.
 */
function readEdits(values: Values): { edits?: ImageEdits; error?: string } {
  if (!transformIsEdit(values)) return {};
  const sides = [
    ['cropX', 'Crop left'],
    ['cropY', 'Crop top'],
    ['cropW', 'Crop width'],
    ['cropH', 'Crop height'],
  ] as const;
  const read: Record<string, number> = {};
  for (const [name, label] of sides) {
    const value = num(values, name, 0);
    if (!Number.isInteger(value) || value < 0 || value > CROP_MAX) {
      return { error: `${label} must be a whole number from 0 to ${CROP_MAX.toLocaleString('en-US')}.` };
    }
    read[name] = value;
  }
  const rotate = Number(str(values, 'rotate', '0'));
  const flip = str(values, 'flip', 'none');
  const edits: ImageEdits = {
    rotate: (ROTATIONS as readonly number[]).includes(rotate) ? (rotate as Rotation) : 0,
    flip: (FLIPS as readonly string[]).includes(flip) ? (flip as FlipMode) : 'none',
  };
  const width = read.cropW!;
  const height = read.cropH!;
  if (width === 0 && height === 0) {
    // With no crop size the whole image is kept, so a corner would be ignored: say so rather than ignore it.
    if (read.cropX! !== 0 || read.cropY! !== 0) {
      return {
        error:
          'Crop left and Crop top have no effect without a crop size. Set Crop width and Crop height, or set Crop left and Crop top back to 0.',
      };
    }
    return { edits };
  }
  if (width === 0 || height === 0) {
    return { error: 'Crop width and Crop height must both be set, or both left at 0 to keep the whole image.' };
  }
  edits.crop = { x: read.cropX!, y: read.cropY!, width, height };
  return { edits };
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
  {
    name: 'transform',
    label: 'Crop, rotate and flip',
    type: 'select',
    default: 'none',
    options: [
      { value: 'none', label: 'No crop, rotate or flip' },
      { value: 'edit', label: 'Crop, rotate or flip' },
    ],
    help: 'Applied in this order before any resize: crop, then rotate, then flip.',
  },
  {
    name: 'cropX',
    label: 'Crop left',
    type: 'number',
    default: 0,
    min: 0,
    max: CROP_MAX,
    visible: transformIsEdit,
    help: 'Pixels from the left edge of the upright image. Used only when Crop width and Crop height are set.',
  },
  {
    name: 'cropY',
    label: 'Crop top',
    type: 'number',
    default: 0,
    min: 0,
    max: CROP_MAX,
    visible: transformIsEdit,
    help: 'Pixels from the top edge of the upright image. Used only when Crop width and Crop height are set.',
  },
  {
    name: 'cropW',
    label: 'Crop width',
    type: 'number',
    default: 0,
    min: 0,
    max: CROP_MAX,
    visible: transformIsEdit,
    help: 'Pixels. Leave width and height at 0 to keep the whole image.',
  },
  {
    name: 'cropH',
    label: 'Crop height',
    type: 'number',
    default: 0,
    min: 0,
    max: CROP_MAX,
    visible: transformIsEdit,
    help: 'Pixels. Leave width and height at 0 to keep the whole image.',
  },
  {
    name: 'rotate',
    label: 'Rotate',
    type: 'select',
    default: '0',
    options: ROTATIONS.map((degrees) => ({
      value: String(degrees),
      label: degrees === 0 ? 'Not rotated' : `${degrees} degrees clockwise`,
    })),
    visible: transformIsEdit,
  },
  {
    name: 'flip',
    label: 'Flip',
    type: 'select',
    default: 'none',
    options: [
      { value: 'none', label: 'Not flipped' },
      { value: 'horizontal', label: 'Left to right' },
      { value: 'vertical', label: 'Top to bottom' },
      { value: 'both', label: 'Both ways' },
    ],
    visible: transformIsEdit,
  },
  {
    name: 'allowSvg',
    label: 'Allow SVG input',
    type: 'checkbox',
    default: false,
    help: 'Off, an SVG is refused. On, an SVG that stays within itself (no scripts, other files or addresses) is drawn by this browser and converted. The file picker may need All files to show it.',
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
  runLimit: { ms: IMAGE_CONVERTER_STALL_LIMIT_MS, kind: 'quiet' },
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

    const { edits, error: editError } = readEdits(values);
    if (editError) return { outputs: [capabilityOutput], errors: [{ message: editError }] };

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
      ...(edits ? { edits } : {}),
    };

    let result: ConvertImageResult | SvgConvertResult;
    try {
      // An SVG is drawn on this page only when its box is ticked; every other file, and every SVG with the box
      // unticked, takes the one path this page always had, error text included.
      const svg = bool(values, 'allowSvg', false) ? await rasterizeSvgFile(file, options, ctx) : undefined;
      result = svg ?? (await convertImageInWorker(file, options, ctx));
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

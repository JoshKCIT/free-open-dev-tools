import meta from './meta.json';
import { assertFileKind, type FileKind } from './file-sniff';
import { planSize, largestFittingSize, MAX_OUTPUT_PIXELS, type ResizeMode, type SizeSource } from './sizing';
import { formatInfo, type OutputFormatId } from './capabilities';
import { planEdits, planEditedSize, type EditPlan, type ImageEdits } from './edits';

export { meta };
export { OUTPUT_FORMATS, formatInfo, interpretEncodeResult, writableFormats } from './capabilities';
export type { OutputFormatId, OutputFormatInfo, EncodeInterpretation } from './capabilities';
export { planSize, largestFittingSize, MAX_OUTPUT_PIXELS } from './sizing';
export type { SizeSource, SizeOptions, SizePlan, ResizeMode } from './sizing';
export { sniffFile, assertFileKind, FileSignatureError, FILE_KINDS, MAX_HEADER_BYTES } from './file-sniff';
export type { FileKind, SniffResult, FileKindLimits } from './file-sniff';
export { planEdits, planEditedSize, ImageEditError, ROTATIONS, FLIPS } from './edits';
export type { ImageEdits, EditPlan, CropRect, Rotation, FlipMode } from './edits';
export { scanSvg, looksLikeSvg, looksLikeSvgStart, SvgGuardError } from './svg-guard';
export { svgSize, SvgSizeError, MAX_SVG_PIXELS } from './svg-size';

/** The five raster formats this tool reads. AVIF, HEIC and TIFF are never accepted as input (D-133). */
const ACCEPTED_KINDS: FileKind[] = ['png', 'jpeg', 'gif', 'webp', 'bmp'];

/** 100 MB, checked from the file's own reported size before anything is read into memory. */
export const MAX_INPUT_BYTES = 100 * 1024 * 1024;

/** 100,000,000 declared pixels, checked from the header before any decoding. */
export const MAX_INPUT_PIXELS = 100_000_000;

/** The floor a quality fraction is clamped to. Never zero: a genuinely-zero quality argument is a degenerate encode request most encoders treat unpredictably. */
const MIN_QUALITY_FRACTION = 0.01;
const MAX_QUALITY_FRACTION = 1;

export class ImageConverterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageConverterError';
  }
}

export interface ConvertOptions {
  format: OutputFormatId;
  /** 1 to 100. Converted here to the 0 to 1 fraction the HTML Standard's own encode calls take. */
  quality: number;
  /** A '#rgb' or '#rrggbb' hex colour. Used only when the output has no alpha channel (JPEG). */
  background: string;
  resize: {
    mode: ResizeMode;
    percent?: number;
    width?: number;
    height?: number;
    keepAspect?: boolean;
    enlarge?: boolean;
  };
  /** Crop, rotate and flip, applied in that order before the resize. Left out, the picture is converted as it always was. */
  edits?: ImageEdits;
}

export interface ConversionPlan {
  sourceKind: FileKind;
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  format: OutputFormatId;
  mediaType: string;
  extension: string;
  /** The 0 to 1 fraction actually passed to convertToBlob/toBlob. Meaningless for PNG, which has no quality argument. */
  qualityFraction: number;
  background: string;
  warnings: string[];
}

const HEX_COLOUR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** '#rgb' or '#rrggbb' only; anything else falls back to '#ffffff' with a warning naming the field. */
function parseBackground(raw: string, warnings: string[]): string {
  const trimmed = raw.trim();
  if (HEX_COLOUR.test(trimmed)) return trimmed;
  warnings.push(`'background' was not a valid #rgb or #rrggbb colour; white (#ffffff) was used instead.`);
  return '#ffffff';
}

/** Clamps a 1-100 quality field to the 0 to 1 fraction the HTML Standard's own encode calls accept, per the HTML Standard's own quality argument. */
function clampQuality(raw: number, warnings: string[]): number {
  const fraction = raw / 100;
  if (fraction > MAX_QUALITY_FRACTION) {
    warnings.push(`'quality' was above the allowed range and was clamped to 100.`);
    return MAX_QUALITY_FRACTION;
  }
  if (fraction < MIN_QUALITY_FRACTION) {
    warnings.push(`'quality' was below the allowed range and was clamped to ${MIN_QUALITY_FRACTION * 100}.`);
    return MIN_QUALITY_FRACTION;
  }
  return fraction;
}

/**
 * Checks the file header, plans the output size and clamps every option,
 * without ever touching a canvas or a real image decoder -- that happens
 * only in the worker this package never imports. Throws `ImageConverterError`
 * when the header check fails or the planned output would be too large for
 * this browser's own measured pixel ceiling to encode.
 */
export function planConversion(bytes: Uint8Array, fileName: string, options: ConvertOptions): ConversionPlan {
  const sniffed = assertFileKind(bytes, ACCEPTED_KINDS, { maxBytes: MAX_INPUT_BYTES, maxPixels: MAX_INPUT_PIXELS });
  if (sniffed.width === undefined || sniffed.height === undefined) {
    // Every kind in ACCEPTED_KINDS reports dimensions from its own header;
    // this only guards against a future accepted kind that does not.
    throw new ImageConverterError(`Could not read '${fileName}': its dimensions could not be determined.`);
  }
  const source: SizeSource = { width: sniffed.width, height: sniffed.height };

  // With edits, resizing measures the cropped and turned size. A JPEG may store its picture turned a quarter,
  // so its header size is only a first guess; the drawing site plans again from the decoded picture.
  const sizeSource: SizeSource = options.edits
    ? planEditedSize(source.width, source.height, options.edits, sniffed.kind === 'jpeg')
    : source;
  const sizePlan = planSize(sizeSource, options.resize);
  const warnings = [...sizePlan.warnings];

  if (sizePlan.width * sizePlan.height > MAX_OUTPUT_PIXELS) {
    const largest = largestFittingSize(sizePlan.width, sizePlan.height, MAX_OUTPUT_PIXELS);
    throw new ImageConverterError(
      `Could not convert '${fileName}': the requested output is ${sizePlan.width} by ${sizePlan.height} pixels, ` +
        `above this browser's own ${MAX_OUTPUT_PIXELS.toLocaleString('en-US')}-pixel limit. The largest size that ` +
        `fits is ${largest.width} by ${largest.height}.`,
    );
  }

  const qualityFraction = clampQuality(options.quality, warnings);
  const background = parseBackground(options.background, warnings);

  warnings.push('Re-encoding drops embedded metadata, including any colour profile.');
  if (sniffed.kind === 'gif' || sniffed.kind === 'webp') {
    warnings.push('If this source is animated, only its first frame is kept.');
  }
  if (options.format === 'jpeg' && sniffed.kind !== 'jpeg') {
    warnings.push(
      'If this source has transparency, it is composited on the background colour for JPEG output, which has no transparency of its own.',
    );
  }

  const info = formatInfo(options.format);
  return {
    sourceKind: sniffed.kind,
    sourceWidth: source.width,
    sourceHeight: source.height,
    targetWidth: sizePlan.width,
    targetHeight: sizePlan.height,
    format: info.id,
    mediaType: info.mediaType,
    extension: info.extension,
    qualityFraction,
    background,
    warnings,
  };
}

/** The visitor's own base name (its own extension stripped) plus the chosen format's extension. Never anything read from inside the file. */
export function outputFileName(fileName: string, format: OutputFormatId): string {
  const base = fileName.replace(/\.[^./\\]+$/, '') || 'image';
  return `${base}.${formatInfo(format).extension}`;
}

export interface SvgConversionPlan {
  /** The SVG's own size (width and height, else viewBox, else 300 by 150). */
  sourceWidth: number;
  sourceHeight: number;
  /** The size after crop, rotate and flip (the same as the source size when there are none). */
  editedWidth: number;
  editedHeight: number;
  targetWidth: number;
  targetHeight: number;
  format: OutputFormatId;
  mediaType: string;
  extension: string;
  qualityFraction: number;
  background: string;
  /** Present only when there are edits that change something. */
  edits?: EditPlan;
  warnings: string[];
}

/**
 * Plans the conversion of an SVG whose own size is already known (from
 * `svgSize`, after `scanSvg` accepted it): edits, then the resize, with the
 * same output pixel limit and the same quality and background handling as
 * `planConversion`.
 */
export function planSvgConversion(
  natural: { width: number; height: number },
  fileName: string,
  options: ConvertOptions,
): SvgConversionPlan {
  const editPlan = options.edits ? planEdits(natural.width, natural.height, options.edits) : undefined;
  const edits = editPlan && !editPlan.identity ? editPlan : undefined;
  const edited = edits
    ? { width: edits.width, height: edits.height }
    : { width: natural.width, height: natural.height };

  const sizePlan = planSize(edited, options.resize);
  const warnings = [...sizePlan.warnings];
  if (sizePlan.width * sizePlan.height > MAX_OUTPUT_PIXELS) {
    const largest = largestFittingSize(sizePlan.width, sizePlan.height, MAX_OUTPUT_PIXELS);
    throw new ImageConverterError(
      `Could not convert '${fileName}': the requested output is ${sizePlan.width} by ${sizePlan.height} pixels, ` +
        `above this browser's own ${MAX_OUTPUT_PIXELS.toLocaleString('en-US')}-pixel limit. The largest size that ` +
        `fits is ${largest.width} by ${largest.height}.`,
    );
  }

  const qualityFraction = clampQuality(options.quality, warnings);
  const background = parseBackground(options.background, warnings);

  warnings.push(
    'An SVG is drawn by this browser, so text in it uses this browser\x27s fonts, and the result can differ slightly between browsers.',
  );
  if (options.format === 'jpeg') {
    warnings.push(
      'An SVG with no background of its own is composited on the background colour for JPEG output, which has no transparency of its own.',
    );
  }

  const info = formatInfo(options.format);
  return {
    sourceWidth: natural.width,
    sourceHeight: natural.height,
    editedWidth: edited.width,
    editedHeight: edited.height,
    targetWidth: sizePlan.width,
    targetHeight: sizePlan.height,
    format: info.id,
    mediaType: info.mediaType,
    extension: info.extension,
    qualityFraction,
    background,
    ...(edits ? { edits } : {}),
    warnings,
  };
}

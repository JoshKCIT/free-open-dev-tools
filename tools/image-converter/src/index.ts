import meta from './meta.json';
import { assertFileKind, type FileKind, type SniffResult } from './file-sniff';
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

/** What a file over the size limit is told. The same sentence is used by the page before it reads anything and by the check below. */
export const FILE_TOO_LARGE_MESSAGE = 'This file is larger than 100 MB, the most this page accepts.';

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
  /** Every warning, the size warnings first. */
  warnings: string[];
  /** How many of the first `warnings` are about the requested size (and so are replaced when the plan is made again). */
  sizeWarningCount: number;
}

const HEX_COLOUR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** The refusal for an output over the pixel limit, naming the largest size of the same shape that fits. */
function tooLargeMessage(fileName: string, width: number, height: number): string {
  const largest = largestFittingSize(width, height, MAX_OUTPUT_PIXELS);
  return (
    `Could not convert '${fileName}': the requested output is ${width} by ${height} pixels, ` +
    `above this browser's own ${MAX_OUTPUT_PIXELS.toLocaleString('en-US')}-pixel limit. The largest size that ` +
    `fits is ${largest.width} by ${largest.height}.`
  );
}

/**
 * The refusal for edits that would draw an edited picture, before any resize, over the output pixel limit. The edited
 * picture is drawn once at its full size and then resized, and a canvas of that size is as large as one this tool
 * refuses as an output (a browser may draw one canvas in a different way than two, so a single combined draw was not
 * used: its pixels differ from the two-step result).
 */
function editedTooLargeMessage(fileName: string, width: number, height: number): string {
  return (
    `Could not convert '${fileName}': the cropped, rotated or flipped picture would be ${width} by ${height} pixels ` +
    `before it is resized, above this browser's own ${MAX_OUTPUT_PIXELS.toLocaleString('en-US')}-pixel limit. ` +
    'Crop it to a smaller area first.'
  );
}

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
 * Refuses a file that should not be read or decoded, before it is: one over 100 MB (judged from `byteLength`, the file's
 * own reported size, whatever the first bytes say), an empty one, one that is not a PNG, JPEG, GIF, WebP or BMP picture,
 * and one that declares more than 100,000,000 pixels. `header` is the first bytes of the file (at most MAX_HEADER_BYTES
 * are looked at). The size refusal is an `ImageConverterError`; the others are the `FileSignatureError` this tool has
 * always thrown, with the same words. Nothing in a message holds the file's own content or name.
 */
export function checkConverterFile(header: Uint8Array, byteLength: number): SniffResult {
  if (byteLength > MAX_INPUT_BYTES) throw new ImageConverterError(FILE_TOO_LARGE_MESSAGE);
  return assertFileKind(header, ACCEPTED_KINDS, { maxBytes: MAX_INPUT_BYTES, maxPixels: MAX_INPUT_PIXELS });
}

/**
 * Checks the file header, plans the output size and clamps every option,
 * without ever touching a canvas or a real image decoder -- that happens
 * only in the worker this package never imports. `byteLength` is the whole file's size when `bytes` holds only its
 * first part (the worker's case); left out, it is the length of `bytes`. Throws `ImageConverterError`
 * when the header check fails or the planned output would be too large for
 * this browser's own measured pixel ceiling to encode.
 */
export function planConversion(
  bytes: Uint8Array,
  fileName: string,
  options: ConvertOptions,
  byteLength: number = bytes.length,
): ConversionPlan {
  const sniffed = checkConverterFile(bytes, byteLength);
  if (sniffed.width === undefined || sniffed.height === undefined) {
    // Every kind in ACCEPTED_KINDS reports dimensions from its own header;
    // this only guards against a future accepted kind that does not.
    throw new ImageConverterError(`Could not read '${fileName}': its dimensions could not be determined.`);
  }
  const source: SizeSource = { width: sniffed.width, height: sniffed.height };

  // With edits, resizing measures the cropped and turned size. A JPEG may store its picture turned a quarter,
  // so its header size is only a first guess; the drawing site plans again from the decoded picture.
  let sizeSource: SizeSource = source;
  if (options.edits) {
    const edited = planEditedSize(source.width, source.height, options.edits, sniffed.kind === 'jpeg');
    sizeSource = { width: edited.width, height: edited.height };
    if (edited.changes && edited.width * edited.height > MAX_OUTPUT_PIXELS) {
      throw new ImageConverterError(editedTooLargeMessage(fileName, edited.width, edited.height));
    }
  }
  const sizePlan = planSize(sizeSource, options.resize);
  const warnings = [...sizePlan.warnings];

  if (sizePlan.width * sizePlan.height > MAX_OUTPUT_PIXELS) {
    throw new ImageConverterError(tooLargeMessage(fileName, sizePlan.width, sizePlan.height));
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
    sizeWarningCount: sizePlan.warnings.length,
  };
}

export interface DecodedReplan {
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  /** The plan's warnings with the size warnings made again for the decoded size (never both the old and the new). */
  warnings: string[];
  /** Crop, rotate and flip planned on the decoded picture; absent when there are none or they change nothing. */
  edits?: EditPlan;
}

/**
 * Plans the size again against the picture as it was really decoded. The header's size can differ from it (a JPEG
 * stored turned a quarter and shown upright by its orientation tag), and crop, rotate and flip are measured on the
 * decoded picture. When nothing differs the plan is returned as it is. Otherwise the size warnings of the first plan are
 * replaced by those of the new one, so a warning such as a clamped percent is told once, and the output size is held to
 * the same pixel limit with the same words as `planConversion`.
 */
export function replanForDecoded(
  plan: ConversionPlan,
  fileName: string,
  decoded: { width: number; height: number },
  options: ConvertOptions,
): DecodedReplan {
  let edits: EditPlan | undefined = options.edits ? planEdits(decoded.width, decoded.height, options.edits) : undefined;
  if (edits?.identity) edits = undefined;
  if (edits && edits.width * edits.height > MAX_OUTPUT_PIXELS) {
    throw new ImageConverterError(editedTooLargeMessage(fileName, edits.width, edits.height));
  }
  if (!edits && decoded.width === plan.sourceWidth && decoded.height === plan.sourceHeight) {
    return {
      sourceWidth: plan.sourceWidth,
      sourceHeight: plan.sourceHeight,
      targetWidth: plan.targetWidth,
      targetHeight: plan.targetHeight,
      warnings: plan.warnings,
    };
  }
  const resized = planSize(
    { width: edits?.width ?? decoded.width, height: edits?.height ?? decoded.height },
    options.resize,
  );
  if (resized.width * resized.height > MAX_OUTPUT_PIXELS) {
    throw new ImageConverterError(tooLargeMessage(fileName, resized.width, resized.height));
  }
  return {
    sourceWidth: decoded.width,
    sourceHeight: decoded.height,
    targetWidth: resized.width,
    targetHeight: resized.height,
    warnings: [...resized.warnings, ...plan.warnings.slice(plan.sizeWarningCount)],
    ...(edits ? { edits } : {}),
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
    throw new ImageConverterError(tooLargeMessage(fileName, sizePlan.width, sizePlan.height));
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

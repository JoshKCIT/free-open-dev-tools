import meta from './meta.json';

export { meta };
export * from './file-sniff';
export * from './page-sizes';
export * from './jpeg-orientation';

import { PDFDocument, type PDFImage } from '@cantoo/pdf-lib';
import { assertFileKind, type FileKind } from './file-sniff';
import { PAGE_SIZES, mmToPoints, type PageSizeName } from './page-sizes';
import { readJpegOrientation } from './jpeg-orientation';

export const MAX_IMAGES = 200;
export const MAX_TOTAL_BYTES = 300 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 100_000_000;

/** 96 pixels per inch, the CSS reference pixel this project's other tools already use, at 72 points per inch. */
const ACTUAL_SIZE_POINTS_PER_PIXEL = 72 / 96;

export interface ImageInput {
  name: string;
  bytes: Uint8Array;
  /** Only 'png' and 'jpeg' ever reach this package; other formats are converted to PNG by the worker first. */
  kind: 'png' | 'jpeg';
  /** Set by the caller when this image was converted from another format, for the placement report. */
  convertedFrom?: string;
}

export interface ImagesToPdfOptions {
  pageSize: PageSizeName | 'fit';
  orientation: 'portrait' | 'landscape' | 'auto';
  /** 0 to 50. */
  marginMm: number;
  fit: 'contain' | 'actual';
  order?: 'as-picked' | 'by-name';
  title?: string;
}

export interface ImagesToPdfHooks {
  onProgress?(fraction: number, detail: string): void;
  signal?: AbortSignal;
}

export interface PlacedImagePage {
  name: string;
  pageWidth: number;
  pageHeight: number;
  placedAt: string;
  note?: string;
}

export interface ImagesToPdfResult {
  bytes: Uint8Array;
  pages: PlacedImagePage[];
  warnings: string[];
}

export class ImageToPdfError extends Error {
  readonly reason: string;
  readonly fileName?: string;
  constructor(message: string, reason: string, fileName?: string) {
    super(message);
    this.name = 'ImageToPdfError';
    this.reason = reason;
    this.fileName = fileName;
  }
}

/**
 * The affine transform (`cm a b c d e f`, ISO 32000-1 8.3.4) that maps a
 * PDF image XObject's own unit square directly to a `width` by `height`
 * rectangle whose lower-left corner is `(x, y)`, oriented per CIPA
 * DC-008's own eight Exif Orientation values. Derived and verified against
 * the installed `@cantoo/pdf-lib` this session: passing this as
 * `drawImage`'s own `matrix` option together with `x: 0, y: 0, width: 1,
 * height: 1` (each otherwise a no-op identity transform in the operator
 * sequence `drawImage` itself builds) makes this matrix the image's entire
 * placement, with no further composition to reason about.
 */
export function orientationMatrix(
  orientation: number,
  x: number,
  y: number,
  width: number,
  height: number,
): [number, number, number, number, number, number] {
  switch (orientation) {
    case 2:
      return [-width, 0, 0, height, x + width, y];
    case 3:
      return [-width, 0, 0, -height, x + width, y + height];
    case 4:
      return [width, 0, 0, -height, x, y + height];
    case 5:
      return [0, -height, -width, 0, x + width, y + height];
    case 6:
      return [0, -height, width, 0, x, y + height];
    case 7:
      return [0, height, width, 0, x, y];
    case 8:
      return [0, height, -width, 0, x + width, y];
    default:
      return [width, 0, 0, height, x, y];
  }
}

/** Orientations 5 to 8 (a 90 or 270 degree rotation) swap which raw pixel axis is the upright width. */
function effectiveDimensions(
  rawWidth: number,
  rawHeight: number,
  orientation: number,
): { width: number; height: number } {
  return orientation >= 5 && orientation <= 8
    ? { width: rawHeight, height: rawWidth }
    : { width: rawWidth, height: rawHeight };
}

function checkAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new ImageToPdfError('The run was cancelled before it finished.', 'cancelled');
  }
}

/**
 * Places every image on its own PDF page, one image per page, with the
 * chosen page size, orientation, margin and fit. JPEGs are embedded
 * unchanged (`embedJpg`, never re-encoded); PNGs keep their own alpha as a
 * soft mask (`embedPng`). A JPEG's own Exif Orientation is read and applied
 * as a placement transform, never by re-encoding the pixel data.
 */
export async function imagesToPdf(
  images: ImageInput[],
  options: ImagesToPdfOptions,
  hooks: ImagesToPdfHooks = {},
): Promise<ImagesToPdfResult> {
  if (images.length === 0) {
    throw new ImageToPdfError('Pick at least one image.', 'no-images');
  }
  if (images.length > MAX_IMAGES) {
    throw new ImageToPdfError(`This tool places at most ${MAX_IMAGES} images in one run.`, 'too-many-images');
  }
  const totalBytes = images.reduce((sum, i) => sum + i.bytes.length, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new ImageToPdfError("The images picked add up to more than this tool's total size limit.", 'too-large');
  }
  checkAborted(hooks.signal);

  const ordered = options.order === 'by-name' ? [...images].sort((a, b) => a.name.localeCompare(b.name)) : images;

  const doc = await PDFDocument.create({ updateMetadata: false });
  const pages: PlacedImagePage[] = [];
  const warnings: string[] = [];
  const marginPt = mmToPoints(Math.min(50, Math.max(0, options.marginMm)));

  for (let i = 0; i < ordered.length; i++) {
    const input = ordered[i]!;
    checkAborted(hooks.signal);

    let sniffKind: FileKind;
    try {
      sniffKind = assertFileKind(input.bytes, ['png', 'jpeg'], {
        maxBytes: MAX_IMAGE_BYTES,
        maxPixels: MAX_IMAGE_PIXELS,
      }).kind;
    } catch (err) {
      throw new ImageToPdfError(
        err instanceof Error ? `Could not place '${input.name}': ${err.message}.` : `Could not place '${input.name}'.`,
        'unrecognised',
        input.name,
      );
    }

    let embedded: PDFImage;
    let orientation = 1;
    if (sniffKind === 'jpeg') {
      orientation = readJpegOrientation(input.bytes);
      embedded = await doc.embedJpg(input.bytes);
    } else {
      embedded = await doc.embedPng(input.bytes);
    }

    const { width: uprightWidth, height: uprightHeight } = effectiveDimensions(
      embedded.width,
      embedded.height,
      orientation,
    );

    let baseWidth: number;
    let baseHeight: number;
    if (options.pageSize === 'fit') {
      baseWidth = uprightWidth * ACTUAL_SIZE_POINTS_PER_PIXEL;
      baseHeight = uprightHeight * ACTUAL_SIZE_POINTS_PER_PIXEL;
    } else {
      const size = PAGE_SIZES[options.pageSize];
      baseWidth = size.width;
      baseHeight = size.height;
    }

    let pageWidth: number;
    let pageHeight: number;
    const wide = uprightWidth > uprightHeight;
    if (options.orientation === 'landscape' || (options.orientation === 'auto' && wide)) {
      pageWidth = Math.max(baseWidth, baseHeight);
      pageHeight = Math.min(baseWidth, baseHeight);
    } else {
      pageWidth = Math.min(baseWidth, baseHeight);
      pageHeight = Math.max(baseWidth, baseHeight);
    }

    const contentWidth = Math.max(1, pageWidth - 2 * marginPt);
    const contentHeight = Math.max(1, pageHeight - 2 * marginPt);

    let drawWidth: number;
    let drawHeight: number;
    let note: string | undefined;
    if (options.fit === 'actual') {
      drawWidth = uprightWidth * ACTUAL_SIZE_POINTS_PER_PIXEL;
      drawHeight = uprightHeight * ACTUAL_SIZE_POINTS_PER_PIXEL;
      if (drawWidth > contentWidth || drawHeight > contentHeight) {
        const scale = Math.min(contentWidth / drawWidth, contentHeight / drawHeight);
        drawWidth *= scale;
        drawHeight *= scale;
        note = 'scaled down to fit the page';
        warnings.push(`'${input.name}' did not fit at actual size and was scaled down.`);
      }
    } else {
      const rawScale = Math.min(contentWidth / uprightWidth, contentHeight / uprightHeight);
      drawWidth = uprightWidth * rawScale;
      drawHeight = uprightHeight * rawScale;
    }

    const x = marginPt + (contentWidth - drawWidth) / 2;
    const y = marginPt + (contentHeight - drawHeight) / 2;

    const page = doc.addPage([pageWidth, pageHeight]);
    const matrix = orientationMatrix(orientation, x, y, drawWidth, drawHeight);
    page.drawImage(embedded, { x: 0, y: 0, width: 1, height: 1, matrix });

    const placedAt = `${x.toFixed(2)}, ${y.toFixed(2)}`;
    pages.push({
      name: input.name,
      pageWidth: Math.round(pageWidth * 100) / 100,
      pageHeight: Math.round(pageHeight * 100) / 100,
      placedAt,
      note: input.convertedFrom ? `converted to PNG${note ? `, ${note}` : ''}` : note,
    });

    hooks.onProgress?.((i + 1) / ordered.length, `Placed ${input.name}`);
  }

  if (options.title) doc.setTitle(options.title);

  const bytes = await doc.save();
  return { bytes, pages, warnings };
}

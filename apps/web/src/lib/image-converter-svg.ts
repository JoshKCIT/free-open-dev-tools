/**
 * Draws a picked SVG file on the page and encodes it with the converter's own encoder, only when the visitor has ticked
 * Allow SVG input.
 *
 * Why the page thread: a worker has no `Image`, and `createImageBitmap` refuses SVG, so an SVG can only be drawn here
 * (research C12). The text is checked first by `scanSvg` (nothing it names outside itself is ever drawn), its size is
 * read by `svgSize` (refused over 40,000,000 pixels before any canvas exists), and it is shown to the browser through an
 * image whose address is a `data:` address built here from the text, never an object address: a picture loaded from a
 * data address loads nothing and runs nothing, and does not mark the canvas as holding another site's pixels.
 *
 * Every canvas made here stays a local variable, never attached to the document, so the picked file is never shown.
 */
import {
  ImageConverterError,
  ImageEditError,
  SvgGuardError,
  SvgSizeError,
  looksLikeSvg,
  looksLikeSvgStart,
  outputFileName,
  planSvgConversion,
  scanSvg,
  svgSize,
  type ConvertOptions,
} from '@fodt/image-converter';
import { encodeCanvasOnPage } from './run-image-converter-in-worker';
import type { RunContext } from './tool-ui';

/** The largest SVG file read: the text is checked, held and turned into an address, so it is held to a few megabytes. */
export const MAX_SVG_BYTES = 10 * 1024 * 1024;

/** Shown when the browser cannot draw the file (markup that is not a valid SVG document, or an engine failure). */
export const SVG_DRAW_FAILURE =
  'This browser could not draw this SVG. Check that it is one valid SVG document, then try again.';

export const SVG_TOO_LARGE = 'This SVG file is larger than 10 MiB, which is the most this page reads.';

const HEAD_BYTES = 1024;

export interface SvgConvertResult {
  bytes: Uint8Array;
  mediaType: string;
  fileName: string;
  sourceKind: 'svg';
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  warnings: string[];
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); // never appended to the document
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function contextOf(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not provide a 2D drawing surface for this image.');
  return context;
}

/**
 * The file's text when it is an SVG this page may read, or undefined when it is not one (so the ordinary refusal for a
 * file that is not a picture applies, unchanged). Refuses a file over 10 MiB that starts like an SVG.
 */
async function readSvgText(file: File): Promise<string | undefined> {
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  if (!looksLikeSvgStart(head)) return undefined;
  if (file.size > MAX_SVG_BYTES) throw new Error(SVG_TOO_LARGE);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikeSvg(bytes)) return undefined;
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Converts a picked file as an SVG when it is one, and returns undefined when it is not (the caller then takes its
 * ordinary path). Every error that leaves here has a fixed, plain message that never repeats the file's text.
 */
export async function rasterizeSvgFile(
  file: File,
  options: ConvertOptions,
  ctx: RunContext,
): Promise<SvgConvertResult | undefined> {
  try {
    const text = await readSvgText(file);
    if (text === undefined) return undefined;
    if (ctx.signal.aborted) throw new Error('The run was cancelled.');

    scanSvg(text);
    const natural = svgSize(text);
    const plan = planSvgConversion(natural, file.name, options);
    ctx.onProgress?.(1 / 3, 'Checked');

    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
    try {
      await image.decode();
    } catch {
      throw new Error(SVG_DRAW_FAILURE);
    }
    if (ctx.signal.aborted) throw new Error('The run was cancelled.');

    let finished: HTMLCanvasElement;
    if (plan.edits) {
      // Crop, rotate and flip are exact only on the SVG's own pixels, so it is drawn at its own size first, then
      // the edits are applied with the plan's whole-number transform, then the result is resized.
      const own = makeCanvas(natural.width, natural.height);
      contextOf(own).drawImage(image, 0, 0, natural.width, natural.height);
      const edited = makeCanvas(plan.edits.width, plan.edits.height);
      const editContext = contextOf(edited);
      editContext.imageSmoothingEnabled = false;
      const [a, b, c, d, e, f] = plan.edits.transform;
      editContext.setTransform(a, b, c, d, e, f);
      const s = plan.edits.source;
      editContext.drawImage(own, s.x, s.y, s.width, s.height, 0, 0, s.width, s.height);
      if (plan.targetWidth === edited.width && plan.targetHeight === edited.height) {
        finished = edited;
      } else {
        finished = makeCanvas(plan.targetWidth, plan.targetHeight);
        const resizeContext = contextOf(finished);
        resizeContext.imageSmoothingQuality = 'high';
        resizeContext.drawImage(edited, 0, 0, plan.targetWidth, plan.targetHeight);
      }
    } else {
      // No edits: the vector is drawn directly at the output size, so enlarging stays sharp.
      finished = makeCanvas(plan.targetWidth, plan.targetHeight);
      const drawContext = contextOf(finished);
      drawContext.imageSmoothingQuality = 'high';
      drawContext.drawImage(image, 0, 0, plan.targetWidth, plan.targetHeight);
    }
    ctx.onProgress?.(2 / 3, 'Drawn');
    if (ctx.signal.aborted) throw new Error('The run was cancelled.');

    const encoded = await encodeCanvasOnPage(finished, plan.format, plan.qualityFraction, plan.background);
    if (ctx.signal.aborted) throw new Error('The run was cancelled.');
    ctx.onProgress?.(1, 'Encoded');
    return {
      bytes: encoded.bytes,
      mediaType: encoded.mediaType,
      fileName: outputFileName(file.name, plan.format),
      sourceKind: 'svg',
      sourceWidth: natural.width,
      sourceHeight: natural.height,
      width: plan.targetWidth,
      height: plan.targetHeight,
      warnings: plan.warnings,
    };
  } catch (err) {
    if (ctx.signal.aborted) throw err;
    if (
      err instanceof SvgGuardError ||
      err instanceof SvgSizeError ||
      err instanceof ImageConverterError ||
      err instanceof ImageEditError
    ) {
      throw err;
    }
    if (err instanceof Error && (err.message === SVG_DRAW_FAILURE || err.message === SVG_TOO_LARGE)) throw err;
    if (err instanceof Error && err.message.startsWith('This browser ')) throw err;
    throw new Error(SVG_DRAW_FAILURE);
  }
}

/**
 * The page-side work of the Chart Maker: it puts the chart's SVG text into an image through a data address and draws that
 * image on a local canvas, which is never appended to the document, then encodes the canvas as a PNG.
 *
 * Everything runs on the page thread: the picture is a fixed 800 by 480 pixels, so drawing it at twice that size is short,
 * and `toBlob` is already asynchronous. The SVG is the one the package wrote; text in it uses system fonts and the file has
 * no outside reference, so the browser draws it from the text alone and nothing is requested.
 *
 * Nothing is fetched, stored, logged or kept here, and the canvas is a local variable.
 */
import { CHART_HEIGHT, CHART_WIDTH } from '@fodt/chart-maker';

const PNG_FAILED_MESSAGE = 'This browser could not draw the chart as a PNG.';
const PNG_CANCELLED_MESSAGE = 'The run was cancelled.';

/** The most the picture may be enlarged: at 4 times it is 3,200 by 1,920 pixels. */
const MAX_SCALE = 4;

/** A failure of this helper, with a fixed plain sentence (never any text from the chart). */
export class ChartPngError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChartPngError';
  }
}

/** A data address for an SVG text, so an image element can show it without any request. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Draws the SVG on a white canvas `scale` times its own size (a whole number from 1 to 4) and returns the PNG bytes.
 * Throws `ChartPngError` when the browser cannot load the SVG as an image, cannot make a 2D surface or cannot encode,
 * and when `signal` is aborted: the wait for the image stops at once and nothing more is drawn.
 */
export async function chartSvgToPng(svg: string, scale: number, signal?: AbortSignal): Promise<Uint8Array> {
  if (!Number.isInteger(scale) || scale < 1 || scale > MAX_SCALE) throw new ChartPngError(PNG_FAILED_MESSAGE);
  const width = CHART_WIDTH * scale;
  const height = CHART_HEIGHT * scale;

  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    const stop = (): void => reject(new ChartPngError(PNG_CANCELLED_MESSAGE));
    if (signal?.aborted) {
      stop();
      return;
    }
    signal?.addEventListener('abort', stop, { once: true });
    image.onload = () => {
      signal?.removeEventListener('abort', stop);
      resolve();
    };
    image.onerror = () => {
      signal?.removeEventListener('abort', stop);
      reject(new ChartPngError(PNG_FAILED_MESSAGE));
    };
  });
  image.src = svgDataUrl(svg);
  try {
    await loaded;
  } catch (err) {
    // A cancelled wait must not leave the image loading for nobody.
    image.onload = null;
    image.onerror = null;
    image.src = '';
    throw err;
  }
  if (signal?.aborted) throw new ChartPngError(PNG_CANCELLED_MESSAGE);

  const canvas = document.createElement('canvas'); // never appended to the document
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) throw new ChartPngError(PNG_FAILED_MESSAGE);
  // The chart has its own white background; the fill keeps the PNG opaque whatever the browser does at the edges.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (signal?.aborted) throw new ChartPngError(PNG_CANCELLED_MESSAGE);
  if (blob === null || blob.type !== 'image/png') throw new ChartPngError(PNG_FAILED_MESSAGE);
  return new Uint8Array(await blob.arrayBuffer());
}

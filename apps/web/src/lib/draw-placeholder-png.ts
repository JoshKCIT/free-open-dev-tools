/**
 * Draws the same picture `generatePlaceholder`'s own SVG describes, using
 * the browser's own canvas -- directly in the page thread (BP and BQ do not
 * apply to this tool: it reads no file, per D-10 it reruns as the visitor
 * types, and drawing a flat rectangle, a few lines and one line of text is
 * fast enough that a worker would only add a round trip, not responsiveness).
 * `OffscreenCanvas` is used when available; a plain, never-appended
 * `<canvas>` element is the fallback for a browser with none.
 */
import type { Pattern, PlaceholderResult } from '@fodt/placeholder-image';

export interface DrawPlaceholderOptions {
  background: string;
  foreground: string;
  fontFamily: string;
  fontSize: number;
  pattern: Pattern;
}

export async function drawPlaceholderPng(result: PlaceholderResult, options: DrawPlaceholderOptions): Promise<Blob> {
  const { width, height } = result;
  const hasOffscreen = typeof OffscreenCanvas !== 'undefined';
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  let toBlob: () => Promise<Blob>;

  if (hasOffscreen) {
    const canvas = new OffscreenCanvas(width, height);
    ctx = canvas.getContext('2d');
    toBlob = () => canvas.convertToBlob({ type: 'image/png' });
  } else {
    const canvas = document.createElement('canvas'); // never appended to the document
    canvas.width = width;
    canvas.height = height;
    ctx = canvas.getContext('2d');
    toBlob = () =>
      new Promise((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('This browser could not encode the image.'))),
          'image/png',
        );
      });
  }
  if (!ctx) throw new Error('This browser could not provide a 2D drawing surface for this image.');

  ctx.fillStyle = options.background;
  ctx.fillRect(0, 0, width, height);

  if (options.pattern !== 'none') {
    ctx.strokeStyle = options.foreground;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (options.pattern === 'cross') {
      ctx.moveTo(0, 0);
      ctx.lineTo(width, height);
      ctx.moveTo(width, 0);
      ctx.lineTo(0, height);
    } else {
      for (let i = 1; i < 10; i++) {
        const x = Math.round((width * i) / 10);
        const y = Math.round((height * i) / 10);
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
    }
    ctx.stroke();
  }

  ctx.fillStyle = options.foreground;
  ctx.font = `${options.fontSize}px ${options.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(result.label, Math.round(width / 2), Math.round(height / 2));

  const blob = await toBlob();
  // D-139: a browser's own encoder can silently substitute a different
  // format from the one requested; PNG is universally supported so this is
  // not expected to ever fire, but the check costs nothing and matches
  // every other canvas-encoding tool in this phase.
  if (blob.type !== 'image/png') {
    throw new Error(`This browser could not encode a PNG; it produced ${blob.type || 'an unknown format'} instead.`);
  }
  return blob;
}

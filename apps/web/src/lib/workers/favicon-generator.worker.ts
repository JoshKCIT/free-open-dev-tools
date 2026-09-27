/**
 * Draws every standard favicon size from text, an emoji or a picked image,
 * checks a picked image's header before any real decoding, and hands the
 * finished PNG bytes back for the page to build the ICO container and the
 * downloadable files from -- all inside this worker, so the tab that
 * constructed it stays responsive and a picked image is never sent
 * anywhere. All logic that plans a favicon or writes the ICO container
 * lives in the tool package (@fodt/favicon-generator); this file only owns
 * decoding an image and drawing with canvas APIs the package itself never
 * names, and the message protocol back to the page.
 *
 * Engine fallback (measured this session, matching 08-09's and 09-03
 * Task 1's identical finding, not merely assumed): this project's tested
 * WebKit build has no `OffscreenCanvas` anywhere at all, including in a
 * worker, so text drawn with `fillText` and an image drawn with
 * `drawImage` both move to the page thread's own canvas on that engine
 * (confirmed separately this session: chromium and firefox both draw text
 * correctly inside a worker's own `OffscreenCanvas`, so the split the plan
 * anticipated -- an engine with `OffscreenCanvas` that still cannot draw
 * text in it -- was not observed on any of the three tested engines; the
 * only split that exists here is "has OffscreenCanvas anywhere" or not).
 */
import {
  planFavicon,
  assertFileKind,
  FaviconError,
  FileSignatureError,
  MAX_HEADER_BYTES,
  MAX_INPUT_BYTES,
  MAX_INPUT_PIXELS,
  type FaviconOptions,
  type FaviconPlan,
} from '@fodt/favicon-generator';

/** The six sizes this tool always draws. Kept local (not imported from FAVICON_SET) so this file never needs to know file names, only pixel sizes. */
const SIZES = [16, 32, 48, 180, 192, 512] as const;

export interface FaviconGeneratorJobMessage {
  type: 'favicon-generator-job';
  options: FaviconOptions;
  /** Present only when `options.source === 'image'`. */
  bytes?: ArrayBuffer;
  fileName?: string;
  /**
   * A test-only affordance: an artificial pause after each size is encoded,
   * so the browser test suite can reliably observe an in-flight run and
   * click Cancel before a real favicon build -- six small canvases, done in
   * well under a second -- would otherwise ever give it the chance to.
   * Absent (every real run), this changes nothing.
   */
  testStepDelayMs?: number;
}

export interface FaviconGeneratorProgressMessage {
  type: 'favicon-generator-progress';
  fraction: number;
  detail: string;
}

export interface FaviconGeneratorDoneMessage {
  type: 'favicon-generator-done';
  /** Size to PNG bytes, one per entry in `SIZES`. */
  pngs: Record<number, ArrayBuffer>;
  warnings: string[];
}

export interface FaviconGeneratorErrorMessage {
  type: 'favicon-generator-error';
  message: string;
}

export interface FaviconGeneratorNeedsPageCanvasMessage {
  type: 'favicon-generator-needs-page-canvas';
  plan: FaviconPlan;
  bitmap: ImageBitmap | null;
  testStepDelayMs?: number;
}

export type FaviconGeneratorWorkerMessage =
  | FaviconGeneratorProgressMessage
  | FaviconGeneratorDoneMessage
  | FaviconGeneratorErrorMessage
  | FaviconGeneratorNeedsPageCanvasMessage;

interface WorkerGlobal {
  postMessage(message: FaviconGeneratorWorkerMessage, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<FaviconGeneratorJobMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

function hasOffscreenCanvas(): boolean {
  return typeof OffscreenCanvas !== 'undefined';
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  size: number,
  radius: number,
): void {
  ctx.moveTo(radius, 0);
  ctx.arcTo(size, 0, size, size, radius);
  ctx.arcTo(size, size, 0, size, radius);
  ctx.arcTo(0, size, 0, 0, radius);
  ctx.arcTo(0, 0, size, 0, radius);
}

function applyShapeClip(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  size: number,
  shape: string,
): void {
  if (shape === 'square') return;
  ctx.beginPath();
  if (shape === 'circle') {
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  } else {
    roundedRectPath(ctx, size, size * 0.2);
  }
  ctx.closePath();
  ctx.clip();
}

function drawImageInto(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  size: number,
  bitmap: ImageBitmap,
  fit: string,
  paddingPercent: number,
): void {
  const iw = bitmap.width;
  const ih = bitmap.height;
  const box = fit === 'contain' ? size * (1 - (paddingPercent / 100) * 2) : size;
  const scale = fit === 'contain' ? Math.min(box / iw, box / ih) : Math.max(size / iw, size / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(bitmap, (size - dw) / 2, (size - dh) / 2, dw, dh);
}

export function drawFaviconSize(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  size: number,
  plan: FaviconPlan,
  bitmap: ImageBitmap | null,
): void {
  ctx.clearRect(0, 0, size, size);
  // Apple's own developer documentation: an apple-touch-icon must not rely
  // on transparency, since iOS fills a transparent one in black -- always
  // opaque here regardless of the visitor's own `transparent` choice.
  const forceOpaque = size === 180;
  const opaque = forceOpaque || !plan.transparent;
  if (opaque) {
    ctx.fillStyle = plan.background;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.save();
  applyShapeClip(ctx, size, plan.shape);
  if (plan.source === 'image' && bitmap) {
    drawImageInto(ctx, size, bitmap, plan.fit, plan.paddingPercent);
  } else {
    const text = plan.source === 'emoji' ? plan.emoji : plan.text;
    ctx.fillStyle = plan.foreground;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const weight = plan.bold ? 'bold ' : '';
    let fontSize = Math.round(size * 0.6);
    ctx.font = `${weight}${fontSize}px ${plan.font}`;
    while (fontSize > 4 && ctx.measureText(text).width > size * 0.88) {
      fontSize -= 1;
      ctx.font = `${weight}${fontSize}px ${plan.font}`;
    }
    ctx.fillText(text, size / 2, size / 2 + size * 0.02);
  }
  ctx.restore();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function encodeAllSizes(
  plan: FaviconPlan,
  bitmap: ImageBitmap | null,
  stepDelay: number | undefined,
): Promise<{ pngs: Record<number, ArrayBuffer>; warnings: string[] }> {
  const pngs: Record<number, ArrayBuffer> = {};
  const warnings = [...plan.warnings];
  let done = 0;
  for (const size of SIZES) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new FaviconError('This browser could not provide a 2D drawing surface for the favicon.');
    drawFaviconSize(ctx, size, plan, bitmap);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    // D-139: read the returned blob's own type, never assume PNG encoding
    // succeeded just because a blob came back.
    if (blob.type !== 'image/png') {
      throw new FaviconError('This browser cannot write PNG images, so no favicon could be produced.');
    }
    pngs[size] = await blob.arrayBuffer();
    done++;
    workerGlobal.postMessage({
      type: 'favicon-generator-progress',
      fraction: done / SIZES.length,
      detail: `${size}px drawn`,
    });
    if (stepDelay) await sleep(stepDelay);
  }
  return { pngs, warnings };
}

async function handleJob(job: FaviconGeneratorJobMessage): Promise<void> {
  let bitmap: ImageBitmap | null = null;
  let transferredOwnership = false;
  try {
    const plan = planFavicon(job.options);

    if (job.options.source === 'image') {
      if (!job.bytes) throw new FaviconError('No image was given.');
      // Header check first, before any real decoding.
      const headerBytes = new Uint8Array(job.bytes, 0, Math.min(job.bytes.byteLength, MAX_HEADER_BYTES));
      assertFileKind(headerBytes, ['png', 'jpeg', 'gif', 'webp', 'bmp'], {
        maxBytes: MAX_INPUT_BYTES,
        maxPixels: MAX_INPUT_PIXELS,
      });
      const blob = new Blob([job.bytes]);
      bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    }

    if (!hasOffscreenCanvas()) {
      const forThePage = bitmap;
      transferredOwnership = forThePage !== null;
      workerGlobal.postMessage(
        { type: 'favicon-generator-needs-page-canvas', plan, bitmap: forThePage, testStepDelayMs: job.testStepDelayMs },
        forThePage ? [forThePage] : [],
      );
      return;
    }

    const { pngs, warnings } = await encodeAllSizes(plan, bitmap, job.testStepDelayMs);
    const transferables = Object.values(pngs);
    workerGlobal.postMessage({ type: 'favicon-generator-done', pngs, warnings }, transferables);
  } catch (err) {
    workerGlobal.postMessage({
      type: 'favicon-generator-error',
      message:
        err instanceof FaviconError || err instanceof FileSignatureError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'This favicon could not be built for an unknown reason.',
    });
  } finally {
    if (!transferredOwnership) bitmap?.close();
  }
}

workerGlobal.addEventListener('message', (event) => {
  void handleJob(event.data);
});

/** The page's own driver builds the ICO from these sizes' own PNG bytes; exported so it never needs to duplicate this list. */
export { SIZES as FAVICON_DRAW_SIZES };

import { test, expect, type Page } from '@playwright/test';
import { writePng, buildFixtureFile } from './fixture-files';

/**
 * The dedicated capability, conversion, orientation, hostile-file, pixel-
 * limit and Cancel proofs for Image Converter & Resizer, on top of the
 * phase-wide proof `e2e/file-tools.spec.ts` already runs.
 *
 * [09-03 deviation] The plan's own text names `e2e/hash-file.spec.ts` as the
 * source for `rel()`, a request recorder and the Run/Cancel helpers.
 * `hash-file.spec.ts` defines `rel()` and Run/Cancel helpers but -- exactly
 * as 09-02's own SUMMARY records finding for the same instruction -- has no
 * request-recording logic at all (grepped directly, confirmed absent). The
 * request recorder here is copied in shape from `e2e/pdf-to-image.spec.ts`'s
 * own `withRequestRecorder` instead, which does exist.
 */
const rel = (path: string) => path.replace(/^\//, '');

declare global {
  interface Window {
    __FODT_IMAGE_CONVERTER_TEST_STEP_DELAY_MS__?: number;
  }
}

async function withRequestRecorder(page: Page, action: () => Promise<void>): Promise<string[]> {
  const requests: string[] = [];
  const handler = (req: import('@playwright/test').Request) => {
    const url = req.url();
    if (!url.startsWith('data:') && !url.startsWith('blob:')) requests.push(`${req.method()} ${url}`);
  };
  page.on('request', handler);
  try {
    await action();
  } finally {
    page.off('request', handler);
  }
  return requests;
}

function runButtonOf(page: Page) {
  return page.getByRole('button', { name: 'Run', exact: true });
}

async function pressRun(page: Page): Promise<void> {
  await runButtonOf(page).click();
  await expect(runButtonOf(page)).toHaveText('Run', { timeout: 30_000 });
}

async function attachFile(page: Page, name: string, mimeType: string, buffer: Uint8Array): Promise<void> {
  await page.locator('#f-file').setInputFiles({ name, mimeType, buffer: Buffer.from(buffer) });
}

function outputOf(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

/** A real, solid-colour, decodable PNG (writePng deflates real pixel content, unlike this file's own JPEG stub). */
function solidPng(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = rgb[0];
    rgba[i * 4 + 1] = rgb[1];
    rgba[i * 4 + 2] = rgb[2];
    rgba[i * 4 + 3] = 255;
  }
  return writePng(width, height, rgba);
}

function isJpegSignature(bytes: Buffer): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}
function isWebpSignature(bytes: Buffer): boolean {
  return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
}
function isAvifSignature(bytes: Buffer): boolean {
  return bytes.subarray(4, 8).toString('ascii') === 'ftyp' && bytes.subarray(8, 12).toString('ascii').startsWith('av');
}

const OUTPUT_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/avif'] as const;

/**
 * Probes this real browser engine itself -- the worker's own
 * `OffscreenCanvas.convertToBlob`, or the page-thread fallback on an engine
 * with no `OffscreenCanvas` in a worker at all -- never trusting this
 * project's own probe code as its own oracle for what it claims to report.
 */
async function probeThisEngine(page: Page): Promise<Record<string, string>> {
  return page.evaluate(async (types) => {
    const workerSrc = `
      self.onmessage = async () => {
        if (typeof OffscreenCanvas === 'undefined') { self.postMessage(null); return; }
        const canvas = new OffscreenCanvas(2, 2);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(0, 0, 2, 2);
        const out = {};
        for (const t of ${JSON.stringify(types)}) {
          try { const b = await canvas.convertToBlob({ type: t }); out[t] = b.type; } catch { out[t] = ''; }
        }
        self.postMessage(out);
      };
    `;
    const blob = new Blob([workerSrc], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const fromWorker: Record<string, string> | null = await new Promise((resolve) => {
      const worker = new Worker(url);
      const timer = setTimeout(() => {
        worker.terminate();
        resolve(null);
      }, 10_000);
      worker.onmessage = (e) => {
        clearTimeout(timer);
        worker.terminate();
        resolve(e.data);
      };
      worker.onerror = () => {
        clearTimeout(timer);
        worker.terminate();
        resolve(null);
      };
      worker.postMessage('go');
    });
    if (fromWorker) return fromWorker;

    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 2, 2);
    const out: Record<string, string> = {};
    for (const t of types) {
      const b = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((bl) => (bl ? resolve(bl) : reject(new Error('null blob'))), t),
      );
      out[t] = b.type;
    }
    return out;
  }, OUTPUT_MEDIA_TYPES);
}

async function keyValuePairs(page: Page): Promise<[string, string][]> {
  return page.locator('dl.kv').evaluate((dl) => {
    const dts = Array.from(dl.querySelectorAll('dt')).map((e) => e.textContent ?? '');
    const dds = Array.from(dl.querySelectorAll('dd')).map((e) => e.textContent ?? '');
    return dts.map((k, i) => [k, dds[i] ?? ''] as [string, string]);
  });
}

test('image-converter reports exactly the formats this browser writes, judged by the blob type it returns', async ({
  page,
}) => {
  await page.goto(rel('/tools/image-converter'));
  await page.waitForLoadState('networkidle');

  const actual = await probeThisEngine(page);
  await attachFile(page, 'sample.png', 'image/png', solidPng(4, 4, [255, 0, 0]));
  await pressRun(page);

  const pairs = await keyValuePairs(page);
  const byLabel = Object.fromEntries(pairs);
  const expected: Record<string, string> = {
    PNG: actual['image/png'] === 'image/png' ? 'Yes' : 'No',
    JPEG: actual['image/jpeg'] === 'image/jpeg' ? 'Yes' : 'No',
    WebP: actual['image/webp'] === 'image/webp' ? 'Yes' : 'No',
    AVIF: actual['image/avif'] === 'image/avif' ? 'Yes' : 'No',
  };
  for (const label of ['PNG', 'JPEG', 'WebP', 'AVIF']) {
    expect(
      byLabel[label],
      `${label}: reported ${byLabel[label]}, engine actually returned ${JSON.stringify(actual)}`,
    ).toBe(expected[label]);
  }
});

test('image-converter converts PNG to JPEG, and to WebP and AVIF where this browser writes them, with the requested dimensions and the right signature', async ({
  page,
}) => {
  await page.goto(rel('/tools/image-converter'));
  await page.waitForLoadState('networkidle');
  const actual = await probeThisEngine(page);

  const formats: { value: string; label: string; mediaType: string; check: (b: Buffer) => boolean }[] = [
    { value: 'jpeg', label: 'JPEG', mediaType: 'image/jpeg', check: isJpegSignature },
    { value: 'webp', label: 'WebP', mediaType: 'image/webp', check: isWebpSignature },
    { value: 'avif', label: 'AVIF', mediaType: 'image/avif', check: isAvifSignature },
  ];

  for (const format of formats) {
    await page.goto(rel('/tools/image-converter'));
    await page.waitForLoadState('networkidle');
    await attachFile(page, 'sample.png', 'image/png', solidPng(8, 8, [0, 255, 0]));
    await page.locator('#f-format').selectOption(format.value);

    const writable = actual[format.mediaType] === format.mediaType;
    await pressRun(page);

    if (writable) {
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).first().click();
      const download = await downloadPromise;
      const path = await download.path();
      expect(path).not.toBeNull();
      const fs = await import('node:fs');
      const bytes = fs.readFileSync(path!);
      expect(
        format.check(bytes),
        `expected ${format.label} signature, got ${bytes.subarray(0, 12).toString('hex')}`,
      ).toBe(true);
      await expect(outputOf(page)).toContainText('8 × 8');
    } else {
      await expect(outputOf(page)).toContainText(`This browser cannot write ${format.label} images`);
      expect(await page.locator('li:has-text("Download")').count()).toBe(0);
    }
  }
});

test('image-converter applies EXIF orientation so the output is upright', async ({ page }) => {
  await page.goto(rel('/tools/image-converter'));
  await page.waitForLoadState('networkidle');

  // A real, browser-encoded JPEG (left half red, right half blue) with a
  // hand-built EXIF APP1 segment (Orientation 6) spliced in right after SOI
  // -- a real decoder, not a header-only stub, since this test proves real
  // pixel content ends up the right way round.
  const bytes: number[] = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 8;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 8, 8);
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(8, 0, 8, 8);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.95));
    const raw = new Uint8Array(await blob.arrayBuffer());
    // APP1: marker (FFE1), length (0x001E), "Exif\0\0", then a TIFF header
    // (II, 42, IFD at offset 8) with one entry: tag 0x0112 (Orientation),
    // type SHORT (3), count 1, value 6.
    const app1 = new Uint8Array([
      0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01,
      0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    const spliced = new Uint8Array(2 + app1.length + (raw.length - 2));
    spliced.set(raw.subarray(0, 2), 0);
    spliced.set(app1, 2);
    spliced.set(raw.subarray(2), 2 + app1.length);
    return Array.from(spliced);
  });

  await attachFile(page, 'oriented.jpg', 'image/jpeg', Uint8Array.from(bytes));
  await page.locator('#f-format').selectOption('png');
  await pressRun(page);

  await expect(outputOf(page)).toContainText('8 × 16');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).first().click();
  const download = await downloadPromise;
  const path = await download.path();
  const fs = await import('node:fs');
  const outBytes = fs.readFileSync(path!);

  const pixelCheck = await page.evaluate(async (base64) => {
    const bin = atob(base64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const top = ctx.getImageData(Math.floor(bitmap.width / 2), 1, 1, 1).data;
    const bottom = ctx.getImageData(Math.floor(bitmap.width / 2), bitmap.height - 2, 1, 1).data;
    return { width: bitmap.width, height: bitmap.height, top: Array.from(top), bottom: Array.from(bottom) };
  }, outBytes.toString('base64'));

  expect(pixelCheck.width).toBe(8);
  expect(pixelCheck.height).toBe(16);
  expect(pixelCheck.top[0]).toBeGreaterThan(150); // upright: the source's left (red) half is now on top
  expect(pixelCheck.top[2]).toBeLessThan(100);
  expect(pixelCheck.bottom[2]).toBeGreaterThan(150); // the source's right (blue) half is now on the bottom
});

test('image-converter refuses an SVG and a non-image before decoding and sends nothing', async ({ page }) => {
  await page.goto(rel('/tools/image-converter'));
  await page.waitForLoadState('networkidle');

  const requests = await withRequestRecorder(page, async () => {
    await attachFile(
      page,
      'x.svg',
      'image/svg+xml',
      new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.invalid/x.png"/></svg>',
      ),
    );
    await pressRun(page);
  });
  expect(requests).toEqual([]);
  await expect(outputOf(page)).toContainText('Could not convert');

  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  const requests2 = await withRequestRecorder(page, async () => {
    await attachFile(page, 'x.png', 'image/png', new TextEncoder().encode('just plain text, not an image at all'));
    await pressRun(page);
  });
  expect(requests2).toEqual([]);
  await expect(outputOf(page)).toContainText('Could not convert');
});

test('image-converter refuses an output size over the pixel limit before creating a canvas', async ({ page }) => {
  await page.goto(rel('/tools/image-converter'));
  await page.waitForLoadState('networkidle');
  await attachFile(page, 'tiny.png', 'image/png', solidPng(8, 8, [255, 0, 0]));
  await page.locator('input[name="resize"][value="exact"]').check();
  await page.locator('#f-width').fill('10000');
  await page.locator('#f-height').fill('10000');

  const requests = await withRequestRecorder(page, async () => {
    await pressRun(page);
  });
  expect(requests).toEqual([]);
  await expect(outputOf(page)).toContainText('pixel limit');
});

test('image-converter shows progress, stops on Cancel and the page keeps answering', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    window.__FODT_IMAGE_CONVERTER_TEST_STEP_DELAY_MS__ = 400;
  });
  await page.goto(rel('/tools/image-converter'));
  await page.waitForLoadState('networkidle');

  const { name, mimeType, buffer } = buildFixtureFile('png-large', 'FODT-TEST-MARKER');
  await attachFile(page, name, mimeType, buffer);

  const runButton = runButtonOf(page);
  await runButton.click();

  const cancelButton = page.getByRole('button', { name: 'Cancel', exact: true });
  await expect(cancelButton).toBeVisible({ timeout: 30_000 });

  const progressEl = page.locator('progress.tool-progress');
  const seen = new Set<number>();
  const deadline = Date.now() + 60_000;
  while (seen.size < 1 && Date.now() < deadline) {
    if ((await progressEl.count()) > 0) {
      const value = await progressEl.evaluate((el) => (el as HTMLProgressElement).value);
      seen.add(value);
    }
    if ((await cancelButton.count()) === 0) break;
    await page.waitForTimeout(5);
  }
  expect(seen.size, `observed progress values: ${[...seen].join(', ')}`).toBeGreaterThanOrEqual(1);

  await cancelButton.click();
  const note = page.locator('section[aria-label="Output"] .note-warn');
  await expect(note).toHaveText('Cancelled before finishing. No result was produced.');
  await expect(runButton).toBeEnabled();

  // The page keeps answering: five round trips, each comfortably fast (BQ).
  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    await page.evaluate(() => 1 + 1);
    expect(Date.now() - start).toBeLessThan(1000);
  }
});

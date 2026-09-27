import { test, expect, type Page } from '@playwright/test';
import { writePng } from './fixture-files';

/**
 * The dedicated ICO-decode, hostile-file and Cancel proofs for Favicon
 * Generator, on top of the phase-wide proof `e2e/file-tools.spec.ts`
 * already runs.
 *
 * [09-03 deviation] As Task 1's own spec already notes, the plan's text
 * names `e2e/hash-file.spec.ts` for a request recorder that does not exist
 * there; copied in shape from `e2e/pdf-to-image.spec.ts`'s own
 * `withRequestRecorder` instead.
 */
const rel = (path: string) => path.replace(/^\//, '');

declare global {
  interface Window {
    __FODT_FAVICON_GENERATOR_TEST_STEP_DELAY_MS__?: number;
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

function outputOf(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

async function downloadNamed(page: Page, name: string): Promise<Buffer> {
  const li = page.locator('li', { hasText: name });
  const downloadPromise = page.waitForEvent('download');
  await li.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const fs = await import('node:fs');
  return fs.readFileSync(path!);
}

function pngDimensions(bytes: Buffer): { width: number; height: number } {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function icoDirectory(bytes: Buffer): { width: number; height: number; length: number; offset: number }[] {
  const count = bytes.readUInt16LE(4);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const base = 6 + i * 16;
    const rawW = bytes.readUInt8(base);
    const rawH = bytes.readUInt8(base + 1);
    entries.push({
      width: rawW === 0 ? 256 : rawW,
      height: rawH === 0 ? 256 : rawH,
      length: bytes.readUInt32LE(base + 8),
      offset: bytes.readUInt32LE(base + 12),
    });
  }
  return entries;
}

/** Decodes bytes with the page's own createImageBitmap, returning the real decoded size. */
async function decodedSize(page: Page, bytes: Buffer): Promise<{ width: number; height: number }> {
  return page.evaluate(async (base64) => {
    const bin = atob(base64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);
    return { width: bitmap.width, height: bitmap.height };
  }, bytes.toString('base64'));
}

test('favicon-generator builds an ICO this browser decodes at every size, from text, an emoji and an image', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(rel('/tools/favicon-generator'));
  await page.waitForLoadState('networkidle');

  // Text source (the page's own default: "Ab").
  await pressRun(page);
  const ico1 = await downloadNamed(page, 'favicon.ico');
  const dir1 = icoDirectory(ico1);
  expect(dir1.map((e) => e.width)).toEqual([16, 32, 48]);
  for (const entry of dir1) {
    const pngBytes = ico1.subarray(entry.offset, entry.offset + entry.length);
    const decoded = await decodedSize(page, pngBytes);
    expect(decoded).toEqual({ width: entry.width, height: entry.height });
  }
  const icoWhole = await decodedSize(page, ico1);
  expect(icoWhole.width).toBeGreaterThan(0);

  const png16a = await downloadNamed(page, 'favicon-16x16.png');
  expect(pngDimensions(png16a)).toEqual({ width: 16, height: 16 });
  const png32a = await downloadNamed(page, 'favicon-32x32.png');
  expect(pngDimensions(png32a)).toEqual({ width: 32, height: 32 });
  const apple1 = await downloadNamed(page, 'apple-touch-icon.png');
  expect(pngDimensions(apple1)).toEqual({ width: 180, height: 180 });

  // Emoji source.
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.locator('input[name="source"][value="emoji"]').check();
  await pressRun(page);
  const ico2 = await downloadNamed(page, 'favicon.ico');
  expect(icoDirectory(ico2).map((e) => e.width)).toEqual([16, 32, 48]);

  // Image source.
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.locator('input[name="source"][value="image"]').check();
  await page.locator('#f-file').setInputFiles({
    name: 'sample.png',
    mimeType: 'image/png',
    buffer: Buffer.from(writePng(64, 64, solidRgba(64, 64))),
  });
  await pressRun(page);
  const ico3 = await downloadNamed(page, 'favicon.ico');
  const dir3 = icoDirectory(ico3);
  expect(dir3.map((e) => e.width)).toEqual([16, 32, 48]);
  for (const entry of dir3) {
    const pngBytes = ico3.subarray(entry.offset, entry.offset + entry.length);
    const decoded = await decodedSize(page, pngBytes);
    expect(decoded).toEqual({ width: entry.width, height: entry.height });
  }
});

function solidRgba(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = 0;
    rgba[i * 4 + 1] = 128;
    rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

test('favicon-generator refuses an SVG and a non-image before decoding and sends nothing', async ({ page }) => {
  await page.goto(rel('/tools/favicon-generator'));
  await page.waitForLoadState('networkidle');
  await page.locator('input[name="source"][value="image"]').check();

  const requests = await withRequestRecorder(page, async () => {
    await page.locator('#f-file').setInputFiles({
      name: 'x.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.invalid/x.png"/></svg>',
      ),
    });
    await pressRun(page);
  });
  expect(requests).toEqual([]);
  await expect(outputOf(page)).toContainText('Could not build');

  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.locator('input[name="source"][value="image"]').check();
  const requests2 = await withRequestRecorder(page, async () => {
    await page.locator('#f-file').setInputFiles({
      name: 'x.png',
      mimeType: 'image/png',
      buffer: Buffer.from('just plain text, not an image at all'),
    });
    await pressRun(page);
  });
  expect(requests2).toEqual([]);
  await expect(outputOf(page)).toContainText('Could not build');
});

test('favicon-generator shows progress, stops on Cancel and the page keeps answering', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    window.__FODT_FAVICON_GENERATOR_TEST_STEP_DELAY_MS__ = 400;
  });
  await page.goto(rel('/tools/favicon-generator'));
  await page.waitForLoadState('networkidle');
  await page.locator('input[name="source"][value="image"]').check();
  await page.locator('#f-file').setInputFiles({
    name: 'sample.png',
    mimeType: 'image/png',
    buffer: Buffer.from(writePng(64, 64, solidRgba(64, 64))),
  });

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

  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    await page.evaluate(() => 1 + 1);
    expect(Date.now() - start).toBeLessThan(1000);
  }
});

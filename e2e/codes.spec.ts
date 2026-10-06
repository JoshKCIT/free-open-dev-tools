import { test, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

/**
 * Four-browser decode of qr-generator's and barcode-generator's own output,
 * drawn from the page's own rendered SVG (and, for QR, the downloaded PNG
 * too) into a canvas inside the browser and decoded with a real reader.
 * `jsQR`'s and `@zxing/library`'s UMD builds are resolved from each tool's own
 * installed `node_modules` with `createRequire`, served by `page.route` at an
 * address under the site's own origin and loaded as a script element with that
 * `src`. Every page now carries a policy whose `script-src` allows only the
 * site itself, so the reader must arrive as a same-origin script: an inline
 * script (what the add-script-tag helper of the test library inserts) is refused, and the
 * policy-bypass option is never used. The reader is served from the test
 * process, so nothing leaves the machine.
 */
const rel = (path: string) => path.replace(/^\//, '');

/**
 * Serves the library file at `address` (a path under the page's own origin)
 * with a JavaScript type, loads it as a script element and waits for it to run.
 * It is loaded before the request listener of each test is attached, so the
 * test's own "no request other than data: and blob:" assertion covers every
 * request the tool page makes while it works and never the reader's own load.
 */
async function loadSameOriginScript(page: Page, address: string, filePath: string): Promise<void> {
  const body = readFileSync(filePath, 'utf8');
  await page.route(
    (url) => url.pathname === address,
    (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body }),
  );
  await page.evaluate(
    (src) =>
      new Promise<void>((resolve, reject) => {
        const element = document.createElement('script');
        element.addEventListener('load', () => resolve(), { once: true });
        element.addEventListener('error', () => reject(new Error(`the script ${src} did not load`)), { once: true });
        element.src = src;
        document.head.append(element);
      }),
    address,
  );
}

const qrGeneratorRequire = createRequire(new URL('../tools/qr-generator/package.json', import.meta.url));
const JSQR_PATH = qrGeneratorRequire.resolve('jsqr/dist/jsQR.js');

const barcodeGeneratorRequire = createRequire(new URL('../tools/barcode-generator/package.json', import.meta.url));
const ZXING_PATH = barcodeGeneratorRequire.resolve('@zxing/library/umd/index.js');

declare global {
  interface Window {
    jsQR: (
      data: Uint8ClampedArray,
      width: number,
      height: number,
      options?: { inversionAttempts?: string },
    ) => { data: string } | null;
    ZXing: {
      MultiFormatReader: new () => {
        decode: (bitmap: unknown, hints?: Map<unknown, unknown>) => { getText(): string };
      };
      RGBLuminanceSource: new (luminances: Uint8ClampedArray, width: number, height: number) => unknown;
      HybridBinarizer: new (source: unknown) => unknown;
      BinaryBitmap: new (binarizer: unknown) => unknown;
      DecodeHintType: { POSSIBLE_FORMATS: unknown };
      BarcodeFormat: Record<string, unknown>;
    };
  }
}

/** Reads a labelled `code`/`text` output block's own displayed value. */
async function readOutputCode(page: Page, label: string): Promise<string> {
  const block = page.locator('.output-block', { has: page.locator('.output-label span', { hasText: label }) });
  return await block.locator('pre.output').innerText();
}

/**
 * `<pre>`'s own rendered `innerText()` can normalise CRLF line breaks
 * (present verbatim in a vCard payload) differently across browser
 * engines; this normalises both a DOM-read value and a decoder-read value
 * the same way before comparing, so the comparison is about the encoded
 * content, not a browser's own text-node line-ending quirk.
 */
function normalizeLineEndings(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Reads one row's value from a `keyvalue` output block by its key. */
async function readKeyValue(page: Page, key: string): Promise<string> {
  const dt = page.locator('dl.kv dt', { hasText: key });
  return (await dt.locator('xpath=following-sibling::dd[1]').innerText()).trim();
}

/** Draws the page's own displayed image (an `<img src="data:...">`) into an
 * in-page canvas and decodes it with `window.jsQR`. */
async function decodeDisplayedImageWithJsQr(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const img = document.querySelector<HTMLImageElement>('.output-block img')!;
    if (!img.complete) await new Promise((resolve) => img.addEventListener('load', resolve, { once: true }));
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = window.jsQR(imageData.data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
    return result ? result.data : null;
  });
}

/** Downloads the file the PNG `files` output block offers, hands its bytes
 * to the page as a blob URL, draws it into a canvas and decodes it with
 * `window.jsQR`. */
async function decodeDownloadedPngWithJsQr(page: Page): Promise<string | null> {
  const downloadPromise = page.waitForEvent('download');
  const pngBlock = page.locator('.output-block', { has: page.locator('.output-label span', { hasText: 'PNG' }) });
  await pngBlock.locator('button', { hasText: 'Download' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  const bytes = path ? readFileSync(path) : Buffer.alloc(0);
  const base64 = bytes.toString('base64');
  return page.evaluate(async (b64) => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await new Promise((resolve, reject) => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', reject, { once: true });
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = window.jsQR(imageData.data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
      return result ? result.data : null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }, base64);
}

/** Draws the page's own displayed barcode image into a canvas and decodes
 * it with `window.ZXing`'s `MultiFormatReader`, restricted to `format`. */
async function decodeDisplayedBarcodeWithZxing(page: Page, formatName: string): Promise<string | null> {
  return page.evaluate(async (fmt) => {
    const img = document.querySelector<HTMLImageElement>('.output-block img')!;
    if (!img.complete) await new Promise((resolve) => img.addEventListener('load', resolve, { once: true }));
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const luminance = new Uint8ClampedArray(canvas.width * canvas.height);
    for (let i = 0; i < luminance.length; i++) luminance[i] = imageData.data[i * 4]!;
    const { RGBLuminanceSource, HybridBinarizer, BinaryBitmap, MultiFormatReader, DecodeHintType, BarcodeFormat } =
      window.ZXing;
    const source = new RGBLuminanceSource(luminance, canvas.width, canvas.height);
    const bitmap = new BinaryBitmap(new HybridBinarizer(source));
    const reader = new MultiFormatReader();
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat[fmt]]);
    try {
      return reader.decode(bitmap, hints).getText();
    } catch {
      return null;
    }
  }, formatName);
}

test('qr-generator output decodes back to the exact payload for every payload kind in this browser', async ({
  page,
}) => {
  const requests: string[] = [];
  await page.goto(rel('/tools/qr-generator'));
  await page.waitForLoadState('networkidle');
  await loadSameOriginScript(page, '/__fodt-jsqr.js', JSQR_PATH);
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    requests.push(`${request.method()} ${url}`);
  });
  expect(await page.evaluate(() => typeof window.jsQR)).toBe('function');

  const scenarios: { kind: string; fields: Record<string, string> }[] = [
    { kind: 'text', fields: { text: 'Hello, world' } },
    { kind: 'url', fields: { url: 'https://example.invalid/a?b=c' } },
    { kind: 'wifi', fields: { ssid: 'CafeNet', password: 'letmein1', security: 'WPA' } },
    { kind: 'vcard', fields: { givenName: 'Ada', familyName: 'Lovelace' } },
    { kind: 'email', fields: { to: 'user@example.invalid', subject: 'Hi' } },
    { kind: 'sms', fields: { number: '+15551234567', message: 'hi' } },
  ];

  for (const scenario of scenarios) {
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.locator(`input[type="radio"][name="kind"][value="${scenario.kind}"]`).check();
    for (const [field, value] of Object.entries(scenario.fields)) {
      if (field === 'security') {
        await page.locator(`#f-${field}`).selectOption(value);
        continue;
      }
      await page.locator(`#f-${field}`).fill(value);
    }
    await page.waitForTimeout(150);

    const encodedText = normalizeLineEndings(await readOutputCode(page, 'Encoded text'));
    expect(encodedText.length, scenario.kind).toBeGreaterThan(0);

    const fromImage = await decodeDisplayedImageWithJsQr(page);
    expect(fromImage === null ? null : normalizeLineEndings(fromImage), `${scenario.kind}: displayed SVG`).toBe(
      encodedText,
    );

    const fromPng = await decodeDownloadedPngWithJsQr(page);
    expect(fromPng === null ? null : normalizeLineEndings(fromPng), `${scenario.kind}: downloaded PNG`).toBe(
      encodedText,
    );
  }

  expect(requests, 'a request was made other than data:/blob: while decoding qr-generator output').toEqual([]);
});

test('barcode-generator output decodes back to the exact data for every symbology in this browser', async ({
  page,
}) => {
  const requests: string[] = [];
  await page.goto(rel('/tools/barcode-generator'));
  await page.waitForLoadState('networkidle');
  await loadSameOriginScript(page, '/__fodt-zxing.js', ZXING_PATH);
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    requests.push(`${request.method()} ${url}`);
  });
  expect(await page.evaluate(() => typeof window.ZXing)).toBe('object');

  const scenarios: { symbology: string; data: string; format: string }[] = [
    { symbology: 'code128', data: 'Wikipedia', format: 'CODE_128' },
    { symbology: 'ean13', data: '400638133393', format: 'EAN_13' },
    { symbology: 'ean8', data: '4006381', format: 'EAN_8' },
    { symbology: 'upca', data: '03600024145', format: 'UPC_A' },
  ];

  for (const scenario of scenarios) {
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.locator('#f-symbology').selectOption(scenario.symbology);
    await page.locator('#f-data').fill(scenario.data);
    await page.locator('#f-moduleWidth').fill('3');
    await page.waitForTimeout(150);

    const encoded = await readOutputCode(page, 'SVG');
    expect(encoded.length, scenario.symbology).toBeGreaterThan(0);
    const encodedText = await readKeyValue(page, 'Encoded');

    const decoded = await decodeDisplayedBarcodeWithZxing(page, scenario.format);
    const expected = scenario.symbology === 'code128' ? scenario.data : encodedText;
    expect(decoded, scenario.symbology).toBe(expected);
  }

  expect(requests, 'a request was made other than data:/blob: while decoding barcode-generator output').toEqual([]);
});

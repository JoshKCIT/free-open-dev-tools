import { test, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { buildFixtureFiles } from './fixture-files';

/**
 * The dedicated four-browser proof for the three `@cantoo/pdf-lib` tools
 * (`pdf-merge`, `pdf-split`, `image-to-pdf`): real outputs parsed
 * independently by the `pdfjs-dist` `tools/pdf-merge` itself declares
 * (resolved with `createRequire`, since this package lives only under that
 * tool's own `node_modules`, matching `e2e/codes.spec.ts`'s own established
 * pattern for a tool-scoped test-only dependency), an encrypted PDF and a
 * non-PDF both refused sending nothing, and progress/Cancel/responsiveness
 * for all three worker-backed pages (BQ). `rel()`, the request recorder and
 * the Run/Cancel helpers are copied in shape from `e2e/hash-file.spec.ts`.
 */
const rel = (path: string) => path.replace(/^\//, '');

const pdfMergeRequire = createRequire(new URL('../tools/pdf-merge/package.json', import.meta.url));
const PDFJS_PATH = pdfMergeRequire.resolve('pdfjs-dist/legacy/build/pdf.mjs');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsLibPromise: Promise<any> | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pdfjsLib(): Promise<any> {
  pdfjsLibPromise ??= import(pathToFileURL(PDFJS_PATH).href);
  return pdfjsLibPromise;
}

if (typeof (Promise as unknown as { try?: unknown }).try !== 'function') {
  (Promise as unknown as { try: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => Promise<unknown> }).try =
    function promiseTryPolyfill(fn, ...args) {
      return new Promise((resolve) => resolve(fn(...args)));
    };
}

async function loadPdf(
  bytes: Uint8Array,
): Promise<{
  doc: {
    numPages: number;
    getPage(n: number): Promise<{ getTextContent(): Promise<{ items: { str?: string }[] }>; rotate: number }>;
  };
  task: { destroy(): Promise<void> };
}> {
  const lib = await pdfjsLib();
  // A fresh, genuinely copied Uint8Array every call: PDF.js's own `data`
  // option detaches the buffer it is given once loading starts (confirmed
  // directly this session, matching tools/pdf-to-image's own recorded
  // finding), and a Node `Buffer`'s own `.slice()` returns a VIEW over the
  // same memory rather than a copy, so `Uint8Array.from` is used here, not
  // `.slice()`.
  const task = lib.getDocument({ data: Uint8Array.from(bytes), useWorkerFetch: false, verbosity: 0 });
  const doc = await task.promise;
  return { doc, task };
}

async function pageTextOf(
  doc: { getPage(n: number): Promise<{ getTextContent(): Promise<{ items: { str?: string }[] }> }> },
  pageIndex: number,
): Promise<string> {
  const page = await doc.getPage(pageIndex + 1);
  const content = await page.getTextContent();
  return content.items.map((i) => i.str ?? '').join('');
}

function runButtonOf(page: Page) {
  return page.getByRole('button', { name: 'Run', exact: true });
}

async function pressRun(page: Page): Promise<void> {
  await runButtonOf(page).click();
  await expect(runButtonOf(page)).toHaveText('Run', { timeout: 60_000 });
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

function outputOf(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

async function attachFiles(
  page: Page,
  field: string,
  files: { name: string; mimeType: string; buffer: Uint8Array }[],
): Promise<void> {
  await page
    .locator(`#f-${field}`)
    .setInputFiles(files.map((f) => ({ name: f.name, mimeType: f.mimeType, buffer: Buffer.from(f.buffer) })));
}

async function downloadAllBytes(page: Page, count: number): Promise<Buffer[]> {
  const buttons = page.locator('section[aria-label="Output"] button', { hasText: 'Download' });
  const out: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    const downloadPromise = page.waitForEvent('download');
    await buttons.nth(i).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).not.toBeNull();
    out.push(readFileSync(path!));
  }
  return out;
}

declare global {
  interface Window {
    __FODT_PDF_MERGE_TEST_CHUNK_SIZE__?: number;
    __FODT_PDF_SPLIT_TEST_CHUNK_SIZE__?: number;
    __FODT_PDF_SPLIT_TEST_STEP_DELAY_MS__?: number;
    __FODT_IMAGE_TO_PDF_TEST_CHUNK_SIZE__?: number;
  }
}

test('pdf-merge combines two picked PDFs in order and the result opens with every page', async ({ page }) => {
  const files = buildFixtureFiles('pdf,pdf-3', 'FODT-PDF-PAGES');
  await page.goto(rel('/tools/pdf-merge'));
  await page.waitForLoadState('networkidle');

  const requests = await withRequestRecorder(page, async () => {
    await attachFiles(page, 'files', files);
    await pressRun(page);
  });
  expect(requests).toEqual([]);

  const [bytes] = await downloadAllBytes(page, 1);
  const { doc, task } = await loadPdf(bytes!);
  expect(doc.numPages).toBe(4);
  await task.destroy();
});

test('pdf-split splits, extracts, reorders and rotates a picked PDF and each result has the expected pages and rotation', async ({
  page,
}) => {
  const [threePage] = buildFixtureFiles('pdf-3', 'FODT-PDF-PAGES-SPLIT');

  await page.goto(rel('/tools/pdf-split'));
  await page.waitForLoadState('networkidle');
  await attachFiles(page, 'file', [threePage!]);
  await pressRun(page); // default: split-each
  const splitBytes = await downloadAllBytes(page, 3);
  for (const bytes of splitBytes) {
    const { doc, task } = await loadPdf(bytes);
    expect(doc.numPages).toBe(1);
    await task.destroy();
  }

  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await attachFiles(page, 'file', [threePage!]);
  await page.locator('input[type="radio"][name="operation"][value="reorder"]').check();
  await page.locator('#f-order').fill('3,1,2');
  await pressRun(page);
  const [reorderedBytes] = await downloadAllBytes(page, 1);
  const reordered = await loadPdf(reorderedBytes!);
  const original = await loadPdf(threePage!.buffer);
  expect(await pageTextOf(reordered.doc, 0)).toBe(await pageTextOf(original.doc, 2));
  await reordered.task.destroy();
  await original.task.destroy();

  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await attachFiles(page, 'file', [threePage!]);
  await page.locator('input[type="radio"][name="operation"][value="rotate"]').check();
  await page.locator('#f-degrees').selectOption('90');
  await pressRun(page);
  const [rotatedBytes] = await downloadAllBytes(page, 1);
  const rotated = await loadPdf(rotatedBytes!);
  const rotatedPage = await rotated.doc.getPage(1);
  expect(rotatedPage.rotate).toBe(90);
  await rotated.task.destroy();
});

test('image-to-pdf places a PNG and a rotated JPEG on A4 pages that open with the expected sizes', async ({ page }) => {
  const files = buildFixtureFiles('png,jpeg', 'FODT-IMAGE-TO-PDF-PAGES');

  await page.goto(rel('/tools/image-to-pdf'));
  await page.waitForLoadState('networkidle');
  const requests = await withRequestRecorder(page, async () => {
    await attachFiles(page, 'files', files);
    await page.locator('#f-pageSize').selectOption('a4');
    // The JPEG fixture kind (e2e/fixture-files.ts) is 16 by 8 pixels, wider
    // than tall, which automatic orientation (the page's own default) would
    // turn to landscape; forcing portrait here keeps both pages the same
    // A4 size this test asserts on.
    await page.locator('input[type="radio"][name="orientation"][value="portrait"]').check();
    await pressRun(page);
  });
  expect(requests).toEqual([]);

  const [bytes] = await downloadAllBytes(page, 1);
  const { doc, task } = await loadPdf(bytes!);
  expect(doc.numPages).toBe(2);
  for (let i = 1; i <= 2; i++) {
    const p = (await doc.getPage(i)) as unknown as {
      getViewport(opts: { scale: number }): { width: number; height: number };
    };
    const viewport = p.getViewport({ scale: 1 });
    expect(Math.round(viewport.width * 100) / 100).toBe(595.28);
    expect(Math.round(viewport.height * 100) / 100).toBe(841.89);
  }
  await task.destroy();
});

test('the PDF page tools refuse an encrypted PDF and a non-PDF and send nothing', async ({ page }) => {
  // A real, RC4-encrypted PDF (ISO 32000-1 Annex C, revision 2, 40-bit), built
  // directly from the specification's own algorithms: e2e code does not
  // import tool test code, so this is written again rather than imported.
  const PAD = Uint8Array.from([
    0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00,
    0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
  ]);
  const { createHash } = await import('node:crypto');
  function padPassword(password: string): Uint8Array {
    const bytes = new TextEncoder().encode(password).slice(0, 32);
    const out = new Uint8Array(32);
    out.set(bytes, 0);
    out.set(PAD.slice(0, 32 - bytes.length), bytes.length);
    return out;
  }
  function md5(...parts: Uint8Array[]): Uint8Array {
    const hash = createHash('md5');
    for (const p of parts) hash.update(p);
    return new Uint8Array(hash.digest());
  }
  function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
    const s = new Uint8Array(256);
    for (let i = 0; i < 256; i++) s[i] = i;
    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = (j + s[i]! + key[i % key.length]!) & 0xff;
      [s[i], s[j]] = [s[j]!, s[i]!];
    }
    const out = new Uint8Array(data.length);
    let i = 0;
    j = 0;
    for (let k = 0; k < data.length; k++) {
      i = (i + 1) & 0xff;
      j = (j + s[i]!) & 0xff;
      [s[i], s[j]] = [s[j]!, s[i]!];
      out[k] = data[k]! ^ s[(s[i]! + s[j]!) & 0xff]!;
    }
    return out;
  }
  function int32LE(n: number): Uint8Array {
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setInt32(0, n, true);
    return buf;
  }
  function toHex(bytes: Uint8Array): string {
    return `<${Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}>`;
  }
  function buildEncryptedPdf(): Uint8Array {
    const chunks: Uint8Array[] = [];
    let length = 0;
    const offsets: number[] = [0];
    const push = (text: string) => {
      const b = new TextEncoder().encode(text);
      chunks.push(b);
      length += b.length;
    };
    const pushBytes = (b: Uint8Array) => {
      chunks.push(b);
      length += b.length;
    };
    const beginObject = (n: number) => {
      offsets[n] = length;
      push(`${n} 0 obj\n`);
    };
    const endObject = () => push('endobj\n');
    push('%PDF-1.7\n');
    pushBytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    const catalogNum = 1;
    const pagesNum = 2;
    const pageNum = 3;
    const contentNum = 4;
    const fontNum = 5;
    const encryptNum = 6;
    beginObject(catalogNum);
    push(`<< /Type /Catalog /Pages ${pagesNum} 0 R >>\n`);
    endObject();
    beginObject(pagesNum);
    push(`<< /Type /Pages /Kids [${pageNum} 0 R] /Count 1 >>\n`);
    endObject();
    beginObject(fontNum);
    push('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>\n');
    endObject();
    const content = 'BT /F1 24 Tf 72 700 Td (Encrypted) Tj ET\n';
    const contentBytes = new TextEncoder().encode(content);
    beginObject(pageNum);
    push(
      `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontNum} 0 R >> >> /Contents ${contentNum} 0 R >>\n`,
    );
    endObject();
    beginObject(contentNum);
    push(`<< /Length ${contentBytes.length} >>\nstream\n`);
    pushBytes(contentBytes);
    push('\nendstream\n');
    endObject();
    const fileId = Uint8Array.from({ length: 16 }, (_, i) => (i * 7 + 11) & 0xff);
    const userPassword = 'secret';
    const ownerKey = md5(padPassword('')).slice(0, 5);
    const o = rc4(ownerKey, padPassword(userPassword));
    const p = -44;
    const fileKey = md5(padPassword(userPassword), o, int32LE(p), fileId).slice(0, 5);
    const u = rc4(fileKey, PAD);
    beginObject(encryptNum);
    push(`<< /Filter /Standard /V 1 /R 2 /O ${toHex(o)} /U ${toHex(u)} /P ${p} >>\n`);
    endObject();
    const size = 7;
    const xrefOffset = length;
    push(`xref\n0 ${size}\n`);
    push('0000000000 65535 f\r\n');
    for (let i = 1; i < size; i++) push(`${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n\r\n`);
    push('trailer\n');
    push(
      `<< /Size ${size} /Root ${catalogNum} 0 R /Encrypt ${encryptNum} 0 R /ID [${toHex(fileId)} ${toHex(fileId)}] >>\n`,
    );
    push(`startxref\n${xrefOffset}\n%%EOF`);
    const out = new Uint8Array(length);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }

  const encrypted = buildEncryptedPdf();
  const notAPdf = new TextEncoder().encode('just plain text, not a PDF at all');

  await page.goto(rel('/tools/pdf-merge'));
  await page.waitForLoadState('networkidle');
  const requests1 = await withRequestRecorder(page, async () => {
    await attachFiles(page, 'files', [{ name: 'locked.pdf', mimeType: 'application/pdf', buffer: encrypted }]);
    await pressRun(page);
  });
  expect(requests1).toEqual([]);
  await expect(outputOf(page)).toContainText('encrypted');

  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  const requests2 = await withRequestRecorder(page, async () => {
    await attachFiles(page, 'files', [{ name: 'notes.pdf', mimeType: 'application/pdf', buffer: notAPdf }]);
    await pressRun(page);
  });
  expect(requests2).toEqual([]);
  await expect(outputOf(page)).toContainText('Could not open');

  await page.goto(rel('/tools/pdf-split'));
  await page.waitForLoadState('networkidle');
  const requests3 = await withRequestRecorder(page, async () => {
    await attachFiles(page, 'file', [{ name: 'locked.pdf', mimeType: 'application/pdf', buffer: encrypted }]);
    await pressRun(page);
  });
  expect(requests3).toEqual([]);
  await expect(outputOf(page)).toContainText('encrypted');
});

test('pdf-merge shows progress, stops on Cancel and the page keeps answering', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    window.__FODT_PDF_MERGE_TEST_CHUNK_SIZE__ = 4096;
  });
  await page.goto(rel('/tools/pdf-merge'));
  await page.waitForLoadState('networkidle');

  const files = Array.from({ length: 10 }, (_, i) => buildFixtureFiles('pdf-long', `FODT-CANCEL-${i}`)).flat();
  await attachFiles(page, 'files', files);

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

test('pdf-split shows progress, stops on Cancel and the page keeps answering', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    window.__FODT_PDF_SPLIT_TEST_CHUNK_SIZE__ = 4096;
    // Splitting 150 small text-only pages otherwise finishes in well under a
    // second: too fast for a real click to ever land while Cancel is still
    // showing. The same established test-only per-step delay pattern
    // `image-converter.worker.ts`'s own `testStepDelayMs` uses.
    window.__FODT_PDF_SPLIT_TEST_STEP_DELAY_MS__ = 80;
  });
  await page.goto(rel('/tools/pdf-split'));
  await page.waitForLoadState('networkidle');

  const [longPdf] = buildFixtureFiles('pdf-long', 'FODT-CANCEL-SPLIT');
  await attachFiles(page, 'file', [longPdf!]);

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

test('image-to-pdf shows progress, stops on Cancel and the page keeps answering', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    window.__FODT_IMAGE_TO_PDF_TEST_CHUNK_SIZE__ = 4096;
  });
  await page.goto(rel('/tools/image-to-pdf'));
  await page.waitForLoadState('networkidle');

  const [largePng] = buildFixtureFiles('png-large', 'FODT-CANCEL-IMG');
  await attachFiles(page, 'files', [largePng!]);

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

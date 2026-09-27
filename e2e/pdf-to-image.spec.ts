import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';

/**
 * The dedicated hostile, font, decoder, script, password and Cancel proofs
 * for PDF to Image, on top of the phase-wide proof
 * `e2e/file-tools.spec.ts` already runs. Builds its own PDF fixtures by
 * hand, from ISO 32000-1's own object/xref/trailer grammar (the same
 * approach `tools/pdf-to-image/test/minimal-pdf.ts` and
 * `e2e/fixture-files.ts` both take, written again here rather than
 * imported: e2e code does not import tool test code).
 */
const rel = (path: string) => path.replace(/^\//, '');

// --- A small, hand-written PDF writer, local to this spec -------------------

const STANDARD_FONTS = [
  'Times-Roman',
  'Helvetica',
  'Courier',
  'Symbol',
  'Times-Bold',
  'Helvetica-Bold',
  'Courier-Bold',
  'ZapfDingbats',
  'Times-Italic',
  'Helvetica-Oblique',
  'Courier-Oblique',
  'Times-BoldItalic',
  'Helvetica-BoldOblique',
  'Courier-BoldOblique',
] as const;
type StandardFontName = (typeof STANDARD_FONTS)[number];

interface TestPdfPage {
  lines?: { text: string; font: StandardFontName; y: number }[];
  cjkText?: boolean;
  linkUri?: string;
}

interface TestPdfOptions {
  pages: TestPdfPage[];
  userPassword?: string;
  openActionJavaScript?: string;
}

function escapePdfString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

const PAD = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00,
  0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

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

function toHexString(bytes: Uint8Array): string {
  return `<${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}>`;
}

class PdfBuilder {
  private chunks: Uint8Array[] = [];
  private length = 0;
  private offsets: number[] = [0];
  push(text: string): void {
    const bytes = new TextEncoder().encode(text);
    this.chunks.push(bytes);
    this.length += bytes.length;
  }
  pushBytes(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }
  get currentOffset(): number {
    return this.length;
  }
  beginObject(num: number): void {
    this.offsets[num] = this.currentOffset;
    this.push(`${num} 0 obj\n`);
  }
  endObject(): void {
    this.push('endobj\n');
  }
  build(rootNum: number, size: number, encrypt?: { encryptNum: number; fileId: Uint8Array }): Uint8Array {
    const xrefOffset = this.currentOffset;
    this.push(`xref\n0 ${size}\n`);
    this.push('0000000000 65535 f\r\n');
    for (let i = 1; i < size; i++) {
      const offset = this.offsets[i] ?? 0;
      this.push(`${String(offset).padStart(10, '0')} 00000 n\r\n`);
    }
    this.push('trailer\n');
    const idEntry = encrypt ? ` /ID [${toHexString(encrypt.fileId)} ${toHexString(encrypt.fileId)}]` : '';
    const encryptEntry = encrypt ? ` /Encrypt ${encrypt.encryptNum} 0 R` : '';
    this.push(`<< /Size ${size} /Root ${rootNum} 0 R${encryptEntry}${idEntry} >>\n`);
    this.push(`startxref\n${xrefOffset}\n%%EOF`);
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

function buildTestPdf(options: TestPdfOptions): Buffer {
  const pdf = new PdfBuilder();
  pdf.push('%PDF-1.7\n');
  pdf.pushBytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  let nextObjNum = 1;
  const catalogNum = nextObjNum++;
  const pagesNum = nextObjNum++;

  const needsCjkFont = options.pages.some((p) => p.cjkText);
  let cjkType0Num: number | null = null;
  let cjkDescendantNum: number | null = null;
  let cjkDescriptorNum: number | null = null;
  if (needsCjkFont) {
    cjkType0Num = nextObjNum++;
    cjkDescendantNum = nextObjNum++;
    cjkDescriptorNum = nextObjNum++;
  }

  const fontNames = new Set<StandardFontName>();
  for (const p of options.pages) for (const l of p.lines ?? []) fontNames.add(l.font);
  const fontObjNums = new Map<StandardFontName, number>();
  for (const name of fontNames) fontObjNums.set(name, nextObjNum++);

  const pageNums: number[] = [];
  const contentNums: number[] = [];
  const annotNums: (number | null)[] = [];
  for (const p of options.pages) {
    pageNums.push(nextObjNum++);
    contentNums.push(nextObjNum++);
    annotNums.push(p.linkUri ? nextObjNum++ : null);
  }
  const encryptNum = options.userPassword !== undefined ? nextObjNum++ : null;

  pdf.beginObject(catalogNum);
  const openAction = options.openActionJavaScript
    ? ` /OpenAction << /Type /Action /S /JavaScript /JS (${escapePdfString(options.openActionJavaScript)}) >>`
    : '';
  pdf.push(`<< /Type /Catalog /Pages ${pagesNum} 0 R${openAction} >>\n`);
  pdf.endObject();

  pdf.beginObject(pagesNum);
  pdf.push(`<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageNums.length} >>\n`);
  pdf.endObject();

  for (const [name, num] of fontObjNums) {
    pdf.beginObject(num);
    pdf.push(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} >>\n`);
    pdf.endObject();
  }

  if (needsCjkFont) {
    pdf.beginObject(cjkDescriptorNum!);
    pdf.push(
      '<< /Type /FontDescriptor /FontName /Ryumin-Light /Flags 4 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 1000 /Descent -200 /CapHeight 1000 /StemV 0 >>\n',
    );
    pdf.endObject();
    pdf.beginObject(cjkDescendantNum!);
    pdf.push(
      `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /Ryumin-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> /FontDescriptor ${cjkDescriptorNum} 0 R /DW 1000 >>\n`,
    );
    pdf.endObject();
    pdf.beginObject(cjkType0Num!);
    pdf.push(
      `<< /Type /Font /Subtype /Type0 /BaseFont /Ryumin-Light /Encoding /UniJIS-UCS2-H /DescendantFonts [${cjkDescendantNum} 0 R] >>\n`,
    );
    pdf.endObject();
  }

  for (let i = 0; i < options.pages.length; i++) {
    const page = options.pages[i]!;
    const pageNum = pageNums[i]!;
    const contentNum = contentNums[i]!;
    const annotNum = annotNums[i];
    const fontRefs = new Map<StandardFontName, number>();
    let content = '';
    let fCounter = 1;
    for (const line of page.lines ?? []) {
      let resName = [...fontRefs.entries()].find(([n]) => n === line.font)?.[1];
      if (resName === undefined) {
        resName = fCounter++;
        fontRefs.set(line.font, resName);
      }
      content += `BT /F${resName} 18 Tf 72 ${line.y} Td (${escapePdfString(line.text)}) Tj ET\n`;
    }
    if (page.cjkText) {
      content += `BT /FCJK 18 Tf 72 100 Td <3042> Tj ET\n`;
    }

    const fontDictEntries = [...fontRefs.entries()]
      .map(([font, num]) => `/F${num} ${fontObjNums.get(font)} 0 R`)
      .join(' ');
    const cjkEntry = page.cjkText ? ` /FCJK ${cjkType0Num} 0 R` : '';
    const annotsEntry = annotNum !== null ? ` /Annots [${annotNum} 0 R]` : '';

    pdf.beginObject(pageNum);
    pdf.push(
      `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 612 792] /Resources << /Font << ${fontDictEntries}${cjkEntry} >> >> /Contents ${contentNum} 0 R${annotsEntry} >>\n`,
    );
    pdf.endObject();

    if (annotNum != null) {
      pdf.beginObject(annotNum);
      pdf.push(
        `<< /Type /Annot /Subtype /Link /Rect [72 700 400 720] /Border [0 0 0] /A << /Type /Action /S /URI /URI (${page.linkUri}) >> >>\n`,
      );
      pdf.endObject();
    }

    const contentBytes = new TextEncoder().encode(content);
    pdf.beginObject(contentNum);
    pdf.push(`<< /Length ${contentBytes.length} >>\nstream\n`);
    pdf.pushBytes(contentBytes);
    pdf.push('\nendstream\n');
    pdf.endObject();
  }

  if (encryptNum !== null) {
    const fileId = Uint8Array.from({ length: 16 }, (_, i) => (i * 7 + 11) & 0xff);
    const ownerKey = md5(padPassword('')).slice(0, 5);
    const o = rc4(ownerKey, padPassword(options.userPassword!));
    const p = -44;
    const fileKey = md5(padPassword(options.userPassword!), o, int32LE(p), fileId).slice(0, 5);
    const u = rc4(fileKey, PAD);
    pdf.beginObject(encryptNum);
    pdf.push(`<< /Filter /Standard /V 1 /R 2 /O ${toHexString(o)} /U ${toHexString(u)} /P ${p} >>\n`);
    pdf.endObject();
    return Buffer.from(pdf.build(catalogNum, nextObjNum, { encryptNum, fileId }));
  }

  return Buffer.from(pdf.build(catalogNum, nextObjNum));
}

function fourteenFontPdf(): Buffer {
  return buildTestPdf({
    pages: [{ lines: STANDARD_FONTS.map((font, i) => ({ text: `${font} line`, font, y: 750 - i * 50 })) }],
  });
}

// --- Page helpers -------------------------------------------------------

async function attachPdf(page: Page, bytes: Buffer, name = 'sample.pdf'): Promise<void> {
  await page.locator('#f-file').setInputFiles({ name, mimeType: 'application/pdf', buffer: bytes });
}

function runButtonOf(page: Page) {
  return page.getByRole('button', { name: 'Run', exact: true });
}

async function pressRun(page: Page): Promise<void> {
  await runButtonOf(page).click();
  await expect(runButtonOf(page)).toHaveText('Run', { timeout: 30_000 });
}

declare global {
  interface Window {
    __FODT_PDF_TO_IMAGE_TEST_HOOKS__?: { requests: { kind: string; filename: string; served: boolean }[] };
    __FODT_PDF_TO_IMAGE_TEST_STALL_MS__?: number;
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

test('pdf-to-image renders text in each of the fourteen standard fonts without any request', async ({ page }) => {
  await page.addInitScript(() => {
    window.__FODT_PDF_TO_IMAGE_TEST_HOOKS__ = { requests: [] };
  });
  await page.goto(rel('/tools/pdf-to-image'));
  await page.waitForLoadState('networkidle');

  const requests = await withRequestRecorder(page, async () => {
    await attachPdf(page, fourteenFontPdf());
    await pressRun(page);
  });

  expect(requests).toEqual([]);
  await expect(page.locator('section[aria-label="Output"]')).toContainText('Pages rendered');

  const log = await page.evaluate(() => window.__FODT_PDF_TO_IMAGE_TEST_HOOKS__?.requests ?? []);
  // Every request the factory saw names a bundled Foxit file or is a
  // refused Liberation Sans request (the Helvetica family) -- never a URL.
  for (const entry of log) {
    expect(entry.filename).not.toContain('://');
  }
});

test('pdf-to-image answers every binary data request from the bundle and refuses anything else without a request', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__FODT_PDF_TO_IMAGE_TEST_HOOKS__ = { requests: [] };
  });
  await page.goto(rel('/tools/pdf-to-image'));
  await page.waitForLoadState('networkidle');

  const requests = await withRequestRecorder(page, async () => {
    await attachPdf(page, fourteenFontPdf());
    await pressRun(page);
  });
  expect(requests).toEqual([]);

  const log = await page.evaluate(() => window.__FODT_PDF_TO_IMAGE_TEST_HOOKS__?.requests ?? []);
  expect(log.length).toBeGreaterThan(0);
  for (const entry of log) {
    // Every request is answered from the bundle, or is a known, disclosed
    // refusal (a Liberation Sans file the Helvetica standard fonts map to).
    if (!entry.served) {
      expect(entry.filename).toContain('LiberationSans');
    }
  }
});

test('pdf-to-image refuses a password protected PDF without asking for a password and sends nothing', async ({
  page,
}) => {
  await page.goto(rel('/tools/pdf-to-image'));
  await page.waitForLoadState('networkidle');

  const requests = await withRequestRecorder(page, async () => {
    await attachPdf(
      page,
      buildTestPdf({ pages: [{ lines: [{ text: 'secret', font: 'Times-Roman', y: 700 }] }], userPassword: 'hunter2' }),
    );
    await pressRun(page);
  });

  expect(requests).toEqual([]);
  await expect(page.locator('section[aria-label="Output"]')).toContainText('protected by a password');
});

test('pdf-to-image never runs document scripts or follows actions', async ({ page }) => {
  let dialogSeen = false;
  page.on('dialog', () => {
    dialogSeen = true;
  });
  let popupSeen = false;
  page.on('popup', () => {
    popupSeen = true;
  });

  await page.goto(rel('/tools/pdf-to-image'));
  await page.waitForLoadState('networkidle');
  const startUrl = page.url();

  const requests = await withRequestRecorder(page, async () => {
    await attachPdf(
      page,
      buildTestPdf({
        pages: [
          {
            lines: [{ text: 'has actions', font: 'Times-Roman', y: 700 }],
            linkUri: 'https://example.invalid/should-never-be-followed',
          },
        ],
        openActionJavaScript: 'app.alert("should never run");',
      }),
    );
    await pressRun(page);
  });

  expect(requests).toEqual([]);
  expect(dialogSeen).toBe(false);
  expect(popupSeen).toBe(false);
  expect(page.url()).toBe(startUrl);
});

test('pdf-to-image reports a PDF that needs an unbundled character map', async ({ page }) => {
  await page.goto(rel('/tools/pdf-to-image'));
  await page.waitForLoadState('networkidle');

  const requests = await withRequestRecorder(page, async () => {
    await attachPdf(page, buildTestPdf({ pages: [{ cjkText: true }] }));
    await pressRun(page);
  });

  expect(requests).toEqual([]);
  await expect(page.locator('section[aria-label="Output"]')).toContainText('Chinese, Japanese or Korean font encoding');
});

test('pdf-to-image refuses a file that is not a PDF before parsing it', async ({ page }) => {
  await page.goto(rel('/tools/pdf-to-image'));
  await page.waitForLoadState('networkidle');

  const requests = await withRequestRecorder(page, async () => {
    await attachPdf(
      page,
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.invalid/x.png"/></svg>'),
      'fake.pdf',
    );
    await pressRun(page);
  });
  expect(requests).toEqual([]);
  await expect(page.locator('section[aria-label="Output"]')).toContainText('Could not render');

  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  const requests2 = await withRequestRecorder(page, async () => {
    await attachPdf(page, Buffer.from('just plain text, not a pdf at all'), 'fake2.pdf');
    await pressRun(page);
  });
  expect(requests2).toEqual([]);
  await expect(page.locator('section[aria-label="Output"]')).toContainText('Could not render');
});

test('pdf-to-image shows progress, stops on Cancel and the page keeps answering', async ({ page }) => {
  test.setTimeout(90_000);
  const longPdf = buildTestPdf({
    pages: Array.from({ length: 150 }, (_, i) => ({
      lines: [{ text: `Page ${i + 1}`, font: 'Times-Roman' as const, y: 700 }],
    })),
  });

  await page.goto(rel('/tools/pdf-to-image'));
  await page.waitForLoadState('networkidle');
  await attachPdf(page, longPdf, 'long.pdf');

  const runButton = runButtonOf(page);
  await runButton.click();

  const cancelButton = page.getByRole('button', { name: 'Cancel', exact: true });
  await expect(cancelButton).toBeVisible({ timeout: 30_000 });

  const progressEl = page.locator('progress.tool-progress');
  const seen = new Set<number>();
  const deadline = Date.now() + 60_000;
  while (seen.size < 3 && Date.now() < deadline) {
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

test('pdf-to-image stops a run that makes no progress at the stall limit', async ({ page }) => {
  test.setTimeout(30_000);
  await page.addInitScript(() => {
    window.__FODT_PDF_TO_IMAGE_TEST_STALL_MS__ = 1;
  });
  await page.goto(rel('/tools/pdf-to-image'));
  await page.waitForLoadState('networkidle');
  // A multi-page document, not a single page: the 1ms test stall limit
  // needs a real yield point between pages to actually fire before the
  // whole run finishes, which a single fast page would not leave open.
  const multiPagePdf = buildTestPdf({
    pages: Array.from({ length: 20 }, (_, i) => ({
      lines: [{ text: `Page ${i + 1}`, font: 'Times-Roman' as const, y: 700 }],
    })),
  });
  await attachPdf(page, multiPagePdf);

  await pressRun(page);
  await expect(page.locator('section[aria-label="Output"]')).toContainText('Stopped: no progress for', {
    timeout: 5_000,
  });
});

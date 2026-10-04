import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  INFO_KEYS,
  MAX_PDF_BYTES,
  MAX_TEXT_CHARS,
  MAX_TEXT_PAGES,
  PDF_MESSAGES,
  PasswordException,
  PdfToolError,
  checkPdfFile,
  cleanCopyName,
  createRefusingBinaryDataFactory,
  describeMetadata,
  extractPageTexts,
  formatPageTexts,
  getDocument,
  meta as toolMeta,
  pdfDateToIso,
  stripMetadata,
  visible,
  PDFJS_SAFE_OPTIONS,
  type PdfDocLike,
} from '../src/index';
import { buildMinimalPdf } from './minimal-pdf';
import { openWithPdfJs } from './pdfjs-node';
import { fixtureBytes } from './scan';
import {
  F1_FULL,
  F1_PLAIN,
  F3_OWNER_ENCRYPTED,
  F4_USER_ENCRYPTED,
  F5_CLEAN_NO_INFO,
  F6_UNICODE,
  F7_BIDI,
} from './fixtures/pdfs';

/**
 * Every title below is a top-level `it(...)` call, never nested in `describe(...)`: Vitest's JSON reporter joins the
 * describe name into `fullName`, and the verify scripts of this project match required titles by exact equality.
 *
 * Expected values are the strings given to the fixture writers (reportlab 5.0.1, pikepdf 10.16.0, pypdf 6.19.0; see
 * test/fixtures/make-fixtures.py and README.md), the sections of ISO 32000-1:2008 cited at each test, or numbers fixed
 * by this folder's own limits. None is taken from the code under test.
 */
const BS = String.fromCharCode(92);

const TITLE = 'SENTINEL-TITLE-7f3a';
const AUTHOR = 'SENTINEL-AUTHOR-Ada Lovelace';
const SUBJECT = 'SENTINEL-SUBJECT-91bc';
const KEYWORDS = 'SENTINEL-KEYWORDS-xyz';
const CREATOR = 'SENTINEL-CREATOR-Writer 9';
const PRODUCER = 'SENTINEL-PRODUCER-Maker 3';
const CUSTOM = 'SENTINEL-CUSTOM-VALUE';

/** The lines reportlab drew on page `n` of the three page fixtures. */
function drawnLines(n: number): string[] {
  return [
    `Page ${n} heading`,
    `This is line one of page ${n}.`,
    `Second line, page ${n}: numbers 3.14159 and email test@example.com`,
  ];
}

function linesOf(text: string): string[] {
  return text.split('\n').filter((line) => line !== '');
}

const quiet = { signal: new AbortController().signal, onPage: () => undefined };

const logSpies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  for (const method of ['log', 'warn', 'error', 'info', 'debug'] as const) {
    logSpies.push(vi.spyOn(console, method).mockImplementation(() => undefined));
  }
});

afterEach(() => {
  for (const spy of logSpies.splice(0)) spy.mockRestore();
});

it('text is extracted page by page in page order and equals the strings the writer drew', async () => {
  const pdf = await openWithPdfJs(fixtureBytes(F1_PLAIN));
  try {
    const progress: [number, number][] = [];
    const result = await extractPageTexts(pdf.doc, [1, 2, 3], {
      signal: new AbortController().signal,
      onPage: (done, total) => progress.push([done, total]),
    });
    expect(result.pages.map((p) => p.page)).toEqual([1, 2, 3]);
    for (const page of result.pages) {
      expect(linesOf(page.text)).toEqual(drawnLines(page.page));
      expect(page.empty).toBe(false);
    }
    expect(result.notes).toEqual([]);
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    // A page list in another order is read in the order written (ISO 32000-1 7.7.3 page tree order is the file's own).
    const reversed = await extractPageTexts(pdf.doc, [3, 1], quiet);
    expect(reversed.pages.map((p) => p.page)).toEqual([3, 1]);
    expect(linesOf(reversed.pages[0]!.text)).toEqual(drawnLines(3));

    const joined = formatPageTexts(result.pages);
    expect(joined).toBe(result.pages.map((p) => `--- Page ${p.page} ---\n${p.text.trimEnd()}`).join('\n\n'));
    expect(joined.startsWith('--- Page 1 ---\nPage 1 heading\n')).toBe(true);
  } finally {
    await pdf.destroy();
  }
}, 30_000);

it('Unicode text and a UTF-16 title read back exactly and control and bidirectional characters are shown escaped', async () => {
  const unicodeTitle =
    'Titel ' +
    String.fromCodePoint(0xfc) +
    'n' +
    String.fromCodePoint(0xef) +
    'c' +
    String.fromCodePoint(0xf6) +
    'd' +
    String.fromCodePoint(0xe9) +
    ' ' +
    String.fromCodePoint(0x2713) +
    ' ' +
    String.fromCodePoint(0x65e5, 0x672c);
  const unicodeAuthor = 'Zo' + String.fromCodePoint(0xeb) + ' M' + String.fromCodePoint(0xfc) + 'ller';

  const unicode = await openWithPdfJs(fixtureBytes(F6_UNICODE));
  try {
    const metadata = await unicode.doc.getMetadata();
    const rows = describeMetadata(metadata.info as Record<string, unknown>, metadata.metadata);
    const byKey = new Map(rows.info);
    expect(byKey.get('Title')).toBe(unicodeTitle);
    expect(byKey.get('Author')).toBe(unicodeAuthor);
  } finally {
    await unicode.destroy();
  }

  const bidi = await openWithPdfJs(fixtureBytes(F7_BIDI));
  try {
    const metadata = await bidi.doc.getMetadata();
    const rows = describeMetadata(metadata.info as Record<string, unknown>, metadata.metadata);
    // The writer put U+202E (right-to-left override) first in the title; it is shown as its escape, never as itself.
    expect(new Map(rows.info).get('Title')).toBe(BS + 'u{202E}gnp.exe-SENTINEL-BIDI');
    expect(rows.info.every(([, value]) => !value.includes(String.fromCodePoint(0x202e)))).toBe(true);
  } finally {
    await bidi.destroy();
  }

  const controls =
    'a' + String.fromCharCode(7) + 'b' + String.fromCodePoint(0x2066) + 'c' + String.fromCodePoint(0x9f) + 'd\te\nf';
  expect(visible(controls)).toBe('a' + BS + 'u{7}b' + BS + 'u{2066}c' + BS + 'u{9F}d\te\nf');
  // The same escaping is applied to page text when it is formatted.
  const shown = formatPageTexts([{ page: 1, text: 'x' + String.fromCodePoint(0x202e) + 'y', empty: false }]);
  expect(shown).toBe('--- Page 1 ---\nx' + BS + 'u{202E}y');
  // The Unicode a writer drew is not touched: the tick mark and the Japanese survive.
  expect(visible(unicodeTitle)).toBe(unicodeTitle);
}, 30_000);

it('the document information and XMP of a fully tagged file are listed with every value the writer set', async () => {
  const pdf = await openWithPdfJs(fixtureBytes(F1_FULL));
  try {
    const metadata = await pdf.doc.getMetadata();
    const rows = describeMetadata(metadata.info as Record<string, unknown>, metadata.metadata);
    // ISO 32000-1:2008 Table 317 order, then the custom key.
    expect(rows.info.map(([key]) => key)).toEqual([...INFO_KEYS, 'CustomKey']);
    expect(rows.info).toEqual([
      ['Title', TITLE],
      ['Author', AUTHOR],
      ['Subject', SUBJECT],
      ['Keywords', KEYWORDS],
      ['Creator', CREATOR],
      ['Producer', PRODUCER],
      ['CreationDate', "D:20200102030405+02'00' (2020-01-02T03:04:05+02:00)"],
      ['ModDate', 'D:20210203040506Z (2021-02-03T04:05:06Z)'],
      ['Trapped', 'False'],
      ['CustomKey', CUSTOM],
    ]);
    const xmp = new Map(rows.xmp);
    expect(xmp.get('dc:title')).toBe('SENTINEL-XMP-TITLE-55aa');
    expect(xmp.get('dc:creator')).toBe('SENTINEL-XMP-CREATOR-Bob');
    expect(xmp.get('xmp:creatortool')).toBe('SENTINEL-XMP-TOOL');
    expect(rows.notes).toEqual([]);
  } finally {
    await pdf.destroy();
  }
}, 30_000);

it('a file that is not a PDF or is over 100 MB is refused before parsing', () => {
  const pdfHeader = new TextEncoder().encode('%PDF-1.7\n%');
  expect(MAX_PDF_BYTES).toBe(104857600);
  expect(() => checkPdfFile(pdfHeader, MAX_PDF_BYTES)).not.toThrow();

  const tooBig = (() => {
    try {
      checkPdfFile(pdfHeader, 104857601);
    } catch (err) {
      return err;
    }
    return null;
  })();
  expect(tooBig).toBeInstanceOf(PdfToolError);
  expect((tooBig as PdfToolError).kind).toBe('size');
  expect((tooBig as PdfToolError).message).toBe(PDF_MESSAGES.size);

  // A PNG header, text, an empty file and a header that only mentions %PDF- after its first kilobyte are not PDFs.
  const png = Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0,
  ]);
  const late = new Uint8Array(1100);
  late.set(new TextEncoder().encode('%PDF-1.7'), 1050);
  for (const header of [png, new TextEncoder().encode('hello world, not a document'), new Uint8Array(0), late]) {
    let caught: unknown = null;
    try {
      checkPdfFile(header, header.length);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PdfToolError);
    expect((caught as PdfToolError).kind).toBe('not-pdf');
  }
  // The size check comes first, so a huge file is refused for its size whatever its header says.
  expect(() => checkPdfFile(png, 104857601)).toThrowError(PDF_MESSAGES.size);
});

it('text stops at 500 pages and 2000000 characters with a note', async () => {
  expect(MAX_TEXT_PAGES).toBe(500);
  expect(MAX_TEXT_CHARS).toBe(2_000_000);

  // 501 real pages read through PDF.js: 500 are read and the page list is cut with a note.
  const bytes = buildMinimalPdf({ pages: Array.from({ length: 501 }, (_, i) => ({ text: `Page ${i + 1}` })) });
  const pdf = await openWithPdfJs(bytes);
  try {
    expect(pdf.doc.numPages).toBe(501);
    const start = performance.now();
    const result = await extractPageTexts(
      pdf.doc,
      Array.from({ length: 501 }, (_, i) => i + 1),
      quiet,
    );
    const elapsed = performance.now() - start;
    expect(result.pages).toHaveLength(500);
    expect(result.pages.at(-1)!.page).toBe(500);
    expect(result.pages.at(-1)!.text.trim()).toBe('Page 500');
    expect(result.notes.some((note) => note.includes('500 pages'))).toBe(true);
    expect(elapsed).toBeLessThan(50_000);
  } finally {
    await pdf.destroy();
  }

  // Text past 2,000,000 characters is cut: ten pages of 600,000 characters give 2,000,000 and stop reading after page 4.
  let pagesRequested = 0;
  const fake: PdfDocLike = {
    numPages: 10,
    getPage: (n) => {
      pagesRequested++;
      return Promise.resolve({
        getTextContent: () => Promise.resolve({ items: [{ str: String(n % 10).repeat(600_000), hasEOL: false }] }),
        cleanup: () => undefined,
      });
    },
  };
  const result = await extractPageTexts(fake, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], quiet);
  const total = result.pages.reduce((sum, p) => sum + p.text.length, 0);
  expect(total).toBe(2_000_000);
  expect(result.pages.map((p) => p.page)).toEqual([1, 2, 3, 4]);
  expect(result.pages[3]!.text).toHaveLength(200_000);
  expect(pagesRequested).toBe(4);
  expect(result.notes.some((note) => note.includes('2,000,000 characters'))).toBe(true);
}, 60_000);

it('Info keys are looked up safely for __proto__, constructor and toString', () => {
  // JSON.parse makes own properties named like the prototype's, as a hostile file's custom keys would be.
  const custom = JSON.parse(
    '{"__proto__":"p-value","constructor":"c-value","toString":"s-value","valueOf":"v-value"}',
  ) as Record<string, unknown>;
  const hostile: Record<string, unknown> = { Title: 'T', Custom: custom };
  const rows = describeMetadata(hostile, null);
  expect(rows.info).toEqual([
    ['Title', 'T'],
    ['__proto__', 'p-value'],
    ['constructor', 'c-value'],
    ['toString', 's-value'],
    ['valueOf', 'v-value'],
  ]);
  expect(Object.keys({} as object)).toEqual([]);
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();

  // PDF.js hands custom keys over as a Map; the same keys behave the same way.
  const asMap = describeMetadata(
    {
      Custom: new Map([
        ['__proto__', 'a'],
        ['constructor', 'b'],
      ]),
    },
    null,
  );
  expect(asMap.info).toEqual([
    ['__proto__', 'a'],
    ['constructor', 'b'],
  ]);

  // A standard key that only the prototype holds is not a value of the file.
  const inherited = Object.create({ Title: 'inherited', Author: 'inherited' }) as Record<string, unknown>;
  inherited.Subject = 'own';
  expect(describeMetadata(inherited, null).info).toEqual([['Subject', 'own']]);

  // XMP properties named like the prototype's are listed, not looked up.
  const xmp = describeMetadata({}, [
    ['__proto__', 'x'],
    ['toString', ['y', 'z']],
  ]);
  expect(xmp.xmp).toEqual([
    ['__proto__', 'x'],
    ['toString', 'y, z'],
  ]);
});

it('meta pins pdfjs-dist 6.3.289 and @cantoo/pdf-lib 2.11.1 exactly and carries the pdf.js notices', () => {
  expect(toolMeta.dependencies).toEqual({ 'pdfjs-dist': '6.3.289', '@cantoo/pdf-lib': '2.11.1' });
  expect(toolMeta.sideEffects).toEqual(['src/pdf-worker-entry.ts']);
  const names = toolMeta.bundledData.map((d) => d.name);
  expect(names).toEqual(['PDF.js JBIG2 wasm decoder', 'PDF.js OpenJPEG wasm decoder', 'PDF.js qcms wasm decoder']);
  for (const entry of toolMeta.bundledData) {
    // Each notice names the package that ships the module and exists in this folder with text in it.
    expect(entry.attribution).toContain('pdfjs-dist 6.3.289');
    const text = readFileSync(join(import.meta.dirname, '..', entry.noticeFile), 'utf8');
    expect(text.length).toBeGreaterThan(200);
  }
  const installed = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'node_modules', 'pdfjs-dist', 'package.json'), 'utf8'),
  ) as { version: string };
  expect(installed.version).toBe('6.3.289');
  const lib = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'node_modules', '@cantoo', 'pdf-lib', 'package.json'), 'utf8'),
  ) as { version: string };
  expect(lib.version).toBe('2.11.1');
});

it('the copy name keeps the picked base name, drops control characters and ends in -clean.pdf', () => {
  expect(cleanCopyName('report.pdf')).toBe('report-clean.pdf');
  expect(cleanCopyName('Quarterly Report 2026.PDF')).toBe('Quarterly Report 2026-clean.pdf');
  expect(cleanCopyName('archive.tar.pdf')).toBe('archive.tar-clean.pdf');
  expect(cleanCopyName('no-extension')).toBe('no-extension-clean.pdf');
  // Path parts of either kind never reach the name.
  expect(cleanCopyName('C:' + BS + 'Users' + BS + 'me' + BS + 'a.pdf')).toBe('a-clean.pdf');
  expect(cleanCopyName('../../etc/passwd.pdf')).toBe('passwd-clean.pdf');
  // Control and direction-changing characters are dropped.
  const dirty =
    'in' +
    String.fromCharCode(0) +
    'v' +
    String.fromCharCode(7) +
    'o' +
    String.fromCodePoint(0x202e) +
    'ice' +
    String.fromCodePoint(0x2066) +
    '.pdf';
  expect(cleanCopyName(dirty)).toBe('invoice-clean.pdf');
  // Nothing left of the name gives a plain default, and a long name is cut to 100 characters before the suffix.
  expect(cleanCopyName('.pdf')).toBe('document-clean.pdf');
  expect(cleanCopyName('')).toBe('document-clean.pdf');
  expect(cleanCopyName(String.fromCharCode(1) + '.pdf')).toBe('document-clean.pdf');
  const long = cleanCopyName('x'.repeat(300) + '.pdf');
  expect(long).toBe('x'.repeat(100) + '-clean.pdf');
  // A cut never ends in half of a surrogate pair.
  const emoji = String.fromCodePoint(0x1f600);
  const cut = cleanCopyName(emoji.repeat(80) + '.pdf');
  expect(cut.endsWith('-clean.pdf')).toBe(true);
  expect(/[\ud800-\udbff]-clean/.test(cut)).toBe(false);
});

it('nothing is written to the console while reading or stripping', async () => {
  const pdf = await openWithPdfJs(fixtureBytes(F1_FULL));
  try {
    const metadata = await pdf.doc.getMetadata();
    describeMetadata(metadata.info as Record<string, unknown>, metadata.metadata);
    const result = await extractPageTexts(pdf.doc, [1, 2, 3], quiet);
    formatPageTexts(result.pages);
  } finally {
    await pdf.destroy();
  }
  await stripMetadata(fixtureBytes(F1_FULL));
  await expect(stripMetadata(fixtureBytes(F4_USER_ENCRYPTED))).rejects.toBeInstanceOf(PdfToolError);
  await expect(stripMetadata(new TextEncoder().encode('%PDF-1.7 not really'))).rejects.toBeInstanceOf(PdfToolError);
  for (const method of ['log', 'warn', 'error', 'info', 'debug'] as const) {
    expect(console[method]).not.toHaveBeenCalled();
  }
}, 30_000);

it('the refusing factory answers every request with a refusal, records its kind, and text is still extracted', async () => {
  const pdf = await openWithPdfJs(fixtureBytes(F1_PLAIN));
  try {
    const result = await extractPageTexts(pdf.doc, [1], quiet);
    expect(linesOf(result.pages[0]!.text)).toEqual(drawnLines(1));
    // Helvetica and Times are not embedded, so PDF.js asked for standard font data and was refused.
    expect(pdf.requests.length).toBeGreaterThan(0);
    expect(pdf.requests.every((r) => r.kind === 'font')).toBe(true);
  } finally {
    await pdf.destroy();
  }

  const { Factory, requests } = createRefusingBinaryDataFactory();
  const factory = new Factory({});
  await expect(factory.fetch({ kind: 'cMapUrl', filename: 'UniJIS-UCS2-H.bcmap' })).rejects.toBeInstanceOf(Error);
  await expect(factory.fetch({ kind: 'wasmUrl', filename: 'jbig2_decoder.wasm' })).rejects.toBeInstanceOf(Error);
  await expect(factory.fetch({ kind: 'somethingNew', filename: 'x' })).rejects.toBeInstanceOf(Error);
  expect(requests.map((r) => r.kind)).toEqual(['cmap', 'wasm', 'other']);
  // The safe options never name an address and never let PDF.js fetch by itself.
  expect(PDFJS_SAFE_OPTIONS.useWorkerFetch).toBe(false);
  expect(PDFJS_SAFE_OPTIONS.isEvalSupported).toBe(false);
  expect(PDFJS_SAFE_OPTIONS.enableXfa).toBe(false);
  expect(Object.keys(PDFJS_SAFE_OPTIONS).some((key) => key.endsWith('Url'))).toBe(false);
}, 30_000);

it('a run that asks for a CJK character map is recorded as a character map request', async () => {
  const bytes = buildMinimalPdf({ pages: [{ text: 'Latin text', cjkText: true }] });
  const pdf = await openWithPdfJs(bytes);
  try {
    await extractPageTexts(pdf.doc, [1], quiet);
    expect(pdf.requests.some((r) => r.kind === 'cmap')).toBe(true);
  } finally {
    await pdf.destroy();
  }
}, 30_000);

it('a page with no text says so and the other pages are still read', async () => {
  const bytes = buildMinimalPdf({ pages: [{}, { text: 'Hello' }] });
  const pdf = await openWithPdfJs(bytes);
  try {
    const result = await extractPageTexts(pdf.doc, [1, 2], quiet);
    expect(result.pages[0]).toEqual({ page: 1, text: '', empty: true });
    expect(result.pages[1]!.empty).toBe(false);
    expect(result.pages[1]!.text.trim()).toBe('Hello');
    expect(formatPageTexts(result.pages)).toBe('--- Page 1 ---\nNo text was found on page 1.\n\n--- Page 2 ---\nHello');
  } finally {
    await pdf.destroy();
  }
}, 30_000);

it('a page whose text cannot be read is reported and the other pages are still read', async () => {
  const fake: PdfDocLike = {
    numPages: 3,
    getPage: (n) =>
      n === 2
        ? Promise.reject(new Error('FODT-MARKER-should-not-appear'))
        : Promise.resolve({
            getTextContent: () =>
              Promise.resolve({ items: [{ str: `text ${n}`, hasEOL: false }, { type: 'beginMarkedContent' }] }),
            cleanup: () => undefined,
          }),
  };
  const result = await extractPageTexts(fake, [1, 2, 3], quiet);
  expect(result.pages.map((p) => [p.page, p.text, p.empty])).toEqual([
    [1, 'text 1', false],
    [2, '', true],
    [3, 'text 3', false],
  ]);
  expect(result.notes).toEqual(['Page 2 could not be read.']);
});

it('Cancel stops extraction between pages', async () => {
  const controller = new AbortController();
  let requested = 0;
  const fake: PdfDocLike = {
    numPages: 50,
    getPage: () => {
      requested++;
      return Promise.resolve({
        getTextContent: () => Promise.resolve({ items: [{ str: 'x', hasEOL: false }] }),
        cleanup: () => undefined,
      });
    },
  };
  await expect(
    extractPageTexts(
      fake,
      Array.from({ length: 50 }, (_, i) => i + 1),
      {
        signal: controller.signal,
        onPage: (done) => {
          if (done === 2) controller.abort();
        },
      },
    ),
  ).rejects.toThrowError('The run was cancelled.');
  expect(requested).toBe(2);
  // Already cancelled: nothing is read at all.
  requested = 0;
  await expect(
    extractPageTexts(fake, [1], { signal: controller.signal, onPage: () => undefined }),
  ).rejects.toThrowError('The run was cancelled.');
  expect(requested).toBe(0);
});

it('dates are shown raw and as ISO 8601 and an impossible date is shown raw only', () => {
  // ISO 32000-1:2008 7.9.4: D:YYYYMMDDHHmmSSOHH'mm', every part after the year optional.
  expect(pdfDateToIso("D:20200102030405+02'00'")).toBe('2020-01-02T03:04:05+02:00');
  expect(pdfDateToIso("D:20200102030405-05'30'")).toBe('2020-01-02T03:04:05-05:30');
  expect(pdfDateToIso('D:20210203040506Z')).toBe('2021-02-03T04:05:06Z');
  expect(pdfDateToIso('D:2021')).toBe('2021-01-01T00:00:00');
  expect(pdfDateToIso('D:202102')).toBe('2021-02-01T00:00:00');
  expect(pdfDateToIso('D:20210203')).toBe('2021-02-03T00:00:00');
  expect(pdfDateToIso('20210203')).toBeNull();
  expect(pdfDateToIso('D:20211303')).toBeNull();
  expect(pdfDateToIso('D:20210230')).toBeNull();
  expect(pdfDateToIso('D:20210203250000')).toBeNull();
  expect(pdfDateToIso('D:2021xx')).toBeNull();
  const rows = describeMetadata({ CreationDate: 'D:20211303', ModDate: "D:20240229120000+00'00'" }, null);
  expect(rows.info).toEqual([
    ['CreationDate', 'D:20211303'],
    ['ModDate', "D:20240229120000+00'00' (2024-02-29T12:00:00+00:00)"],
  ]);
});

it('values are cut at 1000 characters and the lists at 200 rows, each with a note', () => {
  const long = 'a'.repeat(1500);
  const custom = new Map<string, unknown>();
  for (let i = 0; i < 250; i++) custom.set(`Key${String(i).padStart(3, '0')}`, `v${i}`);
  const xmp: [string, unknown][] = [];
  for (let i = 0; i < 230; i++) xmp.push([`ns:p${String(i).padStart(3, '0')}`, 'x']);
  const rows = describeMetadata({ Title: long, Custom: custom }, xmp);
  const title = new Map(rows.info).get('Title')!;
  expect(title.startsWith('a'.repeat(1000))).toBe(true);
  expect(title.length).toBeLessThan(1100);
  expect(title).toContain('cut at 1,000 characters');
  expect(rows.info.length).toBe(1 + 200);
  expect(rows.xmp.length).toBe(200);
  expect(rows.notes).toEqual(['50 more custom keys are not shown.', '30 more XMP properties are not shown.']);
});

it('a document that PDF.js refuses without a password is the exception the page matches', async () => {
  // The page maps this class to its password sentence; it must be the one the package re-exports from the same build.
  const task = getDocument({
    ...PDFJS_SAFE_OPTIONS,
    data: fixtureBytes(F4_USER_ENCRYPTED).slice(),
    BinaryDataFactory: createRefusingBinaryDataFactory().Factory as never,
  });
  await expect(task.promise).rejects.toBeInstanceOf(PasswordException);
  await task.destroy();
  // A file with an owner password only opens and reads without one (ISO 32000-1 7.6.3.2).
  const owner = await openWithPdfJs(fixtureBytes(F3_OWNER_ENCRYPTED));
  try {
    const result = await extractPageTexts(owner.doc, [1], quiet);
    expect(linesOf(result.pages[0]!.text)).toEqual(drawnLines(1));
  } finally {
    await owner.destroy();
  }
  // A file with no document information at all lists no row.
  const clean = await openWithPdfJs(fixtureBytes(F5_CLEAN_NO_INFO));
  try {
    const metadata = await clean.doc.getMetadata();
    expect(describeMetadata(metadata.info as Record<string, unknown>, metadata.metadata)).toEqual({
      info: [],
      xmp: [],
      notes: [],
    });
  } finally {
    await clean.destroy();
  }
}, 30_000);

it('invisible format characters are shown as escapes: soft hyphen, zero width marks, line and paragraph separators, word joiners, the byte order mark and tag characters', () => {
  const escaped = [
    0xad, 0x200b, 0x200c, 0x200d, 0x2028, 0x2029, 0x2060, 0x2061, 0x2064, 0xfeff, 0xe0001, 0xe0041, 0xe007f,
  ];
  for (const cp of escaped) {
    expect(visible(`a${String.fromCodePoint(cp)}b`)).toBe(`a${BS}u{${cp.toString(16).toUpperCase()}}b`);
  }
  // A run of tag characters spelling a word is escaped one by one and none is left as itself.
  const tagged = Array.from('hidden', (c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join('');
  expect(visible(tagged)).toBe(
    Array.from('hidden', (c) => `${BS}u{${(0xe0000 + c.charCodeAt(0)).toString(16).toUpperCase()}}`).join(''),
  );
  // Characters next to them in the tables stay as they are: a hyphen, a no-break space, U+2065 (unassigned), a letter, an emoji.
  const kept = [
    '-',
    String.fromCodePoint(0xa0),
    String.fromCodePoint(0x2065),
    'z',
    String.fromCodePoint(0x1f600),
    String.fromCodePoint(0xe0080),
  ];
  for (const text of kept) expect(visible(text)).toBe(text);
});

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFStream } from '@cantoo/pdf-lib';
import {
  PDF_MESSAGES,
  PdfToolError,
  checkPdfFile,
  describeMetadata,
  extractPageTexts,
  findMetadataLeft,
  reachableRefs,
  stripMetadata,
  type StripReport,
} from '../src/index';
import { buildMinimalPdf } from './minimal-pdf';
import { openWithPdfJs } from './pdfjs-node';
import { countEverywhere, countIn, fixtureBytes } from './scan';
import {
  F1_FULL,
  F1_FULL_NO_OBJSTM,
  F2_INCREMENTAL,
  F3_OWNER_ENCRYPTED,
  F4_USER_ENCRYPTED,
  F5_CLEAN_NO_INFO,
  F8_NESTED,
} from './fixtures/pdfs';

/**
 * Every title below is a top-level `it(...)` call (see index.test.ts for why). Expected values are the strings given to
 * the fixture writers (test/fixtures/make-fixtures.py), the structure those scripts built (which objects they made),
 * the sections of ISO 32000-1:2008 cited at each test (14.3 metadata streams, 7.5.6 incremental updates, 7.6 encryption),
 * and what the offline second readers reported (pypdf, pikepdf and Poppler, recorded in the plan summary).
 */
const silent = { signal: new AbortController().signal, onPage: () => undefined };

const logSpies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  for (const method of ['log', 'warn', 'error'] as const) {
    logSpies.push(vi.spyOn(console, method).mockImplementation(() => undefined));
  }
});

afterEach(() => {
  for (const spy of logSpies.splice(0)) spy.mockRestore();
});

/** What PDF.js reports as document information and XMP for these bytes, as rows. */
async function pdfJsView(bytes: Uint8Array): Promise<{ info: [string, string][]; xmp: [string, string][] }> {
  const pdf = await openWithPdfJs(bytes);
  try {
    const metadata = await pdf.doc.getMetadata();
    const rows = describeMetadata(metadata.info as Record<string, unknown>, metadata.metadata);
    return { info: rows.info, xmp: rows.xmp };
  } finally {
    await pdf.destroy();
  }
}

async function pagesText(bytes: Uint8Array, count: number): Promise<string[]> {
  const pdf = await openWithPdfJs(bytes);
  try {
    const result = await extractPageTexts(
      pdf.doc,
      Array.from({ length: count }, (_, i) => i + 1),
      silent,
    );
    return result.pages.map((p) => p.text);
  } finally {
    await pdf.destroy();
  }
}

/** Keys of every dictionary and stream dictionary of the file, found with pdf-lib directly (not the code under test). */
async function keysHeldAnywhere(bytes: Uint8Array, wanted: string[]): Promise<string[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const found = new Set<string>();
  const visit = (node: unknown): void => {
    const stack = [node];
    while (stack.length > 0) {
      const item = stack.pop();
      if (item instanceof PDFStream) stack.push(item.dict);
      else if (item instanceof PDFDict) {
        for (const [key, value] of item.entries()) {
          if (wanted.includes(key.decodeText())) found.add(key.decodeText());
          stack.push(value);
        }
      } else if (item instanceof PDFArray) {
        for (let i = 0; i < item.size(); i++) stack.push(item.get(i));
      }
    }
  };
  for (const [, object] of doc.context.enumerateIndirectObjects()) visit(object);
  return [...found].sort();
}

it('a stripped copy re-read by pdf.js and by pdf-lib has no document information, no XMP and no Metadata, PieceInfo or LastModified key', async () => {
  // The same content with and without object streams (ISO 32000-1 7.5.7), and Metadata, PieceInfo and LastModified
  // keys hidden in a form XObject, in font dictionaries and in an inline dictionary.
  for (const fixture of [F1_FULL, F1_FULL_NO_OBJSTM, F8_NESTED]) {
    const input = fixtureBytes(fixture);
    expect(await countEverywhere(input, 'SENTINEL')).toBeGreaterThan(5);
    expect((await pdfJsView(input)).info.length).toBeGreaterThan(5);

    const { bytes, report } = await stripMetadata(input);

    // Reader one: PDF.js shows no document information and no XMP.
    expect(await pdfJsView(bytes)).toEqual({ info: [], xmp: [] });
    // Reader two: pdf-lib finds no trailer Info and none of the three keys in any dictionary.
    expect(await findMetadataLeft(bytes)).toEqual([]);
    expect(await keysHeldAnywhere(bytes, ['Metadata', 'PieceInfo', 'LastModified'])).toEqual([]);
    const reloaded = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(reloaded.context.trailerInfo.Info).toBeUndefined();
    expect(reloaded.getTitle()).toBeUndefined();
    expect(reloaded.getAuthor()).toBeUndefined();
    // And the marker is in no byte of the file, written or decompressed.
    expect(countIn(bytes, 'SENTINEL')).toBe(0);
    expect(await countEverywhere(bytes, 'SENTINEL')).toBe(0);
    expect(await countEverywhere(bytes, 'Lovelace')).toBe(0);
    expect(report.info).toBe(true);
    expect(report.metadataStreams).toBeGreaterThanOrEqual(2);
  }
}, 60_000);

it('what was removed is counted from the structure the writer built', async () => {
  // F1_FULL_NO_OBJSTM: the script gave it an Info dictionary, a catalog Metadata stream, a page Metadata stream, one
  // PieceInfo and one LastModified on the first page. After the keys go, the Info dictionary and the two streams are
  // objects nothing refers to.
  const first = await stripMetadata(fixtureBytes(F1_FULL_NO_OBJSTM));
  const expectedFirst: StripReport = { info: true, metadataStreams: 2, pieceInfo: 1, lastModified: 1, unreachable: 3 };
  expect(first.report).toEqual(expectedFirst);
  // The same file with its objects in object streams reports the same numbers: the containers are not counted.
  const second = await stripMetadata(fixtureBytes(F1_FULL));
  expect(second.report).toEqual(expectedFirst);
  // F8_NESTED: Metadata in a form XObject and in two font dictionaries, LastModified in the form, a PieceInfo in an
  // inline dictionary; the Info dictionary and three streams become unreachable.
  const nested = await stripMetadata(fixtureBytes(F8_NESTED));
  expect(nested.report).toEqual({ info: true, metadataStreams: 3, pieceInfo: 1, lastModified: 1, unreachable: 4 });
}, 60_000);

it('an incrementally updated file loses its superseded revision so neither author value survives in the bytes', async () => {
  const input = fixtureBytes(F2_INCREMENTAL);
  // The fixture's premise (ISO 32000-1 7.5.6): both revisions are in the file, the first author as written by the first
  // writer and the second by the update (pypdf writes a hyphen inside a string as an octal escape, so it is found by
  // its last word), and the first revision's XMP creator too.
  expect(countIn(input, 'SENTINEL-AUTHOR-Ada Lovelace')).toBe(1);
  expect(countIn(input, 'Grace')).toBe(1);
  expect(countIn(input, 'SENTINEL-XMP-CREATOR-Bob')).toBe(1);
  expect(countIn(input, 'Carol')).toBe(1);

  // The control: loading and saving with pdf-lib after deleting the trailer's Info and the Metadata keys, which is
  // what a plain removal does, still holds the first revision's author and XMP creator, because those objects are
  // still in the file and nothing deletes them. This is why the sweep exists.
  const naive = await PDFDocument.load(input, { updateMetadata: false });
  delete naive.context.trailerInfo.Info;
  naive.catalog.delete(PDFName.of('Metadata'));
  const naiveBytes = await naive.save({ useObjectStreams: false });
  expect(await countEverywhere(naiveBytes, 'Lovelace')).toBeGreaterThan(0);
  expect(await countEverywhere(naiveBytes, 'Bob')).toBeGreaterThan(0);

  const { bytes, report } = await stripMetadata(input);
  expect(report.unreachable).toBeGreaterThanOrEqual(4);
  for (const needle of ['Lovelace', 'Grace', 'Bob', 'Carol', 'SENTINEL', 'REV2']) {
    expect(countIn(bytes, needle), needle).toBe(0);
    expect(await countEverywhere(bytes, needle), needle).toBe(0);
  }
  expect(await findMetadataLeft(bytes)).toEqual([]);
  expect(await pdfJsView(bytes)).toEqual({ info: [], xmp: [] });
}, 60_000);

it('the page text is identical before and after the metadata is removed', async () => {
  for (const fixture of [F1_FULL, F2_INCREMENTAL, F8_NESTED]) {
    const input = fixtureBytes(fixture);
    const before = await pagesText(input, 3);
    const { bytes } = await stripMetadata(input);
    const after = await pagesText(bytes, 3);
    expect(before).toHaveLength(3);
    expect(after).toEqual(before);
    expect(before[2]).toContain('Page 3 heading');
  }
}, 60_000);

it('a file with no metadata reports none and its stripped copy is clean with nothing removed', async () => {
  const input = fixtureBytes(F5_CLEAN_NO_INFO);
  expect(await pdfJsView(input)).toEqual({ info: [], xmp: [] });
  expect(await findMetadataLeft(input)).toEqual([]);
  const { bytes, report } = await stripMetadata(input);
  expect(report).toEqual({ info: false, metadataStreams: 0, pieceInfo: 0, lastModified: 0, unreachable: 0 });
  expect(await findMetadataLeft(bytes)).toEqual([]);
  expect(await pdfJsView(bytes)).toEqual({ info: [], xmp: [] });
  expect(await pagesText(bytes, 2)).toEqual(await pagesText(input, 2));
  // pdf-lib did not stamp its own name into the copy (loading with updateMetadata false keeps the Info dictionary absent).
  expect(countIn(bytes, 'pdf-lib')).toBe(0);
  expect(countIn(bytes, '/Producer')).toBe(0);
  expect(countIn(bytes, '/ModDate')).toBe(0);
}, 30_000);

it('a password-protected file is refused and an encrypted file is not rewritten', async () => {
  // ISO 32000-1 7.6: a file with an Encrypt entry in its trailer is encrypted, whether or not a password is needed to open
  // it (an owner password only leaves the user password empty). Rewriting it would drop the encryption.
  for (const fixture of [F3_OWNER_ENCRYPTED, F4_USER_ENCRYPTED]) {
    let caught: unknown = null;
    try {
      await stripMetadata(fixtureBytes(fixture));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PdfToolError);
    expect((caught as PdfToolError).kind).toBe('encrypted');
    expect((caught as PdfToolError).message).toBe(PDF_MESSAGES.encrypted);
  }
  expect(PDF_MESSAGES.password).toBe('This PDF needs a password, which this page cannot use.');
  // The refusal for the file that needs a password to open is PDF.js's, which the page turns into the password sentence.
  await expect(openWithPdfJs(fixtureBytes(F4_USER_ENCRYPTED))).rejects.toMatchObject({ name: 'PasswordException' });
}, 30_000);

it('a marker inside a malformed file never appears in a message', async () => {
  const marker = 'FODT-MARKER-9c1d-hidden';
  const truncated = fixtureBytes(F1_FULL_NO_OBJSTM).slice(0, 1500);
  const inputs = [
    new TextEncoder().encode(`%PDF-1.7\n${marker} 1 0 obj << /Type /Catalog /Pages ${marker} >> endobj`),
    new TextEncoder().encode(
      `%PDF-1.7\n1 0 obj\n<< /Title (${marker}) /Root 9 0 R >>\nendobj\ntrailer << /Root 1 0 R /Info (${marker}) >>\n%%EOF`,
    ),
    new Uint8Array([...truncated, ...new TextEncoder().encode(marker)]),
    new TextEncoder().encode(marker.repeat(5000)),
  ];
  for (const input of inputs) {
    for (const run of [() => stripMetadata(input), () => findMetadataLeft(input)]) {
      let caught: unknown = null;
      try {
        await run();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(PdfToolError);
      const error = caught as PdfToolError;
      expect(error.kind).toBe('damaged');
      expect(error.message).toBe(PDF_MESSAGES.damaged);
      expect(String(error)).not.toContain(marker);
      expect(error.stack ?? '').not.toContain(marker);
    }
  }
  // The header check never quotes the file either.
  let refused: unknown = null;
  try {
    checkPdfFile(new TextEncoder().encode(marker), 100);
  } catch (err) {
    refused = err;
  }
  expect((refused as PdfToolError).message).not.toContain(marker);
}, 30_000);

it('the file identifier and the page count survive removal', async () => {
  const input = fixtureBytes(F1_FULL_NO_OBJSTM);
  const before = await PDFDocument.load(input, { updateMetadata: false });
  const { bytes } = await stripMetadata(input);
  const after = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(after.getPageCount()).toBe(3);
  expect(before.context.trailerInfo.ID).toBeDefined();
  expect(String(after.context.trailerInfo.ID)).toBe(String(before.context.trailerInfo.ID));
});

it('the remaining check lists the Info dictionary, each key and each unreachable object of an untouched file', async () => {
  const left = await findMetadataLeft(fixtureBytes(F1_FULL_NO_OBJSTM));
  expect(left.some((entry) => entry.startsWith('Info'))).toBe(true);
  expect(left.some((entry) => entry.startsWith('Metadata'))).toBe(true);
  expect(left.some((entry) => entry.startsWith('PieceInfo'))).toBe(true);
  expect(left.some((entry) => entry.startsWith('LastModified'))).toBe(true);
  expect(await findMetadataLeft(fixtureBytes(F5_CLEAN_NO_INFO))).toEqual([]);
  // An object nothing refers to is listed even when it holds none of the keys: here, the first revision of an update.
  const incremental = await findMetadataLeft(fixtureBytes(F2_INCREMENTAL));
  expect(incremental.some((entry) => entry.startsWith('Unreachable'))).toBe(true);
  for (const entry of left.concat(incremental)) {
    expect(entry).not.toContain('SENTINEL');
  }
}, 30_000);

it('reachability is found without recursion over a chain of 100000 references', async () => {
  // A catalog entry leads to 100,000 arrays that each hold the next one: a recursive walk would overflow the stack.
  const doc = await PDFDocument.create({ updateMetadata: false });
  const context = doc.context;
  const count = 100_000;
  const refs = Array.from({ length: count }, () => context.nextRef());
  for (let i = 0; i < count; i++) {
    context.assign(refs[i]!, context.obj(i + 1 < count ? [refs[i + 1]!] : []));
  }
  const orphan = context.register(context.obj({ Orphan: true }));
  doc.catalog.set(PDFName.of('Chain'), refs[0]!);
  const start = performance.now();
  const live = reachableRefs(context);
  const elapsed = performance.now() - start;
  expect(live.has(refs[count - 1]!.tag)).toBe(true);
  expect(live.has(orphan.tag)).toBe(false);
  expect(live.size).toBeGreaterThanOrEqual(count);
  expect(elapsed).toBeLessThan(20_000);
}, 60_000);

it('a file of 3000 pages is stripped in time and keeps all its pages', async () => {
  const input = buildMinimalPdf({
    pages: Array.from({ length: 3000 }, (_, i) => ({ text: `Page ${i + 1}` })),
    title: 'SENTINEL-LARGE-TITLE',
  });
  const start = performance.now();
  const result = await stripMetadata(input);
  const elapsed = performance.now() - start;
  expect(elapsed).toBeLessThan(50_000);
  expect(result.report.info).toBe(true);
  const after = await PDFDocument.load(result.bytes, { updateMetadata: false });
  expect(after.getPageCount()).toBe(3000);
  expect(countIn(result.bytes, 'SENTINEL')).toBe(0);
}, 60_000);

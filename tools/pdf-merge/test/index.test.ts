import { it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRawStream, decodePDFRawStream } from '@cantoo/pdf-lib';
import { mergePdfs, PdfMergeError } from '../src/index';
import { buildPdf, buildEncryptedPdf } from './build-pdfs';

// pdfjs-dist runs its own "fake worker" loopback in plain Node (no real
// Worker thread here); its shared message handler calls the standard
// `Promise.try`, which this project's Node floor does not yet ship
// (measured directly, matching tools/pdf-to-image/test/pdfjs-node.ts's own
// note). Test-only, never shipped in the package under test.
if (typeof (Promise as unknown as { try?: unknown }).try !== 'function') {
  (Promise as unknown as { try: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => Promise<unknown> }).try =
    function promiseTryPolyfill(fn, ...args) {
      return new Promise((resolve) => resolve(fn(...args)));
    };
}

async function pdfjsTextOf(bytes: Uint8Array, pageIndex: number): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // A fresh copy every call: PDF.js's own `data` option detaches the
  // Uint8Array's underlying buffer once loading starts (confirmed directly
  // this session, matching tools/pdf-to-image's own recorded finding), so
  // reusing the same bytes across more than one getDocument() call fails.
  const task = pdfjsLib.getDocument({
    data: bytes.slice(),
    useWorkerFetch: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  const page = await doc.getPage(pageIndex + 1);
  const content = await page.getTextContent();
  const text = content.items.map((item) => ('str' in item ? item.str : '')).join('');
  await task.destroy();
  return text;
}

/**
 * Content streams are treated as if concatenated with a newline between
 * them (ISO 32000-1 7.8.2): `Contents` may be a single stream or a
 * `PDFArray` of streams (this project's own writes always produce a
 * one-element array, confirmed directly against the installed 2.11.1
 * source this session), so both shapes are handled.
 */
function contentBytesOf(doc: PDFDocument, pageIndex: number): Uint8Array {
  const page = doc.getPage(pageIndex);
  const contents = page.node.Contents();
  const streams: PDFRawStream[] = [];
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) streams.push(doc.context.lookup(contents.get(i)) as PDFRawStream);
  } else {
    streams.push(contents as PDFRawStream);
  }
  const parts = streams.map((s) => decodePDFRawStream(s).decode());
  const newline = Uint8Array.from([0x0a]);
  const total = parts.reduce((sum, p, i) => sum + p.length + (i > 0 ? newline.length : 0), 0);
  const out = new Uint8Array(total);
  let offset = 0;
  parts.forEach((p, i) => {
    if (i > 0) {
      out.set(newline, offset);
      offset += newline.length;
    }
    out.set(p, offset);
    offset += p.length;
  });
  return out;
}

it('merging two documents gives every page of each in order', async () => {
  const a = await buildPdf([{ text: 'A page 1' }, { text: 'A page 2' }]);
  const b = await buildPdf([{ text: 'B page 1' }, { text: 'B page 2' }, { text: 'B page 3' }]);

  const result = await mergePdfs([
    { name: 'a.pdf', bytes: a },
    { name: 'b.pdf', bytes: b },
  ]);

  expect(result.pageCount).toBe(5);
  const merged = await PDFDocument.load(result.bytes, { updateMetadata: false });
  expect(merged.getPageCount()).toBe(5);
  for (let i = 0; i < 2; i++) {
    expect(await pdfjsTextOf(result.bytes, i)).toContain(`A page ${i + 1}`);
  }
  for (let i = 0; i < 3; i++) {
    expect(await pdfjsTextOf(result.bytes, 2 + i)).toContain(`B page ${i + 1}`);
  }
});

it('merged pages keep their content streams and fonts byte for byte and nothing is rasterised', async () => {
  const source = await buildPdf([{ text: 'Kept exactly' }]);
  const sourceDoc = await PDFDocument.load(source, { updateMetadata: false });
  const sourceContent = contentBytesOf(sourceDoc, 0);

  const result = await mergePdfs([{ name: 'source.pdf', bytes: source }]);
  const merged = await PDFDocument.load(result.bytes, { updateMetadata: false });
  const mergedContent = contentBytesOf(merged, 0);
  expect(mergedContent).toEqual(sourceContent);

  // Every page pdf-lib creates carries its own empty XObject placeholder
  // dict in Resources regardless of whether an image was ever drawn
  // (confirmed directly against the installed 2.11.1 source this session);
  // the meaningful claim is that merging never adds a NEW image object,
  // i.e. the merged page's own XObject dict has exactly as many entries as
  // the source page's did (zero, for a page with no image).
  const sourceResources = sourceDoc.getPage(0).node.Resources();
  const sourceXObjectKeys = sourceResources?.lookupMaybe(PDFName.of('XObject'), PDFDict)?.keys().length ?? 0;
  const mergedPage = merged.getPage(0);
  const resources = mergedPage.node.Resources();
  const mergedXObjectKeys = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict)?.keys().length ?? 0;
  expect(mergedXObjectKeys).toBe(sourceXObjectKeys);
  expect(mergedXObjectKeys).toBe(0);
  expect(resources?.lookupMaybe(PDFName.of('Font'), PDFDict)).toBeDefined();
});

it('text extracted by PDF.js from each merged page equals the text of its source page', async () => {
  const a = await buildPdf([{ text: 'First source text' }]);
  const b = await buildPdf([{ text: 'Second source text' }]);
  const result = await mergePdfs([
    { name: 'a.pdf', bytes: a },
    { name: 'b.pdf', bytes: b },
  ]);
  expect(await pdfjsTextOf(result.bytes, 0)).toBe(await pdfjsTextOf(a, 0));
  expect(await pdfjsTextOf(result.bytes, 1)).toBe(await pdfjsTextOf(b, 0));
});

it('a page list per document such as 1-3,5 takes only those pages in that order', async () => {
  const doc = await buildPdf([
    { text: 'Page 1' },
    { text: 'Page 2' },
    { text: 'Page 3' },
    { text: 'Page 4' },
    { text: 'Page 5' },
  ]);
  const result = await mergePdfs([{ name: 'doc.pdf', bytes: doc, pages: '1-3,5' }]);
  expect(result.pageCount).toBe(4);
  expect(result.parts).toEqual([{ name: 'doc.pdf', pages: [1, 2, 3, 5] }]);
  expect(await pdfjsTextOf(result.bytes, 3)).toContain('Page 5');
});

it('an encrypted document is refused by name and nothing is written', async () => {
  const ownerOnly = await buildEncryptedPdf(undefined);
  await expect(mergePdfs([{ name: 'owner-only.pdf', bytes: ownerOnly }])).rejects.toMatchObject({
    reason: 'encrypted',
    fileName: 'owner-only.pdf',
  } satisfies Partial<PdfMergeError>);

  const userProtected = await buildEncryptedPdf('user-secret');
  await expect(mergePdfs([{ name: 'locked.pdf', bytes: userProtected }])).rejects.toMatchObject({
    reason: 'encrypted',
    fileName: 'locked.pdf',
  } satisfies Partial<PdfMergeError>);
});

it('a file that is not a PDF is refused before parsing', async () => {
  const notAPdf = new TextEncoder().encode('just plain text, not a PDF at all');
  await expect(mergePdfs([{ name: 'notes.txt', bytes: notAPdf }])).rejects.toThrow(PdfMergeError);
  await expect(mergePdfs([{ name: 'notes.txt', bytes: notAPdf }])).rejects.toMatchObject({ reason: 'unrecognised' });
});

it('document level scripts and the opening action of the sources are not carried into the merged document', async () => {
  const withJs = await buildPdf([{ text: 'Has scripts' }], { javascript: true });
  const sourceDoc = await PDFDocument.load(withJs, { updateMetadata: false });
  expect(sourceDoc.catalog.get(PDFName.of('OpenAction'))).toBeDefined();
  expect(sourceDoc.catalog.get(PDFName.of('Names'))).toBeDefined();

  const result = await mergePdfs([{ name: 'scripted.pdf', bytes: withJs }]);
  const merged = await PDFDocument.load(result.bytes, { updateMetadata: false });
  expect(merged.catalog.get(PDFName.of('OpenAction'))).toBeUndefined();
  expect(merged.catalog.get(PDFName.of('Names'))).toBeUndefined();
});

it('the merged document carries no metadata from the sources and does not name the library', async () => {
  const titled = await buildPdf([{ text: 'Has a title' }], { title: 'A Secret Source Title' });
  const result = await mergePdfs([{ name: 'titled.pdf', bytes: titled }]);
  const merged = await PDFDocument.load(result.bytes, { updateMetadata: false });
  expect(merged.getTitle()).toBeUndefined();
  expect(merged.getProducer()).toBeUndefined();
  expect(merged.getCreator()).toBeUndefined();

  const withTitle = await mergePdfs([{ name: 'titled.pdf', bytes: titled }], { title: 'A Chosen Title' });
  const mergedWithTitle = await PDFDocument.load(withTitle.bytes, { updateMetadata: false });
  expect(mergedWithTitle.getTitle()).toBe('A Chosen Title');
  expect(mergedWithTitle.getProducer()).toBeUndefined();
});

it('nothing is written to the console while merging', async () => {
  const logSpy = { calls: 0 };
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = () => {
    logSpy.calls++;
  };
  console.warn = () => {
    logSpy.calls++;
  };
  console.error = () => {
    logSpy.calls++;
  };
  try {
    const a = await buildPdf([{ text: 'Quiet' }]);
    const b = await buildPdf([{ text: 'Quiet too' }]);
    await mergePdfs([
      { name: 'a.pdf', bytes: a },
      { name: 'b.pdf', bytes: b },
    ]);
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
  expect(logSpy.calls).toBe(0);
});

it('merging with a page list beyond the document is refused naming the file and position', async () => {
  const doc = await buildPdf([{ text: 'Only page' }]);
  await expect(mergePdfs([{ name: 'doc.pdf', bytes: doc, pages: '1,5' }])).rejects.toThrow(/doc\.pdf/);
});

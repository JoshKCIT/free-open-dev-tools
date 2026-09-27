import { it, expect } from 'vitest';
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from '@cantoo/pdf-lib';
import { organizePdf, PdfSplitError } from '../src/index';
import { buildPdf, buildPdfWithInheritedRotation, buildEncryptedPdf } from './build-pdfs';

// pdfjs-dist's own "fake worker" loopback in plain Node calls the standard
// `Promise.try`, unavailable on this project's Node floor (measured
// directly, matching tools/pdf-to-image/test/pdfjs-node.ts's own note).
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
  // this session, matching tools/pdf-to-image's own recorded finding).
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

/** `Contents` may be a single stream or a `PDFArray` of streams (ISO 32000-1 7.8.2); both shapes are handled. */
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

it('split into single pages gives one document per page with the same content stream', async () => {
  const source = await buildPdf([{ text: 'Page 1' }, { text: 'Page 2' }, { text: 'Page 3' }]);
  const sourceDoc = await PDFDocument.load(source, { updateMetadata: false });

  const result = await organizePdf(source, 'sample.pdf', { kind: 'split-each' });
  expect(result.files.map((f) => f.name)).toEqual(['sample-page-1.pdf', 'sample-page-2.pdf', 'sample-page-3.pdf']);
  expect(result.files.map((f) => f.pages)).toEqual([[1], [2], [3]]);

  for (let i = 0; i < 3; i++) {
    const out = await PDFDocument.load(result.files[i]!.bytes, { updateMetadata: false });
    expect(out.getPageCount()).toBe(1);
    expect(contentBytesOf(out, 0)).toEqual(contentBytesOf(sourceDoc, i));
  }
});

it('split by ranges gives one document per range', async () => {
  const source = await buildPdf([{ text: 'P1' }, { text: 'P2' }, { text: 'P3' }]);
  const result = await organizePdf(source, 'sample.pdf', { kind: 'split-ranges', ranges: '1-2;3' });
  expect(result.files.map((f) => f.name)).toEqual(['sample-part-1.pdf', 'sample-part-2.pdf']);
  expect(result.files.map((f) => f.pages)).toEqual([[1, 2], [3]]);
  const first = await PDFDocument.load(result.files[0]!.bytes, { updateMetadata: false });
  expect(first.getPageCount()).toBe(2);
  const second = await PDFDocument.load(result.files[1]!.bytes, { updateMetadata: false });
  expect(second.getPageCount()).toBe(1);
});

it('extract, delete and reorder by a page list give the pages in exactly that order', async () => {
  const source = await buildPdf([{ text: 'P1' }, { text: 'P2' }, { text: 'P3' }]);

  const extracted = await organizePdf(source, 'sample.pdf', { kind: 'extract', pages: '3,1' });
  expect(extracted.files[0]!.name).toBe('sample-extracted.pdf');
  expect(extracted.files[0]!.pages).toEqual([3, 1]);

  const deleted = await organizePdf(source, 'sample.pdf', { kind: 'delete', pages: '2' });
  expect(deleted.files[0]!.name).toBe('sample-without-pages.pdf');
  expect(deleted.files[0]!.pages).toEqual([1, 3]);

  const reordered = await organizePdf(source, 'sample.pdf', { kind: 'reorder', order: '3,1,2' });
  expect(reordered.files[0]!.name).toBe('sample-reordered.pdf');
  expect(reordered.files[0]!.pages).toEqual([3, 1, 2]);
});

it('reordering requires every page exactly once and names the missing or repeated page', async () => {
  const source = await buildPdf([{ text: 'P1' }, { text: 'P2' }, { text: 'P3' }]);
  await expect(organizePdf(source, 'sample.pdf', { kind: 'reorder', order: '3,1' })).rejects.toMatchObject({
    reason: 'missing-page',
  });
  await expect(organizePdf(source, 'sample.pdf', { kind: 'reorder', order: '3,1' })).rejects.toThrow(/page 2/);
  await expect(organizePdf(source, 'sample.pdf', { kind: 'reorder', order: '1,1,2,3' })).rejects.toMatchObject({
    reason: 'repeated-page',
  });
  await expect(organizePdf(source, 'sample.pdf', { kind: 'reorder', order: '1,1,2,3' })).rejects.toThrow(/page 1/);
});

it('rotation adds 90, 180 or 270 degrees to each page existing rotation as ISO 32000 defines Rotate', async () => {
  const inherited = await buildPdfWithInheritedRotation(2, 270);
  const rotated = await organizePdf(inherited, 'sample.pdf', { kind: 'rotate', pages: '1', degrees: 90 });
  const out = await PDFDocument.load(rotated.files[0]!.bytes, { updateMetadata: false });
  expect(out.getPage(0).getRotation().angle).toBe(0);

  const noRotation = await buildPdf([{ text: 'P1' }]);
  const bare = await organizePdf(noRotation, 'sample.pdf', { kind: 'rotate', pages: '1', degrees: 90 });
  const outBare = await PDFDocument.load(bare.files[0]!.bytes, { updateMetadata: false });
  expect(outBare.getPage(0).getRotation().angle).toBe(90);

  const twoEighty = await organizePdf(noRotation, 'sample.pdf', { kind: 'rotate', pages: '1', degrees: 180 });
  const outTwoEighty = await PDFDocument.load(twoEighty.files[0]!.bytes, { updateMetadata: false });
  expect(outTwoEighty.getPage(0).getRotation().angle).toBe(180);

  const twoSeventy = await organizePdf(noRotation, 'sample.pdf', { kind: 'rotate', pages: '1', degrees: 270 });
  const outTwoSeventy = await PDFDocument.load(twoSeventy.files[0]!.bytes, { updateMetadata: false });
  expect(outTwoSeventy.getPage(0).getRotation().angle).toBe(270);
});

it('deleting every page is refused', async () => {
  const source = await buildPdf([{ text: 'P1' }, { text: 'P2' }]);
  await expect(organizePdf(source, 'sample.pdf', { kind: 'delete', pages: '1,2' })).rejects.toMatchObject({
    reason: 'deletes-everything',
  });
});

it('an encrypted document is refused by name and nothing is written', async () => {
  const ownerOnly = await buildEncryptedPdf(undefined);
  await expect(organizePdf(ownerOnly, 'owner-only.pdf', { kind: 'split-each' })).rejects.toMatchObject({
    reason: 'encrypted',
  });
  const userProtected = await buildEncryptedPdf('user-secret');
  await expect(organizePdf(userProtected, 'locked.pdf', { kind: 'split-each' })).rejects.toMatchObject({
    reason: 'encrypted',
  });
});

it('a file that is not a PDF is refused before parsing', async () => {
  const notAPdf = new TextEncoder().encode('just plain text, not a PDF at all');
  await expect(organizePdf(notAPdf, 'notes.txt', { kind: 'split-each' })).rejects.toThrow(PdfSplitError);
  await expect(organizePdf(notAPdf, 'notes.txt', { kind: 'split-each' })).rejects.toMatchObject({
    reason: 'unrecognised',
  });
});

it('text extracted by PDF.js from every output page equals the text of its source page', async () => {
  const source = await buildPdf([{ text: 'First page text' }, { text: 'Second page text' }]);
  const result = await organizePdf(source, 'sample.pdf', { kind: 'split-each' });
  expect(await pdfjsTextOf(result.files[0]!.bytes, 0)).toBe(await pdfjsTextOf(source, 0));
  expect(await pdfjsTextOf(result.files[1]!.bytes, 0)).toBe(await pdfjsTextOf(source, 1));
});

it('nothing is written to the console while organising pages', async () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  let calls = 0;
  console.log = () => {
    calls++;
  };
  console.warn = () => {
    calls++;
  };
  console.error = () => {
    calls++;
  };
  try {
    const source = await buildPdf([{ text: 'Quiet' }, { text: 'Quiet too' }]);
    await organizePdf(source, 'sample.pdf', { kind: 'split-each' });
    await organizePdf(source, 'sample.pdf', { kind: 'rotate', degrees: 90 });
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
  expect(calls).toBe(0);
});

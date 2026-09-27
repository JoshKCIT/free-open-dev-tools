import { it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFDict, PDFRawStream, decodePDFRawStream } from '@cantoo/pdf-lib';
import { imagesToPdf, ImageToPdfError, PAGE_SIZES, mmToPoints } from '../src/index';
import { writeJpeg, writePng, buildTransparentPng } from './build-images';

if (typeof (Promise as unknown as { try?: unknown }).try !== 'function') {
  (Promise as unknown as { try: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => Promise<unknown> }).try =
    function promiseTryPolyfill(fn, ...args) {
      return new Promise((resolve) => resolve(fn(...args)));
    };
}

const DEFAULT_OPTIONS = {
  pageSize: 'a4' as const,
  orientation: 'portrait' as const,
  marginMm: 0,
  fit: 'contain' as const,
};

function imageXObjectStreamBytes(doc: PDFDocument, pageIndex: number): { image: Uint8Array; smask?: Uint8Array } {
  const page = doc.getPage(pageIndex);
  const resources = page.node.Resources()!;
  const xObjects = resources.lookupMaybe(PDFName.of('XObject'), PDFDict)!;
  const keys = xObjects.keys();
  const imageRef = xObjects.get(keys[0]!)!;
  const imageDict = doc.context.lookup(imageRef as never) as PDFRawStream;
  const image = decodePDFRawStream(imageDict).decode();
  const smaskRef = imageDict.dict.get(PDFName.of('SMask'));
  const smask = smaskRef
    ? decodePDFRawStream(doc.context.lookup(smaskRef as never) as PDFRawStream).decode()
    : undefined;
  return { image, smask };
}

async function pdfjsDoc(bytes: Uint8Array) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjsLib.getDocument({
    data: bytes.slice(),
    useWorkerFetch: false,
    verbosity: 0,
  });
  return { doc: await task.promise, task };
}

it('a JPEG is embedded without re-encoding and the image stream equals the JPEG file bytes', async () => {
  const jpeg = writeJpeg(16, 8);
  const result = await imagesToPdf([{ name: 'photo.jpg', bytes: jpeg, kind: 'jpeg' }], DEFAULT_OPTIONS);
  const doc = await PDFDocument.load(result.bytes, { updateMetadata: false });
  const page = doc.getPage(0);
  const resources = page.node.Resources()!;
  const xObjects = resources.lookupMaybe(PDFName.of('XObject'), PDFDict)!;
  const keys = xObjects.keys();
  const imageRef = xObjects.get(keys[0]!)!;
  const imageDict = doc.context.lookup(imageRef as never) as PDFRawStream;
  expect(imageDict.dict.get(PDFName.of('Filter'))?.toString()).toBe('/DCTDecode');
  expect(imageDict.contents).toEqual(jpeg);
});

it('a PNG with transparency is embedded with a soft mask and its pixels are unchanged', async () => {
  const { bytes: pngBytes, width, height, rgba } = buildTransparentPng();
  const result = await imagesToPdf([{ name: 'pic.png', bytes: pngBytes, kind: 'png' }], DEFAULT_OPTIONS);
  const doc = await PDFDocument.load(result.bytes, { updateMetadata: false });
  const { image, smask } = imageXObjectStreamBytes(doc, 0);
  expect(smask).toBeDefined();
  expect(image.length).toBe(width * height * 3);
  expect(smask!.length).toBe(width * height);
  for (let p = 0; p < width * height; p++) {
    expect(image[p * 3]).toBe(rgba[p * 4]);
    expect(image[p * 3 + 1]).toBe(rgba[p * 4 + 1]);
    expect(image[p * 3 + 2]).toBe(rgba[p * 4 + 2]);
    expect(smask![p]).toBe(rgba[p * 4 + 3]);
  }
});

it('A3, A4, A5, US Letter and Legal page sizes match ISO 216 and ANSI dimensions in points', () => {
  expect(PAGE_SIZES.a4).toEqual({ width: 595.28, height: 841.89 });
  expect(PAGE_SIZES.a3).toEqual({ width: 841.89, height: 1190.55 });
  expect(PAGE_SIZES.a5).toEqual({ width: 419.53, height: 595.28 });
  expect(PAGE_SIZES.letter).toEqual({ width: 612, height: 792 });
  expect(PAGE_SIZES.legal).toEqual({ width: 612, height: 1008 });
  expect(mmToPoints(210)).toBe(595.28);
});

it('portrait, landscape and automatic orientation give each page the expected size', async () => {
  const wide = writeJpeg(16, 8); // wider than tall
  const tall = writeJpeg(8, 16); // taller than wide

  const portrait = await imagesToPdf([{ name: 'w.jpg', bytes: wide, kind: 'jpeg' }], {
    ...DEFAULT_OPTIONS,
    orientation: 'portrait',
  });
  const pDoc = await PDFDocument.load(portrait.bytes, { updateMetadata: false });
  expect(pDoc.getPage(0).getSize()).toEqual(PAGE_SIZES.a4);

  const landscape = await imagesToPdf([{ name: 't.jpg', bytes: tall, kind: 'jpeg' }], {
    ...DEFAULT_OPTIONS,
    orientation: 'landscape',
  });
  const lDoc = await PDFDocument.load(landscape.bytes, { updateMetadata: false });
  expect(lDoc.getPage(0).getSize()).toEqual({ width: PAGE_SIZES.a4.height, height: PAGE_SIZES.a4.width });

  const autoWide = await imagesToPdf([{ name: 'w.jpg', bytes: wide, kind: 'jpeg' }], {
    ...DEFAULT_OPTIONS,
    orientation: 'auto',
  });
  const awDoc = await PDFDocument.load(autoWide.bytes, { updateMetadata: false });
  expect(awDoc.getPage(0).getSize()).toEqual({ width: PAGE_SIZES.a4.height, height: PAGE_SIZES.a4.width });

  const autoTall = await imagesToPdf([{ name: 't.jpg', bytes: tall, kind: 'jpeg' }], {
    ...DEFAULT_OPTIONS,
    orientation: 'auto',
  });
  const atDoc = await PDFDocument.load(autoTall.bytes, { updateMetadata: false });
  expect(atDoc.getPage(0).getSize()).toEqual(PAGE_SIZES.a4);
});

it('an image is centred and scaled to fit inside the margins without changing its aspect ratio', async () => {
  const jpeg = writeJpeg(1600, 800); // 2:1 aspect ratio
  const result = await imagesToPdf([{ name: 'wide.jpg', bytes: jpeg, kind: 'jpeg' }], {
    ...DEFAULT_OPTIONS,
    marginMm: 10,
  });
  expect(result.pages).toHaveLength(1);
  const marginPt = mmToPoints(10);
  const contentWidth = PAGE_SIZES.a4.width - 2 * marginPt;
  const contentHeight = PAGE_SIZES.a4.height - 2 * marginPt;
  const scale = Math.min(contentWidth / 1600, contentHeight / 800);
  const drawWidth = 1600 * scale;
  const drawHeight = 800 * scale;
  expect(Math.abs(drawWidth / drawHeight - 2)).toBeLessThan(0.001);
  const expectedX = marginPt + (contentWidth - drawWidth) / 2;
  const expectedY = marginPt + (contentHeight - drawHeight) / 2;
  const [xStr, yStr] = result.pages[0]!.placedAt.split(', ');
  expect(Number(xStr)).toBeCloseTo(expectedX, 1);
  expect(Number(yStr)).toBeCloseTo(expectedY, 1);
});

it('a JPEG whose EXIF orientation is not 1 is placed upright on the page', async () => {
  const jpeg = writeJpeg(16, 8, 6);
  const result = await imagesToPdf([{ name: 'rot.jpg', bytes: jpeg, kind: 'jpeg' }], {
    ...DEFAULT_OPTIONS,
    fit: 'actual',
  });
  const { doc, task } = await pdfjsDoc(result.bytes);
  const page = await doc.getPage(1);
  const opList = await page.getOperatorList();
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let matrix: number[] | undefined;
  for (let i = 0; i < opList.fnArray.length; i++) {
    if (opList.fnArray[i] === pdfjsLib.OPS.paintImageXObject) {
      // `drawImage`'s own operator sequence pushes five `cm` operators in a
      // row before the image paint -- this package's own custom matrix
      // first, then translate(0,0)/rotate(0)/scale(1,1)/skew(0,0), each its
      // own identity `cm` (confirmed directly against the installed 2.11.1
      // source this session). Walking back to the earliest `cm` in that
      // contiguous run (right after `save`) finds the real one; the later
      // identity ones compose to no change.
      let j = i - 1;
      while (j >= 0 && opList.fnArray[j] !== pdfjsLib.OPS.transform) j--;
      let earliest = j;
      while (earliest - 1 >= 0 && opList.fnArray[earliest - 1] === pdfjsLib.OPS.transform) earliest--;
      matrix = opList.argsArray[earliest] as number[];
      break;
    }
  }
  await task.destroy();
  expect(matrix).toBeDefined();
  const [a, b, c, d, e, f] = matrix!;
  // Orientation 6 (rotate 90 CW to view): the raw image's own top-left
  // corner (unit square (0,1)) must land at the placement rectangle's own
  // top-right corner, per this package's own derivation (index.ts).
  const topLeftX = a! * 0 + c! * 1 + e!;
  const topLeftY = b! * 0 + d! * 1 + f!;
  const [xStr, yStr] = result.pages[0]!.placedAt.split(', ');
  const x = Number(xStr);
  const y = Number(yStr);
  // Upright dims for orientation 6: raw 16x8 swapped to 8x16 (width,height).
  const uprightWidth = 8 * (72 / 96);
  const uprightHeight = 16 * (72 / 96);
  expect(topLeftX).toBeCloseTo(x + uprightWidth, 1);
  expect(topLeftY).toBeCloseTo(y + uprightHeight, 1);
});

it('the output opens in PDF.js with one page per image and the expected page sizes', async () => {
  const a = writeJpeg(16, 8);
  const b = buildTransparentPng().bytes;
  const result = await imagesToPdf(
    [
      { name: 'a.jpg', bytes: a, kind: 'jpeg' },
      { name: 'b.png', bytes: b, kind: 'png' },
    ],
    DEFAULT_OPTIONS,
  );
  const { doc, task } = await pdfjsDoc(result.bytes);
  expect(doc.numPages).toBe(2);
  const page1 = await doc.getPage(1);
  const viewport = page1.getViewport({ scale: 1 });
  expect(Math.round(viewport.width * 100) / 100).toBe(PAGE_SIZES.a4.width);
  expect(Math.round(viewport.height * 100) / 100).toBe(PAGE_SIZES.a4.height);
  await task.destroy();
});

it('a file that is not a PNG or JPEG is refused before embedding', async () => {
  const notAnImage = new TextEncoder().encode('just plain text, not an image at all');
  await expect(imagesToPdf([{ name: 'notes.txt', bytes: notAnImage, kind: 'png' }], DEFAULT_OPTIONS)).rejects.toThrow(
    ImageToPdfError,
  );
});

it('nothing is written to the console while building the PDF', async () => {
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
    const jpeg = writeJpeg(16, 8);
    const png = writePng(4, 4, new Uint8Array(4 * 4 * 4).fill(200));
    await imagesToPdf(
      [
        { name: 'a.jpg', bytes: jpeg, kind: 'jpeg' },
        { name: 'b.png', bytes: png, kind: 'png' },
      ],
      DEFAULT_OPTIONS,
    );
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
  expect(calls).toBe(0);
});

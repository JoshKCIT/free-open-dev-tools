import { it, expect, vi } from 'vitest';
// Imported first, and deliberately before any import that reaches
// src/binary-data.ts transitively (src/index.ts does): its own
// `FODT_REGENERATE` side effect must run before that generated module is
// ever read, or a regeneration run compares the freshly written file
// against the placeholder value ES module evaluation already cached.
import { buildBinaryData, FOXIT_FONT_FILES } from './build-binary-data';
import { getDocument, PDFJS_SAFE_OPTIONS, planRender, renderPages, bundledBinaryData } from '../src/index';
import { buildMinimalPdf } from './minimal-pdf';
import { createTestBinaryDataFactory, createTestSurfaceFactory, createTestCanvasFactory } from './pdfjs-node';
import { BUNDLED_BINARY_DATA } from '../src/binary-data';

/**
 * PDF.js's own `data` option takes ownership of the bytes it is given and
 * detaches the underlying buffer once loading starts (the same zero-copy
 * transfer its real Worker message channel uses, confirmed directly this
 * session even against the in-process fake worker Node uses). Every call
 * here hands PDF.js a fresh copy (`bytes.slice()`) so the caller's own
 * `bytes` reference stays usable afterwards -- for `planRender`, for a
 * second `getDocument` call, or for building a different fixture from the
 * same source bytes.
 *
 * Every title below is a top-level `it(...)` call, never nested in
 * `describe(...)`: Vitest's JSON reporter concatenates the describe name
 * into `fullName`, and this project's own verify scripts match required
 * titles by exact equality.
 */
function loadDocument(bytes: Uint8Array) {
  const BinaryDataFactory = createTestBinaryDataFactory();
  const task = getDocument({
    ...PDFJS_SAFE_OPTIONS,
    data: bytes.slice(),
    BinaryDataFactory,
    CanvasFactory: createTestCanvasFactory(),
  });
  return { task, requests: BinaryDataFactory.requests };
}

it('a page renders at the requested resolution with the size the PDF user space unit gives', async () => {
  // ISO 32000-1:2008 section 8.3.2.3 "User Space": "the default value of
  // 1/72 inch is used" for the length of a unit in default user space, so
  // a US Letter page (MediaBox [0 0 612 792]) rendered at 72 dots per
  // inch is 612 by 792 pixels, and at 144 dots per inch is 1224 by 1584.
  const pdf = buildMinimalPdf({ pages: [{ fillColor: [1, 0, 0], mediaBox: [0, 0, 612, 792] }] });
  const surfaces = createTestSurfaceFactory();

  for (const [dpi, expectedWidth, expectedHeight] of [
    [72, 612, 792],
    [144, 1224, 1584],
  ] as const) {
    const { task } = loadDocument(pdf);
    const document = await task.promise;
    try {
      const plan = planRender(pdf, 'sample.pdf', { dpi });
      const [rendered] = await renderPages(document, plan, surfaces);
      expect(rendered!.width).toBe(expectedWidth);
      expect(rendered!.height).toBe(expectedHeight);

      // The filled rectangle ("50 50 200 100 re f" in PDF user space) is
      // opaque red; sample its centre in device space via PDF.js's own
      // viewport transform rather than a hand-derived pixel formula.
      const page = await document.getPage(1);
      const viewport = page.getViewport({ scale: dpi / 72 });
      const [devX, devY] = viewport.convertToViewportPoint(150, 100);
      const { createCanvas, loadImage } = await import('@napi-rs/canvas');
      const decodeCanvas = createCanvas(expectedWidth, expectedHeight);
      const decodeCtx = decodeCanvas.getContext('2d');
      const img = await loadImage(Buffer.from(rendered!.bytes));
      decodeCtx.drawImage(img, 0, 0);
      const pixel = decodeCtx.getImageData(Math.round(devX), Math.round(devY), 1, 1).data;
      expect(pixel[0]).toBeGreaterThan(200); // red channel
      expect(pixel[1]).toBeLessThan(60); // green channel
    } finally {
      await task.destroy();
    }
  }
});

it('the bundled binary data is exactly what the generator builds from the installed pdfjs-dist files', () => {
  const fresh = buildBinaryData();
  expect(BUNDLED_BINARY_DATA).toEqual(fresh);
  expect(Object.keys(BUNDLED_BINARY_DATA).sort()).toEqual([...FOXIT_FONT_FILES].sort());
  for (const filename of FOXIT_FONT_FILES) {
    const bytes = bundledBinaryData('font', filename);
    expect(bytes).not.toBeNull();
    expect(bytes!.length).toBe(BUNDLED_BINARY_DATA[filename]!.bytes);
  }
  // Never the Liberation Sans files (GPL-2.0 with a font exception that
  // does not cover redistributing the font itself) and never a character
  // map or the scripting engine.
  for (const forbidden of ['LiberationSans-Regular.ttf', 'LiberationSans-Bold.ttf', 'quickjs']) {
    expect(BUNDLED_BINARY_DATA[forbidden]).toBeUndefined();
  }
  expect(bundledBinaryData('font', 'LiberationSans-Regular.ttf')).toBeNull();
});

it('PDF.js is given no address to load anything from and every option that could fetch is off', async () => {
  expect(PDFJS_SAFE_OPTIONS.useWorkerFetch).toBe(false);
  expect(PDFJS_SAFE_OPTIONS.enableXfa).toBe(false);
  // Every value here is a plain boolean or number: none of cMapUrl,
  // standardFontDataUrl or wasmUrl is set at all, so there is no address
  // or path anywhere in this object for a fetch to reach.
  for (const value of Object.values(PDFJS_SAFE_OPTIONS)) {
    expect(['boolean', 'number']).toContain(typeof value);
  }

  // Every request PDF.js's own factory makes while loading and rendering
  // a real document is answered from bundled bytes or refused -- never
  // routed to a real address.
  const pdf = buildMinimalPdf({ pages: [{ text: 'Hello standard font' }] });
  const { task, requests } = loadDocument(pdf);
  const document = await task.promise;
  try {
    const plan = planRender(pdf, 'sample.pdf');
    await renderPages(document, plan, createTestSurfaceFactory());
  } finally {
    await task.destroy();
  }
  expect(requests.length).toBeGreaterThan(0);
  for (const req of requests) {
    expect(['cMapUrl', 'standardFontDataUrl', 'wasmUrl']).toContain(req.kind);
  }
});

it('nothing is written to the console while rendering', async () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const pdf = buildMinimalPdf({ pages: [{ text: 'Quiet please', fillColor: [0, 0, 1] }] });
    const { task } = loadDocument(pdf);
    const document = await task.promise;
    try {
      const plan = planRender(pdf, 'sample.pdf');
      await renderPages(document, plan, createTestSurfaceFactory());
    } finally {
      await task.destroy();
    }
  } finally {
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    logSpy.mockRestore();
  }
});

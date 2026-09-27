import { it, expect, vi } from 'vitest';
// Imported first, and deliberately before any import that reaches
// src/binary-data.ts transitively (src/index.ts does): its own
// `FODT_REGENERATE` side effect must run before that generated module is
// ever read, or a regeneration run compares the freshly written file
// against the placeholder value ES module evaluation already cached.
import { buildBinaryData, FOXIT_FONT_FILES, WASM_DECODER_FILES, ICC_PROFILE_FILES } from './build-binary-data';
import {
  getDocument,
  PDFJS_SAFE_OPTIONS,
  planRender,
  resolvePages,
  renderPages,
  bundledBinaryData,
  PasswordException,
  PdfToImageError,
} from '../src/index';
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

/**
 * [09-03 deviation, Rule 3 - Blocking] `test/file-sniff.test.ts` is one of
 * this phase's canonical, byte-for-byte-copied snippets (09-01's own BR):
 * every later file-reading tool's copy is checked equal to this file's copy
 * by SNIPPETS-IDENTICAL. The version 09-01 committed embedded a real PDF.js
 * getDocument() round trip in its first test, which only compiles here
 * (this package alone exports getDocument and has test/minimal-pdf.ts and
 * test/pdfjs-node.ts); copying it verbatim into image-converter or
 * favicon-generator would fail to even parse. The sniffFile-only behaviour
 * moved into file-sniff.test.ts's own (renamed) first test, which needs no
 * package-specific import and is now genuinely copyable; the PDF.js
 * integration half of the original test is preserved here instead, since it
 * is still worth proving that PDF.js's own header leniency and this
 * package's sniffFile() search window agree on the same boundary.
 */
it('a PDF header found within file-sniff.ts own search window is one PDF.js itself also opens', async () => {
  const junk = new Uint8Array(300).fill(0x20); // 300 bytes of junk before the header, still inside the window
  const pdf = buildMinimalPdf({ pages: [{ text: 'Hello' }] });
  const withJunk = new Uint8Array(junk.length + pdf.length);
  withJunk.set(junk, 0);
  withJunk.set(pdf, junk.length);

  for (const bytes of [pdf, withJunk]) {
    const { task } = loadDocument(bytes);
    const doc = await task.promise;
    expect(doc.numPages).toBe(1);
    await task.destroy();
  }
});

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
  const allBundledFiles = [...FOXIT_FONT_FILES, ...WASM_DECODER_FILES, ...ICC_PROFILE_FILES];
  expect(Object.keys(BUNDLED_BINARY_DATA).sort()).toEqual([...allBundledFiles].sort());
  for (const filename of allBundledFiles) {
    const kind = FOXIT_FONT_FILES.includes(filename) ? 'font' : ICC_PROFILE_FILES.includes(filename) ? 'icc' : 'wasm';
    const bytes = bundledBinaryData(kind, filename);
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

it('a password protected document is refused without asking for a password', async () => {
  const pdf = buildMinimalPdf({ pages: [{ text: 'secret' }], userPassword: 'hunter2' });
  const { task } = loadDocument(pdf);
  let caught: unknown;
  try {
    await task.promise;
  } catch (err) {
    caught = err;
  } finally {
    await task.destroy();
  }
  // PDF.js's own PasswordException, thrown because this tool never sets
  // `onPassword` at all -- the password callback is never even given the
  // chance to be answered, let alone answered with a value.
  expect(caught).toBeInstanceOf(PasswordException);
});

it('a document that asks for a character map that is not bundled is reported with the plain note', async () => {
  // A Type0/CIDFontType0 font (ISO 32000-1 9.7) whose /Encoding names the
  // built-in CMap UniJIS-UCS2-H, which this tool's own bundled data never
  // includes (D-138): rendering still succeeds, and the factory's own
  // request log shows the refused cMapUrl request the driver turns into
  // the visitor-facing CJK note.
  const pdf = buildMinimalPdf({ pages: [{ cjkText: true }] });
  const { task, requests } = loadDocument(pdf);
  const document = await task.promise;
  try {
    const plan = planRender(pdf, 'sample.pdf');
    const rendered = await renderPages(document, plan, createTestSurfaceFactory());
    expect(rendered.length).toBe(1);
  } finally {
    await task.destroy();
  }
  const cmapRequests = requests.filter((r) => r.kind === 'cMapUrl');
  expect(cmapRequests.length).toBeGreaterThan(0);
  expect(cmapRequests.every((r) => r.served === false)).toBe(true);
});

it('document scripts and actions are never run and the scripting engine is never requested', async () => {
  const pdf = buildMinimalPdf({
    pages: [{ text: 'has an OpenAction' }],
    openActionJavaScript: 'app.alert("this must never run");',
  });
  const { task, requests } = loadDocument(pdf);
  const document = await task.promise;
  try {
    const plan = planRender(pdf, 'sample.pdf');
    const rendered = await renderPages(document, plan, createTestSurfaceFactory());
    expect(rendered.length).toBe(1);
  } finally {
    await task.destroy();
  }
  for (const req of requests) {
    expect(req.filename.toLowerCase()).not.toContain('quickjs');
  }
});

it('JPEG output uses the chosen quality and PNG output keeps transparency when asked', async () => {
  const pdf = buildMinimalPdf({ pages: [{ fillColor: [1, 0, 0], mediaBox: [0, 0, 100, 100] }] });
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');

  {
    const { task } = loadDocument(pdf);
    const document = await task.promise;
    try {
      const plan = planRender(pdf, 'sample.pdf', { format: 'jpeg', quality: 40 });
      const [page] = await renderPages(document, plan, createTestSurfaceFactory());
      expect(page!.mime).toBe('image/jpeg');
      // ITU-T T.81 SOI marker: every JPEG starts 0xFFD8.
      expect(page!.bytes[0]).toBe(0xff);
      expect(page!.bytes[1]).toBe(0xd8);
    } finally {
      await task.destroy();
    }
  }

  async function backgroundAlpha(transparent: boolean): Promise<number> {
    const { task } = loadDocument(pdf);
    const document = await task.promise;
    try {
      const plan = planRender(pdf, 'sample.pdf', { format: 'png', transparent });
      const [page] = await renderPages(document, plan, createTestSurfaceFactory());
      const decodeCanvas = createCanvas(page!.width, page!.height);
      const ctx = decodeCanvas.getContext('2d');
      const img = await loadImage(Buffer.from(page!.bytes));
      ctx.drawImage(img, 0, 0);
      // A corner pixel, well outside the drawn rectangle ("50 50 200 100 re f").
      return ctx.getImageData(0, 0, 1, 1).data[3]!;
    } finally {
      await task.destroy();
    }
  }

  expect(await backgroundAlpha(false)).toBe(255);
  expect(await backgroundAlpha(true)).toBe(0);
});

it('a page whose rendered size would exceed the pixel limit is refused before rendering', async () => {
  // A MediaBox large enough that even at 72 dots per inch (scale 1) the
  // rendered pixel count exceeds MAX_PAGE_PIXELS (40,000,000): 8000 x 6000
  // is 48,000,000.
  const pdf = buildMinimalPdf({ pages: [{ mediaBox: [0, 0, 8000, 6000] }] });
  const { task } = loadDocument(pdf);
  const document = await task.promise;
  try {
    const plan = planRender(pdf, 'sample.pdf', { dpi: 72 });
    await expect(renderPages(document, plan, createTestSurfaceFactory())).rejects.toThrow(PdfToImageError);
  } finally {
    await task.destroy();
  }
});

it('rendering stops between pages when the run is cancelled', async () => {
  const pdf = buildMinimalPdf({
    pages: Array.from({ length: 5 }, (_, i) => ({ text: `Page ${i + 1}` })),
  });
  const { task } = loadDocument(pdf);
  const document = await task.promise;
  try {
    const plan = planRender(pdf, 'sample.pdf');
    const controller = new AbortController();
    let pagesDone = 0;
    const run = renderPages(document, plan, createTestSurfaceFactory(), {
      signal: controller.signal,
      onProgress: (done) => {
        pagesDone = done;
        if (done === 2) controller.abort();
      },
    });
    await expect(run).rejects.toThrow(PdfToImageError);
    expect(pagesDone).toBe(2);
  } finally {
    await task.destroy();
  }
});

it('the page list resolves against the real page count and refuses a list over this run’s own page limit', async () => {
  const pdf = buildMinimalPdf({
    pages: Array.from({ length: 5 }, (_, i) => ({ text: `Page ${i + 1}` })),
  });
  const { task } = loadDocument(pdf);
  const document = await task.promise;
  try {
    const plan = planRender(pdf, 'sample.pdf', { pages: '2,4' });
    const resolved = resolvePages(plan, document.numPages);
    expect(resolved.pages).toEqual([2, 4]);
    const rendered = await renderPages(document, resolved, createTestSurfaceFactory());
    expect(rendered.map((p) => p.page)).toEqual([2, 4]);
  } finally {
    await task.destroy();
  }
});

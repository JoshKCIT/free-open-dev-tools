/**
 * Test-only adapter that lets this package's tests drive the real, installed pdfjs-dist entirely in Node, through the
 * same refusing binary-data factory and the same safe options the page uses, so a passing test is real evidence about
 * how the shipped code behaves and not a mock standing in for it.
 *
 * pdfjs-dist 6.3.289's own message handler calls the standard `Promise.try(fn, ...args)` (a TC39 method that reaches
 * V8 and Node only from Node 23.9; `typeof Promise.try` is `undefined` on Node 22.14 and on CI's Node 22.23.3) whenever
 * PDF.js runs its in-process "fake worker", which is the path every `getDocument()` call in a Node test takes. Every
 * browser this site tests ships `Promise.try`; the gap is specific to running PDF.js's shared message code directly in
 * Node, so the polyfill lives here, in a test-only file the browser bundle never contains. A Node that has its own
 * `Promise.try` skips it.
 */
import {
  createRefusingBinaryDataFactory,
  getDocument,
  PDFJS_SAFE_OPTIONS,
  type BinaryRequest,
  type PDFDocumentProxy,
} from '../src/index';

type PromiseTry = (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => Promise<unknown>;

if (typeof (Promise as unknown as { try?: unknown }).try !== 'function') {
  (Promise as unknown as { try: PromiseTry }).try = function promiseTryPolyfill(fn, ...args) {
    return new Promise((resolve) => resolve(fn(...args)));
  };
}

export interface OpenedPdf {
  doc: PDFDocumentProxy;
  /** Every binary-data request PDF.js made while this document was open, each refused. */
  requests: BinaryRequest[];
  destroy(): Promise<void>;
}

/**
 * Opens `bytes` with PDF.js the way the page does: safe options, every binary-data request refused and recorded. A
 * fresh copy of the bytes is handed over because PDF.js takes ownership of the buffer it is given.
 */
export async function openWithPdfJs(bytes: Uint8Array): Promise<OpenedPdf> {
  const { Factory, requests } = createRefusingBinaryDataFactory();
  const task = getDocument({
    ...PDFJS_SAFE_OPTIONS,
    data: bytes.slice(),
    BinaryDataFactory: Factory as never,
  });
  try {
    const doc = await task.promise;
    return {
      doc,
      requests,
      destroy: async () => {
        await task.destroy();
      },
    };
  } catch (err) {
    await task.destroy();
    throw err;
  }
}

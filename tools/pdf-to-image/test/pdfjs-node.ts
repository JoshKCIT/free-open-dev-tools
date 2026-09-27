/**
 * Test-only adapters that let this package's own tests drive the real,
 * installed pdfjs-dist entirely in Node, through exactly the same
 * "answer only from bundled bytes, refuse everything else" contract the
 * browser worker uses -- so a passing test here is real evidence about
 * how the shipped code behaves, not a mock standing in for it.
 */
import { createCanvas } from '@napi-rs/canvas';
import { bundledBinaryData } from '../src/index';
import type { RenderSurfacePair, SurfaceFactory } from '../src/render';

/**
 * pdfjs-dist 6.3.289's own `src/shared/message_handler.js` calls the
 * standard `Promise.try(fn, ...args)` (a TC39 stage-4 method landing in
 * V8/Node only from Node 23.9; measured directly this session: `typeof
 * Promise.try` is `undefined` on this project's own Node 22.14 floor,
 * `process.versions.v8` `12.4.254.21-node.22`) whenever PDF.js runs its
 * "fake worker" loopback message handler -- exactly the path every
 * `getDocument()` call in this package's own Node-side test suite takes,
 * since there is no real Worker thread in Node. Every browser this
 * project tests (chromium, firefox, webkit, mobile-chrome through
 * Playwright) ships `Promise.try` already; this gap is specific to
 * running PDF.js's shared message-handler code directly in Node, so the
 * polyfill lives here, in the test-only adapter, never in a file the
 * browser bundle ships. A future Node upgrade past 23.9 makes this a
 * no-op (the `typeof` guard skips it once the platform provides its own).
 */
if (typeof (Promise as unknown as { try?: unknown }).try !== 'function') {
  (Promise as unknown as { try: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => Promise<unknown> }).try =
    function promiseTryPolyfill(fn, ...args) {
      return new Promise((resolve) => resolve(fn(...args)));
    };
}

export interface BinaryDataRequestLog {
  kind: string;
  filename: string;
  served: boolean;
}

/**
 * Returns a `BinaryDataFactory` **class** -- pdfjs-dist's own `getDocument`
 * constructs it itself (`new BinaryDataFactory({ cMapUrl, standardFontDataUrl,
 * wasmUrl })`, confirmed directly against the installed 6.3.289 source this
 * session) -- whose `fetch({ kind, filename })` answers only from
 * `bundledBinaryData`, recording every request it sees so a test can assert
 * on exactly what was asked for and whether it was served.
 */
export function createTestBinaryDataFactory(): {
  new (...args: unknown[]): { fetch(req: { kind: string; filename: string }): Promise<Uint8Array> };
  requests: BinaryDataRequestLog[];
} {
  const requests: BinaryDataRequestLog[] = [];
  class TestBinaryDataFactory {
    static requests = requests;
    constructor(..._args: unknown[]) {
      // The URL-shaped constructor arguments (cMapUrl/standardFontDataUrl/
      // wasmUrl) are accepted and ignored: every byte this factory ever
      // returns comes from bundledBinaryData, never a URL.
    }
    async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
      const bundledKind = kind === 'standardFontDataUrl' ? 'font' : kind === 'cMapUrl' ? 'cmap' : 'wasm';
      const data = bundledBinaryData(bundledKind, filename);
      requests.push({ kind, filename, served: data !== null });
      if (!data) throw new Error(`Not bundled: ${kind} ${filename}`);
      return data;
    }
  }
  return TestBinaryDataFactory as unknown as {
    new (...args: unknown[]): { fetch(req: { kind: string; filename: string }): Promise<Uint8Array> };
    requests: BinaryDataRequestLog[];
  };
}

/**
 * A `SurfaceFactory` (tools/pdf-to-image/src/render.ts) built on
 * @napi-rs/canvas. `encode` uses the canvas's own `toBuffer(mime, quality)`
 * method, not `convertToBlob`: measured directly this session, the
 * installed @napi-rs/canvas version's own `convertToBlob({ type:
 * 'image/jpeg' })` silently returns a PNG blob (the exact D-139
 * silent-substitution shape this package's own `renderPages` is built to
 * catch and refuse), while its `toBuffer('image/jpeg', quality)` encodes a
 * real JPEG correctly. `toBuffer` is this test double's own path to a
 * genuinely correct encoded byte string; `convertToBlob`'s real behaviour,
 * including this D-139 case, is what the browser worker's own dedicated
 * spec proves.
 */
export function createTestSurfaceFactory(): SurfaceFactory {
  const MIME_TO_EXT: Record<string, 'image/png' | 'image/jpeg'> = {
    'image/png': 'image/png',
    'image/jpeg': 'image/jpeg',
  };
  return {
    create(width, height): RenderSurfacePair {
      const canvas = createCanvas(width, height);
      const context = canvas.getContext('2d');
      return { canvas, context };
    },
    reset(pair, width, height) {
      const canvas = pair.canvas as { width: number; height: number };
      canvas.width = width;
      canvas.height = height;
    },
    destroy(pair) {
      const canvas = pair.canvas as { width: number; height: number };
      canvas.width = 0;
      canvas.height = 0;
    },
    async encode(canvas, mimeType, quality) {
      const napiCanvas = canvas as {
        toBuffer(mime: 'image/png'): Buffer;
        toBuffer(mime: 'image/jpeg', quality?: number): Buffer;
      };
      const ext = MIME_TO_EXT[mimeType] ?? 'image/png';
      const buffer =
        ext === 'image/jpeg' ? napiCanvas.toBuffer('image/jpeg', quality) : napiCanvas.toBuffer('image/png');
      return { type: ext, bytes: new Uint8Array(buffer) };
    },
  };
}

/**
 * A minimal `CanvasFactory` **class** for `getDocument`'s own option of the
 * same name (distinct from `SurfaceFactory` above, which this package's own
 * `renderPages` uses for its top-level page surface). PDF.js needs this for
 * internal work (soft masks, patterns) during rendering.
 */
export function createTestCanvasFactory(): new (...args: unknown[]) => {
  create(width: number, height: number): RenderSurfacePair;
  reset(pair: RenderSurfacePair, width: number, height: number): void;
  destroy(pair: RenderSurfacePair): void;
} {
  return class TestCanvasFactory {
    create(width: number, height: number): RenderSurfacePair {
      const canvas = createCanvas(width, height);
      const context = canvas.getContext('2d');
      return { canvas, context };
    }
    reset(pair: RenderSurfacePair, width: number, height: number) {
      const canvas = pair.canvas as { width: number; height: number };
      canvas.width = width;
      canvas.height = height;
    }
    destroy(pair: RenderSurfacePair) {
      const canvas = pair.canvas as { width: number; height: number };
      canvas.width = 0;
      canvas.height = 0;
    }
  };
}

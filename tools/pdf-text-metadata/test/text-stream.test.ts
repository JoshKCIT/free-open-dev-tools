import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MAX_TEXT_CHARS, extractPageTexts, type PdfDocLike, type PdfPageLike } from '../src/index';
import { buildRawPdf, streamObject } from './bombs';
import { openWithPdfJs } from './pdfjs-node';

/**
 * Every title below is a top-level `it(...)` call (see index.test.ts for why). The text of one page is read as a stream
 * of items and reading stops when the character budget of the run is reached, so a page that holds millions of items
 * is not built in full. The numbers are the budget of this folder (2,000,000 characters) and the sizes the builders
 * were given.
 */
const quiet = { signal: new AbortController().signal, onPage: () => undefined };

beforeEach(() => {
  for (const method of ['log', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface Counters {
  chunks: number;
  items: number;
  cancelled: boolean;
}

/** A page whose text arrives as `chunkCount` chunks of `perChunk` items of `size` characters, counting what is pulled. */
function streamingPage(chunkCount: number, perChunk: number, size: number, counters: Counters): PdfPageLike {
  let sent = 0;
  return {
    getTextContent: () => Promise.reject(new Error('The whole page must not be built.')),
    streamTextContent: () =>
      new ReadableStream<{ items: unknown[] }>(
        {
          pull(controller) {
            if (sent === chunkCount) {
              controller.close();
              return;
            }
            sent++;
            counters.chunks++;
            const items = Array.from({ length: perChunk }, () => {
              counters.items++;
              return { str: 'x'.repeat(size), hasEOL: false };
            });
            controller.enqueue({ items });
          },
          cancel() {
            counters.cancelled = true;
          },
        },
        { highWaterMark: 0 },
      ),
    cleanup: () => undefined,
  };
}

it('a page with far more text than the budget is cut at 2,000,000 characters without reading the rest of it', async () => {
  const counters: Counters = { chunks: 0, items: 0, cancelled: false };
  const doc: PdfDocLike = { numPages: 1, getPage: () => Promise.resolve(streamingPage(1000, 100, 1000, counters)) };
  const result = await extractPageTexts(doc, [1], quiet);
  expect(result.pages).toHaveLength(1);
  expect(result.pages[0]!.text).toHaveLength(MAX_TEXT_CHARS);
  expect(result.notes.some((note) => note.includes('2,000,000 characters'))).toBe(true);
  // 100,000 characters arrive in each chunk, so 20 chunks fill the budget; the other 980 are never asked for.
  expect(counters.chunks).toBeLessThanOrEqual(22);
  expect(counters.items).toBeLessThanOrEqual(2200);
  expect(counters.cancelled).toBe(true);
});

it('the budget is shared by the pages: a second page is cut where the first one left off, and a third is not read', async () => {
  const pages = [
    { chunks: 0, items: 0, cancelled: false },
    { chunks: 0, items: 0, cancelled: false },
    { chunks: 0, items: 0, cancelled: false },
  ] satisfies Counters[];
  let requested = 0;
  const doc: PdfDocLike = {
    numPages: 3,
    getPage: (n) => {
      requested++;
      return Promise.resolve(streamingPage(1000, 100, 1000, pages[n - 1]!));
    },
  };
  const result = await extractPageTexts(doc, [1, 2, 3], quiet);
  expect(result.pages.map((p) => p.page)).toEqual([1]);
  expect(requested).toBe(1);

  // Pages of 600,000 characters each: the first two are whole, the third is cut at the 200,000 that are left.
  const small: Counters[] = [
    { chunks: 0, items: 0, cancelled: false },
    { chunks: 0, items: 0, cancelled: false },
    { chunks: 0, items: 0, cancelled: false },
    { chunks: 0, items: 0, cancelled: false },
  ];
  const doc2: PdfDocLike = {
    numPages: 4,
    getPage: (n) => Promise.resolve(streamingPage(6, 10, 10_000, small[n - 1]!)),
  };
  const result2 = await extractPageTexts(doc2, [1, 2, 3, 4], quiet);
  expect(result2.pages.map((p) => p.text.length)).toEqual([600_000, 600_000, 600_000, 200_000]);
  expect(small[3]!.cancelled).toBe(true);
});

it('a stream that fails marks the page as unreadable and the others are still read', async () => {
  const bad: PdfPageLike = {
    getTextContent: () => Promise.reject(new Error('no')),
    streamTextContent: () =>
      new ReadableStream({
        pull(controller) {
          controller.error(new Error('the page could not be parsed'));
        },
      }),
    cleanup: () => undefined,
  };
  const good: PdfPageLike = {
    getTextContent: () => Promise.resolve({ items: [] }),
    streamTextContent: () =>
      new ReadableStream({
        pull(controller) {
          controller.enqueue({ items: [{ str: 'fine', hasEOL: true }] });
          controller.close();
        },
      }),
    cleanup: () => undefined,
  };
  const doc: PdfDocLike = { numPages: 2, getPage: (n) => Promise.resolve(n === 1 ? bad : good) };
  const result = await extractPageTexts(doc, [1, 2], quiet);
  expect(result.pages[0]).toEqual({ page: 1, text: '', empty: true, failed: true });
  expect(result.pages[1]).toEqual({ page: 2, text: 'fine\n', empty: false });
  expect(result.notes).toContain('Page 1 could not be read.');
});

it('cancelling while a page streams stops at once and cancels the stream', async () => {
  const counters: Counters = { chunks: 0, items: 0, cancelled: false };
  const controller = new AbortController();
  const page = streamingPage(1000, 10, 100, counters);
  const original = page.streamTextContent!;
  page.streamTextContent = () => {
    const stream = original();
    const reader = stream.getReader();
    return new ReadableStream({
      async pull(out) {
        const next = await reader.read();
        if (next.done) out.close();
        else {
          out.enqueue(next.value);
          if (counters.chunks === 3) controller.abort();
        }
      },
      cancel: () => reader.cancel(),
    });
  };
  const doc: PdfDocLike = { numPages: 1, getPage: () => Promise.resolve(page) };
  await expect(extractPageTexts(doc, [1], { signal: controller.signal, onPage: () => undefined })).rejects.toThrow(
    'The run was cancelled.',
  );
  expect(counters.chunks).toBeLessThanOrEqual(5);
  expect(counters.cancelled).toBe(true);
});

/**
 * A page that draws the same form 10 times, which draws another form 10 times, and so on four levels down, with 400
 * characters of text in the last form: 10,000 text items of 400 characters (4,000,000 characters) from a file of about
 * 2 KB. The reviewer's probe for the same flaw went five levels down (100,000 items, 10.8 seconds).
 */
function nestedFormsPdf(depth: number, fan: number, text: string): Uint8Array {
  const objects = [
    { number: 1, body: Buffer.from('<< /Type /Catalog /Pages 2 0 R >>') },
    { number: 2, body: Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>') },
    {
      number: 3,
      body: Buffer.from(
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /XObject << /X0 10 0 R >> /Font << /F1 5 0 R >> >> >>',
      ),
    },
    { number: 4, body: streamObject('', Buffer.from('/X0 Do')) },
    { number: 5, body: Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>') },
  ];
  for (let level = 0; level <= depth; level++) {
    const content =
      level === depth
        ? `BT /F1 0.5 Tf 0 0 Td (${text}) Tj ET`
        : Array.from({ length: fan }, () => `/X${level + 1} Do`).join('\n');
    objects.push({
      number: 10 + level,
      body: streamObject(
        `/Type /XObject /Subtype /Form /BBox [0 0 200 200] /Resources << /XObject << /X${level + 1} ${11 + level} 0 R >> /Font << /F1 5 0 R >> >>`,
        Buffer.from(content),
      ),
    });
  }
  return buildRawPdf(objects);
}

it('a real PDF whose forms repeat each other into millions of characters stops reading at the budget', async () => {
  const bytes = nestedFormsPdf(4, 10, 'A'.repeat(400));
  expect(bytes.length).toBeLessThan(4000);
  const pdf = await openWithPdfJs(bytes);
  try {
    let delivered = 0;
    const doc: PdfDocLike = {
      numPages: pdf.doc.numPages,
      getPage: async (n) => {
        const page = await pdf.doc.getPage(n);
        return {
          getTextContent: () => page.getTextContent() as Promise<{ items: unknown[] }>,
          streamTextContent: () => {
            const reader = page.streamTextContent().getReader();
            return new ReadableStream({
              async pull(controller) {
                const next = await reader.read();
                if (next.done) {
                  controller.close();
                  return;
                }
                delivered += next.value.items.length;
                controller.enqueue(next.value);
              },
              cancel: () => reader.cancel(),
            });
          },
          cleanup: () => page.cleanup(),
        } as PdfPageLike;
      },
    };
    const result = await extractPageTexts(doc, [1], quiet);
    expect(result.pages[0]!.text).toHaveLength(MAX_TEXT_CHARS);
    expect(result.notes.some((note) => note.includes('2,000,000 characters'))).toBe(true);
    // Five thousand items fill the budget; the other five thousand are never read.
    expect(delivered).toBeLessThan(7000);
  } finally {
    await pdf.destroy();
  }
}, 60_000);

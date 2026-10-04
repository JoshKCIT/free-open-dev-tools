/**
 * Page by page text from an already opened PDF.js document, with the limits that keep one run bounded: at most 500 pages
 * and 2,000,000 characters, a progress call after every page, and a stop between pages when the caller cancels.
 *
 * ISO 32000-1:2008 section 9.4 describes how text is shown on a page; section 7.7.3 describes the page tree whose order
 * the page numbers follow. PDF.js reports the text of a page as a list of items, each with its string and a flag that
 * says a line ends there; the page text is the strings in order with a line break after each flagged item.
 *
 * Nothing here touches the DOM, a clock or a network: the document is injected, so a test can drive it with a fake.
 */
import { MAX_TEXT_CHARS, MAX_TEXT_PAGES, head, visible } from './shared';

/**
 * The part of a PDF.js page this module uses. The text is read with `streamTextContent` when the page has it, so reading
 * can stop at the character budget; `getTextContent` (the whole page at once) is the fallback for a page without it.
 */
export interface PdfPageLike {
  getTextContent(): Promise<{ items: unknown[] }>;
  streamTextContent?(): ReadableStream<{ items: unknown[] }>;
  cleanup(): void;
}

/** The part of a PDF.js document this module uses. */
export interface PdfDocLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
}

export interface PageText {
  page: number;
  /** The text of the page; empty when the page has none or could not be read. */
  text: string;
  empty: boolean;
  /** Only present, and true, for a page that could not be read. */
  failed?: true;
}

export interface ExtractOptions {
  /** Aborting stops the run before the next page and rejects with a plain message. */
  signal: AbortSignal;
  /** Called after each page with the number of pages read so far and the number this run will read. */
  onPage(done: number, total: number): void;
}

export interface ExtractResult {
  pages: PageText[];
  /** Plain sentences about what was left out or could not be read. */
  notes: string[];
}

const CANCELLED = 'The run was cancelled.';

const CHAR_LIMIT_NOTE = 'Text stops at 2,000,000 characters, the most this page shows; later text was left out.';

function cancelled(): Error {
  const error = new Error(CANCELLED);
  error.name = 'AbortError';
  return error;
}

/** The strings of PDF.js's text items in order, with a line break after each item that ends a line. */
function joinItems(items: unknown[]): string {
  let out = '';
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const { str, hasEOL } = item as { str?: unknown; hasEOL?: unknown };
    if (typeof str !== 'string') continue;
    out += str;
    if (hasEOL === true) out += '\n';
  }
  return out;
}

/**
 * The text of one page, read as a stream of items and cut at `remaining` characters: reading stops, and the stream is
 * cancelled, as soon as the text read so far passes the budget, so a page that holds millions of items is not built in
 * full. `capped` is true when the page had more text than the budget allowed. A page with no `streamTextContent` is read
 * whole, and the caller cuts it.
 */
async function readPageText(
  page: PdfPageLike,
  remaining: number,
  signal: AbortSignal,
): Promise<{ text: string; capped: boolean }> {
  if (typeof page.streamTextContent !== 'function') {
    return { text: joinItems((await page.getTextContent()).items), capped: false };
  }
  const reader = page.streamTextContent().getReader();
  let text = '';
  let capped = false;
  let finished = false;
  try {
    for (;;) {
      if (signal.aborted) throw cancelled();
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        break;
      }
      text += joinItems(value.items);
      if (text.length > remaining) {
        text = head(text, remaining);
        capped = true;
        break;
      }
    }
  } finally {
    // Whatever stopped the read, the stream is told to stop producing. Not awaited: the answer comes from the worker,
    // and a worker that is busy must not hold up the page.
    if (!finished) void reader.cancel().catch(() => undefined);
  }
  return { text, capped };
}

function listPages(numbers: number[]): string {
  const shown = numbers.slice(0, 20).join(', ');
  return numbers.length > 20 ? `${shown} and ${numbers.length - 20} more` : shown;
}

/**
 * Reads the text of `pages` (1-based page numbers, in the order given) from `doc`. A page whose text cannot be read is
 * recorded as failed and the others are still read. Reading stops, with a note, after 500 pages of the list or when the
 * text reaches 2,000,000 characters (the page that crosses the limit is cut there, and the rest of that page is not read:
 * its text is streamed and the stream is cancelled at the limit). Rejects with `The run was cancelled.` when the signal
 * aborts, before the next page is requested or the next piece of the page is read.
 */
export async function extractPageTexts(
  doc: PdfDocLike,
  pages: number[],
  options: ExtractOptions,
): Promise<ExtractResult> {
  const notes: string[] = [];
  const wanted = pages.length > MAX_TEXT_PAGES ? pages.slice(0, MAX_TEXT_PAGES) : pages;
  if (pages.length > MAX_TEXT_PAGES) {
    notes.push(
      `Only the first ${MAX_TEXT_PAGES} pages of the list were read; this page reads at most ${MAX_TEXT_PAGES} pages in one run.`,
    );
  }
  const results: PageText[] = [];
  const failed: number[] = [];
  let characters = 0;
  const total = wanted.length;

  for (let i = 0; i < total; i++) {
    if (options.signal.aborted) throw cancelled();
    if (characters >= MAX_TEXT_CHARS) {
      notes.push(CHAR_LIMIT_NOTE);
      break;
    }
    const number = wanted[i]!;
    let text = '';
    let capped = false;
    let unreadable = false;
    try {
      const page = await doc.getPage(number);
      try {
        ({ text, capped } = await readPageText(page, MAX_TEXT_CHARS - characters, options.signal));
      } finally {
        try {
          page.cleanup();
        } catch {
          // Releasing a page's memory is a courtesy; a page that cannot do it has already given its text.
        }
      }
    } catch {
      if (options.signal.aborted) throw cancelled();
      unreadable = true;
    }
    if (options.signal.aborted) throw cancelled();

    let reachedLimit = capped;
    if (characters + text.length > MAX_TEXT_CHARS) {
      text = head(text, MAX_TEXT_CHARS - characters);
      reachedLimit = true;
    }
    characters += text.length;
    if (unreadable) {
      failed.push(number);
      results.push({ page: number, text: '', empty: true, failed: true });
    } else if (text.trim() === '') {
      results.push({ page: number, text: '', empty: true });
    } else {
      results.push({ page: number, text, empty: false });
    }
    options.onPage(i + 1, total);
    if (reachedLimit) {
      notes.push(CHAR_LIMIT_NOTE);
      break;
    }
  }
  if (failed.length > 0) {
    notes.push(
      failed.length === 1 ? `Page ${failed[0]} could not be read.` : `Pages ${listPages(failed)} could not be read.`,
    );
  }
  return { pages: results, notes };
}

/**
 * The pages as one text: a `--- Page N ---` heading, then the page's text with control and direction-changing
 * characters written as escapes, or a sentence when the page has no text or could not be read; blank line between pages.
 */
export function formatPageTexts(pages: PageText[]): string {
  return pages
    .map((p) => {
      const heading = `--- Page ${p.page} ---\n`;
      if (p.failed === true) return heading + `Page ${p.page} could not be read.`;
      if (p.empty) return heading + `No text was found on page ${p.page}.`;
      return heading + visible(p.text.trimEnd());
    })
    .join('\n\n');
}

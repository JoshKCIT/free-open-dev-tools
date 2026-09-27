import meta from './meta.json';

export { meta };
export * from './file-sniff';
export * from './page-range';
export * from './load';

import { PDFDocument } from '@cantoo/pdf-lib';
import { loadPdf, PdfLoadError } from './load';
import { parsePageList, PageRangeError } from './page-range';

/** At most this many PDFs may be merged in a single run. */
export const MAX_MERGE_INPUTS = 50;
/** The combined size of every input PDF in a single run. */
export const MAX_MERGE_TOTAL_BYTES = 500 * 1024 * 1024;

export interface MergeInput {
  /** The visitor's own file name, used only in messages and the parts report. */
  name: string;
  bytes: Uint8Array;
  /** A page list such as "1-3,5". Empty or omitted means every page, in order. */
  pages?: string;
}

export interface MergeOptions {
  /** 'as-picked' (default) keeps the input array's own order; 'by-name' reads inputs in file-name order first. */
  order?: 'as-picked' | 'by-name';
  /** Sets only the merged document's title; nothing else in its information dictionary is ever set. */
  title?: string;
}

export interface MergeHooks {
  onProgress?(fraction: number, detail: string): void;
  signal?: AbortSignal;
}

export interface MergePart {
  name: string;
  /** 1-based source page numbers taken from this input, in the order they were added. */
  pages: number[];
}

export interface MergeResult {
  bytes: Uint8Array;
  pageCount: number;
  parts: MergePart[];
  warnings: string[];
}

export class PdfMergeError extends Error {
  readonly reason: string;
  /** The input file this problem belongs to, when it belongs to one. */
  readonly fileName?: string;
  /** 1-based character offset into that input's own page-list text, when the problem is a page-list error. */
  readonly position?: number;
  constructor(message: string, reason: string, fileName?: string, position?: number) {
    super(message);
    this.name = 'PdfMergeError';
    this.reason = reason;
    this.fileName = fileName;
    this.position = position;
  }
}

function totalBytes(inputs: MergeInput[]): number {
  return inputs.reduce((sum, input) => sum + input.bytes.length, 0);
}

function checkAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new PdfMergeError('The run was cancelled before it finished.', 'cancelled');
  }
}

/**
 * Merges every input in order (or by file name when `options.order` is
 * `'by-name'`), taking each input's own page list (every page when absent),
 * and returns one combined PDF whose pages are the sources' own PDF
 * objects -- never rasterised. Document-level items (the catalog's own
 * `OpenAction`, the JavaScript name tree, outlines, the interactive form
 * dictionary) are never copied: a brand new document is built and only
 * `copyPages` ever reaches across from a source, which carries page
 * content, resources, annotations and page-level links unchanged, and
 * bakes each page's own inherited attributes (its effective `MediaBox` and
 * `Rotate`, ISO 32000-1 7.7.3.3) directly onto the copy before the source's
 * own page tree parent is dropped (`@cantoo/pdf-lib`'s own `copyPages`,
 * confirmed directly against the installed 2.11.1 source this session).
 */
export async function mergePdfs(
  inputs: MergeInput[],
  options: MergeOptions = {},
  hooks: MergeHooks = {},
): Promise<MergeResult> {
  if (inputs.length === 0) {
    throw new PdfMergeError('Pick at least one PDF to merge.', 'no-inputs');
  }
  if (inputs.length > MAX_MERGE_INPUTS) {
    throw new PdfMergeError(`This tool merges at most ${MAX_MERGE_INPUTS} PDFs in one run.`, 'too-many-files');
  }
  if (totalBytes(inputs) > MAX_MERGE_TOTAL_BYTES) {
    throw new PdfMergeError("The PDFs picked add up to more than this tool's total size limit.", 'too-large');
  }
  checkAborted(hooks.signal);

  const ordered = options.order === 'by-name' ? [...inputs].sort((a, b) => a.name.localeCompare(b.name)) : inputs;

  const merged = await PDFDocument.create({ updateMetadata: false });
  const parts: MergePart[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < ordered.length; i++) {
    const input = ordered[i]!;
    checkAborted(hooks.signal);

    let source: PDFDocument;
    try {
      source = await loadPdf(input.bytes, input.name);
    } catch (err) {
      if (err instanceof PdfLoadError) {
        throw new PdfMergeError(err.message, err.reason, input.name);
      }
      throw err;
    }

    const pageCount = source.getPageCount();
    let pageList: number[];
    try {
      pageList = parsePageList(input.pages ?? '', pageCount);
    } catch (err) {
      if (err instanceof PageRangeError) {
        throw new PdfMergeError(`In '${input.name}': ${err.message}`, err.reason, input.name, err.position);
      }
      throw err;
    }

    const copied = await merged.copyPages(
      source,
      pageList.map((p) => p - 1),
    );
    for (let j = 0; j < copied.length; j++) {
      merged.addPage(copied[j]!);
      if ((j + 1) % 20 === 0) {
        checkAborted(hooks.signal);
        hooks.onProgress?.(
          (i + (j + 1) / copied.length) / ordered.length,
          `${input.name}: page ${j + 1} of ${copied.length}`,
        );
      }
    }
    parts.push({ name: input.name, pages: pageList });

    hooks.onProgress?.((i + 1) / ordered.length, `Added ${input.name}`);
  }

  if (options.title) {
    merged.setTitle(options.title);
  }

  const bytes = await merged.save();
  return { bytes, pageCount: merged.getPageCount(), parts, warnings };
}

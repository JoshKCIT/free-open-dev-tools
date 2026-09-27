import meta from './meta.json';

export { meta };
export * from './file-sniff';
export * from './page-range';
export * from './load';

import { PDFDocument, degrees } from '@cantoo/pdf-lib';
import { loadPdf, PdfLoadError } from './load';
import { parsePageList, PageRangeError } from './page-range';

export const MAX_PDF_BYTES = 200 * 1024 * 1024;
export const MAX_OUTPUT_FILES = 1000;

export type OrganizeOperation =
  | { kind: 'split-each' }
  | { kind: 'split-ranges'; ranges: string }
  | { kind: 'extract'; pages: string }
  | { kind: 'delete'; pages: string }
  | { kind: 'reorder'; order: string }
  | { kind: 'rotate'; pages?: string; degrees: 90 | 180 | 270 };

export interface OrganizeHooks {
  onProgress?(fraction: number, detail: string): void | Promise<void>;
  signal?: AbortSignal;
}

export interface OrganizeOutputFile {
  name: string;
  bytes: Uint8Array;
  /** 1-based source page numbers this output file carries, in order. */
  pages: number[];
}

export interface OrganizeResult {
  files: OrganizeOutputFile[];
  warnings: string[];
  /** The source document's own page count, before this operation. */
  sourcePageCount: number;
}

export class PdfSplitError extends Error {
  readonly reason: string;
  readonly position?: number;
  constructor(message: string, reason: string, position?: number) {
    super(message);
    this.name = 'PdfSplitError';
    this.reason = reason;
    this.position = position;
  }
}

function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot <= 0 ? fileName : fileName.slice(0, dot);
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/** Every page 1..pageCount must appear in `list` exactly once, else names the first missing or repeated page. */
function validatePermutation(list: number[], pageCount: number): void {
  const seen = new Map<number, number>();
  for (const p of list) seen.set(p, (seen.get(p) ?? 0) + 1);
  for (let p = 1; p <= pageCount; p++) {
    if (!seen.has(p)) {
      throw new PdfSplitError(`Reordering must name every page exactly once; page ${p} is missing.`, 'missing-page');
    }
  }
  for (const [p, count] of seen) {
    if (count > 1) {
      throw new PdfSplitError(`Reordering must name every page exactly once; page ${p} is repeated.`, 'repeated-page');
    }
  }
}

async function buildDocument(source: PDFDocument, pageIndices: number[]): Promise<PDFDocument> {
  const out = await PDFDocument.create({ updateMetadata: false });
  const copied = await out.copyPages(source, pageIndices);
  for (const page of copied) out.addPage(page);
  return out;
}

function checkAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new PdfSplitError('The run was cancelled before it finished.', 'cancelled');
  }
}

/**
 * Splits, extracts, deletes, reorders or rotates a single PDF's pages.
 * Every output document is built fresh (`PDFDocument.create`) and only
 * ever reached through `copyPages`, so document-level items (the catalog's
 * own `OpenAction`, the JavaScript name tree, outlines, the interactive
 * form dictionary) are never carried into any output, and each page's own
 * effective `MediaBox`/`Rotate` (ISO 32000-1 7.7.3.3) travels with it even
 * when the source only inherited them from its page tree.
 */
export async function organizePdf(
  bytes: Uint8Array,
  fileName: string,
  operation: OrganizeOperation,
  hooks: OrganizeHooks = {},
): Promise<OrganizeResult> {
  checkAborted(hooks.signal);
  let source: PDFDocument;
  try {
    source = await loadPdf(bytes, fileName);
  } catch (err) {
    if (err instanceof PdfLoadError) throw new PdfSplitError(err.message, err.reason);
    throw err;
  }
  const pageCount = source.getPageCount();
  const base = baseName(fileName);
  const warnings: string[] = [];

  if (operation.kind === 'split-each') {
    if (pageCount > MAX_OUTPUT_FILES) {
      throw new PdfSplitError(`This tool writes at most ${MAX_OUTPUT_FILES} files in one run.`, 'too-many-files');
    }
    const width = String(pageCount).length;
    const files: OrganizeOutputFile[] = [];
    for (let i = 0; i < pageCount; i++) {
      checkAborted(hooks.signal);
      const doc = await buildDocument(source, [i]);
      files.push({ name: `${base}-page-${pad(i + 1, width)}.pdf`, bytes: await doc.save(), pages: [i + 1] });
      await hooks.onProgress?.((i + 1) / pageCount, `Page ${i + 1} of ${pageCount}`);
    }
    return { files, warnings, sourcePageCount: pageCount };
  }

  if (operation.kind === 'split-ranges') {
    const rangeTexts = operation.ranges
      .split(';')
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
    if (rangeTexts.length === 0) {
      throw new PdfSplitError('Name at least one range, such as 1-2;3.', 'no-ranges');
    }
    if (rangeTexts.length > MAX_OUTPUT_FILES) {
      throw new PdfSplitError(`This tool writes at most ${MAX_OUTPUT_FILES} files in one run.`, 'too-many-files');
    }
    const width = String(rangeTexts.length).length;
    const files: OrganizeOutputFile[] = [];
    for (let k = 0; k < rangeTexts.length; k++) {
      checkAborted(hooks.signal);
      let list: number[];
      try {
        list = parsePageList(rangeTexts[k]!, pageCount);
      } catch (err) {
        if (err instanceof PageRangeError) throw new PdfSplitError(err.message, err.reason, err.position);
        throw err;
      }
      const doc = await buildDocument(
        source,
        list.map((p) => p - 1),
      );
      files.push({ name: `${base}-part-${pad(k + 1, width)}.pdf`, bytes: await doc.save(), pages: list });
      await hooks.onProgress?.((k + 1) / rangeTexts.length, `Range ${k + 1} of ${rangeTexts.length}`);
    }
    return { files, warnings, sourcePageCount: pageCount };
  }

  if (operation.kind === 'extract') {
    let list: number[];
    try {
      list = parsePageList(operation.pages, pageCount);
    } catch (err) {
      if (err instanceof PageRangeError) throw new PdfSplitError(err.message, err.reason, err.position);
      throw err;
    }
    const doc = await buildDocument(
      source,
      list.map((p) => p - 1),
    );
    hooks.onProgress?.(1, 'Extracted');
    return {
      files: [{ name: `${base}-extracted.pdf`, bytes: await doc.save(), pages: list }],
      warnings,
      sourcePageCount: pageCount,
    };
  }

  if (operation.kind === 'delete') {
    let toDelete: number[];
    try {
      toDelete = parsePageList(operation.pages, pageCount);
    } catch (err) {
      if (err instanceof PageRangeError) throw new PdfSplitError(err.message, err.reason, err.position);
      throw err;
    }
    const deleteSet = new Set(toDelete);
    const kept: number[] = [];
    for (let p = 1; p <= pageCount; p++) if (!deleteSet.has(p)) kept.push(p);
    if (kept.length === 0) {
      throw new PdfSplitError(
        'Deleting every page is refused: a PDF must have at least one page.',
        'deletes-everything',
      );
    }
    const doc = await buildDocument(
      source,
      kept.map((p) => p - 1),
    );
    hooks.onProgress?.(1, 'Deleted');
    return {
      files: [{ name: `${base}-without-pages.pdf`, bytes: await doc.save(), pages: kept }],
      warnings,
      sourcePageCount: pageCount,
    };
  }

  if (operation.kind === 'reorder') {
    let list: number[];
    try {
      list = parsePageList(operation.order, pageCount);
    } catch (err) {
      if (err instanceof PageRangeError) throw new PdfSplitError(err.message, err.reason, err.position);
      throw err;
    }
    validatePermutation(list, pageCount);
    const doc = await buildDocument(
      source,
      list.map((p) => p - 1),
    );
    hooks.onProgress?.(1, 'Reordered');
    return {
      files: [{ name: `${base}-reordered.pdf`, bytes: await doc.save(), pages: list }],
      warnings,
      sourcePageCount: pageCount,
    };
  }

  // rotate
  const targetText = operation.pages ?? '';
  let targets: number[];
  try {
    targets = parsePageList(targetText, pageCount);
  } catch (err) {
    if (err instanceof PageRangeError) throw new PdfSplitError(err.message, err.reason, err.position);
    throw err;
  }
  const targetSet = new Set(targets);
  const doc = await buildDocument(
    source,
    Array.from({ length: pageCount }, (_, i) => i),
  );
  for (let i = 0; i < pageCount; i++) {
    if (!targetSet.has(i + 1)) continue;
    const page = doc.getPage(i);
    const current = page.getRotation().angle;
    const next = (((current + operation.degrees) % 360) + 360) % 360;
    page.setRotation(degrees(next));
  }
  hooks.onProgress?.(1, 'Rotated');
  return {
    files: [
      {
        name: `${base}-rotated.pdf`,
        bytes: await doc.save(),
        pages: Array.from({ length: pageCount }, (_, i) => i + 1),
      },
    ],
    warnings,
    sourcePageCount: pageCount,
  };
}

/** Scaffold: the tests for this module are written first; the implementation follows in the next commit. */
export interface PdfPageLike {
  getTextContent(): Promise<{ items: unknown[] }>;
  cleanup(): void;
}

export interface PdfDocLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
}

export interface PageText {
  page: number;
  text: string;
  empty: boolean;
}

export interface ExtractOptions {
  signal: AbortSignal;
  onPage(done: number, total: number): void;
}

export interface ExtractResult {
  pages: PageText[];
  notes: string[];
}

export function extractPageTexts(_doc: PdfDocLike, _pages: number[], _options: ExtractOptions): Promise<ExtractResult> {
  return Promise.reject(new Error('not implemented'));
}

export function formatPageTexts(_pages: PageText[]): string {
  throw new Error('not implemented');
}

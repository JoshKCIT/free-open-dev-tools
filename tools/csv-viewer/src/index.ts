import meta from './meta.json';

export { meta };

export class CsvViewerError extends Error {
  readonly line?: number;
  readonly column?: number;
  constructor(message: string, line?: number, column?: number) {
    super(message);
    this.name = 'CsvViewerError';
    if (line !== undefined) this.line = line;
    if (column !== undefined) this.column = column;
  }
}

export const MAX_DISPLAY_ROWS = 500;

export interface ViewCsvOptions {
  delimiter?: string;
  header?: boolean;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
  sortAs?: 'auto' | 'text' | 'number';
  filter?: string;
  filterColumn?: string;
}

export interface ViewCsvResult {
  delimiter: string;
  detected: boolean;
  headers: string[];
  rows: string[][];
  totalRows: number;
  matchedRows: number;
  warnings: string[];
}

// RED stub: intentionally throws so the new tests in index.test.ts fail on
// a real assertion rather than an import error, before the GREEN commit
// replaces this file with the working implementation.
export function detectDelimiter(_text: string): string {
  throw new Error('not implemented');
}

export function viewCsv(_text: string, _options: ViewCsvOptions = {}): ViewCsvResult {
  throw new Error('not implemented');
}

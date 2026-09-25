/**
 * RFC 4180 CSV reading and writing. RED-phase stub: not yet implemented.
 */

export class CsvSyntaxError extends Error {
  readonly line: number;
  readonly column: number;
  constructor(message: string, line: number, column: number) {
    super(message);
    this.name = 'CsvSyntaxError';
    this.line = line;
    this.column = column;
  }
}

export interface CsvParseOptions {
  delimiter?: string;
}

export interface CsvParseResult {
  rows: string[][];
}

export interface CsvFormatOptions {
  delimiter?: string;
  lineEnding?: string;
  quoteAll?: boolean;
}

export function parseCsv(_text: string, _options: CsvParseOptions = {}): CsvParseResult {
  throw new Error('not implemented');
}

export function formatCsv(_rows: string[][], _options: CsvFormatOptions = {}): string {
  throw new Error('not implemented');
}

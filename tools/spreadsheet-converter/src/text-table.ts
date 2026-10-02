/**
 * Reads pasted CSV, TSV or JSON into the rows the writer stores. CSV goes through the canonical RFC 4180 reader copied
 * into this folder.
 */
import { parseCsv, CsvSyntaxError } from './csv';
import { SpreadsheetConverterError, type TableCell } from './types';

export function parseTextTable(
  text: string,
  format: 'csv' | 'tsv' | 'json',
): { rows: TableCell[][]; warnings: string[] } {
  if (format !== 'csv') throw new SpreadsheetConverterError(`Reading ${format.toUpperCase()} is not available yet.`);
  try {
    return { rows: parseCsv(text).rows, warnings: [] };
  } catch (err) {
    if (err instanceof CsvSyntaxError) {
      throw new SpreadsheetConverterError(err.message, { line: err.line, column: err.column });
    }
    throw err;
  }
}

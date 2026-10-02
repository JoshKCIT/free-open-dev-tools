/**
 * Writes one sheet as text: CSV (RFC 4180), TSV, JSON or a fixed XML layout.
 */
import { formatCsv } from './csv';
import { SpreadsheetConverterError, type Sheet, type TextFormat, type TextOptions } from './types';

/** The widest row of a sheet: every row is padded to this many cells on output. */
export function sheetWidth(sheet: Sheet): number {
  let width = 0;
  for (const row of sheet.rows) width = Math.max(width, row.length);
  return width;
}

/** The sheet as a rectangle of text. */
export function sheetGrid(sheet: Sheet): string[][] {
  const width = sheetWidth(sheet);
  return sheet.rows.map((row) => {
    const out: string[] = new Array<string>(width);
    for (let c = 0; c < width; c++) out[c] = row[c]?.text ?? '';
    return out;
  });
}

export function sheetToText(
  sheet: Sheet,
  format: TextFormat,
  options: TextOptions,
): { text: string; warnings: string[] } {
  void options;
  if (format !== 'csv') throw new SpreadsheetConverterError(`Writing ${format.toUpperCase()} is not available yet.`);
  return { text: formatCsv(sheetGrid(sheet)), warnings: [] };
}

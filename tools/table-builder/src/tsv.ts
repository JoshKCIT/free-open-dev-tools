import { TableBuilderError } from './errors';

/**
 * Writes rows of cells as TSV, the text/tab-separated-values format registered with IANA: one record per line,
 * fields separated by a tab. The registration has no quoting and no escape, and says fields that contain tabs are
 * not allowed, so a cell holding a tab or a line break cannot be written faithfully and is refused naming its row
 * and column (both counted from 1). Records are joined with a line feed and no trailing line break is added. A
 * cell's own spaces are kept exactly.
 */
export function formatTsv(rows: string[][]): string {
  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell.includes('\t')) {
        throw new TableBuilderError(
          `Row ${r + 1}, column ${c + 1} holds a tab, and TSV has no way to quote one. Remove the tab or choose another format.`,
        );
      }
      if (cell.includes('\n') || cell.includes('\r')) {
        throw new TableBuilderError(
          `Row ${r + 1}, column ${c + 1} holds a line break, and TSV has no way to quote one. Remove the line break or choose another format.`,
        );
      }
    });
  });
  return rows.map((row) => row.join('\t')).join('\n');
}

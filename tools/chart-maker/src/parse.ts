/** The most text a paste may hold, counted in UTF-8 bytes. */
export const MAX_PASTE_BYTES = 65_536;
/** The most data rows (points per series) a chart may have. */
export const MAX_POINTS = 200;
/** The most number columns (series) a chart may have. */
export const MAX_SERIES = 8;
/** The most slices a pie chart may have. */
export const MAX_SLICES = 24;

export interface ParsedSeries {
  name: string;
  values: number[];
}

export interface ParsedTable {
  /** The name of the label column, then the name of each series. */
  headers: string[];
  /** The label of each data row, as written. */
  labels: string[];
  series: ParsedSeries[];
  /** Things worth telling the reader that are not failures (a left-out column, a cut title). */
  notes: string[];
}

export function readRows(_text: string): { delimiter: string; rows: string[][] } {
  throw new Error('not implemented');
}

export function parseTable(_text: string, _options: { header: boolean }): ParsedTable {
  throw new Error('not implemented');
}

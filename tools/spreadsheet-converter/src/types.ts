/**
 * The shared shapes of the spreadsheet converter: its limits, its one error class and the cell, sheet and workbook
 * records the reader produces and the output writers consume.
 */

/** A file over this many bytes (20 MiB) is refused before it is unzipped. */
export const MAX_FILE_BYTES = 20971520;
/** The unzipped XML and relationship parts of a package may declare no more than this many bytes (100 MiB) together. */
export const MAX_UNZIPPED_BYTES = 104857600;
/** Excel's own row limit. */
export const MAX_ROWS = 1048576;
/** Excel's own column limit (XFD). */
export const MAX_COLUMNS = 16384;
/**
 * A sheet is read as a rectangle, so rows times columns is bounded, or one cell at XFD1048576 would ask for 17 billion
 * entries. Ten million covers every real sheet whose XML fits in 100 MiB.
 */
export const MAX_CELLS = 10000000;
/** Excel keeps at most this many characters of one cell's text. */
export const MAX_CELL_CHARACTERS = 32767;

/**
 * Raised, with a plain message, for every expected failure: a file that is too big or is not a workbook, a sheet that
 * does not exist, text that cannot be written as it is, a cell a format cannot carry. `cell` names the cell (A1 style),
 * `part` the part of the package, `line` and `column` a position in pasted text.
 */
export class SpreadsheetConverterError extends Error {
  readonly cell?: string;
  readonly part?: string;
  readonly line?: number;
  readonly column?: number;
  constructor(message: string, detail: { cell?: string; part?: string; line?: number; column?: number } = {}) {
    super(message);
    this.name = 'SpreadsheetConverterError';
    if (detail.cell !== undefined) this.cell = detail.cell;
    if (detail.part !== undefined) this.part = detail.part;
    if (detail.line !== undefined) this.line = detail.line;
    if (detail.column !== undefined) this.column = detail.column;
  }
}

export type CellKind = 'number' | 'string' | 'boolean' | 'error' | 'date' | 'empty';

/** One cell as the file stores it: `text` is the stored text (a date is its ISO form unless serials were asked for). */
export interface Cell {
  kind: CellKind;
  text: string;
  ref: string;
}

export type SheetState = 'visible' | 'hidden' | 'veryHidden';

/** A sheet's rows. A row holds cells up to its last non-empty one, with a shared empty cell in any gap. */
export interface Sheet {
  name: string;
  state: SheetState;
  rows: Cell[][];
}

export interface Workbook {
  sheets: Sheet[];
  date1904: boolean;
  warnings: string[];
}

export interface ReadOptions {
  /** Show date cells as their stored serial numbers instead of as dates. */
  datesAsSerials: boolean;
  /** Read only the cells of the sheet this selects (see `pickSheet`); every other sheet is listed with no rows. */
  sheet?: string;
}

export type TextFormat = 'csv' | 'tsv' | 'json' | 'xml';

export interface TextOptions {
  /** JSON only: the first row names the columns, so each later row becomes an object. */
  header: boolean;
  /** JSON only: numbers, booleans and empty cells keep their type instead of becoming text. */
  keepTypes: boolean;
}

/** A value to write: text (typed by detection when that is on), or a value whose type is already known. */
export interface TypedValue {
  kind: 'text' | 'number' | 'boolean';
  text: string;
}
export type TableCell = string | TypedValue | null;

export interface WriteOptions {
  sheetName: string;
  detectTypes: boolean;
}

export interface WrittenCell {
  ref: string;
  value: string;
  type: 'inlineStr' | 'n' | 'b';
}

export interface WriteResult {
  bytes: Uint8Array;
  /** The first cells written, each with its ECMA-376 cell type. */
  preview: WrittenCell[];
  cellCount: number;
  rowCount: number;
  columnCount: number;
  warnings: string[];
}

/** How many written cells `writeXlsx` lists in its preview. */
export const PREVIEW_CELLS = 500;

/** Spreadsheet to text: read the picked file, choose a sheet, write it in a text format. */
export interface ToTextJob {
  direction: 'xlsx-to-text';
  bytes: Uint8Array;
  sheet: string;
  output: TextFormat;
  header: boolean;
  keepTypes: boolean;
  datesAsSerials: boolean;
}

/** Text to spreadsheet: read pasted CSV, TSV or JSON and write a one-sheet package. */
export interface ToXlsxJob {
  direction: 'text-to-xlsx';
  text: string;
  inputFormat: 'csv' | 'tsv' | 'json';
  detectTypes: boolean;
  sheetName: string;
}

export type ConvertJob = ToTextJob | ToXlsxJob;

export interface SheetInfo {
  name: string;
  state: SheetState;
}

export interface ToTextResult {
  direction: 'xlsx-to-text';
  text: string;
  /** Every sheet of the workbook, in order, with its state. */
  sheets: SheetInfo[];
  /** Position (0-based) in `sheets` of the sheet that was converted. */
  chosen: number;
  rows: number;
  columns: number;
  /** The first rows of the sheet (at most `PREVIEW_ROWS`), each padded to `previewColumns` cells. */
  previewRows: string[][];
  previewColumns: number;
  warnings: string[];
}

export type ToXlsxResult = WriteResult & { direction: 'text-to-xlsx' };

export type ConvertResult = ToTextResult | ToXlsxResult;

/** How many rows, and how many columns, of a sheet the text direction returns for a preview table. */
export const PREVIEW_ROWS = 500;
export const PREVIEW_COLUMNS = 40;

import { ChartError } from './errors';

/** The most text a paste may hold, counted in UTF-8 bytes. */
export const MAX_PASTE_BYTES = 65_536;
/** The most data rows (points per series) a chart may have. */
export const MAX_POINTS = 200;
/** The most number columns (series) a chart may have. */
export const MAX_SERIES = 8;
/** The most slices a pie chart may have. */
export const MAX_SLICES = 24;
/** The largest size a number may have: beyond it the value axis would overflow while it is being laid out. */
export const MAX_MAGNITUDE = 1e100;

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

/** A whole number with a comma between each group of three digits, built without a pattern over the text. */
function grouped(n: number): string {
  const digits = String(n);
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}

/** The size of a text in UTF-8 bytes, counted in one pass without building the bytes. */
function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/** Refuses a paste over the limit before anything reads it. The size is in bytes, so accented text counts fully. */
export function checkPasteSize(text: string): void {
  const bytes = utf8Length(text);
  if (bytes > MAX_PASTE_BYTES) {
    throw new ChartError(
      `This paste is ${grouped(bytes)} bytes. The limit is ${grouped(MAX_PASTE_BYTES)} bytes because a chart of that much text is too crowded to read.`,
    );
  }
}

/** The start of the first line that has anything on it, past blank lines and lines of only spaces and tabs. */
function firstRealLine(text: string, from: number): number {
  let lineStart = from;
  for (let i = from; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit === 10 || unit === 13) lineStart = i + 1;
    else if (unit !== 32 && unit !== 9) return lineStart;
  }
  return text.length;
}

/**
 * True when the first line that has anything on it holds a tab outside a pair of quotes, so the rows are tab separated.
 * Blank lines and lines of only spaces and tabs before it are skipped.
 */
function firstLineHasTab(text: string, from: number): boolean {
  let quoted = false;
  from = firstRealLine(text, from);
  for (let i = from; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit === 34) quoted = !quoted;
    else if (!quoted && (unit === 10 || unit === 13)) return false;
    else if (!quoted && unit === 9) return true;
  }
  return false;
}

/**
 * Splits pasted text into rows of cells in one pass, as RFC 4180 describes: a value in double quotes may hold the
 * separator, line breaks and a doubled quote; a quote inside an unquoted value is kept as it is; rows end at a line feed,
 * a carriage return or both. The separator is a tab when the first line with anything on it holds one outside quotes, otherwise a comma.
 * Every cell is kept, so a row that ends in a separator ends in an empty cell. A line with nothing on it is skipped, and
 * a leading byte order mark is dropped. A value in quotes that is never closed, or that has text after its closing quote,
 * is refused with its row and column.
 */
export function readRows(text: string): { delimiter: string; rows: string[][] } {
  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const delimiter = firstLineHasTab(text, start) ? '\t' : ',';
  const delimiterCode = delimiter.charCodeAt(0);
  const length = text.length;
  const rows: string[][] = [];
  let i = start;
  while (i < length) {
    const row: string[] = [];
    for (;;) {
      let field: string;
      if (text.charCodeAt(i) === 34) {
        let value = '';
        i++;
        for (;;) {
          const close = text.indexOf('"', i);
          if (close < 0) throw new ChartError(`Row ${rows.length + 1}: a quote that opens a value is never closed.`);
          value += text.slice(i, close);
          if (text.charCodeAt(close + 1) === 34) {
            value += '"';
            i = close + 2;
          } else {
            i = close + 1;
            break;
          }
        }
        field = value;
        const after = i < length ? text.charCodeAt(i) : -1;
        if (after !== -1 && after !== delimiterCode && after !== 10 && after !== 13) {
          throw new ChartError(
            `Row ${rows.length + 1}, column ${row.length + 1}: a value in quotes must end at its closing quote.`,
          );
        }
      } else {
        const from = i;
        while (i < length) {
          const unit = text.charCodeAt(i);
          if (unit === delimiterCode || unit === 10 || unit === 13) break;
          i++;
        }
        field = text.slice(from, i);
      }
      row.push(field);
      if (i >= length) break;
      const unit = text.charCodeAt(i);
      if (unit === delimiterCode) {
        i++;
        continue;
      }
      i += unit === 13 && text.charCodeAt(i + 1) === 10 ? 2 : 1;
      break;
    }
    // A line with nothing on it is not a row.
    if (row.length === 1 && row[0] === '') continue;
    rows.push(row);
  }
  return { delimiter, rows };
}

function isDigit(unit: number): boolean {
  return unit >= 48 && unit <= 57;
}

/**
 * True for an optional sign, digits, an optional point followed by digits and an optional exponent, and nothing else:
 * no thousands separator, no decimal comma, no leading or trailing point, no letters. One pass, no pattern.
 */
function isNumberText(text: string): boolean {
  const length = text.length;
  let i = 0;
  if (text[i] === '+' || text[i] === '-') i++;
  const whole = i;
  while (i < length && isDigit(text.charCodeAt(i))) i++;
  if (i === whole) return false;
  if (text[i] === '.') {
    i++;
    const fraction = i;
    while (i < length && isDigit(text.charCodeAt(i))) i++;
    if (i === fraction) return false;
  }
  if (text[i] === 'e' || text[i] === 'E') {
    i++;
    if (text[i] === '+' || text[i] === '-') i++;
    const exponent = i;
    while (i < length && isDigit(text.charCodeAt(i))) i++;
    if (i === exponent) return false;
  }
  return i === length;
}

/** The text without spaces and tabs at either end. */
function trimBlanks(text: string): string {
  let from = 0;
  let to = text.length;
  while (from < to && (text.charCodeAt(from) === 32 || text.charCodeAt(from) === 9)) from++;
  while (to > from && (text.charCodeAt(to - 1) === 32 || text.charCodeAt(to - 1) === 9)) to--;
  return text.slice(from, to);
}

/** The number a cell holds, or a refusal that names the row and the column and never repeats the cell. */
function readNumber(cell: string, row: number, column: number): number {
  const where = `Row ${row}, column ${column}`;
  const text = trimBlanks(cell);
  if (text === '')
    throw new ChartError(`${where}: this value is empty. Every value in a number column needs a number.`);
  if (!isNumberText(text)) {
    throw new ChartError(`${where}: this is not a number. Use digits with a point for decimals, such as 12 or 3.5.`);
  }
  const value = Number(text);
  if (!Number.isFinite(value) || Math.abs(value) > MAX_MAGNITUDE) {
    throw new ChartError(`${where}: this number is too large to draw. Use a size of 1e100 or less.`);
  }
  // A negative zero would print as -0 in places; there is only one zero here.
  return value + 0;
}

/**
 * Reads pasted rows into labels and number columns. The first column holds the labels; every other column that has
 * anything in it is a series of numbers, read strictly (see `isNumberText`). With `header` the first row names the label
 * column and the series. A column that is empty in every row, header included, is left out with a note. A paste of no
 * rows, of a header row alone, or with no number column has no data yet and gives a table with no labels or no series.
 * Refuses a paste over the byte limit before reading it, more than 200 data rows, more than 8 series, and anything in a
 * number column that is not a finite number of 1e100 or less, naming its row and column (rows count the header as row 1).
 */
export function parseTable(text: string, options: { header: boolean }): ParsedTable {
  checkPasteSize(text);
  const { rows } = readRows(text);
  const nothing: ParsedTable = { headers: [], labels: [], series: [], notes: [] };
  if (rows.length === 0) return nothing;

  const headerRow = options.header ? rows[0]! : null;
  const dataRows = options.header ? rows.slice(1) : rows;
  const firstDataRow = options.header ? 2 : 1;
  if (dataRows.length > MAX_POINTS) {
    throw new ChartError(
      `There are ${dataRows.length} rows of data, but a chart can show at most ${MAX_POINTS} points per series.`,
    );
  }

  let width = 0;
  for (const row of rows) if (row.length > width) width = row.length;
  // The label column always stays; another column stays when its header or any of its cells holds something.
  const kept: number[] = [0];
  let leftOut = 0;
  let firstLeftOut = 0;
  for (let column = 1; column < width; column++) {
    let used = headerRow !== null && (headerRow[column] ?? '') !== '';
    for (let r = 0; r < dataRows.length && !used; r++) used = (dataRows[r]![column] ?? '') !== '';
    if (used) kept.push(column);
    else {
      if (leftOut === 0) firstLeftOut = column + 1;
      leftOut++;
    }
  }
  const notes: string[] = [];
  if (leftOut === 1) notes.push(`Column ${firstLeftOut} is empty and was left out.`);
  else if (leftOut > 1) notes.push(`${leftOut} empty columns were left out.`);

  const seriesCount = kept.length - 1;
  if (seriesCount > MAX_SERIES) {
    throw new ChartError(`There are ${seriesCount} number columns, but a chart can show at most ${MAX_SERIES} series.`);
  }
  if (dataRows.length === 0 || seriesCount === 0) return { ...nothing, notes };

  const columns: number[][] = kept.slice(1).map(() => []);
  for (let r = 0; r < dataRows.length; r++) {
    const row = dataRows[r]!;
    for (let s = 0; s < seriesCount; s++) {
      const column = kept[s + 1]!;
      columns[s]!.push(readNumber(row[column] ?? '', firstDataRow + r, column + 1));
    }
  }

  const named = (cell: string | undefined, fallback: string): string =>
    cell !== undefined && cell !== '' ? cell : fallback;
  const labelHeader = named(headerRow?.[0], 'Label');
  const seriesNames = kept
    .slice(1)
    .map((column, s) => named(headerRow?.[column], seriesCount === 1 ? 'Value' : `Series ${s + 1}`));
  return {
    headers: [labelHeader, ...seriesNames],
    labels: dataRows.map((row) => row[0] ?? ''),
    series: seriesNames.map((name, s) => ({ name, values: columns[s]! })),
    notes,
  };
}

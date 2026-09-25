import meta from './meta.json';
import { parseCsv, CsvSyntaxError } from './csv';

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

/** The largest number of rows ever returned from `viewCsv`, whatever the match count. */
export const MAX_DISPLAY_ROWS = 500;

/** Fixed candidate order this tool always tries, comma first. */
const DELIMITER_CANDIDATES = [',', ';', '\t', '|'] as const;

/** Bytes (as UTF-16 code units, this project's convention for an in-memory string) sniffed for delimiter detection. */
const SNIFF_SIZE = 64 * 1024;

/** Cuts `text` to at most `SNIFF_SIZE` code units, then back to the previous record boundary, so a candidate is never scored on a record truncated mid-field. */
function sniffSample(text: string): string {
  if (text.length <= SNIFF_SIZE) return text;
  const cut = text.slice(0, SNIFF_SIZE);
  const lastBreak = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('\r'));
  return lastBreak > 0 ? cut.slice(0, lastBreak) : cut;
}

/**
 * Tries comma, semicolon, tab and pipe in that fixed order on up to the
 * first 64 KB of `text` (cut at a record boundary). Each candidate is
 * scored by the share of records whose field count equals that
 * candidate's own most common field count, and only a candidate whose
 * most common field count is at least 2 is scored at all -- a delimiter
 * that never actually splits a line into more than one field cannot be
 * the real one. The highest score wins; a tie keeps the earlier candidate
 * in the fixed order above. When no candidate qualifies (for example a
 * genuinely one-column file), the answer is comma. Quote-aware, since
 * scoring parses through `parseCsv`.
 */
export function detectDelimiter(text: string): string {
  const sample = sniffSample(text);
  let best: { delimiter: string; score: number } | null = null;

  for (const delimiter of DELIMITER_CANDIDATES) {
    let rows: string[][];
    try {
      rows = parseCsv(sample, { delimiter }).rows;
    } catch {
      continue; // a syntax error under this delimiter disqualifies the candidate
    }
    if (rows.length === 0) continue;

    const counts = new Map<number, number>();
    for (const row of rows) counts.set(row.length, (counts.get(row.length) ?? 0) + 1);
    let mostCommonCount = 0;
    let mostCommonFreq = 0;
    for (const [count, freq] of counts) {
      if (freq > mostCommonFreq) {
        mostCommonFreq = freq;
        mostCommonCount = count;
      }
    }
    if (mostCommonCount < 2) continue;

    const score = mostCommonFreq / rows.length;
    if (best === null || score > best.score) best = { delimiter, score };
  }

  return best ? best.delimiter : ',';
}

export interface ViewCsvOptions {
  /** 'auto' detects the delimiter with `detectDelimiter`; any other value is used literally. Default 'auto'. */
  delimiter?: string;
  /** Whether the first row names the columns. Default true. */
  header?: boolean;
  /** A column name (matched exactly, then ignoring case) or a 1-based column number. Empty string means unsorted. */
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
  /** 'auto' sorts numerically only when every non-empty cell in the column is an RFC 8259 number. Default 'auto'. */
  sortAs?: 'auto' | 'text' | 'number';
  /** A literal substring, matched case-insensitively. Empty string means no filter. */
  filter?: string;
  /** A column name or 1-based number to filter within; empty string means every column. */
  filterColumn?: string;
}

export interface ViewCsvResult {
  /** The delimiter actually used. */
  delimiter: string;
  /** True when `options.delimiter` was 'auto' (or omitted). */
  detected: boolean;
  headers: string[];
  /** At most `MAX_DISPLAY_ROWS` rows, after filtering and sorting. */
  rows: string[][];
  /** Data rows in the document, before filtering. */
  totalRows: number;
  /** Data rows that matched the filter (or all of them, with no filter). */
  matchedRows: number;
  warnings: string[];
}

/** RFC 8259's own JSON number grammar: optional minus, an int part with no leading zero, an optional fraction, an optional exponent. */
const RFC8259_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

function isRfc8259Number(cell: string): boolean {
  return RFC8259_NUMBER.test(cell);
}

/** Matches a header name exactly, then ignoring case, then as a 1-based column number. Returns a 0-based index, or null when nothing matches. */
function resolveColumn(spec: string, headers: string[]): number | null {
  if (spec === '') return null;
  const exact = headers.indexOf(spec);
  if (exact >= 0) return exact;
  const lower = spec.toLowerCase();
  const caseInsensitive = headers.findIndex((h) => h.toLowerCase() === lower);
  if (caseInsensitive >= 0) return caseInsensitive;
  const asNumber = Number(spec);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= headers.length) return asNumber - 1;
  return null;
}

/**
 * Detects (or accepts) a delimiter, splits the header from the data rows,
 * pads a short row and names a long row's extra cells under generated
 * headers, then filters and sorts, returning at most `MAX_DISPLAY_ROWS`
 * rows alongside the full row and match counts. Never throws on a
 * malformed sort or filter column -- an unknown one adds a warning and is
 * ignored, so a stray value in either field never turns into an error
 * page.
 */
export function viewCsv(text: string, options: ViewCsvOptions = {}): ViewCsvResult {
  const warnings: string[] = [];
  const requestedDelimiter = options.delimiter ?? 'auto';
  const detected = requestedDelimiter === 'auto';
  const delimiter = detected ? detectDelimiter(text) : requestedDelimiter;
  const header = options.header ?? true;
  const sortColumnSpec = options.sortColumn ?? '';
  const sortDirection = options.sortDirection ?? 'asc';
  const sortAs = options.sortAs ?? 'auto';
  const filterText = options.filter ?? '';
  const filterColumnSpec = options.filterColumn ?? '';

  let allRows: string[][];
  try {
    allRows = parseCsv(text, { delimiter }).rows;
  } catch (err) {
    if (err instanceof CsvSyntaxError) throw new CsvViewerError(err.message, err.line, err.column);
    throw err;
  }

  let headers: string[];
  let dataRows: string[][];
  if (header) {
    const headerRow = allRows[0] ?? [];
    headers = headerRow.length > 0 ? headerRow.slice() : ['column 1'];
    dataRows = allRows.slice(1);
  } else {
    const columnCount = allRows.reduce((max, row) => Math.max(max, row.length), 0) || 1;
    headers = Array.from({ length: columnCount }, (_, i) => `column ${i + 1}`);
    dataRows = allRows;
  }

  // Pad a short row with empty cells; a long row keeps its extra cells,
  // named by extending `headers` below with generated column headers.
  let paddedCount = 0;
  let extendedCount = 0;
  const normalizedRows = dataRows.map((row) => {
    if (row.length < headers.length) {
      paddedCount++;
      const padded = row.slice();
      while (padded.length < headers.length) padded.push('');
      return padded;
    }
    if (row.length > headers.length) extendedCount++;
    return row;
  });

  const widestRow = normalizedRows.reduce((max, row) => Math.max(max, row.length), headers.length);
  for (let i = headers.length; i < widestRow; i++) headers.push(`column ${i + 1}`);

  if (paddedCount > 0) {
    warnings.push(
      `${paddedCount} row${paddedCount === 1 ? '' : 's'} had fewer fields than the header and were padded with empty cells.`,
    );
  }
  if (extendedCount > 0) {
    warnings.push(
      `${extendedCount} row${extendedCount === 1 ? '' : 's'} had more fields than the header; the extra cells are under generated headers.`,
    );
  }

  let sortColumnIndex: number | null = null;
  if (sortColumnSpec !== '') {
    sortColumnIndex = resolveColumn(sortColumnSpec, headers);
    if (sortColumnIndex === null) warnings.push(`Unknown sort column "${sortColumnSpec}" was ignored.`);
  }

  let filterColumnIndex: number | null = null;
  if (filterColumnSpec !== '') {
    filterColumnIndex = resolveColumn(filterColumnSpec, headers);
    if (filterColumnIndex === null) warnings.push(`Unknown filter column "${filterColumnSpec}" was ignored.`);
  }

  let filteredRows = normalizedRows;
  if (filterText !== '') {
    const needle = filterText.toLowerCase();
    filteredRows = normalizedRows.filter((row) => {
      if (filterColumnIndex !== null) return (row[filterColumnIndex] ?? '').toLowerCase().includes(needle);
      return row.some((cell) => cell.toLowerCase().includes(needle));
    });
  }

  const matchedRows = filteredRows.length;

  let sortedRows = filteredRows;
  if (sortColumnIndex !== null) {
    const idx = sortColumnIndex;
    const useNumeric =
      sortAs === 'number' ||
      (sortAs === 'auto' && filteredRows.every((row) => (row[idx] ?? '') === '' || isRfc8259Number(row[idx] ?? '')));

    const indexed = filteredRows.map((row, i) => ({ row, i }));
    indexed.sort((a, b) => {
      const av = a.row[idx] ?? '';
      const bv = b.row[idx] ?? '';
      // Empty cells sort last in both directions, checked before the
      // direction flip below so this rule is never inverted by `desc`.
      if (av === '' && bv === '') return a.i - b.i;
      if (av === '') return 1;
      if (bv === '') return -1;

      let cmp: number;
      if (useNumeric) {
        const an = Number(av);
        const bn = Number(bv);
        if (Number.isNaN(an) && Number.isNaN(bn)) cmp = 0;
        else if (Number.isNaN(an)) cmp = 1;
        else if (Number.isNaN(bn)) cmp = -1;
        else cmp = an - bn;
      } else {
        cmp = av < bv ? -1 : av > bv ? 1 : 0;
      }
      if (cmp === 0) return a.i - b.i; // stable: equal keys keep original order
      return sortDirection === 'desc' ? -cmp : cmp;
    });
    sortedRows = indexed.map((entry) => entry.row);
  }

  return {
    delimiter,
    detected,
    headers,
    rows: sortedRows.slice(0, MAX_DISPLAY_ROWS),
    totalRows: normalizedRows.length,
    matchedRows,
    warnings,
  };
}

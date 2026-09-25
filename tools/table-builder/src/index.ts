import meta from './meta.json';
import { formatCsv } from './csv';
import { setOwn } from './own-property';

export { meta };

export type TableFormat = 'markdown' | 'html' | 'csv' | 'json';
export type ColumnAlignment = 'left' | 'center' | 'right' | 'none';

export interface BuildTableOptions {
  /** Output format. Default 'markdown'. */
  format?: TableFormat;
  /** Treat the first row as a header. Default true. */
  headerRow?: boolean;
  /** Comma list of left, center, right or none (or l, c, r, -), one per column. */
  alignments?: string;
  /** Pad cell text to its column's width. Markdown only. Default true. */
  pad?: boolean;
  /** Field separator for CSV output. Default a comma. */
  csvDelimiter?: string;
  /** Indent HTML, or pretty-print JSON. Default true. */
  pretty?: boolean;
}

export interface BuildTableResult {
  output: string;
  /** Rows in the grid after short rows are padded and empty trailing rows and columns are dropped. */
  rows: number;
  /** Columns in the grid after the same trimming. */
  columns: number;
  warnings: string[];
}

export class TableBuilderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TableBuilderError';
  }
}

/** Pads every row to the width of the widest row with empty cells. */
function rectangularise(rows: string[][]): string[][] {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return rows.map((row) => {
    const padded = row.slice(0, width);
    while (padded.length < width) padded.push('');
    return padded;
  });
}

/** Drops rows and columns from the end of the grid that hold only empty cells. */
function dropEmptyTrailing(rows: string[][]): string[][] {
  let grid = rows.map((row) => row.slice());
  while (grid.length > 0 && grid[grid.length - 1]!.every((cell) => cell === '')) grid.pop();
  let width = grid.reduce((max, row) => Math.max(max, row.length), 0);
  while (width > 0 && grid.every((row) => (row[width - 1] ?? '') === '')) width--;
  grid = grid.map((row) => row.slice(0, width));
  return grid;
}

const ALIGNMENT_WORDS: Record<string, ColumnAlignment> = {
  left: 'left',
  l: 'left',
  center: 'center',
  c: 'center',
  right: 'right',
  r: 'right',
  none: 'none',
  '-': 'none',
};

function parseAlignments(input: string, columns: number): { alignments: ColumnAlignment[]; warnings: string[] } {
  const warnings: string[] = [];
  const tokens = input
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  const alignments: ColumnAlignment[] = [];
  for (let c = 0; c < columns; c++) {
    const token = tokens[c];
    if (token === undefined) {
      alignments.push('none');
      continue;
    }
    const resolved = ALIGNMENT_WORDS[token.toLowerCase()];
    if (resolved === undefined) {
      warnings.push(`Alignment "${token}" is not left, center, right or none, so column ${c + 1} was left unaligned.`);
      alignments.push('none');
    } else {
      alignments.push(resolved);
    }
  }
  return { alignments, warnings };
}

/** Splits on any line break so every line of a multi-line cell can be escaped and rejoined with <br>. */
function cellLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

/**
 * CommonMark and GFM allow a backslash before any ASCII punctuation
 * character to force it literal, regardless of whether that character would
 * otherwise start emphasis, a strikethrough, a code span, a link, an
 * autolink or raw inline HTML. Escaping every one of them -- not only the
 * pipe -- is what keeps a cell's Markdown form textually equivalent to the
 * same cell's HTML form no matter what the cell holds: a lone pipe alone
 * would still let a cell like "**bold**" or "<script>" be read back as
 * something other than its own text. The backslash itself is in this same
 * set, so it is escaped by the same pass -- a backslash that already
 * precedes a pipe in the original cell text survives rather than being
 * eaten by the pipe's own escape.
 */
const ASCII_PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~\\]/g;

function escapeMarkdownCellLine(line: string): string {
  return line.replace(ASCII_PUNCTUATION, (ch) => '\\' + ch);
}

function escapeMarkdownCell(text: string): string {
  return cellLines(text).map(escapeMarkdownCellLine).join('<br>');
}

/** Matches the escaping a GFM-conformant Markdown renderer applies to table cell text, including the double quote, so this tool's own HTML export stays textually identical to the same cell rendered from Markdown. */
function escapeHtmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function htmlCell(text: string): string {
  return cellLines(text).map(escapeHtmlText).join('<br>');
}

function buildMarkdown(grid: string[][], headerRow: boolean, alignments: ColumnAlignment[], pad: boolean): string {
  const columns = grid[0]!.length;
  const headerCells = headerRow ? grid[0]! : new Array<string>(columns).fill('');
  const bodyRows = headerRow ? grid.slice(1) : grid;

  const escapedHeader = headerCells.map(escapeMarkdownCell);
  const escapedBody = bodyRows.map((row) => row.map(escapeMarkdownCell));

  const widths = new Array<number>(columns).fill(3);
  if (pad) {
    for (let c = 0; c < columns; c++) widths[c] = Math.max(widths[c]!, escapedHeader[c]!.length);
    for (const row of escapedBody) {
      for (let c = 0; c < columns; c++) widths[c] = Math.max(widths[c]!, (row[c] ?? '').length);
    }
  }

  const padCell = (text: string, c: number): string => (pad ? text.padEnd(widths[c]!) : text);

  const delimiterCell = (align: ColumnAlignment, c: number): string => {
    const width = pad ? widths[c]! : 3;
    switch (align) {
      case 'left':
        return ':' + '-'.repeat(Math.max(width - 1, 2));
      case 'right':
        return '-'.repeat(Math.max(width - 1, 2)) + ':';
      case 'center':
        return ':' + '-'.repeat(Math.max(width - 2, 1)) + ':';
      default:
        return '-'.repeat(Math.max(width, 3));
    }
  };

  const line = (cells: string[]): string => '| ' + cells.join(' | ') + ' |';

  const lines: string[] = [];
  lines.push(line(escapedHeader.map((cell, c) => padCell(cell, c))));
  lines.push(line(alignments.map((a, c) => delimiterCell(a, c))));
  for (const row of escapedBody) lines.push(line(row.map((cell, c) => padCell(cell, c))));
  return lines.join('\n');
}

function buildHtmlTable(grid: string[][], headerRow: boolean, alignments: ColumnAlignment[], pretty: boolean): string {
  const columns = grid[0]!.length;
  const headerCells = headerRow ? grid[0]! : new Array<string>(columns).fill('');
  const bodyRows = headerRow ? grid.slice(1) : grid;

  const alignAttr = (align: ColumnAlignment): string => (align === 'none' ? '' : ` align="${align}"`);
  const nl = pretty ? '\n' : '';
  const indent = (level: number): string => (pretty ? '  '.repeat(level) : '');

  const rowHtml = (cells: string[], tag: 'th' | 'td'): string => {
    const open = `${indent(2)}<tr>${nl}`;
    const body = cells
      .map((cell, i) => `${indent(3)}<${tag}${alignAttr(alignments[i]!)}>${htmlCell(cell)}</${tag}>${nl}`)
      .join('');
    const close = `${indent(2)}</tr>${nl}`;
    return open + body + close;
  };

  let out = `<table>${nl}`;
  out += `${indent(1)}<thead>${nl}${rowHtml(headerCells, 'th')}${indent(1)}</thead>${nl}`;
  if (bodyRows.length > 0) {
    out += `${indent(1)}<tbody>${nl}${bodyRows.map((row) => rowHtml(row, 'td')).join('')}${indent(1)}</tbody>${nl}`;
  }
  out += `</table>`;
  return out;
}

function buildCsv(grid: string[][], delimiter: string): string {
  return formatCsv(grid, { delimiter, lineEnding: '\r\n' });
}

function buildJson(grid: string[][], headerRow: boolean, pretty: boolean): { output: string; warnings: string[] } {
  const warnings: string[] = [];
  let value: unknown;

  if (headerRow) {
    const headerCells = grid[0]!;
    const seenCounts = new Map<string, number>();
    const keys: string[] = [];
    headerCells.forEach((h, i) => {
      let baseKey = h;
      if (baseKey === '') {
        baseKey = `column_${i + 1}`;
        warnings.push(`Column ${i + 1} has no header text, so it was named "${baseKey}" in the JSON output.`);
      }
      const count = (seenCounts.get(baseKey) ?? 0) + 1;
      seenCounts.set(baseKey, count);
      let key = baseKey;
      if (count > 1) {
        key = `${baseKey}_${count}`;
        warnings.push(
          `Column ${i + 1}'s header "${baseKey}" duplicates an earlier column, so it was renamed "${key}" in the JSON output.`,
        );
      }
      keys.push(key);
    });

    value = grid.slice(1).map((row) => {
      const obj: Record<string, string> = {};
      keys.forEach((key, i) => setOwn(obj, key, row[i] ?? ''));
      return obj;
    });
  } else {
    value = grid.map((row) => row.slice());
  }

  const output = pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  return { output, warnings };
}

/**
 * Builds a Markdown, HTML, CSV or JSON table from a grid of cell text. Short
 * rows are padded with empty cells, and fully empty trailing rows and
 * columns are dropped, before the grid is written out.
 */
export function buildTable(rows: string[][], options: BuildTableOptions = {}): BuildTableResult {
  const format = options.format ?? 'markdown';
  const headerRow = options.headerRow ?? true;
  const pad = options.pad ?? true;
  const csvDelimiter = options.csvDelimiter && options.csvDelimiter !== '' ? options.csvDelimiter : ',';
  const pretty = options.pretty ?? true;

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new TableBuilderError('This table has no cells to build from.');
  }

  const stringRows = rows.map((row) => row.map((cell) => (typeof cell === 'string' ? cell : String(cell ?? ''))));
  const grid = dropEmptyTrailing(rectangularise(stringRows));

  if (grid.length === 0 || grid[0]!.length === 0) {
    throw new TableBuilderError('This table has no cells to build from.');
  }

  const columns = grid[0]!.length;
  const { alignments, warnings: alignmentWarnings } = parseAlignments(options.alignments ?? '', columns);
  const warnings: string[] = [...alignmentWarnings];

  if (!headerRow && (format === 'markdown' || format === 'html')) {
    warnings.push(
      'No header row was used, so a blank header row was written to keep the table valid Markdown and HTML.',
    );
  }

  let output: string;
  switch (format) {
    case 'markdown':
      output = buildMarkdown(grid, headerRow, alignments, pad);
      break;
    case 'html':
      output = buildHtmlTable(grid, headerRow, alignments, pretty);
      break;
    case 'csv':
      output = buildCsv(grid, csvDelimiter);
      break;
    case 'json': {
      const jsonResult = buildJson(grid, headerRow, pretty);
      output = jsonResult.output;
      warnings.push(...jsonResult.warnings);
      break;
    }
    default:
      throw new TableBuilderError(`"${String(format)}" is not a supported output format.`);
  }

  return { output, rows: grid.length, columns, warnings };
}

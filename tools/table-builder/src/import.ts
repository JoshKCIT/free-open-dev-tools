import { parseFragment } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import { CsvSyntaxError, parseCsv } from './csv';
import { TableImportError } from './errors';

type Element = DefaultTreeAdapterTypes.Element;
type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

/** Where the table comes from. */
export type ImportFormat = 'html' | 'csv' | 'tsv' | 'markdown';

export interface ImportOptions {
  /** Field separator for CSV. Default ','. TSV always uses a tab and Markdown a pipe. */
  delimiter?: ',' | ';' | '\t' | '|';
}

export interface ImportResult {
  /** The cells of the table, row by row. Rows may differ in length (HTML and CSV rows are not made equal). */
  rows: string[][];
  warnings: string[];
}

/** The most cells a pasted table may hold, counting every slot a merged cell covers. */
export const MAX_IMPORT_CELLS = 10_000;

function tooManyCells(): TableImportError {
  return new TableImportError(
    `This table holds more than ${MAX_IMPORT_CELLS.toLocaleString('en-US')} cells. Import a smaller table, or split it.`,
  );
}

/** The ASCII white space of the HTML Living Standard. */
const ASCII_WHITESPACE = '\\t\\n\\f\\r ';
const NOT_BLANK = new RegExp(`[^${ASCII_WHITESPACE}]`);
const isBlank = (text: string): boolean => !NOT_BLANK.test(text);
const TRIM_ASCII = new RegExp(`^[${ASCII_WHITESPACE}]+|[${ASCII_WHITESPACE}]+$`, 'g');
/** A run of white space that holds at least one tab, line break or form feed. */
const SOURCE_BREAK_RUN = new RegExp(`[ ]*[\\t\\n\\f\\r][${ASCII_WHITESPACE}]*`, 'g');

// ---------------------------------------------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------------------------------------------

/** Elements whose start and end begin a new line inside a cell, as a browser lays them out. */
const BLOCK_ELEMENTS = new Set([
  'p',
  'div',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'hr',
  'section',
  'article',
  'header',
  'footer',
  'nav',
  'aside',
  'main',
  'figure',
  'figcaption',
  'address',
  'form',
  'fieldset',
  'details',
  'summary',
  'center',
]);

/** Content a browser never shows as text; it is not read, and the page says so. */
const NOT_TEXT_ELEMENTS = new Set(['script', 'style', 'noscript', 'template']);

interface HtmlNotes {
  merged: boolean;
  nested: boolean;
  skippedCode: boolean;
  collapsed: boolean;
}

const isElement = (node: ChildNode | ParentNode): node is Element => 'tagName' in node;

/** Children of a node, or none for a node that cannot have any (a text or comment node). */
function childrenOf(node: ChildNode | ParentNode): ChildNode[] {
  return 'childNodes' in node ? node.childNodes : [];
}

/** Finds the first table in document order without recursion, so deeply nested markup cannot exhaust the stack. */
function findFirstTable(root: ParentNode): Element | null {
  const stack: { children: ChildNode[]; index: number }[] = [{ children: childrenOf(root), index: 0 }];
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    if (top.index >= top.children.length) {
      stack.pop();
      continue;
    }
    const node = top.children[top.index++]!;
    if (isElement(node)) {
      if (node.tagName === 'table') return node;
      stack.push({ children: childrenOf(node), index: 0 });
    }
  }
  return null;
}

/** The text of one cell: character references decoded, a br as a line break, nested tables and script left out. */
function cellText(cell: Element, notes: HtmlNotes): string {
  const lines: string[] = [];
  let current = '';
  /** True when a line has begun that has not been written to `lines` yet. */
  let lineOpen = false;

  const flush = (force: boolean): void => {
    if (force || !isBlank(current)) {
      lines.push(current);
      lineOpen = false;
      current = '';
    }
  };

  const stack: { children: ChildNode[]; index: number; block: boolean }[] = [
    { children: childrenOf(cell), index: 0, block: false },
  ];
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    if (top.index >= top.children.length) {
      stack.pop();
      if (top.block) flush(false);
      continue;
    }
    const node = top.children[top.index++]!;
    if (node.nodeName === '#text') {
      const value = (node as DefaultTreeAdapterTypes.TextNode).value;
      current += value;
      if (!isBlank(value)) lineOpen = true;
      continue;
    }
    if (!isElement(node)) continue;
    const name = node.tagName;
    if (name === 'br') {
      lines.push(current);
      current = '';
      lineOpen = true;
    } else if (NOT_TEXT_ELEMENTS.has(name)) {
      notes.skippedCode = true;
    } else if (name === 'table') {
      notes.nested = true;
    } else {
      const block = BLOCK_ELEMENTS.has(name);
      if (block) flush(false);
      stack.push({ children: childrenOf(node), index: 0, block });
    }
  }
  if (lineOpen || lines.length === 0) lines.push(current);

  return lines
    .map((line) => {
      const trimmed = line.replace(TRIM_ASCII, '');
      return trimmed.replace(SOURCE_BREAK_RUN, () => {
        notes.collapsed = true;
        return ' ';
      });
    })
    .join('\n');
}

/** HTML "rules for parsing non-negative integers", as far as colspan and rowspan need them: null when not a number. */
function nonNegativeInteger(value: string | undefined): number | null {
  if (value === undefined) return null;
  const match = new RegExp(`^[${ASCII_WHITESPACE}]*\\+?(\\d+)`).exec(value);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

const attribute = (element: Element, name: string): string | undefined =>
  element.attrs.find((attr) => attr.name === name)?.value;

interface RowGroup {
  kind: 'head' | 'body' | 'foot';
  rows: Element[];
}

/** The row groups of a table in the order the HTML `rows` collection lists them: thead, then the bodies, then tfoot. */
function rowGroups(table: Element): RowGroup[] {
  const groups: RowGroup[] = [];
  let loose: RowGroup | null = null;
  for (const child of table.childNodes) {
    if (!isElement(child)) continue;
    if (child.tagName === 'thead' || child.tagName === 'tbody' || child.tagName === 'tfoot') {
      const kind = child.tagName === 'thead' ? 'head' : child.tagName === 'tfoot' ? 'foot' : 'body';
      groups.push({ kind, rows: child.childNodes.filter((n): n is Element => isElement(n) && n.tagName === 'tr') });
      loose = null;
    } else if (child.tagName === 'tr') {
      if (loose === null) {
        loose = { kind: 'body', rows: [] };
        groups.push(loose);
      }
      loose.rows.push(child);
    }
  }
  return [
    ...groups.filter((g) => g.kind === 'head'),
    ...groups.filter((g) => g.kind === 'body'),
    ...groups.filter((g) => g.kind === 'foot'),
  ];
}

function importHtml(text: string, warnings: string[]): string[][] {
  const fragment = parseFragment(text);
  const table = findFirstTable(fragment);
  if (table === null) {
    throw new TableImportError('No table was found in the pasted HTML. Paste markup that holds a <table> element.');
  }

  const notes: HtmlNotes = { merged: false, nested: false, skippedCode: false, collapsed: false };
  const rows: string[][] = [];
  let cellsSoFar = 0;

  for (const group of rowGroups(table)) {
    const grid: (string | undefined)[][] = group.rows.map(() => []);
    group.rows.forEach((tr, r) => {
      let column = 0;
      for (const cell of tr.childNodes) {
        if (!isElement(cell) || (cell.tagName !== 'td' && cell.tagName !== 'th')) continue;
        while (grid[r]![column] !== undefined) column++;

        // HTML 4.9.11 and 4.9.12: a colspan of 0 or an unreadable one is 1 and is at most 1000; a rowspan is at
        // most 65534, 0 reaches the end of the row group, and a span past the last row of the group is cut there.
        let width = nonNegativeInteger(attribute(cell, 'colspan')) ?? 1;
        if (width === 0) width = 1;
        width = Math.min(width, 1000);
        const left = group.rows.length - r;
        let height = nonNegativeInteger(attribute(cell, 'rowspan')) ?? 1;
        height = height === 0 ? left : Math.min(height, 65_534, left);

        cellsSoFar += width * height;
        if (cellsSoFar > MAX_IMPORT_CELLS) throw tooManyCells();
        if (width > 1 || height > 1) notes.merged = true;

        const value = cellText(cell, notes);
        for (let dr = 0; dr < height; dr++) {
          const target = grid[r + dr]!;
          for (let dc = 0; dc < width; dc++) target[column + dc] = value;
        }
        column += width;
      }
    });
    for (const row of grid) {
      const filled: string[] = [];
      for (let c = 0; c < row.length; c++) filled.push(row[c] ?? '');
      rows.push(filled);
    }
  }

  if (notes.merged) {
    warnings.push(
      'Merged cells (colspan or rowspan) were repeated into every cell they cover, because a grid has no merged cells.',
    );
  }
  if (notes.nested) warnings.push('A table nested inside a cell was not read, and its text is not part of the cell.');
  if (notes.skippedCode) warnings.push('Script and style content inside a cell was not read.');
  if (notes.collapsed) {
    warnings.push(
      'Runs of spaces, tabs and line breaks written across source lines inside a cell were read as one space, as a browser shows them.',
    );
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------------------------
// CSV and TSV
// ---------------------------------------------------------------------------------------------------------------

function checkCellCount(rows: string[][]): void {
  let cells = 0;
  for (const row of rows) {
    cells += row.length;
    if (cells > MAX_IMPORT_CELLS) throw tooManyCells();
  }
}

function importCsv(text: string, delimiter: string): string[][] {
  try {
    const rows = parseCsv(text, { delimiter }).rows;
    checkCellCount(rows);
    return rows;
  } catch (err) {
    if (err instanceof CsvSyntaxError) {
      throw new TableImportError(`The CSV could not be read: ${err.message} (line ${err.line}, column ${err.column}).`);
    }
    throw err;
  }
}

/** TSV (IANA text/tab-separated-values): one record per line, fields separated by a tab, no quoting of any kind. */
function importTsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records = source.split(/\r\n|\n|\r/);
  if (records.length > 0 && records[records.length - 1] === '') records.pop();
  const rows = records.map((record) => record.split('\t'));
  checkCellCount(rows);
  return rows;
}

// ---------------------------------------------------------------------------------------------------------------
// Markdown (GFM section 4.10)
// ---------------------------------------------------------------------------------------------------------------

const ASCII_PUNCTUATION = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
const isPunctuation = (ch: string | undefined): boolean => ch !== undefined && ASCII_PUNCTUATION.includes(ch);

/**
 * Splits a table row at its unescaped pipes. A backslash before an ASCII punctuation character keeps both together,
 * as in CommonMark, so `\|` stays inside its cell. One leading and one trailing pipe are optional and are removed.
 */
function splitRow(line: string): { cells: string[]; hasPipe: boolean } {
  const text = line.replace(/^[ \t]+|[ \t]+$/g, '');
  const pieces: string[] = [];
  let current = '';
  let endsWithPipe = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '\\' && isPunctuation(text[i + 1])) {
      current += ch + text[i + 1]!;
      i++;
    } else if (ch === '|') {
      pieces.push(current);
      current = '';
      endsWithPipe = i === text.length - 1;
    } else {
      current += ch;
    }
  }
  pieces.push(current);
  const hasPipe = pieces.length > 1;
  if (hasPipe && text.startsWith('|')) pieces.shift();
  if (hasPipe && endsWithPipe) pieces.pop();
  return { cells: pieces, hasPipe };
}

/** A character reference as a Markdown renderer reads it; text that is not a valid reference stays as written. */
function decodeReference(reference: string): string {
  const node = parseFragment(reference).childNodes[0];
  return node !== undefined && node.nodeName === '#text' ? (node as DefaultTreeAdapterTypes.TextNode).value : reference;
}

const CHARACTER_REFERENCE = /^&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/;

/**
 * The text of one cell: a backslash escape of punctuation is read as the character, a character reference as the
 * character it names, and `<br>` as a line break; code spans and every other Markdown mark stay as written.
 */
function readMarkdownCell(raw: string): string {
  const text = raw.replace(/^[ \t]+|[ \t]+$/g, '');
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\\' && isPunctuation(text[i + 1])) {
      out += text[i + 1]!;
      i += 2;
    } else if (ch === '`') {
      let run = 1;
      while (text[i + run] === '`') run++;
      // A code span ends at the next run of exactly as many backticks; with none, the backticks are plain text.
      let close = -1;
      let j = i + run;
      while (j < text.length) {
        if (text[j] === '`') {
          let k = 1;
          while (text[j + k] === '`') k++;
          if (k === run) {
            close = j;
            break;
          }
          j += k;
        } else {
          j++;
        }
      }
      if (close === -1) {
        out += text.slice(i, i + run);
        i += run;
      } else {
        // GFM: an escaped pipe inside a code span is a pipe; every other character stays as written.
        out += text.slice(i, close + run).replace(/\\\|/g, '|');
        i = close + run;
      }
    } else if (ch === '&') {
      const reference = CHARACTER_REFERENCE.exec(text.slice(i, i + 40));
      if (reference) {
        out += decodeReference(reference[0]);
        i += reference[0].length;
      } else {
        out += ch;
        i++;
      }
    } else if (ch === '<') {
      const br = /^<br[ \t]*\/?>/i.exec(text.slice(i, i + 16));
      if (br) {
        out += '\n';
        i += br[0].length;
      } else {
        out += ch;
        i++;
      }
    } else {
      out += ch;
      i++;
    }
  }
  return out
    .split('\n')
    .map((line) => line.replace(/^[ \t]+|[ \t]+$/g, ''))
    .join('\n');
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const DELIMITER_CELL = /^:?-+:?$/;
/** A line that starts another block and so ends a table: quote, heading, fence, thematic break or list item. */
const BLOCK_START = /^ {0,3}(>|#{1,6}([ \t]|$)|`{3,}|~{3,}|([-*_])([ \t]*\3){2,}[ \t]*$|([-+*]|\d{1,9}[.)])([ \t]|$))/;

function importMarkdown(text: string, warnings: string[]): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const indented = (line: string): boolean => /^( {4,}|\t)/.test(line);

  let fence: { char: string; length: number } | null = null;
  for (let i = 0; i + 1 < lines.length; i++) {
    const line = lines[i]!;
    const fenceMatch = FENCE.exec(line);
    if (fence !== null) {
      if (fenceMatch !== null) {
        const closing = fenceMatch[1]!;
        if (closing[0] === fence.char && closing.length >= fence.length && isBlank(line.slice(fenceMatch[0].length))) {
          fence = null;
        }
      }
      continue;
    }
    if (fenceMatch !== null) {
      fence = { char: fenceMatch[1]![0]!, length: fenceMatch[1]!.length };
      continue;
    }
    if (isBlank(line) || indented(line)) continue;

    const header = splitRow(line);
    const delimiterLine = lines[i + 1]!;
    if (isBlank(delimiterLine) || indented(delimiterLine) || BLOCK_START.test(delimiterLine)) continue;
    const delimiter = splitRow(delimiterLine);
    if (!delimiter.cells.every((cell) => DELIMITER_CELL.test(cell.trim()))) continue;
    if (delimiter.cells.length !== header.cells.length || (!header.hasPipe && !delimiter.hasPipe)) continue;

    const width = header.cells.length;
    if (width > MAX_IMPORT_CELLS) throw tooManyCells();
    const rows: string[][] = [header.cells.map(readMarkdownCell)];
    const dropped: { row: number; cells: string[] }[] = [];
    for (let j = i + 2; j < lines.length; j++) {
      const bodyLine = lines[j]!;
      if (isBlank(bodyLine) || BLOCK_START.test(bodyLine)) break;
      if ((rows.length + 1) * width > MAX_IMPORT_CELLS) throw tooManyCells();
      const cells = splitRow(bodyLine).cells.map(readMarkdownCell);
      if (cells.length > width) dropped.push({ row: rows.length + 1, cells: cells.slice(width) });
      const row = cells.slice(0, width);
      while (row.length < width) row.push('');
      rows.push(row);
    }
    if (dropped.length > 0) {
      const first = dropped[0]!;
      const shown = first.cells.map((cell) => JSON.stringify(cell)).join(', ');
      warnings.push(
        dropped.length === 1
          ? `Row ${first.row} had more cells than the header, so its extra cells were dropped, as GFM specifies (dropped: ${shown}).`
          : `${dropped.length} rows had more cells than the header, so their extra cells were dropped, as GFM specifies (first: row ${first.row}, dropped: ${shown}).`,
      );
    }
    return rows;
  }
  throw new TableImportError(
    'No table was found in the pasted Markdown. A pipe table needs a header row followed by a delimiter row such as | --- | --- |, with the same number of cells in both.',
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------------------------

/**
 * Reads the first table in pasted text. HTML is read as a tree by parse5 and never run: nothing the markup names is
 * fetched, rendered or executed, and only text comes back. Markdown pipe tables follow the GFM specification, CSV
 * follows RFC 4180 with the chosen delimiter, and TSV follows the IANA registration. At most 10,000 cells are read.
 * Empty text gives no rows.
 */
export function importTable(text: string, from: ImportFormat, options: ImportOptions = {}): ImportResult {
  const warnings: string[] = [];
  if (isBlank(text)) return { rows: [], warnings };

  let rows: string[][];
  switch (from) {
    case 'html':
      rows = importHtml(text, warnings);
      break;
    case 'csv':
      rows = importCsv(text, options.delimiter ?? ',');
      break;
    case 'tsv':
      rows = importTsv(text);
      break;
    case 'markdown':
      rows = importMarkdown(text, warnings);
      break;
    default:
      throw new TableImportError(`"${String(from)}" is not a supported import format.`);
  }
  return { rows, warnings };
}

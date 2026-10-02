/**
 * Writes a one-sheet .xlsx package. The parts are the ones ECMA-376 Part 1 needs and no more: the content types part
 * first, the package and workbook relationships, the workbook and one worksheet. Text is written as inline strings with
 * its spaces kept, numbers and booleans only when asked, and the zip carries a fixed modification time, so the same
 * input always gives the same bytes.
 */
import { zipSync, type Zippable } from 'fflate';
import { escapeAttribute, escapeCellText, escapeText } from './xml';
import {
  MAX_CELL_CHARACTERS,
  MAX_COLUMNS,
  MAX_ROWS,
  PREVIEW_CELLS,
  SpreadsheetConverterError,
  type TableCell,
  type WriteOptions,
  type WriteResult,
  type WrittenCell,
} from './types';

const encoder = new TextEncoder();
const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Excel's own rule for a sheet name: 1 to 31 characters, none of [ ] : * ? / \, and no apostrophe at either end. */
export function checkSheetName(name: string): string {
  if (name.length === 0 || name.length > 31) {
    throw new SpreadsheetConverterError(
      `Sheet name: it must be 1 to 31 characters, and "${name.slice(0, 40)}" has ${name.length}.`,
    );
  }
  // eslint-disable-next-line no-control-regex
  if (/[[\]:*?/\\\u0000-\u001F]/.test(name)) {
    throw new SpreadsheetConverterError('Sheet name: it cannot contain any of [ ] : * ? / \\ or a control character.');
  }
  if (name.startsWith("'") || name.endsWith("'")) {
    throw new SpreadsheetConverterError('Sheet name: it cannot start or end with an apostrophe.');
  }
  return name;
}

/** RFC 8259's number grammar, matched over the whole text. */
const JSON_NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

/** Digits in the mantissa, leading zeros not counted. */
function significantDigits(text: string): number {
  const mantissa = text.replace(/^-/, '').split(/[eE]/)[0]!.replace('.', '');
  return mantissa.replace(/^0+/, '').length;
}

/**
 * Whether `text` can be stored as a spreadsheet number with no change to its value: RFC 8259's number grammar (so no
 * leading zero, no plus sign, no bare fraction), at most 15 significant digits (Excel's precision), a value that is not
 * negative zero, and one a double can hold without turning into zero or infinity.
 */
export function isSafeNumber(text: string): boolean {
  if (!JSON_NUMBER.test(text)) return false;
  if (significantDigits(text) > 15) return false;
  const value = Number(text);
  if (!Number.isFinite(value)) return false;
  if (Object.is(value, -0)) return false;
  if (value === 0 && /[1-9]/.test(text.split(/[eE]/)[0]!)) return false;
  return true;
}

const columnNames: string[] = [];

/** Column letters for a 0-based column number: 0 is A, 25 is Z, 26 is AA. */
export function columnName(col: number): string {
  let name = columnNames[col];
  if (name === undefined) {
    let n = col + 1;
    name = '';
    while (n > 0) {
      name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
      n = Math.floor((n - 1) / 26);
    }
    columnNames[col] = name;
  }
  return name;
}

interface Classified {
  type: 'inlineStr' | 'n' | 'b';
  text: string;
}

/** How one value is stored; null for a value that writes no cell. */
function classify(cell: TableCell, detectTypes: boolean, ref: string, warnings: string[]): Classified | null {
  if (cell === null) return null;
  if (typeof cell === 'string') {
    if (cell === '') return null;
    if (detectTypes) {
      if (cell === 'TRUE' || cell === 'FALSE') return { type: 'b', text: cell };
      if (isSafeNumber(cell)) return { type: 'n', text: cell };
    }
    return { type: 'inlineStr', text: cell };
  }
  if (cell.kind === 'number' && detectTypes) {
    if (isSafeNumber(cell.text)) return { type: 'n', text: cell.text };
    warnings.push(
      `Cell ${ref} holds the number ${cell.text.slice(0, 40)}, which a spreadsheet number cannot keep exactly (more than 15 digits, negative zero or out of range), so it was written as text.`,
    );
    return { type: 'inlineStr', text: cell.text };
  }
  if (cell.kind === 'boolean' && detectTypes) return { type: 'b', text: cell.text === 'true' ? 'TRUE' : 'FALSE' };
  if (cell.text === '') return null;
  return { type: 'inlineStr', text: cell.text };
}

function contentTypes(): string {
  return (
    `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '</Types>'
  );
}

function packageRels(): string {
  return (
    `${XML_HEADER}<Relationships xmlns="${PACKAGE_REL_NS}">` +
    `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/>` +
    '</Relationships>'
  );
}

function workbookXml(sheetName: string): string {
  return (
    `${XML_HEADER}<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">` +
    `<sheets><sheet name="${escapeAttribute(sheetName)}" sheetId="1" r:id="rId1"/></sheets>` +
    '</workbook>'
  );
}

function workbookRels(): string {
  return (
    `${XML_HEADER}<Relationships xmlns="${PACKAGE_REL_NS}">` +
    `<Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/>` +
    '</Relationships>'
  );
}

/** Writes `rows` as the one sheet of a new .xlsx package. */
export function writeXlsx(rows: TableCell[][], options: WriteOptions): WriteResult {
  const sheetName = checkSheetName(options.sheetName);
  if (rows.length > MAX_ROWS) {
    throw new SpreadsheetConverterError(
      `There are ${rows.length.toLocaleString('en-US')} rows, and a spreadsheet holds at most ${MAX_ROWS.toLocaleString('en-US')}.`,
    );
  }
  let width = 0;
  for (const row of rows) width = Math.max(width, row.length);
  if (width > MAX_COLUMNS) {
    throw new SpreadsheetConverterError(
      `There are ${width.toLocaleString('en-US')} columns, and a spreadsheet holds at most ${MAX_COLUMNS.toLocaleString('en-US')}.`,
    );
  }

  const warnings: string[] = [];
  const preview: WrittenCell[] = [];
  const longCells: string[] = [];
  const rowXml: string[] = [];
  let cellCount = 0;

  rows.forEach((row, r) => {
    const cells: string[] = [];
    row.forEach((value, c) => {
      const ref = `${columnName(c)}${r + 1}`;
      const stored = classify(value, options.detectTypes, ref, warnings);
      if (stored === null) return;
      cellCount++;
      if (preview.length < PREVIEW_CELLS) preview.push({ ref, value: stored.text, type: stored.type });
      if (stored.type === 'inlineStr') {
        if (stored.text.length > MAX_CELL_CHARACTERS) longCells.push(ref);
        cells.push(
          `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeText(escapeCellText(stored.text))}</t></is></c>`,
        );
      } else if (stored.type === 'b') {
        cells.push(`<c r="${ref}" t="b"><v>${stored.text === 'TRUE' ? 1 : 0}</v></c>`);
      } else {
        cells.push(`<c r="${ref}"><v>${stored.text}</v></c>`);
      }
    });
    if (cells.length > 0) rowXml.push(`<row r="${r + 1}">${cells.join('')}</row>`);
  });

  if (cellCount === 0) {
    throw new SpreadsheetConverterError('There is nothing to write: the text holds no cell with a value.');
  }
  if (longCells.length > 0) {
    const listed = longCells.slice(0, 5).join(', ');
    warnings.push(
      `${longCells.length} ${longCells.length === 1 ? 'cell holds' : 'cells hold'} more than ${MAX_CELL_CHARACTERS.toLocaleString('en-US')} characters (${listed}${longCells.length > 5 ? ', and more' : ''}); the text was written whole, but Excel keeps only the first ${MAX_CELL_CHARACTERS.toLocaleString('en-US')} characters of a cell.`,
    );
  }

  const sheetXml =
    `${XML_HEADER}<worksheet xmlns="${MAIN_NS}"><dimension ref="A1:${columnName(Math.max(width, 1) - 1)}${rows.length}"/>` +
    `<sheetData>${rowXml.join('')}</sheetData></worksheet>`;

  // A fixed modification time (1980-01-01, the earliest a zip can hold) so the bytes depend only on the input.
  const mtime = new Date(1980, 0, 1, 0, 0, 0);
  const file = (text: string): [Uint8Array, { mtime: Date }] => [encoder.encode(text), { mtime }];
  const entries: Zippable = {
    '[Content_Types].xml': file(contentTypes()),
    '_rels/.rels': file(packageRels()),
    'xl/workbook.xml': file(workbookXml(sheetName)),
    'xl/_rels/workbook.xml.rels': file(workbookRels()),
    'xl/worksheets/sheet1.xml': file(sheetXml),
  };
  const bytes = zipSync(entries, { level: 6, mtime });

  return { bytes, preview, cellCount, rowCount: rows.length, columnCount: width, warnings };
}

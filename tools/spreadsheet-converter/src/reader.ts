/**
 * Reads an .xlsx package: the zip is opened with fflate, then the workbook part, its relationships and each worksheet
 * are scanned with the purpose-built XML scanner. Every cell keeps the text the file stores for it.
 */
import { unzipSync } from 'fflate';
import { XmlScanner } from './xml';
import {
  MAX_COLUMNS,
  MAX_ROWS,
  SpreadsheetConverterError,
  type Cell,
  type ReadOptions,
  type Sheet,
  type SheetState,
  type Workbook,
} from './types';

/** The one cell shared by every gap in a row; its `ref` is empty because it stands for no stored cell. */
export const EMPTY_CELL: Cell = Object.freeze({ kind: 'empty', text: '', ref: '' });
const EMPTY_ROW: Cell[] = Object.freeze([]) as unknown as Cell[];

const decoder = new TextDecoder('utf-8');

/** The package parts that matter, keyed by part name: only XML and relationship parts are ever unzipped. */
type Parts = Record<string, Uint8Array>;

function openPackage(bytes: Uint8Array): Parts {
  try {
    return unzipSync(bytes, { filter: (file) => /\.(xml|rels)$/i.test(file.name) });
  } catch {
    throw new SpreadsheetConverterError('This file could not be opened as a zip package, so it is not an .xlsx file.');
  }
}

function partText(parts: Parts, name: string): string | undefined {
  const bytes = parts[name];
  return bytes === undefined ? undefined : decoder.decode(bytes);
}

interface Relationship {
  id: string;
  type: string;
  target: string;
}

function readRelationships(xml: string | undefined): Relationship[] {
  const out: Relationship[] = [];
  if (xml === undefined) return out;
  const scanner = new XmlScanner(xml);
  while (scanner.next()) {
    if (scanner.name !== 'Relationship' || scanner.closing) continue;
    const id = scanner.attr('Id');
    const target = scanner.attr('Target');
    if (id === undefined || target === undefined) continue;
    if (scanner.attr('TargetMode') === 'External') continue;
    out.push({ id, type: scanner.attr('Type') ?? '', target });
  }
  return out;
}

/** The part a relationship target names: from the package root when it starts with a slash, else beside its source. */
function resolveTarget(sourcePart: string, target: string): string {
  const base = target.startsWith('/') ? [] : sourcePart.split('/').slice(0, -1);
  for (const segment of target.replace(/^\//, '').split('/')) {
    if (segment === '..') base.pop();
    else if (segment !== '.' && segment !== '') base.push(segment);
  }
  return base.join('/');
}

function relationshipsPartOf(part: string): string {
  const slash = part.lastIndexOf('/');
  return `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
}

interface SheetEntry {
  name: string;
  state: SheetState;
  part: string;
}

interface WorkbookInfo {
  entries: SheetEntry[];
  date1904: boolean;
}

function readWorkbookPart(parts: Parts): { info: WorkbookInfo; workbookPart: string } {
  const rootRels = readRelationships(partText(parts, '_rels/.rels'));
  const office = rootRels.find((rel) => /\/officeDocument$/.test(rel.type));
  const workbookPart = office ? resolveTarget('', office.target) : 'xl/workbook.xml';
  const xml = partText(parts, workbookPart);
  if (xml === undefined) {
    throw new SpreadsheetConverterError('This zip file is not an Excel workbook: it has no workbook part.', {
      part: workbookPart,
    });
  }
  const rels = readRelationships(partText(parts, relationshipsPartOf(workbookPart)));
  const entries: SheetEntry[] = [];
  let date1904 = false;
  const scanner = new XmlScanner(xml);
  while (scanner.next()) {
    if (scanner.closing) continue;
    if (scanner.name === 'workbookPr') {
      const flag = scanner.attr('date1904');
      date1904 = flag === '1' || flag === 'true';
    } else if (scanner.name === 'sheet') {
      const name = scanner.attr('name') ?? '';
      const id = scanner.attr('id', true);
      const stateText = scanner.attr('state');
      const state: SheetState = stateText === 'hidden' || stateText === 'veryHidden' ? stateText : 'visible';
      const rel = rels.find((candidate) => candidate.id === id);
      if (!rel) {
        throw new SpreadsheetConverterError(`The sheet "${name}" points at a part that is not in the package.`, {
          part: workbookPart,
        });
      }
      entries.push({ name, state, part: resolveTarget(workbookPart, rel.target) });
    }
  }
  if (entries.length === 0) {
    throw new SpreadsheetConverterError('This workbook has no sheets.', { part: workbookPart });
  }
  return { info: { entries, date1904 }, workbookPart };
}

/** Column letters to a 0-based column number, or -1 when the text is not letters. */
function columnNumber(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    const code = letters.charCodeAt(i) & ~32;
    if (code < 65 || code > 90) return -1;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

/** A cell reference such as B12 as 0-based column and row; refused when it is not one or is past Excel's limits. */
function parseRef(ref: string): { col: number; row: number } {
  const match = /^([A-Za-z]{1,3})([0-9]{1,7})$/.exec(ref);
  const col = match ? columnNumber(match[1]!) : -1;
  const row = match ? parseInt(match[2]!, 10) - 1 : -1;
  if (col < 0 || row < 0 || col >= MAX_COLUMNS || row >= MAX_ROWS) {
    throw new SpreadsheetConverterError(
      `The cell reference ${ref} is not a cell inside Excel's limits of ${MAX_ROWS.toLocaleString('en-US')} rows and ${MAX_COLUMNS.toLocaleString('en-US')} columns.`,
      { cell: ref },
    );
  }
  return { col, row };
}

/** The text of an inline string or shared string item: its `<t>` runs joined, phonetic runs left out. */
function readRichText(scanner: XmlScanner, container: string): string {
  let text = '';
  if (scanner.selfClosing) return text;
  while (scanner.next()) {
    if (scanner.closing) {
      if (scanner.name === container) break;
      continue;
    }
    if (scanner.name === 't') text += scanner.readText();
    else if (scanner.name === 'rPh') scanner.skipElement();
  }
  return text;
}

function readSheetRows(xml: string): Cell[][] {
  const scanner = new XmlScanner(xml);
  const rows: Cell[][] = [];
  let rowIndex = -1;
  let nextColumn = 0;

  while (scanner.next()) {
    if (scanner.closing) continue;
    const outer = scanner.name;
    if (outer === 'row') {
      const r = scanner.attr('r');
      rowIndex = r === undefined ? rowIndex + 1 : parseInt(r, 10) - 1;
      nextColumn = 0;
      continue;
    }
    if (outer !== 'c') continue;

    const refAttr = scanner.attr('r');
    const type = scanner.attr('t');
    let value: string | undefined;
    let inline: string | undefined;
    if (!scanner.selfClosing) {
      while (scanner.next()) {
        const tag = scanner.name;
        if (scanner.closing) {
          if (tag === 'c') break;
          continue;
        }
        if (tag === 'v') value = scanner.readText();
        else if (tag === 'is') inline = readRichText(scanner, 'is');
        else if (tag === 'f') scanner.skipElement();
      }
    }

    let col = nextColumn;
    let row = rowIndex < 0 ? 0 : rowIndex;
    if (refAttr !== undefined) {
      const at = parseRef(refAttr);
      col = at.col;
      row = at.row;
    }
    nextColumn = col + 1;
    const ref = refAttr ?? `${columnLetters(col)}${row + 1}`;

    const cell = makeCell(type, value, inline, ref);
    if (cell === null) continue;

    const target = rows[row] ?? (rows[row] = []);
    if (col < target.length) target[col] = cell;
    else {
      while (target.length < col) target.push(EMPTY_CELL);
      target.push(cell);
    }
  }
  for (let i = 0; i < rows.length; i++) rows[i] ??= EMPTY_ROW;
  return rows;
}

function columnLetters(col: number): string {
  let n = col + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function makeCell(
  type: string | undefined,
  value: string | undefined,
  inline: string | undefined,
  ref: string,
): Cell | null {
  if (type === 'inlineStr') return { kind: 'string', text: inline ?? '', ref };
  if (value === undefined) return null;
  if (type === 'b') return { kind: 'boolean', text: value.trim() === '1' ? 'TRUE' : 'FALSE', ref };
  if (type === undefined || type === 'n') {
    const text = value.trim();
    return text === '' ? null : { kind: 'number', text, ref };
  }
  return { kind: 'string', text: value, ref };
}

/** Reads every sheet of an .xlsx package (or only the one `options.sheet` selects). */
export function readXlsx(bytes: Uint8Array, options: ReadOptions): Workbook {
  void options;
  const parts = openPackage(bytes);
  const { info } = readWorkbookPart(parts);
  const sheets: Sheet[] = info.entries.map((entry) => {
    const xml = partText(parts, entry.part);
    if (xml === undefined) {
      throw new SpreadsheetConverterError(`The sheet "${entry.name}" points at a part that is not in the package.`, {
        part: entry.part,
      });
    }
    return { name: entry.name, state: entry.state, rows: readSheetRows(xml) };
  });
  return { sheets, date1904: info.date1904, warnings: [] };
}

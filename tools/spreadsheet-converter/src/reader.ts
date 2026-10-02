/**
 * Reads an .xlsx package: the zip is opened with fflate, then the workbook part, its relationships, the shared strings,
 * the styles and each worksheet are scanned with the purpose-built XML scanner. Every cell keeps the text the file
 * stores for it; a date is shown as a date only when its cell's number format says it is one.
 */
import { unzipSync } from 'fflate';
import { XmlScanner } from './xml';
import { builtInFormatClass, customFormatClass, tryDate, type FormatClass } from './dates';
import {
  MAX_CELLS,
  MAX_COLUMNS,
  MAX_FILE_BYTES,
  MAX_ROWS,
  MAX_UNZIPPED_BYTES,
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

/** The plain sentence for a file over the limit, thrown before a byte of it is read or unzipped. */
export function checkFileSize(byteLength: number): void {
  if (byteLength <= MAX_FILE_BYTES) return;
  throw new SpreadsheetConverterError(
    `This file is ${(byteLength / 1048576).toFixed(1)} MiB (${byteLength.toLocaleString('en-US')} bytes). The limit is 20 MiB because the whole workbook is unpacked in memory.`,
  );
}

/** The package parts that matter, keyed by part name: only XML and relationship parts are ever unzipped. */
type Parts = Record<string, Uint8Array>;

/** The first bytes of the older Office file format (a compound file), which also holds a password-protected workbook. */
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function openPackage(bytes: Uint8Array): Parts {
  checkFileSize(bytes.length);
  if (bytes.length >= OLE_SIGNATURE.length && OLE_SIGNATURE.every((byte, i) => bytes[i] === byte)) {
    throw new SpreadsheetConverterError(
      'This is an older Office file or a password-protected one. Only .xlsx files that are not password-protected can be read.',
    );
  }
  let declared = 0;
  try {
    return unzipSync(bytes, {
      filter: (file) => {
        if (!/\.(xml|rels)$/i.test(file.name)) return false;
        // The declared sizes are summed before anything is inflated, so a package built to unpack to gigabytes is
        // refused while it is still a few kilobytes. fflate itself never inflates a part past the size it declares.
        declared += file.originalSize;
        if (declared > MAX_UNZIPPED_BYTES) {
          throw new SpreadsheetConverterError(
            'This file would unpack to more than 100 MiB of XML, which is the most this page reads, so it was not opened.',
          );
        }
        return true;
      },
    });
  } catch (err) {
    if (err instanceof SpreadsheetConverterError) throw err;
    throw new SpreadsheetConverterError('This file could not be opened as a zip package, so it is not an .xlsx file.');
  }
}

function partText(parts: Parts, name: string): string | undefined {
  // Own properties only: a relationship target such as /constructor must be a missing part, not an inherited function.
  const bytes = Object.hasOwn(parts, name) ? parts[name] : undefined;
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
  sharedStringsPart: string;
  stylesPart: string;
}

function readWorkbookPart(parts: Parts): WorkbookInfo {
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
    const tag = scanner.name;
    if (tag === 'workbookPr') {
      const flag = scanner.attr('date1904');
      date1904 = flag === '1' || flag === 'true';
    } else if (tag === 'sheet') {
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
  const shared = rels.find((rel) => /\/sharedStrings$/.test(rel.type));
  const styles = rels.find((rel) => /\/styles$/.test(rel.type));
  return {
    entries,
    date1904,
    sharedStringsPart: shared ? resolveTarget(workbookPart, shared.target) : 'xl/sharedStrings.xml',
    stylesPart: styles ? resolveTarget(workbookPart, styles.target) : 'xl/styles.xml',
  };
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

function columnLetters(col: number): string {
  let n = col + 1;
  let letters = '';
  while (n > 0) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
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
    const tag = scanner.name;
    if (scanner.closing) {
      if (tag === container) break;
      continue;
    }
    if (tag === 't') text += scanner.readText();
    else if (tag === 'rPh') scanner.skipElement();
  }
  return text;
}

function readSharedStrings(xml: string | undefined): string[] {
  const strings: string[] = [];
  if (xml === undefined) return strings;
  const scanner = new XmlScanner(xml);
  while (scanner.next()) {
    if (!scanner.closing && scanner.name === 'si') strings.push(readRichText(scanner, 'si'));
  }
  return strings;
}

/** For each cell format (the `s` index of a cell), whether its number format is a date, a time, or neither. */
function readStyles(xml: string | undefined): (FormatClass | undefined)[] {
  if (xml === undefined) return [];
  const custom = new Map<number, string>();
  const ids: number[] = [];
  let inCellXfs = false;
  const scanner = new XmlScanner(xml);
  while (scanner.next()) {
    const tag = scanner.name;
    if (tag === 'cellXfs') {
      inCellXfs = !scanner.closing && !scanner.selfClosing;
    } else if (scanner.closing) {
      continue;
    } else if (tag === 'numFmt') {
      const id = parseInt(scanner.attr('numFmtId') ?? '', 10);
      const code = scanner.attr('formatCode');
      if (Number.isFinite(id) && code !== undefined) custom.set(id, code);
    } else if (tag === 'xf' && inCellXfs) {
      const id = parseInt(scanner.attr('numFmtId') ?? '0', 10);
      ids.push(Number.isFinite(id) ? id : 0);
    }
  }
  return ids.map((id) => {
    const code = custom.get(id);
    return code !== undefined ? customFormatClass(code) : builtInFormatClass(id);
  });
}

interface SheetContext {
  shared: string[];
  styles: (FormatClass | undefined)[];
  date1904: boolean;
  datesAsSerials: boolean;
  /** Cells with a date format that hold a number no date can be made from: the count and the first one. */
  outOfRange: { count: number; first: string };
}

function makeCell(
  context: SheetContext,
  type: string | undefined,
  style: FormatClass | undefined,
  value: string | undefined,
  inline: string | undefined,
  ref: string,
): Cell | null {
  if (type === 'inlineStr') return inline === undefined ? null : { kind: 'string', text: inline, ref };
  if (value === undefined) return null;
  switch (type) {
    case 'b':
      return { kind: 'boolean', text: value.trim() === '1' || value.trim() === 'true' ? 'TRUE' : 'FALSE', ref };
    case 'e':
      return { kind: 'error', text: value, ref };
    case 'd':
      return { kind: 'date', text: value.trim(), ref };
    case 's': {
      const index = Number(value.trim());
      const text = Number.isInteger(index) ? context.shared[index] : undefined;
      if (text === undefined) {
        throw new SpreadsheetConverterError(
          `Cell ${ref} points at shared string ${value.trim()}, which does not exist.`,
          { cell: ref },
        );
      }
      return { kind: 'string', text, ref };
    }
    case undefined:
    case 'n': {
      const text = value.trim();
      if (text === '') return null;
      if (style !== undefined && !context.datesAsSerials) {
        const iso = tryDate(text, context.date1904, style === 'time');
        if (iso !== null) return { kind: 'date', text: iso, ref };
        if (context.outOfRange.count++ === 0) context.outOfRange.first = ref;
      }
      return { kind: 'number', text, ref };
    }
    default:
      // str (a formula's text result) and any type this reader does not know: the stored text, unchanged.
      return { kind: 'string', text: value, ref };
  }
}

function readSheetRows(xml: string, context: SheetContext, part: string): Cell[][] {
  const scanner = new XmlScanner(xml);
  const rows: Cell[][] = [];
  let rowIndex = -1;
  let nextColumn = 0;
  let rowCount = 0;
  let width = 0;
  let sawEnd = false;

  while (scanner.next()) {
    const outer = scanner.name;
    if (scanner.closing) {
      if (outer === 'worksheet') sawEnd = true;
      continue;
    }
    if (outer === 'row') {
      // A row number that is missing, is not a whole number or lies outside Excel's rows (1 to MAX_ROWS) is not a
      // position: the row follows the one before it, and that may not run past the last row either.
      const r = scanner.attr('r')?.trim();
      const given = r !== undefined && /^\d{1,8}$/.test(r) ? parseInt(r, 10) : 0;
      rowIndex = given >= 1 && given <= MAX_ROWS ? given - 1 : rowIndex + 1;
      if (rowIndex >= MAX_ROWS) {
        throw new SpreadsheetConverterError(
          `This sheet has more rows than the ${MAX_ROWS.toLocaleString('en-US')} rows a spreadsheet holds, so a row without a usable row number has no place to go.`,
          { part },
        );
      }
      nextColumn = 0;
      continue;
    }
    if (outer !== 'c') continue;

    const refAttr = scanner.attr('r');
    const type = scanner.attr('t');
    const styleAttr = scanner.attr('s');
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

    const style = styleAttr === undefined ? undefined : context.styles[parseInt(styleAttr, 10)];
    const cell = makeCell(context, type, style, value, inline, ref);
    if (cell === null) continue;

    // The sheet is held as a rectangle, so a cell far from the rest would ask for far more entries than the sheet holds.
    if (row + 1 > rowCount || col + 1 > width) {
      rowCount = Math.max(rowCount, row + 1);
      width = Math.max(width, col + 1);
      if (rowCount * width > MAX_CELLS) {
        throw new SpreadsheetConverterError(
          `This sheet spans ${rowCount.toLocaleString('en-US')} rows and ${width.toLocaleString('en-US')} columns, which is more than the ${MAX_CELLS.toLocaleString('en-US')} cells (empty ones included) this page builds.`,
          { part, cell: ref },
        );
      }
    }
    const target = rows[row] ?? (rows[row] = []);
    if (col < target.length) target[col] = cell;
    else {
      while (target.length < col) target.push(EMPTY_CELL);
      target.push(cell);
    }
  }
  if (!sawEnd) {
    throw new SpreadsheetConverterError(
      'This sheet is cut short: its data ends before the closing tag. The file may be damaged, or its zip header may understate the size of the sheet.',
      { part },
    );
  }
  for (let i = 0; i < rows.length; i++) rows[i] ??= EMPTY_ROW;
  return rows;
}

/**
 * The position of the sheet a selector chooses: blank is the first visible sheet, a whole number is a 1-based position,
 * and anything else (or a number that is no position but is a sheet's name) is a sheet's exact name.
 */
export function resolveSheetIndex(sheets: { name: string; state: SheetState }[], selector: string): number {
  const wanted = selector.trim();
  if (wanted === '') {
    const visible = sheets.findIndex((sheet) => sheet.state === 'visible');
    return visible < 0 ? 0 : visible;
  }
  const count = `${sheets.length} ${sheets.length === 1 ? 'sheet' : 'sheets'}`;
  if (/^\d+$/.test(wanted)) {
    const position = parseInt(wanted, 10);
    if (position >= 1 && position <= sheets.length) return position - 1;
    const byNumberName = sheets.findIndex((sheet) => sheet.name === wanted);
    if (byNumberName >= 0) return byNumberName;
    throw new SpreadsheetConverterError(
      `Sheet (name or number): there is no sheet ${wanted}; this workbook has ${count}.`,
    );
  }
  const exact = sheets.findIndex((sheet) => sheet.name === selector);
  const found = exact >= 0 ? exact : sheets.findIndex((sheet) => sheet.name === wanted);
  if (found >= 0) return found;
  const names = sheets.slice(0, 20).map((sheet) => `"${sheet.name}"`);
  throw new SpreadsheetConverterError(
    `Sheet (name or number): there is no sheet named "${wanted}". The sheets are: ${names.join(', ')}${sheets.length > 20 ? ', and more' : ''}.`,
  );
}

/** Reads every sheet of an .xlsx package (or only the one `options.sheet` selects). */
export function readXlsx(bytes: Uint8Array, options: ReadOptions): Workbook {
  const parts = openPackage(bytes);
  const info = readWorkbookPart(parts);
  const only = options.sheet === undefined ? -1 : resolveSheetIndex(info.entries, options.sheet);
  const context: SheetContext = {
    shared: readSharedStrings(partText(parts, info.sharedStringsPart)),
    styles: readStyles(partText(parts, info.stylesPart)),
    date1904: info.date1904,
    datesAsSerials: options.datesAsSerials,
    outOfRange: { count: 0, first: '' },
  };
  const sheets: Sheet[] = info.entries.map((entry, index) => {
    if (only >= 0 && index !== only) return { name: entry.name, state: entry.state, rows: [] };
    const xml = partText(parts, entry.part);
    if (xml === undefined) {
      throw new SpreadsheetConverterError(`The sheet "${entry.name}" points at a part that is not in the package.`, {
        part: entry.part,
      });
    }
    return { name: entry.name, state: entry.state, rows: readSheetRows(xml, context, entry.part) };
  });
  const warnings: string[] = [];
  if (context.outOfRange.count > 0) {
    const { count, first } = context.outOfRange;
    warnings.push(
      `${count} ${count === 1 ? 'cell has' : 'cells have'} a date format but ${count === 1 ? 'holds' : 'hold'} a number no date can be made from (the first is ${first}), so ${count === 1 ? 'it is' : 'they are'} shown as stored.`,
    );
  }
  return { sheets, date1904: info.date1904, warnings };
}

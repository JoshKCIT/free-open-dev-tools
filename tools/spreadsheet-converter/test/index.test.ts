import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  MAX_FILE_BYTES,
  MAX_UNZIPPED_BYTES,
  SpreadsheetConverterError,
  checkFileSize,
  convertSpreadsheet,
  meta as toolMeta,
  parseTextTable,
  pickSheet,
  readXlsx,
  serialToIso,
  sheetToText,
  writeXlsx,
  type Cell,
  type Sheet,
  type TableCell,
} from '../src/index';
import { builtInFormatClass, customFormatClass, tryDate } from '../src/dates';

/*
 * Grounding (D-179, P13-08). The package structure is ECMA-376 Part 1 (SpreadsheetML): a zip with
 * [Content_Types].xml, _rels/.rels, xl/workbook.xml, xl/_rels/workbook.xml.rels and one xl/worksheets/sheet1.xml;
 * the cell types b, d, e, inlineStr, n, s and str come from Microsoft's published CellValues reference
 * (https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.cellvalues), and the 1900 leap-day
 * quirk (serial 60 is the compatibility day 1900-02-29) from Microsoft's support article "Excel incorrectly assumes
 * that the year 1900 is a leap year" (https://learn.microsoft.com/en-us/office/troubleshoot/excel/wrongly-assumes-1900-is-leap-year).
 *
 * Independent second opinions, each run by the executor and quoted as literals here:
 *  - openpyxl 3.1.5 (Python 3.14.3): test/fixtures/make-fixtures.py check <file> opens a file with openpyxl and prints
 *    every cell's value and type; the values quoted for tool-output.xlsx are what it printed.
 *  - XlsxWriter 3.2.9 and openpyxl 3.1.5 WROTE the three other committed fixtures (make-fixtures.py write). Their
 *    expected cells below are the literals typed in that script, what each writer was asked to store, never read back
 *    from this folder's reader.
 *  - Python datetime (3.14.3): every date serial below is (date - date(1899, 12, 30)).days for the 1900 system and
 *    (date - date(1904, 1, 1)).days for the 1904 system, which Python printed: 2020-01-31 is 43861 and 42399,
 *    2024-02-29 is 45351 and 43889, 9999-12-31 is 2958465 and 2957003, 1900-03-01 is 61, 1900-02-28 is 59 (the
 *    pre-leap-day count) and 8:30 is 0.3541666666666667 of a day.
 *
 * Differences between a second opinion and the specification are recorded where they occur: openpyxl returns the escape
 * text for an inline string and turns serial 60 into 1900-02-28; the specification and Excel say otherwise, and this
 * package follows the specification.
 */

const here = (name: string): string => fileURLToPath(new URL(name, import.meta.url));
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(here(`./fixtures/${name}`)));
const MIB = 1048576;
const OPTIONS = { header: true, keepTypes: false };

let consoleSpies: ReturnType<typeof vi.spyOn>[];

// The package must print nothing of its own: a visitor's page console stays empty (D-177).
beforeEach(() => {
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  for (const spy of consoleSpies) spy.mockRestore();
});

/** The cell as a plain value: a number as a number, a boolean as a boolean, text as text, an empty cell as null. */
function plain(cell: Cell | undefined): string | number | boolean | null {
  if (cell === undefined || cell.kind === 'empty') return null;
  if (cell.kind === 'number') return Number(cell.text);
  if (cell.kind === 'boolean') return cell.text === 'TRUE';
  return cell.text;
}

/** Each row of a sheet as [kind, text] pairs. */
function snapshot(sheet: Sheet): [string, string][][] {
  return sheet.rows.map((row) => row.map((cell): [string, string] => [cell.kind, cell.text]));
}

/** The error a call throws, so a test can read its message and its cell. */
function thrown(fn: () => unknown): SpreadsheetConverterError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(SpreadsheetConverterError);
    return err as SpreadsheetConverterError;
  }
  throw new Error('expected the call to throw');
}

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

interface Extra {
  sharedStrings?: string;
  styles?: string;
  workbook?: string;
}

/** The XML parts of a one-sheet package around hand-written sheet XML. */
function partsOf(sheetXml: string, extra: Extra = {}): Record<string, string> {
  const rels = [`<Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/>`];
  if (extra.sharedStrings) {
    rels.push(`<Relationship Id="rId2" Type="${REL_NS}/sharedStrings" Target="sharedStrings.xml"/>`);
  }
  if (extra.styles) rels.push(`<Relationship Id="rId3" Type="${REL_NS}/styles" Target="styles.xml"/>`);
  const parts: Record<string, string> = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
    '_rels/.rels': `<Relationships xmlns="${PKG_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml':
      extra.workbook ??
      `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${PKG_NS}">${rels.join('')}</Relationships>`,
    'xl/worksheets/sheet1.xml': sheetXml,
  };
  if (extra.sharedStrings) parts['xl/sharedStrings.xml'] = extra.sharedStrings;
  if (extra.styles) parts['xl/styles.xml'] = extra.styles;
  return parts;
}

function bytesOf(parts: Record<string, string>): Record<string, Uint8Array> {
  return Object.fromEntries(Object.entries(parts).map(([name, text]) => [name, strToU8(text)]));
}

/** A one-sheet package built from hand-written sheet XML, so a test controls every byte the reader sees. */
function xlsxFrom(sheetXml: string, extra: Extra = {}): Uint8Array {
  return zipSync(bytesOf(partsOf(sheetXml, extra)), { level: 1 });
}

const sheetXmlOf = (cells: string): string =>
  `<worksheet xmlns="${MAIN_NS}"><sheetData>${cells}</sheetData></worksheet>`;

/** Sets the uncompressed size the central directory of a zip declares for one entry (what a lying header does). */
function understateSize(zip: Uint8Array, entryName: string, declared: number): void {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let at = 0; at + 46 <= zip.length; at++) {
    if (view.getUint32(at, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(at + 28, true);
    const name = strFromU8(zip.subarray(at + 46, at + 46 + nameLength));
    if (name === entryName) {
      view.setUint32(at + 24, declared, true);
      return;
    }
  }
  throw new Error(`no entry ${entryName}`);
}

/** A sheet read back from rows the writer wrote. */
function sheetOf(rows: TableCell[][], detectTypes = false): Sheet {
  const written = writeXlsx(rows, { sheetName: 'S', detectTypes });
  return readXlsx(written.bytes, { datesAsSerials: false }).sheets[0]!;
}

/** What the writer is asked to store: text, numbers, a boolean, spaces, a leading zero, non-ASCII, line breaks. */
const FIXED_ROWS: TableCell[][] = [
  ['name', 'age', 'member', 'padded', 'code', 'sci', 'intl', 'multi', 'ctrl'],
  ['Ada', '36', 'TRUE', '  spaced  ', '00123', '1e3', 'é€漢', 'line1\nline2', 'a\u0001b'],
  ['Bo, "Q"', '-5.25', 'FALSE', '', '12345678901234567', '-0', '😀', 'tab\there', 'cr\rlf'],
];

it('CSV text becomes an xlsx package whose parts SpreadsheetML needs, read back to the same cells', () => {
  const parsed = parseTextTable('a,b\r\n1,2', 'csv');
  expect(parsed.warnings).toEqual([]);
  const written = writeXlsx(parsed.rows, { sheetName: 'Sheet1', detectTypes: true });

  // ECMA-376 Part 1: the package parts a one-sheet workbook needs, with the content types part first.
  const parts = unzipSync(written.bytes);
  expect(Object.keys(parts)).toEqual([
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/worksheets/sheet1.xml',
  ]);
  const sheetXml = strFromU8(parts['xl/worksheets/sheet1.xml']!);
  // CellValues: text is an inline string (inlineStr), a number is the default type (n) with its value in <v>.
  expect(sheetXml).toContain('<c r="A1" t="inlineStr"><is><t xml:space="preserve">a</t></is></c>');
  expect(sheetXml).toContain('<c r="A2"><v>1</v></c>');
  expect(strFromU8(parts['xl/workbook.xml']!)).toContain('<sheet name="Sheet1" sheetId="1" r:id="rId1"/>');
  expect(written.preview).toEqual([
    { ref: 'A1', value: 'a', type: 'inlineStr' },
    { ref: 'B1', value: 'b', type: 'inlineStr' },
    { ref: 'A2', value: '1', type: 'n' },
    { ref: 'B2', value: '2', type: 'n' },
  ]);
  expect(written.cellCount).toBe(4);

  const workbook = readXlsx(written.bytes, { datesAsSerials: false });
  expect(workbook.sheets.map((sheet) => [sheet.name, sheet.state])).toEqual([['Sheet1', 'visible']]);
  expect(workbook.sheets[0]!.rows).toEqual([
    [
      { kind: 'string', text: 'a', ref: 'A1' },
      { kind: 'string', text: 'b', ref: 'B1' },
    ],
    [
      { kind: 'number', text: '1', ref: 'A2' },
      { kind: 'number', text: '2', ref: 'B2' },
    ],
  ]);
  expect(consoleSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
});

it('the writer output for the fixed input is byte for byte the committed file openpyxl re-read', () => {
  // test/fixtures/tool-output.xlsx is the writer's output for FIXED_ROWS (detect types on, sheet name Sheet1). openpyxl
  // 3.1.5 re-read it (make-fixtures.py check) to these (data type, value) pairs, row by row. 's' is a string, 'n' a
  // number and 'b' a boolean; an empty field has no cell, so openpyxl shows None.
  const OPENPYXL_REREAD = [
    [
      ['s', 'name'],
      ['s', 'age'],
      ['s', 'member'],
      ['s', 'padded'],
      ['s', 'code'],
      ['s', 'sci'],
      ['s', 'intl'],
      ['s', 'multi'],
      ['s', 'ctrl'],
    ],
    [
      ['s', 'Ada'],
      ['n', 36],
      ['b', true],
      ['s', '  spaced  '],
      ['s', '00123'],
      ['n', 1000],
      ['s', 'é€漢'],
      ['s', 'line1\nline2'],
      ['s', 'a_x0001_b'],
    ],
    [
      ['s', 'Bo, "Q"'],
      ['n', -5.25],
      ['b', false],
      [null, null],
      ['s', '12345678901234567'],
      ['s', '-0'],
      ['s', '😀'],
      ['s', 'tab\there'],
      ['s', 'cr_x000D_lf'],
    ],
  ];

  const committed = readFileSync(here('./fixtures/tool-output.xlsx'));
  const written = writeXlsx(FIXED_ROWS, { sheetName: 'Sheet1', detectTypes: true });
  expect(Buffer.compare(Buffer.from(written.bytes), committed)).toBe(0);

  // Reading the committed file with this package gives openpyxl's values, with one difference that is openpyxl's, not
  // ours: for an inline string it returns the escape text as stored (a_x0001_b) and does not apply the ECMA-376
  // ST_Xstring rule that _xHHHH_ stands for the character U+HHHH, which Excel does apply. Those two cells are compared
  // with the character the escape names.
  const DECODED: Record<string, string> = { a_x0001_b: 'a\u0001b', cr_x000D_lf: 'cr\rlf' };
  const expected = OPENPYXL_REREAD.map((row) =>
    row.map(([, value]) => (typeof value === 'string' && value in DECODED ? DECODED[value]! : value)),
  );
  const rows = readXlsx(new Uint8Array(committed), { datesAsSerials: false }).sheets[0]!.rows;
  expect(rows.map((row) => OPENPYXL_REREAD[0]!.map((_, i) => plain(row[i])))).toEqual(expected);
  expect(rows.map((row) => OPENPYXL_REREAD[0]!.map((_, i) => row[i]?.kind ?? 'empty'))).toEqual(
    OPENPYXL_REREAD.map((row) =>
      row.map(([type]) => (type === 's' ? 'string' : type === 'n' ? 'number' : type === 'b' ? 'boolean' : 'empty')),
    ),
  );
});

it('meta pins fflate 0.8.3 exactly', () => {
  expect(toolMeta.dependencies).toEqual({ fflate: '0.8.3' });
});

it('openpyxl People sheet: every cell reads as written, including spaces, 00123, 1e3 and non-ASCII text', () => {
  // openpyxl-people.xlsx was written by make-fixtures.py (openpyxl 3.1.5). Expected cells are the script's inputs:
  // Ada, 36, date(2020, 1, 31), True, 98.5, "00123"; 'Bo, "Q"', None, datetime(2021, 6, 1, 13, 45, 30), False,
  // 0.3333333333333333, "1e3", "line1\nline2"; Cy, 9007199254740992, time(8, 30, 0), True, -0.0, "  spaced  ", "é€漢".
  const workbook = readXlsx(fixture('openpyxl-people.xlsx'), { datesAsSerials: false });
  expect(workbook.date1904).toBe(false);
  const people = workbook.sheets[0]!;
  expect(people.name).toBe('People');
  expect(snapshot(people)).toEqual([
    [
      ['string', 'name'],
      ['string', 'count'],
      ['string', 'when'],
      ['string', 'flag'],
      ['string', 'ratio'],
      ['string', 'code'],
      ['string', 'note'],
    ],
    [
      ['string', 'Ada'],
      ['number', '36'],
      ['date', '2020-01-31'],
      ['boolean', 'TRUE'],
      ['number', '98.5'],
      ['string', '00123'],
    ],
    [
      ['string', 'Bo, "Q"'],
      ['empty', ''],
      ['date', '2021-06-01T13:45:30'],
      ['boolean', 'FALSE'],
      ['number', '0.3333333333333333'],
      ['string', '1e3'],
      ['string', 'line1\nline2'],
    ],
    [
      ['string', 'Cy'],
      ['number', '9007199254740992'],
      ['date', '08:30:00'],
      ['boolean', 'TRUE'],
      ['number', '-0'],
      ['string', '  spaced  '],
      ['string', 'é€漢'],
    ],
  ]);
  expect(people.rows[1]![2]!.ref).toBe('C2');
  expect(people.rows[3]![6]!.ref).toBe('G4');
  // The same rows through the CSV writer keep every space and character.
  expect(sheetToText(people, 'csv', OPTIONS).text).toBe(
    [
      'name,count,when,flag,ratio,code,note',
      'Ada,36,2020-01-31,TRUE,98.5,00123,',
      '"Bo, ""Q""",,2021-06-01T13:45:30,FALSE,0.3333333333333333,1e3,"line1\nline2"',
      'Cy,9007199254740992,08:30:00,TRUE,-0,  spaced  ,é€漢',
    ].join('\r\n'),
  );
});

it('XlsxWriter Sales sheet: shared strings, rich text, a cached formula, an error, percent and date formats read as written', () => {
  // xlsxwriter-sales.xlsx was written by make-fixtures.py (XlsxWriter 3.2.9). Expected cells are the script's inputs:
  // 'Widget'; datetime(2024, 2, 29) as dd/mm/yyyy; datetime(2024, 1, 1, 8, 30) as yyyy-mm-dd hh:mm:ss; 0.125 as 0.0%;
  // True; the formula =1+2 with cached value 3; =1/0 with cached "#DIV/0!"; a rich string Bold, " plain ", italic more;
  // "ünï"; "007"; time(8, 30) as hh:mm:ss. Row 3: the formula CONCATENATE("a","b") cached "ab", =1=1 cached True and
  // "<b>&amp;</b>". Row 4: the numbers 59, 60 and 61 formatted dd/mm/yyyy.
  const workbook = readXlsx(fixture('xlsxwriter-sales.xlsx'), { datesAsSerials: false });
  expect(workbook.sheets.map((sheet) => sheet.name)).toEqual(['Sales']);
  expect(snapshot(workbook.sheets[0]!)).toEqual([
    [
      ['string', 'Item'],
      ['string', 'Date'],
      ['string', 'Stamp'],
      ['string', 'Rate'],
      ['string', 'Flag'],
      ['string', 'Sum'],
      ['string', 'Error'],
      ['string', 'Rich'],
      ['string', 'Text'],
      ['string', 'Plain'],
      ['string', 'Clock'],
    ],
    [
      ['string', 'Widget'],
      ['date', '2024-02-29'],
      ['date', '2024-01-01T08:30:00'],
      ['number', '0.125'],
      ['boolean', 'TRUE'],
      ['number', '3'],
      ['error', '#DIV/0!'],
      ['string', 'Bold plain more'],
      ['string', 'ünï'],
      ['string', '007'],
      ['date', '08:30:00'],
    ],
    [
      ['string', 'Widget'],
      ['empty', ''],
      ['empty', ''],
      ['empty', ''],
      ['boolean', 'TRUE'],
      ['string', 'ab'],
      ['empty', ''],
      ['empty', ''],
      ['string', '<b>&amp;</b>'],
    ],
    [
      ['string', 'Serials'],
      ['date', '1900-02-28'],
      ['date', '1900-02-29'],
      ['date', '1900-03-01'],
    ],
  ]);
});

it('dates follow the 1900 system with its leap-day quirk and the 1904 system, and can be shown as serial numbers', () => {
  // 1900 system: serial 1 is 1900-01-01, serial 60 is the compatibility day 1900-02-29 (Microsoft), and from 61 the day
  // is 1899-12-30 plus the serial (Python datetime printed 61, 43861, 45351 and 2958465 for these dates).
  const IN_1900: [string, string][] = [
    ['1', '1900-01-01'],
    ['59', '1900-02-28'],
    ['60', '1900-02-29'],
    ['61', '1900-03-01'],
    ['43861', '2020-01-31'],
    ['45351', '2024-02-29'],
    ['2958465', '9999-12-31'],
  ];
  for (const [serial, iso] of IN_1900) expect(serialToIso(serial, false)).toBe(iso);
  // 1904 system: serial 0 is 1904-01-01 (Python printed 42399, 43889 and 2957003).
  const IN_1904: [string, string][] = [
    ['0', '1904-01-01'],
    ['42399', '2020-01-31'],
    ['43889', '2024-02-29'],
    ['2957003', '9999-12-31'],
  ];
  for (const [serial, iso] of IN_1904) expect(serialToIso(serial, true)).toBe(iso);
  expect(serialToIso('43861.5', false)).toBe('2020-01-31T12:00:00');
  expect(serialToIso('0', false)).toBe('1900-01-00');
  // Text that is no date serial, or a serial past 9999-12-31 or below 0, is refused.
  for (const bad of ['', 'abc', '-1', '2958466', '1e400']) {
    expect(() => serialToIso(bad, false)).toThrow(SpreadsheetConverterError);
  }
  expect(() => serialToIso('2957004', true)).toThrow(SpreadsheetConverterError);

  // Files: the 1904 fixture (openpyxl 3.1.5, epoch 1904) holds date(2020, 1, 31), date(1904, 1, 1) and
  // datetime(2000, 2, 29, 12, 0, 0); Python printed 42399, 0 and 35123.5 for them in that system.
  const mac = readXlsx(fixture('openpyxl-date1904.xlsx'), { datesAsSerials: false });
  expect(mac.date1904).toBe(true);
  expect(snapshot(mac.sheets[0]!)[1]).toEqual([
    ['date', '2020-01-31'],
    ['date', '1904-01-01'],
    ['date', '2000-02-29T12:00:00'],
  ]);
  const macSerials = readXlsx(fixture('openpyxl-date1904.xlsx'), { datesAsSerials: true });
  expect(snapshot(macSerials.sheets[0]!)[1]).toEqual([
    ['number', '42399'],
    ['number', '0'],
    ['number', '35123.5'],
  ]);

  // With dates as serial numbers on, a date cell shows exactly the number the file stores.
  const salesSerials = readXlsx(fixture('xlsxwriter-sales.xlsx'), { datesAsSerials: true }).sheets[0]!;
  expect(snapshot(salesSerials)[1]!.slice(1, 4)).toEqual([
    ['number', '45351'],
    ['number', '45292.35416666666'],
    ['number', '0.125'],
  ]);
  expect(snapshot(salesSerials)[3]!.slice(1)).toEqual([
    ['number', '59'],
    ['number', '60'],
    ['number', '61'],
  ]);
  const peopleSerials = readXlsx(fixture('openpyxl-people.xlsx'), { datesAsSerials: true }).sheets[0]!;
  expect(snapshot(peopleSerials).map((row) => row[2]?.[1])).toEqual([
    'when',
    '43861',
    '44348.57326388889',
    '0.3541666666666667',
  ]);
});

it('a very long cell text that is not a date serial is refused at once, not after a quadratic regex scan', () => {
  // 80,000 digits and then a letter kept the old pattern busy for about 15 seconds; a serial is never this long.
  const started = performance.now();
  expect(tryDate('9'.repeat(80_000) + 'x', false)).toBeNull();
  expect(tryDate('9'.repeat(80_000), false)).toBeNull();
  expect(tryDate('1.' + '0'.repeat(80_000) + 'x', true, true)).toBeNull();
  expect(performance.now() - started).toBeLessThan(2000);
  // Ordinary serials and near misses are unchanged.
  expect(tryDate('43861', false)).toBe('2020-01-31');
  expect(tryDate('43861.', false)).toBe('2020-01-31');
  expect(tryDate('.5', false)).toBe('12:00:00');
  expect(tryDate('4.3861E4', false)).toBe('2020-01-31');
  expect(tryDate('43861x', false)).toBeNull();
  expect(tryDate('1.5.5', false)).toBeNull();
  expect(tryDate('.', false)).toBeNull();
  expect(tryDate('e5', false)).toBeNull();
}, 60_000);

it('a time-only serial below 1 shows as a time of day', () => {
  // 8:30 is 0.3541666666666667 of a day (Python: 30600 / 86400). A value below 1 is a time of day, never a date.
  expect(serialToIso('0.3541666666666667', false)).toBe('08:30:00');
  expect(serialToIso('0.5', false)).toBe('12:00:00');
  expect(serialToIso('0.3541666666666667', true)).toBe('08:30:00');
  // A format that holds only a time makes a value of exactly 0 midnight, and a value past 1 a date and a time.
  expect(tryDate('0', false, true)).toBe('00:00:00');
  expect(tryDate('1.5', false, true)).toBe('1900-01-01T12:00:00');
  expect(tryDate('2', false, true)).toBe('1900-01-02T00:00:00');
  // The fixtures: openpyxl wrote time(8, 30, 0) as h:mm:ss and XlsxWriter wrote time(8, 30) as hh:mm:ss.
  const people = readXlsx(fixture('openpyxl-people.xlsx'), { datesAsSerials: false }).sheets[0]!;
  expect(people.rows[3]![2]).toEqual({ kind: 'date', text: '08:30:00', ref: 'C4' });
  const sales = readXlsx(fixture('xlsxwriter-sales.xlsx'), { datesAsSerials: false }).sheets[0]!;
  expect(sales.rows[1]![10]).toEqual({ kind: 'date', text: '08:30:00', ref: 'K2' });
});

it('hidden sheets are listed with their state and can be chosen by name or by number', () => {
  // openpyxl-people.xlsx holds People (visible), "Hidden data" (sheet_state hidden) and "Very hidden" (veryHidden), as
  // typed in make-fixtures.py.
  const workbook = readXlsx(fixture('openpyxl-people.xlsx'), { datesAsSerials: false });
  expect(workbook.sheets.map((sheet) => [sheet.name, sheet.state])).toEqual([
    ['People', 'visible'],
    ['Hidden data', 'hidden'],
    ['Very hidden', 'veryHidden'],
  ]);
  expect(pickSheet(workbook, '').name).toBe('People');
  expect(pickSheet(workbook, '   ').name).toBe('People');
  expect(pickSheet(workbook, 'Hidden data').name).toBe('Hidden data');
  expect(pickSheet(workbook, '2').name).toBe('Hidden data');
  expect(pickSheet(workbook, ' 3 ').name).toBe('Very hidden');
  expect(snapshot(pickSheet(workbook, '2'))).toEqual([
    [
      ['string', 'secret'],
      ['number', '42'],
    ],
  ]);
  const missing = thrown(() => pickSheet(workbook, 'Nope'));
  expect(missing.message).toContain('Nope');
  expect(missing.message).toContain('People');
  expect(thrown(() => pickSheet(workbook, '4')).message).toContain('3 sheets');
  expect(thrown(() => pickSheet(workbook, '0')).message).toContain('3 sheets');

  // Reading one chosen sheet reads only its cells, and the others are listed with no rows.
  const only = readXlsx(fixture('openpyxl-people.xlsx'), { datesAsSerials: false, sheet: '2' });
  expect(only.sheets.map((sheet) => [sheet.name, sheet.state, sheet.rows.length])).toEqual([
    ['People', 'visible', 0],
    ['Hidden data', 'hidden', 1],
    ['Very hidden', 'veryHidden', 0],
  ]);
  expect(pickSheet(only, '2').rows[0]![1]!.text).toBe('42');

  // A number that is no position falls back to a sheet that has that name.
  const named = readXlsx(writeXlsx([['a']], { sheetName: '2024', detectTypes: false }).bytes, {
    datesAsSerials: false,
  });
  expect(pickSheet(named, '2024').name).toBe('2024');
  expect(pickSheet(named, '1').name).toBe('2024');
});

it('parts that would unzip past 100 MiB are refused and an understated size cannot inflate a part', () => {
  // Two parts that declare 60 MiB each: 120 MiB in all, past the limit, though the file itself is tiny.
  const bomb = zipSync(
    {
      ...bytesOf(partsOf('<worksheet/>')),
      'xl/worksheets/sheet2.xml': new Uint8Array(60 * MIB),
      'xl/worksheets/sheet3.xml': new Uint8Array(60 * MIB),
    },
    { level: 1 },
  );
  expect(bomb.length).toBeLessThan(MAX_FILE_BYTES);
  expect(thrown(() => readXlsx(bomb, { datesAsSerials: false })).message).toMatch(/100 MiB/);

  // The limit is on the sum of the declared sizes of the XML and relationship parts: exactly 100 MiB is read, one
  // byte more is refused.
  const fixedBytes = Object.values(partsOf(sheetXmlOf(''))).reduce((sum, text) => sum + strToU8(text).length, 0);
  const sheetFor = (total: number): string => {
    const base = sheetXmlOf('<row r="1"><c r="A1"><v>1</v></c></row>');
    const padding = total - fixedBytes + strToU8(sheetXmlOf('')).length - strToU8(base).length;
    return base.replace('</sheetData>', `</sheetData>${' '.repeat(padding)}`);
  };
  const exact = readXlsx(xlsxFrom(sheetFor(MAX_UNZIPPED_BYTES)), { datesAsSerials: false });
  expect(snapshot(exact.sheets[0]!)).toEqual([[['number', '1']]]);
  expect(thrown(() => readXlsx(xlsxFrom(sheetFor(MAX_UNZIPPED_BYTES + 1)), { datesAsSerials: false })).message).toMatch(
    /100 MiB/,
  );

  // A header that understates a part's size: fflate cuts the part at the declared size, never inflating past it, and
  // a sheet cut short is reported, not read as if it were whole.
  const cells = Array.from({ length: 2000 }, (_, i) => `<c r="A${i + 1}"><v>${i}</v></c>`).join('');
  const lying = xlsxFrom(sheetXmlOf(`<row r="1">${cells}</row>`));
  understateSize(lying, 'xl/worksheets/sheet1.xml', 200);
  const cut = thrown(() => readXlsx(lying, { datesAsSerials: false }));
  expect(cut.message).toMatch(/cut short/);
  expect(cut.part).toBe('xl/worksheets/sheet1.xml');
  // Builds and zips more than 100 MiB of cells: under the full suite's parallel load this takes longer than the
  // default 5 seconds (it timed out on CI), so it gets its own limit.
}, 60_000);

it('a file over 20 MiB is refused before it is unzipped and exactly 20 MiB is accepted', () => {
  expect(MAX_FILE_BYTES).toBe(20971520);
  expect(() => checkFileSize(20971520)).not.toThrow();
  const refused = thrown(() => checkFileSize(20971521));
  expect(refused.message).toBe(
    'This file is 20.0 MiB (20,971,521 bytes). The limit is 20 MiB because the whole workbook is unpacked in memory.',
  );
  // Zeros are no zip, so a read that got as far as unzipping would say so: the size message proves the order.
  const over = thrown(() => readXlsx(new Uint8Array(20971521), { datesAsSerials: false }));
  expect(over.message).toMatch(/limit is 20 MiB/);
  const exact = thrown(() => readXlsx(new Uint8Array(20971520), { datesAsSerials: false }));
  expect(exact.message).toMatch(/not an \.xlsx file/);
  expect(exact.message).not.toMatch(/limit/);
});

it('a file that is not an xlsx package is refused with a plain message', () => {
  const notZip = thrown(() => readXlsx(strToU8('just some text'), { datesAsSerials: false }));
  expect(notZip.message).toBe('This file could not be opened as a zip package, so it is not an .xlsx file.');
  expect(thrown(() => readXlsx(new Uint8Array(0), { datesAsSerials: false })).message).toMatch(/not an \.xlsx file/);
  // A zip with no workbook part: an OpenDocument spreadsheet is one (a mimetype and a content part).
  const ods = zipSync({
    mimetype: strToU8('application/vnd.oasis.opendocument.spreadsheet'),
    'content.xml': strToU8('<x/>'),
  });
  expect(thrown(() => readXlsx(ods, { datesAsSerials: false })).message).toBe(
    'This zip file is not an Excel workbook: it has no workbook part.',
  );
  // The signature of the older Office file format, which also holds a password-protected workbook.
  const older = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
  expect(thrown(() => readXlsx(older, { datesAsSerials: false })).message).toBe(
    'This is an older Office file or a password-protected one. Only .xlsx files that are not password-protected can be read.',
  );
  // A workbook that lists a sheet whose part is missing.
  const withoutSheet = bytesOf(partsOf('<worksheet/>'));
  delete withoutSheet['xl/worksheets/sheet1.xml'];
  expect(thrown(() => readXlsx(zipSync(withoutSheet), { datesAsSerials: false })).message).toContain('"S"');
});

it('TSV output refuses a cell holding a tab or a line break and names the cell', () => {
  // IANA text/tab-separated-values: one record per line, fields separated by a tab, and a field cannot hold a tab.
  expect(
    sheetToText(
      sheetOf([
        ['a', 'b'],
        ['1', '2'],
      ]),
      'tsv',
      OPTIONS,
    ),
  ).toEqual({ text: 'a\tb\n1\t2', warnings: [] });
  for (const value of ['x\ty', 'x\ny', 'x\rz']) {
    const err = thrown(() =>
      sheetToText(
        sheetOf([
          ['a', 'b'],
          ['1', value],
        ]),
        'tsv',
        OPTIONS,
      ),
    );
    expect(err.cell).toBe('B2');
    expect(err.message).toContain('B2');
    expect(err.message).toMatch(/tab or line break/);
  }
  // CSV carries the same cell, quoted (RFC 4180).
  expect(
    sheetToText(
      sheetOf([
        ['a', 'b'],
        ['1', 'x\ty'],
      ]),
      'csv',
      OPTIONS,
    ).text,
  ).toBe('a,b\r\n1,x\ty');
  expect(
    sheetToText(
      sheetOf([
        ['a', 'b'],
        ['1', 'x\ny'],
      ]),
      'csv',
      OPTIONS,
    ).text,
  ).toBe('a,b\r\n1,"x\ny"');
});

it('XML output uses a fixed structure so no cell text becomes an element name', () => {
  const sheet = readXlsx(
    writeXlsx(
      [
        ['<script>', 'a&b'],
        ['1', 'TRUE'],
      ],
      { sheetName: 'A "1" <x> & y', detectTypes: true },
    ).bytes,
    { datesAsSerials: false },
  ).sheets[0]!;
  expect(sheetToText(sheet, 'xml', OPTIONS)).toEqual({
    text: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<workbook>',
      '  <sheet name="A &quot;1&quot; &lt;x&gt; &amp; y">',
      '    <row n="1">',
      '      <cell ref="A1" type="string">&lt;script&gt;</cell>',
      '      <cell ref="B1" type="string">a&amp;b</cell>',
      '    </row>',
      '    <row n="2">',
      '      <cell ref="A2" type="number">1</cell>',
      '      <cell ref="B2" type="boolean">TRUE</cell>',
      '    </row>',
      '  </sheet>',
      '</workbook>',
      '',
    ].join('\n'),
    warnings: [],
  });
  // Text that looks like markup stays text: the Sales fixture holds <b>&amp;</b> (typed in make-fixtures.py).
  const sales = readXlsx(fixture('xlsxwriter-sales.xlsx'), { datesAsSerials: false }).sheets[0]!;
  const salesXml = sheetToText(sales, 'xml', OPTIONS).text;
  expect(salesXml).toContain('<cell ref="I3" type="string">&lt;b&gt;&amp;amp;&lt;/b&gt;</cell>');
  expect(salesXml).toContain('<cell ref="G2" type="error">#DIV/0!</cell>');
  expect(salesXml).toContain('<cell ref="B2" type="date">2024-02-29</cell>');
  // Empty cells are left out.
  expect(salesXml).not.toContain('ref="B3"');
  // A control character XML 1.0 cannot carry is written as the escape a spreadsheet uses, with a warning.
  const control = sheetToText(sheetOf([['a\u0001b']]), 'xml', OPTIONS);
  expect(control.text).toContain('<cell ref="A1" type="string">a_x0001_b</cell>');
  expect(control.warnings).toHaveLength(1);
  expect(control.warnings[0]).toMatch(/XML 1\.0/);
});

it('JSON output never writes two keys of one name when a renamed header meets a header that already has that name', () => {
  // a, a, a_2: the second a cannot become a_2, because the third column is already called that.
  const sheet = sheetOf([
    ['a', 'a', 'a_2'],
    ['1', '2', '3'],
  ]);
  const text = sheetToText(sheet, 'json', { header: true, keepTypes: false });
  const keys = [...text.text.matchAll(/^ {4}"([^"]*)":/gm)].map((match) => match[1]);
  expect(keys).toEqual(['a', 'a_3', 'a_2']);
  expect(JSON.parse(text.text)).toEqual([{ a: '1', a_3: '2', a_2: '3' }]);
  expect(text.warnings).toEqual([
    'Column 2\'s header "a" duplicates an earlier column, so it was renamed "a_3" in the JSON output.',
  ]);

  // The empty-header name column_2 is also kept apart from a header that is already called column_2, and a
  // header repeated three times keeps counting.
  const mixed = sheetOf([
    ['column_2', '', 'x', 'x', 'x', 'x_2'],
    ['1', '2', '3', '4', '5', '6'],
  ]);
  const mixedKeys = [
    ...sheetToText(mixed, 'json', { header: true, keepTypes: false }).text.matchAll(/^ {4}"([^"]*)":/gm),
  ].map((match) => match[1]);
  expect(new Set(mixedKeys).size).toBe(mixedKeys.length);
  expect(mixedKeys).toHaveLength(6);
  expect(mixedKeys[2]).toBe('x');
  expect(mixedKeys[5]).toBe('x_2');
});

it('JSON output renames empty and repeated headers with a warning and keeps strings unless keep types is on', () => {
  const sheet = sheetOf(
    [
      ['name', '', 'name', 'name', '', 'id'],
      ['Ada', 'x', '1', 'TRUE', '', '007'],
      ['Bo', '', '2.5', 'FALSE', 'y', '12'],
    ],
    true,
  );
  const asText = sheetToText(sheet, 'json', { header: true, keepTypes: false });
  expect(JSON.parse(asText.text)).toEqual([
    { name: 'Ada', column_2: 'x', name_2: '1', name_3: 'TRUE', column_5: '', id: '007' },
    { name: 'Bo', column_2: '', name_2: '2.5', name_3: 'FALSE', column_5: 'y', id: '12' },
  ]);
  expect(asText.warnings).toEqual([
    'Column 2 has no header text, so it was named "column_2" in the JSON output.',
    'Column 3\'s header "name" duplicates an earlier column, so it was renamed "name_2" in the JSON output.',
    'Column 4\'s header "name" duplicates an earlier column, so it was renamed "name_3" in the JSON output.',
    'Column 5 has no header text, so it was named "column_5" in the JSON output.',
  ]);
  expect(asText.text.startsWith('[\n  {\n    "name": "Ada",')).toBe(true);

  const typed = sheetToText(sheet, 'json', { header: true, keepTypes: true });
  expect(JSON.parse(typed.text)).toEqual([
    { name: 'Ada', column_2: 'x', name_2: 1, name_3: true, column_5: null, id: '007' },
    { name: 'Bo', column_2: null, name_2: 2.5, name_3: false, column_5: 'y', id: 12 },
  ]);

  const rows = sheetToText(sheet, 'json', { header: false, keepTypes: false });
  expect(JSON.parse(rows.text)).toEqual([
    ['name', '', 'name', 'name', '', 'id'],
    ['Ada', 'x', '1', 'TRUE', '', '007'],
    ['Bo', '', '2.5', 'FALSE', 'y', '12'],
  ]);
  expect(rows.warnings).toEqual([]);
  expect(JSON.parse(sheetToText(sheet, 'json', { header: false, keepTypes: true }).text)[1]).toEqual([
    'Ada',
    'x',
    1,
    true,
    null,
    '007',
  ]);

  // Numbers keep the digits the file stores: 2 to the 53 and negative zero are written as the file has them.
  const people = readXlsx(fixture('openpyxl-people.xlsx'), { datesAsSerials: false }).sheets[0]!;
  const peopleJson = sheetToText(people, 'json', { header: true, keepTypes: true }).text;
  expect(peopleJson).toContain('"count": 9007199254740992,');
  expect(peopleJson).toContain('"ratio": -0,');
  expect(peopleJson).toContain('"ratio": 0.3333333333333333,');
  expect(JSON.parse(peopleJson)[0]).toEqual({
    name: 'Ada',
    count: 36,
    when: '2020-01-31',
    flag: true,
    ratio: 98.5,
    code: '00123',
    note: null,
  });
  // The Sales fixture: dates stay ISO text, an error stays text, an empty cell is null.
  const sales = readXlsx(fixture('xlsxwriter-sales.xlsx'), { datesAsSerials: false }).sheets[0]!;
  expect(JSON.parse(sheetToText(sales, 'json', { header: true, keepTypes: true }).text)[0]).toEqual({
    Item: 'Widget',
    Date: '2024-02-29',
    Stamp: '2024-01-01T08:30:00',
    Rate: 0.125,
    Flag: true,
    Sum: 3,
    Error: '#DIV/0!',
    Rich: 'Bold plain more',
    Text: 'ünï',
    Plain: '007',
    Clock: '08:30:00',
  });

  // An integer beyond 2 to the 53 would be rounded by a JSON reader, so it is written as a string, with a warning.
  const big = readXlsx(
    xlsxFrom(
      sheetXmlOf(
        '<row r="1"><c r="A1" t="inlineStr"><is><t>n</t></is></c></row><row r="2"><c r="A2"><v>12345678901234567890</v></c></row>',
      ),
    ),
    { datesAsSerials: false },
  ).sheets[0]!;
  const bigJson = sheetToText(big, 'json', { header: true, keepTypes: true });
  expect(JSON.parse(bigJson.text)).toEqual([{ n: '12345678901234567890' }]);
  expect(bigJson.warnings).toEqual([
    'Cell A2 holds 12345678901234567890, more than 2 to the 53, so it is written as a JSON string; a JSON reader would round it.',
  ]);
});

it('digit strings with a leading zero or more than 15 digits stay text in the written file', () => {
  const inputs = [
    '00123',
    '0',
    '0.5',
    '1234567890123456',
    '123456789012345',
    '-0',
    '1e3',
    '+5',
    '.5',
    '5.',
    '1e400',
    '1e-400',
    '0123.5',
    'TRUE',
    'true',
    'FALSE',
    '36',
    '-5.25',
  ];
  const written = writeXlsx([inputs], { sheetName: 'S', detectTypes: true });
  expect(written.preview.map((cell) => [cell.value, cell.type])).toEqual([
    ['00123', 'inlineStr'],
    ['0', 'n'],
    ['0.5', 'n'],
    ['1234567890123456', 'inlineStr'],
    ['123456789012345', 'n'],
    ['-0', 'inlineStr'],
    ['1e3', 'n'],
    ['+5', 'inlineStr'],
    ['.5', 'inlineStr'],
    ['5.', 'inlineStr'],
    ['1e400', 'inlineStr'],
    ['1e-400', 'inlineStr'],
    ['0123.5', 'inlineStr'],
    ['TRUE', 'b'],
    ['true', 'inlineStr'],
    ['FALSE', 'b'],
    ['36', 'n'],
    ['-5.25', 'n'],
  ]);
  // The text kept as text reads back with every digit.
  const back = readXlsx(written.bytes, { datesAsSerials: false }).sheets[0]!.rows[0]!;
  expect([back[0]!.text, back[3]!.text, back[5]!.text]).toEqual(['00123', '1234567890123456', '-0']);
  expect(back[0]!.kind).toBe('string');
  expect(back[1]!.kind).toBe('number');
  // With detection off every cell is text, a number and TRUE included.
  const off = writeXlsx([['36', 'TRUE', '00123']], { sheetName: 'S', detectTypes: false });
  expect(off.preview.map((cell) => cell.type)).toEqual(['inlineStr', 'inlineStr', 'inlineStr']);
});

it('a sheet name longer than 31 characters or holding a forbidden character is refused', () => {
  const rows = [['a']];
  expect(writeXlsx(rows, { sheetName: 'x'.repeat(31), detectTypes: false }).cellCount).toBe(1);
  expect(thrown(() => writeXlsx(rows, { sheetName: 'x'.repeat(32), detectTypes: false })).message).toBe(
    `Sheet name: it must be 1 to 31 characters, and "${'x'.repeat(32)}" has 32.`,
  );
  expect(thrown(() => writeXlsx(rows, { sheetName: '', detectTypes: false })).message).toMatch(/^Sheet name/);
  for (const forbidden of ['[', ']', ':', '*', '?', '/', '\\', 'a\u0001b']) {
    expect(thrown(() => writeXlsx(rows, { sheetName: `a${forbidden}b`, detectTypes: false })).message).toBe(
      'Sheet name: it cannot contain any of [ ] : * ? / \\ or a control character.',
    );
  }
  expect(thrown(() => writeXlsx(rows, { sheetName: "'Sales", detectTypes: false })).message).toMatch(/apostrophe/);
  expect(thrown(() => writeXlsx(rows, { sheetName: "Sales'", detectTypes: false })).message).toMatch(/apostrophe/);
  // Characters that are allowed, and are escaped in the workbook part.
  const odd = writeXlsx(rows, { sheetName: 'A & "B" <C>', detectTypes: false });
  expect(strFromU8(unzipSync(odd.bytes)['xl/workbook.xml']!)).toContain(
    '<sheet name="A &amp; &quot;B&quot; &lt;C&gt;" sheetId="1" r:id="rId1"/>',
  );
  expect(readXlsx(odd.bytes, { datesAsSerials: false }).sheets[0]!.name).toBe('A & "B" <C>');
});

it('control characters are written as x escapes and read back', () => {
  // ECMA-376 ST_Xstring: _xHHHH_ stands for the UTF-16 unit HHHH, and _x005F_ is a literal underscore, so a text that
  // really holds _x0041_ is written _x005F_x0041_.
  const texts = ['a\u0001b', 'cr\rlf', '_x0041_', 'tab\there', 'line\nbreak', '\uD800 lone', '😀', 'a_b_x', '\u0000'];
  const written = writeXlsx([texts], { sheetName: 'S', detectTypes: false });
  const sheetXml = strFromU8(unzipSync(written.bytes)['xl/worksheets/sheet1.xml']!);
  expect(sheetXml).toContain('<t xml:space="preserve">a_x0001_b</t>');
  expect(sheetXml).toContain('<t xml:space="preserve">cr_x000D_lf</t>');
  expect(sheetXml).toContain('<t xml:space="preserve">_x005F_x0041_</t>');
  expect(sheetXml).toContain('<t xml:space="preserve">_xD800_ lone</t>');
  expect(sheetXml).toContain('<t xml:space="preserve">_x0000_</t>');
  expect(sheetXml).toContain('<t xml:space="preserve">tab\there</t>');
  expect(sheetXml).toContain('<t xml:space="preserve">a_b_x</t>');
  expect(sheetXml).not.toContain('\u0001');
  const back = readXlsx(written.bytes, { datesAsSerials: false }).sheets[0]!.rows[0]!;
  expect(back.map((cell) => cell.text)).toEqual(texts);
});

it('TSV input needs the same number of fields on every line and names the line that differs', () => {
  expect(parseTextTable('a\tb\n1\t2\n', 'tsv')).toEqual({
    rows: [
      ['a', 'b'],
      ['1', '2'],
    ],
    warnings: [],
  });
  // CRLF and a lone CR end a line too, a quote is an ordinary character (no quoting exists in TSV), and the last line
  // needs no line ending.
  expect(parseTextTable('a\tb\r\n"1"\t2', 'tsv').rows).toEqual([
    ['a', 'b'],
    ['"1"', '2'],
  ]);
  const ragged = thrown(() => parseTextTable('a\tb\n1\t2\t3\n', 'tsv'));
  expect(ragged.message).toBe(
    'Line 2 has 3 fields but line 1 has 2. Every line of a TSV file must have the same number of fields.',
  );
  expect(ragged.line).toBe(2);
  // A blank line in the middle is a line with one field, so it is refused too.
  expect(thrown(() => parseTextTable('a\tb\n\n1\t2', 'tsv')).line).toBe(2);
  // CSV is not that strict: rows may differ in length, and an unclosed quote names its place.
  expect(parseTextTable('a,b\n1', 'csv').rows).toEqual([['a', 'b'], ['1']]);
  const unclosed = thrown(() => parseTextTable('a,b\n"1,2', 'csv'));
  expect([unclosed.line, unclosed.column]).toEqual([2, 1]);
});

it('JSON input becomes columns from the union of keys, with a nested value written as its JSON text and a warning naming its path', () => {
  const text = (value: string) => ({ kind: 'text', text: value });
  const objects = parseTextTable('[{"a":1,"b":"x"},{"b":"y","c":{"d":[1,2.50]}},{"a":true,"c":null}]', 'json');
  expect(objects.rows).toEqual([
    [text('a'), text('b'), text('c')],
    [{ kind: 'number', text: '1' }, text('x'), null],
    [null, text('y'), text('{"d":[1,2.50]}')],
    [{ kind: 'boolean', text: 'true' }, null, null],
  ]);
  expect(objects.warnings).toEqual(['The value at /1/c is nested, so it was written as its JSON text.']);
  // RFC 6901: ~ and / inside a key are escaped in the path.
  expect(parseTextTable('[{"a/b":{"c~d":[]}}]', 'json').warnings).toEqual([
    'The value at /0/a~1b is nested, so it was written as its JSON text.',
  ]);

  // An array of arrays is its rows, and a nested value inside one is named by its position.
  const arrays = parseTextTable('[["x",1],[true,null,[1]]]', 'json');
  expect(arrays.rows).toEqual([
    [text('x'), { kind: 'number', text: '1' }],
    [{ kind: 'boolean', text: 'true' }, null, text('[1]')],
  ]);
  expect(arrays.warnings).toEqual(['The value at /1/2 is nested, so it was written as its JSON text.']);

  // Only an array of objects or an array of arrays is accepted, and a broken document names its place.
  for (const bad of ['{"a":1}', '"text"', '[1,2]', '[{"a":1},[2]]', '[]']) {
    expect(() => parseTextTable(bad, 'json')).toThrow(SpreadsheetConverterError);
  }
  const broken = thrown(() => parseTextTable('[\n  {"a": 1,}\n]', 'json'));
  expect([broken.line, broken.column]).toEqual([2, 11]);
  expect(thrown(() => parseTextTable('['.repeat(600), 'json')).message).toMatch(/nested more than 512 levels/);
  // A repeated key keeps the last value, with a warning.
  const repeated = parseTextTable('[{"a":1,"a":2}]', 'json');
  expect(repeated.rows[1]).toEqual([{ kind: 'number', text: '2' }]);
  expect(repeated.warnings).toEqual(['The key "a" at /0 appears more than once, so its last value was used.']);
});

it('JSON numbers keep their digits and a number that cannot be a spreadsheet number is written as text with a warning', () => {
  const parsed = parseTextTable(
    '[{"n":12345678901234567890,"m":1.5e3,"z":-0,"s":"7","t":true,"u":null,"e":""}]',
    'json',
  );
  const on = writeXlsx(parsed.rows, { sheetName: 'S', detectTypes: true });
  expect(on.preview.map((cell) => [cell.ref, cell.value, cell.type])).toEqual([
    ['A1', 'n', 'inlineStr'],
    ['B1', 'm', 'inlineStr'],
    ['C1', 'z', 'inlineStr'],
    ['D1', 's', 'inlineStr'],
    ['E1', 't', 'inlineStr'],
    ['F1', 'u', 'inlineStr'],
    ['G1', 'e', 'inlineStr'],
    ['A2', '12345678901234567890', 'inlineStr'],
    ['B2', '1.5e3', 'n'],
    ['C2', '-0', 'inlineStr'],
    ['D2', '7', 'inlineStr'],
    ['E2', 'TRUE', 'b'],
  ]);
  expect(on.warnings).toEqual([
    'Cell A2 holds the number 12345678901234567890, which a spreadsheet number cannot keep exactly (more than 15 digits, negative zero or out of range), so it was written as text.',
    'Cell C2 holds the number -0, which a spreadsheet number cannot keep exactly (more than 15 digits, negative zero or out of range), so it was written as text.',
  ]);
  // A JSON string stays text even when it looks like a number, and with detection off nothing is a number.
  const off = writeXlsx(parsed.rows, { sheetName: 'S', detectTypes: false });
  expect(off.preview.slice(7).map((cell) => [cell.value, cell.type])).toEqual([
    ['12345678901234567890', 'inlineStr'],
    ['1.5e3', 'inlineStr'],
    ['-0', 'inlineStr'],
    ['7', 'inlineStr'],
    ['true', 'inlineStr'],
  ]);
  expect(off.warnings).toEqual([]);
});

it('entities, character references, CDATA, x escapes, phonetic runs and comments are read as the specification says', () => {
  // ECMA-376 and XML 1.0 define every expected cell here: the five predefined entities and numeric references, CDATA,
  // ST_Xstring escapes (_x005F_ is an underscore), and <rPh> phonetic runs, which are not part of the text.
  const xml = sheetXmlOf(
    '<!-- <c r="Z9" t="inlineStr"><is><t>never</t></is></c> -->' +
      '<row r="1">' +
      '<c r="A1" t="inlineStr"><is><t>a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos; &#x20AC; &#8364;</t></is></c>' +
      '<c r="B1" t="inlineStr"><is><r><t>Rich</t></r><r><rPr><b/></rPr><t xml:space="preserve"> text </t></r><rPh sb="0" eb="1"><t>PHONETIC</t></rPh><phoneticPr fontId="1"/></is></c>' +
      '<c r="C1" t="inlineStr"><is><t><![CDATA[<raw> & text]]></t></is></c>' +
      '<c r="D1" t="inlineStr"><is><t>_x0041__x005F_x0042_ _x005F_ _xZZZZ_</t></is></c>' +
      '<c r="E1" t="n"><v>1.50</v></c>' +
      '<c r="F1"><f>SUM(A1:A2)</f></c>' +
      '<c r="G1" t="d"><v>2020-01-31T10:00:00Z</v></c>' +
      '<c r="H1" t="str"><f>x</f><v>text &amp; more</v></c>' +
      '<c r="I1" t="b"><v>0</v></c>' +
      '<c r="J1" t="e"><v>#N/A</v></c>' +
      '<c r="K1" s="0" t="inlineStr"/>' +
      '<c r="L1" t="n"><v> 42 </v></c>' +
      '<c r="M1"><v>7</v><extLst><ext/></extLst></c>' +
      '</row>',
  );
  const sheet = readXlsx(xlsxFrom(xml), { datesAsSerials: false }).sheets[0]!;
  expect(snapshot(sheet)).toEqual([
    [
      ['string', 'a & b <c> "d" \'e\' € €'],
      ['string', 'Rich text '],
      ['string', '<raw> & text'],
      ['string', 'A_x0042_ _ _xZZZZ_'],
      ['number', '1.50'],
      ['empty', ''],
      ['date', '2020-01-31T10:00:00Z'],
      ['string', 'text & more'],
      ['boolean', 'FALSE'],
      ['error', '#N/A'],
      ['empty', ''],
      ['number', '42'],
      ['number', '7'],
    ],
  ]);
  // Element names with a namespace prefix, a relationship id attribute with another prefix, and a sheet whose cells have
  // no references (so each takes the next position) are read too.
  const prefixed = xlsxFrom(
    `<x:worksheet xmlns:x="${MAIN_NS}"><x:sheetData><x:row><x:c t="inlineStr"><x:is><x:t>p1</x:t></x:is></x:c><x:c t="inlineStr"><x:is><x:t>p2</x:t></x:is></x:c></x:row><x:row r="3"><x:c t="inlineStr"><x:is><x:t>p3</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>`,
    {
      workbook: `<x:workbook xmlns:x="${MAIN_NS}" xmlns:q="${REL_NS}"><x:sheets><x:sheet name="Pre" sheetId="1" q:id="rId1"/></x:sheets></x:workbook>`,
    },
  );
  const prefixedBook = readXlsx(prefixed, { datesAsSerials: false });
  expect(prefixedBook.sheets[0]!.name).toBe('Pre');
  expect(snapshot(prefixedBook.sheets[0]!)).toEqual([
    [
      ['string', 'p1'],
      ['string', 'p2'],
    ],
    [],
    [['string', 'p3']],
  ]);
});

it('shared strings and cell references: an index that does not exist and a cell past Excel limits are refused naming the cell', () => {
  const shared = `<sst xmlns="${MAIN_NS}" count="2" uniqueCount="2"><si><t>zero</t></si><si><r><t>one</t></r><r><t> two</t></r></si></sst>`;
  const good = readXlsx(
    xlsxFrom(sheetXmlOf('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'), {
      sharedStrings: shared,
    }),
    { datesAsSerials: false },
  );
  expect(snapshot(good.sheets[0]!)).toEqual([
    [
      ['string', 'zero'],
      ['string', 'one two'],
    ],
  ]);
  const badIndex = thrown(() =>
    readXlsx(
      xlsxFrom(sheetXmlOf('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>9</v></c></row>'), {
        sharedStrings: shared,
      }),
      { datesAsSerials: false },
    ),
  );
  expect(badIndex.cell).toBe('B1');
  expect(badIndex.message).toContain('B1');

  for (const ref of ['XFE1', 'A1048577', 'A0', '1A']) {
    const err = thrown(() =>
      readXlsx(xlsxFrom(sheetXmlOf(`<row r="1"><c r="${ref}"><v>1</v></c></row>`)), { datesAsSerials: false }),
    );
    expect(err.cell).toBe(ref);
    expect(err.message).toContain(ref);
  }
  // The last cell Excel allows is refused for its size, not allocated: one row at the far corner would otherwise ask
  // for 17 billion entries.
  const corner = thrown(() =>
    readXlsx(xlsxFrom(sheetXmlOf('<row r="1048576"><c r="XFD1048576"><v>1</v></c></row>')), {
      datesAsSerials: false,
    }),
  );
  expect(corner.message).toMatch(/10,000,000 cells/);
  // A sheet that is wide but within the limit is read.
  const wide = readXlsx(xlsxFrom(sheetXmlOf('<row r="1"><c r="XFD1"><v>1</v></c></row>')), {
    datesAsSerials: false,
  }).sheets[0]!;
  expect(wide.rows[0]).toHaveLength(16384);
  expect(wide.rows[0]![16383]!.ref).toBe('XFD1');
});

it('convertSpreadsheet runs both directions in one call', () => {
  const toXlsx = convertSpreadsheet({
    direction: 'text-to-xlsx',
    text: 'id,code\n1,00123',
    inputFormat: 'csv',
    detectTypes: true,
    sheetName: 'Sheet1',
  });
  if (toXlsx.direction !== 'text-to-xlsx') throw new Error('wrong direction');
  expect(toXlsx.preview.map((cell) => [cell.ref, cell.value, cell.type])).toEqual([
    ['A1', 'id', 'inlineStr'],
    ['B1', 'code', 'inlineStr'],
    ['A2', '1', 'n'],
    ['B2', '00123', 'inlineStr'],
  ]);
  const toText = convertSpreadsheet({
    direction: 'xlsx-to-text',
    bytes: toXlsx.bytes,
    sheet: '',
    output: 'csv',
    header: true,
    keepTypes: false,
    datesAsSerials: false,
  });
  if (toText.direction !== 'xlsx-to-text') throw new Error('wrong direction');
  expect(toText.text).toBe('id,code\r\n1,00123');
  expect(toText.sheets).toEqual([{ name: 'Sheet1', state: 'visible' }]);
  expect([toText.chosen, toText.rows, toText.columns]).toEqual([0, 2, 2]);
  expect(toText.previewRows).toEqual([
    ['id', 'code'],
    ['1', '00123'],
  ]);
  // A hidden sheet chosen by number, in the format the visitor asked for.
  const hidden = convertSpreadsheet({
    direction: 'xlsx-to-text',
    bytes: fixture('openpyxl-people.xlsx'),
    sheet: '2',
    output: 'json',
    header: false,
    keepTypes: true,
    datesAsSerials: false,
  });
  if (hidden.direction !== 'xlsx-to-text') throw new Error('wrong direction');
  expect(JSON.parse(hidden.text)).toEqual([['secret', 42]]);
  expect(hidden.chosen).toBe(1);
});

it('an attribute value holding a greater-than sign does not end its tag, and a DOCTYPE and its entities are never read', () => {
  // XML 1.0 allows > inside a quoted attribute value. An entity declared in a DOCTYPE is never expanded, so nothing a
  // file declares or names is loaded: the text &x; stays as written.
  const xml =
    '<?xml version="1.0"?><!DOCTYPE worksheet [<!ENTITY x "boom">]>' +
    sheetXmlOf(
      '<row r="1"><c r="A1" t="inlineStr"><is><t>&x;</t></is></c><c note="x > y" r="C1" t="n"><v>1</v></c><c note=\'p > q\' r="E1" t="n"><v>2</v></c></row>',
    );
  const sheet = readXlsx(xlsxFrom(xml), { datesAsSerials: false }).sheets[0]!;
  // The reference comes after the attribute that holds the sign, so a tag cut short there would lose C1 and E1 and put
  // their cells next to A1.
  expect(sheet.rows[0]!.map((cell) => [cell.kind, cell.text, cell.ref])).toEqual([
    ['string', '&x;', 'A1'],
    ['empty', '', ''],
    ['number', '1', 'C1'],
    ['empty', '', ''],
    ['number', '2', 'E1'],
  ]);
});

it('custom number formats are classified as date, time or neither by their tokens outside quotes and brackets', () => {
  // ECMA-376 Part 1, 18.8.30 and 18.8.31 define format codes: text in quotes, a backslash escape, _x spacing, *x fill and
  // [bracketed] colours, conditions and locales carry no date meaning; an m directly after h, or directly before s, is
  // minutes and any other m is a month (Microsoft's description of the format code rules).
  const FORMATS: [string, 'date' | 'time' | undefined][] = [
    ['yyyy-mm-dd', 'date'],
    ['dd/mm/yyyy', 'date'],
    ['d-mmm-yy', 'date'],
    ['mmmm d, yyyy', 'date'],
    ['m/d/yy h:mm', 'date'],
    ['yyyy-mm-dd hh:mm:ss', 'date'],
    ['[$-409]d-mmm-yy;@', 'date'],
    ['mmm', 'date'],
    ['h:mm:ss', 'time'],
    ['hh:mm', 'time'],
    ['mm:ss', 'time'],
    ['[h]:mm:ss', 'time'],
    ['h:mm AM/PM', 'time'],
    ['General', undefined],
    ['0.00', undefined],
    ['0.0%', undefined],
    ['#,##0.00 "days"', undefined],
    ['0.00E+00', undefined],
    ['[Red]0.00;[Blue]-0.00', undefined],
    ['"Total: "0', undefined],
    ['\\d0', undefined],
    ['0_);(0)', undefined],
  ];
  for (const [code, expected] of FORMATS) expect(customFormatClass(code), code).toBe(expected);
  // Built-in ids: 14 to 17 and 22 are dates, 18 to 21 and 45 to 47 are times, 0 and 1 are numbers.
  expect([14, 15, 16, 17, 22, 27, 36, 50, 58].map(builtInFormatClass)).toEqual(Array(9).fill('date'));
  expect([18, 19, 20, 21, 45, 46, 47].map(builtInFormatClass)).toEqual(Array(7).fill('time'));
  expect([0, 1, 2, 9, 10, 11, 12, 37, 49].map(builtInFormatClass)).toEqual(Array(9).fill(undefined));

  // A file whose cells use them: styles say which cell format is a date, and the value 0 shows what class it is.
  const styles = `<styleSheet xmlns="${MAIN_NS}"><numFmts count="1"><numFmt numFmtId="164" formatCode="[h]:mm:ss"/></numFmts><cellStyleXfs count="1"><xf numFmtId="14"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0"/><xf numFmtId="21"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="22"/></cellXfs></styleSheet>`;
  const cells = [
    '<c r="A1" s="1"><v>0</v></c>',
    '<c r="B1" s="2"><v>0</v></c>',
    '<c r="C1" s="1"><v>1.5</v></c>',
    '<c r="D1" s="3"><v>0.75</v></c>',
    '<c r="E1" s="4"><v>45351.75</v></c>',
    '<c r="F1" s="2"><v>-1</v></c>',
    '<c r="G1" s="0"><v>43861</v></c>',
    '<c r="H1" s="99"><v>43861</v></c>',
    '<c r="I1"><v>43861</v></c>',
  ].join('');
  const workbook = readXlsx(xlsxFrom(sheetXmlOf(`<row r="1">${cells}</row>`), { styles }), { datesAsSerials: false });
  expect(snapshot(workbook.sheets[0]!)[0]).toEqual([
    ['date', '00:00:00'],
    ['date', '1900-01-00'],
    ['date', '1900-01-01T12:00:00'],
    ['date', '18:00:00'],
    ['date', '2024-02-29T18:00:00'],
    ['number', '-1'],
    ['number', '43861'],
    ['number', '43861'],
    ['number', '43861'],
  ]);
  // The cell with a date format and a number no date can be made from is shown as stored, and the page is told.
  expect(workbook.warnings).toEqual([
    '1 cell has a date format but holds a number no date can be made from (the first is F1), so it is shown as stored.',
  ]);
});

it('a row without a usable row number follows the row before it, and rows never run past the last row Excel has', () => {
  const read = (rows: string) => readXlsx(xlsxFrom(sheetXmlOf(rows)), { datesAsSerials: false }).sheets[0]!.rows;
  const texts = (rows: ReturnType<typeof read>) => rows.map((row) => row.map((cell) => cell.text));
  // A row number that is not a number is the next row, so its cell is kept (it used to vanish).
  expect(texts(read('<row r="abc"><c><v>1</v></c></row><row><c><v>2</v></c></row>'))).toEqual([['1'], ['2']]);
  // A negative or zero row number is not a row either; it used to merge into row 1.
  expect(texts(read('<row r="1"><c><v>a</v></c></row><row r="-4"><c><v>b</v></c></row>'))).toEqual([['a'], ['b']]);
  expect(texts(read('<row r="1"><c><v>a</v></c></row><row r="0"><c><v>b</v></c></row>'))).toEqual([['a'], ['b']]);
  // A row number past Excel's last row (1,048,576) is not a row either, where 5,000,000 once asked for that many rows.
  expect(texts(read('<row r="1"><c><v>a</v></c></row><row r="5000000"><c><v>b</v></c></row>'))).toEqual([['a'], ['b']]);
  // A good row number is still used, with gaps left empty, and the next row without a number follows it.
  expect(texts(read('<row r="3"><c><v>a</v></c></row><row><c><v>b</v></c></row>'))).toEqual([[], [], ['a'], ['b']]);
  // Rows without numbers count too: the one after the last row of the sheet is refused.
  const last = read('<row r="1048576"><c><v>z</v></c></row>');
  expect(last).toHaveLength(1048576);
  const past = thrown(() =>
    readXlsx(xlsxFrom(sheetXmlOf('<row r="1048576"><c><v>z</v></c></row><row><c><v>y</v></c></row>')), {
      datesAsSerials: false,
    }),
  );
  expect(past.message).toMatch(/1,048,576 rows/);
}, 60_000);

it('a damaged sheet that was not chosen does not stop the chosen sheet from being read', () => {
  const parts = partsOf(sheetXmlOf('<row r="1"><c r="A1"><v>1</v></c></row>'), {
    workbook: `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets><sheet name="Good" sheetId="1" r:id="rId1"/><sheet name="Bad" sheetId="2" r:id="rId9"/></sheets></workbook>`,
  });
  parts['xl/_rels/workbook.xml.rels'] = parts['xl/_rels/workbook.xml.rels']!.replace(
    '</Relationships>',
    `<Relationship Id="rId9" Type="${REL_NS}/worksheet" Target="worksheets/sheet9.xml"/></Relationships>`,
  );
  parts['xl/worksheets/sheet9.xml'] = '<worksheet><sheetData><row r="1"><c r="A1"';
  const bytes = zipSync(bytesOf(parts));

  const converted = convertSpreadsheet({
    direction: 'xlsx-to-text',
    bytes,
    sheet: '',
    output: 'csv',
    header: true,
    keepTypes: false,
    datesAsSerials: false,
  });
  if (converted.direction !== 'xlsx-to-text') throw new Error('wrong direction');
  expect(converted.text).toBe('1');
  expect(converted.sheets).toEqual([
    { name: 'Good', state: 'visible' },
    { name: 'Bad', state: 'visible' },
  ]);
  // Reading every sheet, or the damaged one, says so.
  expect(thrown(() => readXlsx(bytes, { datesAsSerials: false })).message).toMatch(/cut short/);
  expect(thrown(() => readXlsx(bytes, { datesAsSerials: false, sheet: 'Bad' })).part).toBe('xl/worksheets/sheet9.xml');
});

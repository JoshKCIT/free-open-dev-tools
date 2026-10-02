import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { meta as toolMeta, parseTextTable, readXlsx, writeXlsx, type Cell, type TableCell } from '../src/index';

/*
 * Grounding (D-179, P13-08). The package structure is ECMA-376 Part 1 (SpreadsheetML): a zip with
 * [Content_Types].xml, _rels/.rels, xl/workbook.xml, xl/_rels/workbook.xml.rels and one xl/worksheets/sheet1.xml;
 * the cell types b, n, inlineStr and the rest come from Microsoft's published CellValues reference
 * (https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.cellvalues). The independent second
 * opinion is openpyxl 3.1.5 (Python 3.14.3): test/fixtures/make-fixtures.py check <file> opens a file with openpyxl and
 * prints every cell's value and type, and the values quoted below are what it printed for the committed
 * test/fixtures/tool-output.xlsx.
 */

const here = (name: string): string => fileURLToPath(new URL(name, import.meta.url));

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

/** What the writer is asked to store: text, numbers, a boolean, spaces, a leading zero, non-ASCII, line breaks. */
const FIXED_ROWS: TableCell[][] = [
  ['name', 'age', 'member', 'padded', 'code', 'sci', 'intl', 'multi', 'ctrl'],
  ['Ada', '36', 'TRUE', '  spaced  ', '00123', '1e3', 'é€漢', 'line1\nline2', 'a\u0001b'],
  ['Bo, "Q"', '-5.25', 'FALSE', '', '12345678901234567', '-0', '😀', 'tab\there', 'cr\rlf'],
];

/** The cell as a plain value: a number as a number, a boolean as a boolean, text as text, an empty cell as null. */
function plain(cell: Cell | undefined): string | number | boolean | null {
  if (cell === undefined || cell.kind === 'empty') return null;
  if (cell.kind === 'number') return Number(cell.text);
  if (cell.kind === 'boolean') return cell.text === 'TRUE';
  return cell.text;
}

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
      ['s', 'a\u0001b'],
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
      ['s', 'cr\rlf'],
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

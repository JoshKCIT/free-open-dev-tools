import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { DEFAULT_ALPHABET, ESCAPE_CODE, EXTENSION, analyseMessage, septetsOf } from '../src/index';

// The tables of 3GPP TS 23.038 clauses 6.2.1 and 6.2.1.1 are grounded three ways, all read from files made once and kept
// under test/fixtures: the Unicode mapping file GSM0338.TXT, the Android table recorded as JSON, and a recorded comparison
// of both with the text of TS 23.038 V20.0.0. Nothing here is fetched or run while the tests run.

function fixture(path: string): string {
  return readFileSync(new URL(`./fixtures/${path}`, import.meta.url), 'utf8');
}

const cp = (code: number): string => String.fromCodePoint(code);

/** The vendored Unicode mapping file: the default alphabet by code, and the extension table by the code after the escape. */
function readUnicodeFile(): { defaultTable: Map<number, string>; extension: Map<number, string>; text: string } {
  const text = fixture('unicode/GSM0338.TXT');
  const defaultTable = new Map<number, string>();
  const extension = new Map<number, string>();
  for (const line of text.split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    const [code, unicode] = line.split('\t');
    const septet = parseInt(code!, 16);
    const character = String.fromCodePoint(parseInt(unicode!, 16));
    if (septet > 0xff) extension.set(septet & 0xff, character);
    else defaultTable.set(septet, character);
  }
  return { defaultTable, extension, text };
}

interface AndroidRecord {
  blob: string;
  recordedAt: string;
  defaultTable: string[];
  extension: Record<string, string>;
}

function readAndroid(): AndroidRecord {
  return JSON.parse(fixture('android/android-alphabet.json')) as AndroidRecord;
}

// The cells where this tool follows TS 23.038 and the Unicode file differs, listed by name. The file's own header says it
// corrected 0x09 to a small c cedilla; TS 23.038 draws the capital one, and so do the Android table and this tool.
const UNICODE_FILE_DIFFERENCES = [
  {
    code: 9,
    thisTool: cp(0xc7),
    unicodeFile: cp(0xe7),
    reason: 'TS 23.038 draws capital C cedilla at code 9; the Unicode file maps it to the small one',
  },
];

it('the default and extension tables equal the vendored Unicode mapping file cell by cell except code 9, listed by name', () => {
  const unicode = readUnicodeFile();
  expect(DEFAULT_ALPHABET).toHaveLength(128);
  // The file has 128 default lines (code 0x1B among them, mapped to a no-break space for display) and 10 extension lines.
  expect(unicode.defaultTable.size).toBe(128);
  expect(unicode.extension.size).toBe(10);

  const differing: number[] = [];
  let compared = 0;
  for (let code = 0; code < 128; code++) {
    if (code === ESCAPE_CODE) continue;
    compared++;
    if (DEFAULT_ALPHABET[code] !== unicode.defaultTable.get(code)) differing.push(code);
  }
  expect(compared).toBe(127);
  expect(differing).toEqual(UNICODE_FILE_DIFFERENCES.map((d) => d.code));
  for (const d of UNICODE_FILE_DIFFERENCES) {
    expect(DEFAULT_ALPHABET[d.code]).toBe(d.thisTool);
    expect(unicode.defaultTable.get(d.code)).toBe(d.unicodeFile);
    // The file keeps the capital letter as a commented line, which is what TS 23.038 draws.
    expect(unicode.text).toContain('#0x09\t0x00C7\t#\tLATIN CAPITAL LETTER C WITH CEDILLA');
  }
  // The escape code is not a character of this tool's table.
  expect(DEFAULT_ALPHABET[ESCAPE_CODE]).toBe('');

  // The extension table: the same ten characters at the same codes.
  expect(EXTENSION.size).toBe(10);
  for (const [code, character] of unicode.extension) expect(EXTENSION.get(character), character).toBe(code);
  for (const [character, code] of EXTENSION) expect(unicode.extension.get(code), character).toBe(character);
});

it('the default and extension tables equal the recorded Android table cell by cell', () => {
  const android = readAndroid();
  expect(android.blob).toBe('5c53f7e5a4d0403d510b8ed5a148558175f212b2');
  expect(android.defaultTable).toHaveLength(128);
  for (let code = 0; code < 128; code++) {
    // Android writes the escape code as the placeholder U+FFFF; this tool's table holds nothing there.
    if (code === ESCAPE_CODE) {
      expect(android.defaultTable[code]).toBe(cp(0xffff));
      expect(DEFAULT_ALPHABET[code]).toBe('');
      continue;
    }
    expect(DEFAULT_ALPHABET[code], `code ${code}`).toBe(android.defaultTable[code]);
  }
  expect(Object.keys(android.extension)).toHaveLength(10);
  expect(EXTENSION.size).toBe(10);
  for (const [code, character] of Object.entries(android.extension)) {
    expect(EXTENSION.get(character), character).toBe(Number(code));
  }
  for (const [character, code] of EXTENSION) expect(android.extension[String(code)], character).toBe(character);
});

it('the recorded comparison with the TS 23.038 table text holds 117 equal cells and names the 11 drawn as symbols', () => {
  const recorded = JSON.parse(fixture('spec/spec-comparison.json')) as {
    recordedAt: string;
    source: string;
    equal: number;
    symbolCells: number[];
    androidDifferences: number[];
    unicodeFileDifferences: { code: number; specification: string; unicodeFile: string }[];
    extensionCells: number;
    extensionEqual: number;
    androidBlob: string;
    tableSha256: string;
  };
  expect(recorded.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  expect(recorded.source).toContain('TS 23.038 V20.0.0');
  expect(recorded.equal).toBe(117);
  // The ten Greek capitals (codes 16 and 18 to 26) and the escape (code 27) are drawn as symbols in the Word file.
  expect(recorded.symbolCells).toEqual([16, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27]);
  expect(recorded.equal + recorded.symbolCells.length).toBe(128);
  expect(recorded.androidDifferences).toEqual([]);
  expect(recorded.unicodeFileDifferences).toEqual([{ code: 9, specification: 'U+00C7', unicodeFile: 'U+00E7' }]);
  expect(recorded.extensionCells).toBe(9);
  expect(recorded.extensionEqual).toBe(9);

  // The table the specification text was compared with is the recorded Android table...
  const android = readAndroid();
  expect(recorded.androidBlob).toBe(android.blob);
  const hash = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
  expect(recorded.tableSha256).toBe(hash(android.defaultTable.join('')));
  // ...and this tool's table, with the placeholder in the escape cell, is that very table, so a later edit is caught.
  const ours = DEFAULT_ALPHABET.map((cell, code) => (code === ESCAPE_CODE ? cp(0xffff) : cell)).join('');
  expect(hash(ours)).toBe(recorded.tableSha256);

  // The symbol cells hold the Greek capitals the specification draws, and the escape.
  const greek = [0x394, 0x3a6, 0x393, 0x39b, 0x3a9, 0x3a0, 0x3a8, 0x3a3, 0x398, 0x39e].map(cp);
  expect(recorded.symbolCells.slice(0, 10).map((code) => DEFAULT_ALPHABET[code])).toEqual(greek);
});

it('capital C cedilla is in the default alphabet and lower case c cedilla forces UCS-2, as TS 23.038 draws code 9', () => {
  expect(DEFAULT_ALPHABET[9]).toBe(cp(0xc7));
  expect(septetsOf(cp(0xc7))).toBe(1);
  expect(septetsOf(cp(0xe7))).toBeUndefined();
  const capital = analyseMessage(cp(0xc7));
  expect(capital.encoding).toBe('gsm7');
  expect(capital.units).toBe(1);
  const small = analyseMessage(cp(0xe7));
  expect(small.encoding).toBe('ucs2');
  expect(small.forced.map((f) => f.codePoint)).toEqual([0xe7]);
  // A capital among small letters does not force Unicode; one small c cedilla among capitals does.
  expect(analyseMessage(`${cp(0xc7)}A${cp(0xc7)}`).encoding).toBe('gsm7');
  expect(analyseMessage(`${cp(0xc7)}A${cp(0xe7)}`).encoding).toBe('ucs2');
});

it('the alphabet holds 127 distinct characters, the ten extension characters count two septets and nothing else is a cell', () => {
  const cells = DEFAULT_ALPHABET.filter((_, code) => code !== ESCAPE_CODE);
  expect(cells).toHaveLength(127);
  expect(new Set(cells).size).toBe(127);
  for (const cell of cells) expect(septetsOf(cell), cell).toBe(1);
  for (const character of EXTENSION.keys()) expect(septetsOf(character), character).toBe(2);
  // The characters of the extension table are not also in the default table.
  for (const character of EXTENSION.keys()) expect(cells).not.toContain(character);
  // Anything that is not exactly one cell is not a cell.
  for (const text of ['', 'ab', '__proto__', 'constructor', 'toString', cp(0x1f600), cp(0xd83d), cp(0)]) {
    expect(septetsOf(text), text).toBeUndefined();
  }
  // The text of every cell is already in composed form, so joining combining marks can never change an alphabet text.
  for (const cell of [...cells, ...EXTENSION.keys()]) expect(cell.normalize('NFC')).toBe(cell);
});

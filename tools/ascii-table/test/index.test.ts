import { it, expect } from 'vitest';
import { ASCII_ROWS, CONTROL_CODES, filterRows } from '../src/index';

it('all 128 codes are present with matching decimal, hexadecimal, octal and binary forms', () => {
  expect(ASCII_ROWS).toHaveLength(128);
  for (let code = 0; code < 128; code++) {
    const row = ASCII_ROWS[code]!;
    expect(row.code).toBe(code);
    expect(row.dec).toBe(String(code));
    expect(row.hex).toBe(code.toString(16).toUpperCase().padStart(2, '0'));
    expect(row.oct).toBe(code.toString(8).padStart(3, '0'));
    expect(row.bin).toBe(code.toString(2).padStart(7, '0'));
  }
  // A spot check with independently computed values, not derived from the row generator.
  const a = ASCII_ROWS[65]!;
  expect(a.dec).toBe('65');
  expect(a.hex).toBe('41');
  expect(a.oct).toBe('101');
  expect(a.bin).toBe('1000001');
  expect(a.char).toBe('A');
});

it('RFC 20 section 4.1 control character names are given for codes 0 to 31 and 127', () => {
  // Hand-transcribed directly from RFC 20 (https://www.rfc-editor.org/rfc/rfc20),
  // section 4.1, fetched live this session -- not copied from CONTROL_CODES.
  // "NUL Null", "BEL Bell (audible or attention signal)", "BS Backspace (FE)",
  // "HT Horizontal Tabulation (punched card skip) (FE)", "LF Line Feed (FE)",
  // "CR Carriage Return (FE)", "ESC Escape", "DEL Delete [1]".
  const rfc20Names: [number, string, string][] = [
    [0, 'NUL', 'Null'],
    [7, 'BEL', 'Bell (audible or attention signal)'],
    [8, 'BS', 'Backspace'],
    [9, 'HT', 'Horizontal Tabulation'],
    [10, 'LF', 'Line Feed'],
    [13, 'CR', 'Carriage Return'],
    [27, 'ESC', 'Escape'],
    [127, 'DEL', 'Delete'],
  ];
  for (const [code, abbreviation, name] of rfc20Names) {
    const row = ASCII_ROWS[code]!;
    expect(row.abbreviation).toBe(abbreviation);
    expect(row.name).toBe(name);
  }

  // Every code 0-31 and 127 carries an abbreviation and a name.
  for (let code = 0; code <= 31; code++) {
    expect(ASCII_ROWS[code]!.abbreviation).toBeDefined();
    expect(ASCII_ROWS[code]!.name).toBeDefined();
  }
  expect(ASCII_ROWS[127]!.abbreviation).toBe('DEL');
  expect(ASCII_ROWS[127]!.name).toBe('Delete');

  // CONTROL_CODES itself carries exactly 34 entries: 0-31, 32 (SP) and 127 (DEL).
  expect(CONTROL_CODES).toHaveLength(34);
});

it('printable codes 33 to 126 show the character itself and 32 is shown as SP', () => {
  for (let code = 33; code <= 126; code++) {
    const row = ASCII_ROWS[code]!;
    expect(row.char).toBe(String.fromCharCode(code));
    expect(row.abbreviation).toBeUndefined();
    expect(row.name).toBeUndefined();
  }
  const space = ASCII_ROWS[32]!;
  expect(space.char).toBe('SP');
  expect(space.abbreviation).toBe('SP');
  expect(space.name).toBe('Space');
});

it('a filter of 0x41, 65, 0o101 or 0b1000001 finds only the letter A', () => {
  for (const query of ['0x41', '0X41', '65', '0o101', '0b1000001']) {
    const rows = filterRows(query);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.code).toBe(65);
    expect(rows[0]!.char).toBe('A');
  }
});

it('a filter by control name finds its row case-insensitively', () => {
  for (const query of ['NUL', 'nul', 'Nul']) {
    const rows = filterRows(query);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.code).toBe(0);
  }
  for (const query of ['null', 'NULL']) {
    const rows = filterRows(query);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.code).toBe(0);
  }
  const bell = filterRows('bell');
  expect(bell).toHaveLength(1);
  expect(bell[0]!.code).toBe(7);
});

it('an empty query returns every row and a query with no match returns none', () => {
  expect(filterRows('')).toHaveLength(128);
  expect(filterRows('   ')).toHaveLength(128);
  expect(filterRows('nosuchcode')).toHaveLength(0);
  expect(filterRows('999')).toHaveLength(0);
});

it('a single literal character finds its own row, case-sensitively', () => {
  const rowA = filterRows('A');
  expect(rowA).toHaveLength(1);
  expect(rowA[0]!.code).toBe(65);

  const rowLowerA = filterRows('a');
  expect(rowLowerA).toHaveLength(1);
  expect(rowLowerA[0]!.code).toBe(97);
});

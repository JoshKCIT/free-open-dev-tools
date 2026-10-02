import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DataConvertError } from '../src/index';
import { readTable, writeTable } from '../src/table';

// RFC 4180, Common Format and MIME Type for CSV Files: https://www.rfc-editor.org/rfc/rfc4180
//   rule 1 (a record per line, CRLF), rule 2 (the last record needs no line break), rule 4 (an optional header line),
//   rules 5 to 7 (fields with a comma, quote or line break are enclosed in double quotes; a quote inside is doubled).
// IANA media type text/tab-separated-values: https://www.iana.org/assignments/media-types/text/tab-separated-values
//   one record per line, fields separated by a tab, a field that contains a tab is not allowed, the first line holds
//   the field names, every record has the same number of fields. It has no quoting mechanism.
// RFC 8259, section 6: the grammar of a JSON number, https://www.rfc-editor.org/rfc/rfc8259#section-6
// RFC 6901: JSON Pointer, https://www.rfc-editor.org/rfc/rfc6901
// The expected texts below are written by hand from those rules, never taken from this converter's own output.

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  expect(console.log).not.toHaveBeenCalled();
  expect(console.warn).not.toHaveBeenCalled();
  expect(console.error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

const HEADER_ROW = { headerRow: true, inferTypes: false };

function readError(text: string, format: 'csv' | 'tsv', options = HEADER_ROW): DataConvertError {
  try {
    readTable(text, format, options);
  } catch (err) {
    expect(err).toBeInstanceOf(DataConvertError);
    return err as DataConvertError;
  }
  throw new Error('expected a refusal');
}

function writeError(value: unknown, format: 'csv' | 'tsv'): DataConvertError {
  try {
    writeTable(value, format);
  } catch (err) {
    expect(err).toBeInstanceOf(DataConvertError);
    return err as DataConvertError;
  }
  throw new Error('expected a refusal');
}

it('CSV in follows RFC 4180, renames empty and repeated headers with a warning and refuses a short or long row naming it', () => {
  // Rules 5 to 7: a field holding a comma, a doubled quote or a line break is enclosed in quotes.
  const quoted = readTable('a,b\r\n"x,1","he said ""hi"""\r\n"line1\nline2",z', 'csv', HEADER_ROW);
  expect(quoted.value).toEqual([
    { a: 'x,1', b: 'he said "hi"' },
    { a: 'line1\nline2', b: 'z' },
  ]);
  expect(quoted.warnings).toEqual([]);

  // A byte order mark is not part of the first header, and CRLF, LF and a lone CR all end a record (rule 1).
  expect(readTable('\u{FEFF}a,b\n1,2\r3,4\r\n5,6\n', 'csv', HEADER_ROW).value).toEqual([
    { a: '1', b: '2' },
    { a: '3', b: '4' },
    { a: '5', b: '6' },
  ]);

  // Cell whitespace is data and is kept exactly; a quote inside an unquoted field is a literal character.
  expect(readTable('a,b\n  x  ,5"6', 'csv', HEADER_ROW).value).toEqual([{ a: '  x  ', b: '5"6' }]);

  // An empty header becomes column_N (its 1-based position) and a repeated one gets _2, _3; a warning lists them.
  const renamed = readTable('a,,a,a\n1,2,3,4', 'csv', HEADER_ROW);
  expect(renamed.value).toEqual([{ a: '1', column_2: '2', a_2: '3', a_3: '4' }]);
  expect(renamed.warnings).toHaveLength(1);
  expect(renamed.warnings[0]).toContain('column_2');
  expect(renamed.warnings[0]).toContain('a_2');
  expect(renamed.warnings[0]).toContain('a_3');

  // A header that is not a safe object key is still read as an ordinary key.
  const proto = readTable('__proto__,constructor\n1,2', 'csv', HEADER_ROW).value as Record<string, unknown>[];
  expect(Object.keys(proto[0]!)).toEqual(['__proto__', 'constructor']);
  expect(Object.getPrototypeOf(proto[0]!)).toBe(Object.prototype);

  // Exactly the header's field count is accepted; one more or one fewer is refused, naming the row and its line.
  expect(readTable('a,b,c\n1,2,3', 'csv', HEADER_ROW).value).toEqual([{ a: '1', b: '2', c: '3' }]);
  const short = readError('a,b,c\n1,2,3\n4,5', 'csv');
  expect(short.message).toContain('Row 3');
  expect(short.line).toBe(3);
  const long = readError('a,b\n1,2,3', 'csv');
  expect(long.message).toContain('Row 2');
  expect(long.line).toBe(2);
  // The line is where the record starts even when an earlier record spans lines: row 3 starts on line 4.
  const later = readError('a,b\n"x\ny",1\n2', 'csv');
  expect(later.message).toContain('Row 3');
  expect(later.line).toBe(4);
  // A blank line inside the table is a record with one field.
  expect(readError('a,b\n1,2\n\n3,4', 'csv').message).toContain('Row 3');

  // An opening quote that never closes names its line and column.
  const open = readError('a\n"x', 'csv');
  expect(open.line).toBe(2);
  expect(open.column).toBe(1);

  // Without a header row every record is a list of text, and the rows must all be as long as the first.
  expect(readTable('a,b\n1,2', 'csv', { headerRow: false, inferTypes: false }).value).toEqual([
    ['a', 'b'],
    ['1', '2'],
  ]);
  expect(readError('a,b\n1', 'csv', { headerRow: false, inferTypes: false }).message).toContain('Row 2');

  // A header and no rows is an empty list, and a warning says the header is not in the result.
  const headerOnly = readTable('a,b\n', 'csv', HEADER_ROW);
  expect(headerOnly.value).toEqual([]);
  expect(headerOnly.warnings).toHaveLength(1);
  // Blank lines at the very end are ignored and a warning says so; one final line break is not a blank line.
  expect(readTable('a\n1\n', 'csv', HEADER_ROW).warnings).toEqual([]);
  const trailing = readTable('a\n1\n\n\n', 'csv', HEADER_ROW);
  expect(trailing.value).toEqual([{ a: '1' }]);
  expect(trailing.warnings).toHaveLength(1);
});

it('TSV in follows the IANA registration: tabs only, no quoting, every record the same width', () => {
  expect(readTable('id\tname\n7\tAda\n8\tGrace', 'tsv', HEADER_ROW).value).toEqual([
    { id: '7', name: 'Ada' },
    { id: '8', name: 'Grace' },
  ]);
  // There is no quoting mechanism: a quote is an ordinary character, and a comma is not a separator.
  expect(readTable('a\tb\n"1\t2"', 'tsv', HEADER_ROW).value).toEqual([{ a: '"1', b: '2"' }]);
  expect(readTable('a,b\tc\n1,2\t3', 'tsv', HEADER_ROW).value).toEqual([{ 'a,b': '1,2', c: '3' }]);
  // CRLF or LF ends a record, and a final line break is not a record.
  expect(readTable('a\tb\r\n1\t2\r\n', 'tsv', HEADER_ROW).value).toEqual([{ a: '1', b: '2' }]);
  // An empty field is kept as the empty text.
  expect(readTable('a\tb\n\t2', 'tsv', HEADER_ROW).value).toEqual([{ a: '', b: '2' }]);
  // The same header rules apply as for CSV.
  const renamed = readTable('a\t\ta\n1\t2\t3', 'tsv', HEADER_ROW);
  expect(renamed.value).toEqual([{ a: '1', column_2: '2', a_2: '3' }]);
  expect(renamed.warnings).toHaveLength(1);

  // Every record must have as many fields as the first line; the refusal names the row and its line.
  const wide = readError('a\tb\n1\t2\t3', 'tsv');
  expect(wide.message).toContain('Row 2');
  expect(wide.line).toBe(2);
  const narrow = readError('a\tb\n1\t2\n3', 'tsv');
  expect(narrow.message).toContain('Row 3');
  expect(narrow.line).toBe(3);
  // Without a header row the first line sets the width.
  expect(readTable('a\tb\n1\t2', 'tsv', { headerRow: false, inferTypes: false }).value).toEqual([
    ['a', 'b'],
    ['1', '2'],
  ]);
});

it('CSV out flattens nested objects with dotted keys and refuses a key that contains a dot', () => {
  const nested = writeTable([{ user: { name: 'Ada', id: 1 }, ok: true }], 'csv');
  expect(nested.text).toBe('user.name,user.id,ok\r\nAda,1,true');
  expect(nested.warnings).toEqual([]);

  // A single object is one row.
  expect(writeTable({ a: 1, b: { c: 2 } }, 'csv').text).toBe('a,b.c\r\n1,2');

  // Rule 6 and 7: a field with a comma, a quote or a line break is enclosed in quotes and a quote is doubled.
  expect(writeTable([{ a: 'x,y', b: 'say "hi"', c: 'l1\nl2' }], 'csv').text).toBe(
    'a,b,c\r\n"x,y","say ""hi""","l1\nl2"',
  );
  // A header is quoted by the same rule.
  expect(writeTable([{ 'a,b': 1 }], 'csv').text).toBe('"a,b"\r\n1');

  // Numbers and true and false are written as JSON text.
  expect(writeTable([{ n: 0.5, big: 12345678901234567890n, t: false }], 'csv').text).toBe(
    'n,big,t\r\n0.5,12345678901234567890,false',
  );

  // A key with a dot would read back as nesting, so it is refused, at any depth, naming where it is.
  const top = writeError([{ 'a.b': 1 }], 'csv');
  expect(top.path).toBe('/0/a.b');
  expect(top.message).toContain('dot');
  expect(writeError([{ a: { 'b.c': 1 } }], 'csv').path).toBe('/0/a/b.c');
  expect(writeError({ 'x.y': 1 }, 'csv').path).toBe('/x.y');

  // A document that is not a table shape is refused rather than guessed at.
  expect(writeError(5, 'csv').message).toContain('list');
  expect(writeError([1, 2], 'csv').path).toBe('/0');
  expect(writeError([{ a: 1 }, 'x'], 'csv').path).toBe('/1');
});

it('an array inside a record is refused with its path and arrays of arrays with unequal rows are refused naming the row', () => {
  const inRecord = writeError([{ a: 1 }, { a: 2, tags: ['x'] }], 'csv');
  expect(inRecord.path).toBe('/1/tags');
  expect(inRecord.message).toContain('cannot be flattened');
  // Even an empty list is refused: it cannot become a cell.
  expect(writeError([{ tags: [] }], 'csv').path).toBe('/0/tags');
  // Deeper in a nested object, and in a single-object root.
  expect(writeError([{ a: { b: [1] } }], 'tsv').path).toBe('/0/a/b');
  expect(writeError({ a: [1] }, 'csv').path).toBe('/a');

  // Rows that are lists: the cells are the values, there is no header line, and every row must be as long as the first.
  expect(
    writeTable(
      [
        [1, 2],
        [3, 4],
      ],
      'csv',
    ).text,
  ).toBe('1,2\r\n3,4');
  const unequal = writeError([[1, 2], [3]], 'csv');
  expect(unequal.path).toBe('/1');
  expect(unequal.message).toContain('Row 2');
  // A list inside a cell, and a list that mixes objects and lists, are refused naming the place.
  expect(writeError([[1, [2]]], 'csv').path).toBe('/0/1');
  expect(writeError([{ a: 1 }, [2]], 'csv').path).toBe('/1');
  expect(writeError([[{ a: 1 }]], 'csv').path).toBe('/0/0');
});

it('objects with different keys become the union of columns in first-appearance order with a warning', () => {
  const union = writeTable([{ a: 1 }, { b: 2 }, { a: 3, c: 4 }], 'csv');
  expect(union.text).toBe('a,b,c\r\n1,,\r\n,2,\r\n3,,4');
  expect(union.warnings).toHaveLength(1);
  expect(union.warnings[0]).toContain('different keys');

  // The same keys in a different order are the same columns, in the order they first appeared, with no warning.
  const reordered = writeTable(
    [
      { a: 1, b: 2 },
      { b: 4, a: 3 },
    ],
    'csv',
  );
  expect(reordered.text).toBe('a,b\r\n1,2\r\n3,4');
  expect(reordered.warnings).toEqual([]);

  // A null becomes an empty cell and the warning says it cannot be told from missing text on the way back.
  const nulled = writeTable([{ a: null, b: 'x' }], 'csv');
  expect(nulled.text).toBe('a,b\r\n,x');
  expect(nulled.warnings).toHaveLength(1);
  expect(nulled.warnings[0]).toContain('null');

  // An empty nested object has no columns of its own; it becomes one empty cell, and a warning says so.
  const empty = writeTable([{ a: {}, b: 1 }], 'csv');
  expect(empty.text).toBe('a,b\r\n,1');
  expect(empty.warnings).toHaveLength(1);
});

it('TSV out refuses a cell containing a tab or line break with its path', () => {
  expect(writeTable([{ a: '1', b: 'x y' }], 'tsv').text).toBe('a\tb\n1\tx y');
  // There is no quoting in TSV, so a quote is written as it is.
  expect(writeTable([{ a: 'say "hi"' }], 'tsv').text).toBe('a\nsay "hi"');

  const tab = writeError([{ a: 'x\ty' }], 'tsv');
  expect(tab.path).toBe('/0/a');
  expect(tab.message).toContain('tab');
  expect(writeError([{ ok: 1 }, { ok: 2, a: 'x\ny' }], 'tsv').path).toBe('/1/a');
  expect(writeError([{ a: 'x\ry' }], 'tsv').path).toBe('/0/a');
  expect(writeError([['fine', 'x\ty']], 'tsv').path).toBe('/0/1');
  // A header that holds a tab cannot be written either.
  expect(writeError([{ 'a\tb': 1 }], 'tsv').path).toBe('/0/a\tb');
  // The same text is fine as CSV, where quoting holds it.
  expect(writeTable([{ a: 'x\ty' }], 'csv').text).toBe('a\r\nx\ty');
});

it('infer types reads true, false, null and RFC 8259 numbers and keeps integers beyond 2 to the 53 as strings', () => {
  const on = { headerRow: true, inferTypes: true };
  const typed = readTable('a,b,c,d,e,f,g\ntrue,false,null,12,-0.5,1e3,007', 'csv', on);
  expect(typed.value).toEqual([{ a: true, b: false, c: null, d: 12, e: -0.5, f: 1000, g: '007' }]);
  expect(typed.warnings).toEqual([]);

  // Only the exact words and the exact number grammar count: everything else stays text.
  const text = readTable('a,b,c,d,e,f,g,h,i\nTrue,NULL,+1,.5,1.,0x10,,Infinity,1_000', 'csv', on).value as Record<
    string,
    unknown
  >[];
  expect(text[0]).toEqual({
    a: 'True',
    b: 'NULL',
    c: '+1',
    d: '.5',
    e: '1.',
    f: '0x10',
    g: '',
    h: 'Infinity',
    i: '1_000',
  });

  // 2 to the 53 minus 1 is the largest integer a double holds exactly; the next one up stays text, with a warning.
  const edge = readTable('a,b,c\n9007199254740991,9007199254740993,-9007199254740993', 'csv', on);
  expect(edge.value).toEqual([{ a: 9007199254740991, b: '9007199254740993', c: '-9007199254740993' }]);
  expect(edge.warnings).toHaveLength(1);
  expect(edge.warnings[0]).toContain('2^53');

  // TSV reads the same way.
  expect(readTable('a\tb\n1\ttrue', 'tsv', on).value).toEqual([{ a: 1, b: true }]);
  // Without the option every value stays text, including the words and numbers.
  expect(readTable('a,b,c\ntrue,null,12', 'csv', HEADER_ROW).value).toEqual([{ a: 'true', b: 'null', c: '12' }]);
  // Without a header row the lists are typed the same way.
  expect(readTable('1,x\n2,null', 'csv', { headerRow: false, inferTypes: true }).value).toEqual([
    [1, 'x'],
    [2, null],
  ]);
});

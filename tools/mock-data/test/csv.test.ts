import { it, expect } from 'vitest';
import { parseCsv, formatCsv, CsvSyntaxError } from '../src/csv';

// Fetched with `curl -fsSL https://www.rfc-editor.org/rfc/rfc4180.txt`, 2026-09-24.
// Rule 1 (quoted): "Each record is located on a separate line, delimited by
// a line break (CRLF)."
// Rule 2 (quoted): "The last record in the file may or may not have an
// ending line break."
// Rule 4 (quoted): "Within the header and each record, there may be one or
// more fields, separated by commas. Each line should contain the same
// number of fields throughout the file."
// Rule 5 (quoted): "Each field may or may not be enclosed in double quotes
// ... If fields are not enclosed with double quotes, then double quotes may
// not appear inside the fields."
// Rule 6 (quoted): "Fields containing line breaks (CRLF), double quotes,
// and commas should be enclosed in double-quotes."
// Rule 7 (quoted): "If double-quotes are used to enclose fields, then a
// double-quote appearing inside a field must be escaped by preceding it
// with another double quote." Example given: "aaa","b""bb","ccc"

it('RFC 4180 quoted fields may contain delimiters, line breaks and doubled quotes', () => {
  const { rows } = parseCsv('"aaa","b""bb","ccc"');
  expect(rows).toEqual([['aaa', 'b"bb', 'ccc']]);

  const withBreak = parseCsv('"aaa","b\r\nbb","ccc"');
  expect(withBreak.rows).toEqual([['aaa', 'b\r\nbb', 'ccc']]);

  const withDelimiter = parseCsv('"a,b",c');
  expect(withDelimiter.rows).toEqual([['a,b', 'c']]);
});

it('RFC 4180 the last record may or may not end with a line break', () => {
  const withTrailing = parseCsv('aaa,bbb,ccc\r\nzzz,yyy,xxx\r\n');
  expect(withTrailing.rows).toEqual([
    ['aaa', 'bbb', 'ccc'],
    ['zzz', 'yyy', 'xxx'],
  ]);

  const withoutTrailing = parseCsv('aaa,bbb,ccc\r\nzzz,yyy,xxx');
  expect(withoutTrailing.rows).toEqual([
    ['aaa', 'bbb', 'ccc'],
    ['zzz', 'yyy', 'xxx'],
  ]);
});

it('formatCsv then parseCsv returns the same rows for fields with quotes, delimiters and line breaks', () => {
  const original = [
    ['name', 'quote'],
    ['Ada', 'Hello, "world"'],
    ['Lin', 'multi\r\nline'],
  ];
  const text = formatCsv(original);
  const { rows } = parseCsv(text);
  expect(rows).toEqual(original);
});

it('CRLF and LF record separators are both accepted', () => {
  expect(parseCsv('a,b\r\nc,d').rows).toEqual([
    ['a', 'b'],
    ['c', 'd'],
  ]);
  expect(parseCsv('a,b\nc,d').rows).toEqual([
    ['a', 'b'],
    ['c', 'd'],
  ]);
  expect(parseCsv('a,b\rc,d').rows).toEqual([
    ['a', 'b'],
    ['c', 'd'],
  ]);
});

it('semicolon, tab and pipe delimiters are honoured when chosen', () => {
  expect(parseCsv('a;b;c', { delimiter: ';' }).rows).toEqual([['a', 'b', 'c']]);
  expect(parseCsv('a\tb\tc', { delimiter: '\t' }).rows).toEqual([['a', 'b', 'c']]);
  expect(parseCsv('a|b|c', { delimiter: '|' }).rows).toEqual([['a', 'b', 'c']]);
});

it('an unterminated quoted field is refused with its line and column', () => {
  expect(() => parseCsv('a,"unterminated')).toThrow(CsvSyntaxError);
  try {
    parseCsv('a,"unterminated');
  } catch (err) {
    expect(err).toBeInstanceOf(CsvSyntaxError);
    expect((err as CsvSyntaxError).line).toBe(1);
    expect((err as CsvSyntaxError).column).toBe(3);
  }
});

it('text after a closing quote is refused, and a stray quote in an unquoted field is literal', () => {
  expect(() => parseCsv('"abc"def')).toThrow(CsvSyntaxError);
  expect(parseCsv('ab"cd,x').rows).toEqual([['ab"cd', 'x']]);
});

it('a quoted field with no closing quote characters at end of input still reports an error, not a crash', () => {
  expect(() => parseCsv('"')).toThrow(CsvSyntaxError);
});

it('the rules 1/2/7 worked example from RFC 4180 round trips through formatCsv', () => {
  const rows = [
    ['aaa', 'bbb', 'ccc'],
    ['zzz', 'yyy', 'xxx'],
  ];
  expect(formatCsv(rows)).toBe('aaa,bbb,ccc\r\nzzz,yyy,xxx');
});

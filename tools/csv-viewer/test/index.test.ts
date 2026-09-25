import { it, expect } from 'vitest';
import { detectDelimiter, viewCsv, CsvViewerError, MAX_DISPLAY_ROWS } from '../src/index';

it('comma, semicolon, tab and pipe delimiters are detected automatically', () => {
  expect(detectDelimiter('a,b,c\nd,e,f\ng,h,i')).toBe(',');
  expect(detectDelimiter('a;b;c\nd;e;f\ng;h;i')).toBe(';');
  expect(detectDelimiter('a\tb\tc\nd\te\tf\ng\th\ti')).toBe('\t');
  expect(detectDelimiter('a|b|c\nd|e|f\ng|h|i')).toBe('|');
  // A genuinely one-column file: no candidate ever splits a row into more
  // than one field, so the fixed default (comma) is returned.
  expect(detectDelimiter('alpha\nbeta\ngamma')).toBe(',');
});

it('a delimiter inside RFC 4180 quotes does not affect detection', () => {
  // Every row has a comma living inside a quoted field, and semicolons
  // outside quotes actually separate the three columns -- the comma must
  // not be mistaken for the real delimiter.
  const text = 'name;note\nAda;"x,y"\nAlan;"p,q"\nGrace;"r,s"';
  expect(detectDelimiter(text)).toBe(';');
});

it('sorting by a column is stable and numeric columns sort by value', () => {
  const numeric = viewCsv('n\n10\n9\n100', { sortColumn: 'n', sortDirection: 'asc' });
  expect(numeric.rows).toEqual([['9'], ['10'], ['100']]);

  // Equal keys keep their original relative order.
  const stable = viewCsv('key,seq\na,1\nb,2\na,3\nb,4', { sortColumn: 'key', sortDirection: 'asc' });
  expect(stable.rows).toEqual([
    ['a', '1'],
    ['a', '3'],
    ['b', '2'],
    ['b', '4'],
  ]);
});

it('empty cells sort last in both directions', () => {
  const ascending = viewCsv('n\n3\n\n1', { sortColumn: 'n', sortDirection: 'asc' });
  expect(ascending.rows).toEqual([['1'], ['3'], ['']]);
  const descending = viewCsv('n\n3\n\n1', { sortColumn: 'n', sortDirection: 'desc' });
  expect(descending.rows).toEqual([['3'], ['1'], ['']]);
});

it('filtering keeps rows containing the text in any column or the chosen column', () => {
  const anyColumn = viewCsv('a,b\nfoo,bar\nbaz,qux', { filter: 'BA' });
  expect(anyColumn.rows).toEqual([
    ['foo', 'bar'],
    ['baz', 'qux'],
  ]);

  const chosenColumn = viewCsv('a,b\nfoo,bar\nbaz,qux', { filter: 'BA', filterColumn: 'a' });
  expect(chosenColumn.rows).toEqual([['baz', 'qux']]);
  expect(chosenColumn.matchedRows).toBe(1);
});

it('only the first 500 matching rows are returned with the full counts', () => {
  const lines = ['n'];
  for (let i = 0; i < 1200; i++) lines.push(String(i));
  const result = viewCsv(lines.join('\n'));
  expect(result.rows.length).toBe(MAX_DISPLAY_ROWS);
  expect(result.totalRows).toBe(1200);
  expect(result.matchedRows).toBe(1200);
});

it('an unknown sort or filter column gives a warning and is ignored', () => {
  const result = viewCsv('a,b\n1,2\n3,4', { sortColumn: 'nope', filterColumn: 'also-nope', filter: '1' });
  expect(result.warnings.some((w) => w.includes('nope'))).toBe(true);
  expect(result.warnings.some((w) => w.includes('also-nope'))).toBe(true);
  // Unresolved column names never turn into an error page: rows still render.
  expect(result.rows.length).toBeGreaterThan(0);
});

it('a header row is detected and a short or long row is handled with a warning, not an error', () => {
  const shortRow = viewCsv('a,b,c\n1,2');
  expect(shortRow.headers).toEqual(['a', 'b', 'c']);
  expect(shortRow.rows).toEqual([['1', '2', '']]);
  expect(shortRow.warnings.some((w) => w.includes('fewer fields'))).toBe(true);

  const longRow = viewCsv('a,b\n1,2,3');
  expect(longRow.headers).toEqual(['a', 'b', 'column 3']);
  expect(longRow.rows).toEqual([['1', '2', '3']]);
  expect(longRow.warnings.some((w) => w.includes('more fields'))).toBe(true);
});

it('without a header, columns are named by generated numbers', () => {
  const result = viewCsv('1,2,3\n4,5,6', { header: false });
  expect(result.headers).toEqual(['column 1', 'column 2', 'column 3']);
  expect(result.rows).toEqual([
    ['1', '2', '3'],
    ['4', '5', '6'],
  ]);
});

it('a CsvSyntaxError from parsing becomes a CsvViewerError with line and column', () => {
  expect(() => viewCsv('a,"unterminated', { delimiter: ',' })).toThrow(CsvViewerError);
  try {
    viewCsv('a,"unterminated', { delimiter: ',' });
  } catch (err) {
    expect(err).toBeInstanceOf(CsvViewerError);
    expect((err as CsvViewerError).line).toBe(1);
    expect((err as CsvViewerError).column).toBe(3);
  }
});

import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { convertData } from '../src/index';
import { writeTable } from '../src/table';

// RFC 4180, Common Format and MIME Type for CSV Files: https://www.rfc-editor.org/rfc/rfc4180
//   rule 2 (the last record may or may not end with a line break) and the ABNF: a record is one or more fields, and a
//   field may be empty, so in a one-column table an empty value is a record of its own, which a reader can only tell
//   from the end of the text when the empty field is written as "".
// IANA media type text/tab-separated-values: https://www.iana.org/assignments/media-types/text/tab-separated-values
//   TSV has no quoting, so a lone empty field can only be a blank line.

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

it('CSV writes an empty value in a one-column table as "" so the record is not lost, and leaves other cells alone', () => {
  expect(writeTable([{ a: 'x' }, { a: '' }], 'csv').text).toBe('a\r\nx\r\n""');
  expect(writeTable([{ a: '' }, { a: 'x' }], 'csv').text).toBe('a\r\n""\r\nx');
  expect(writeTable([['x'], ['']], 'csv').text).toBe('x\r\n""');
  const nulls = writeTable([{ a: 'x' }, { a: null }], 'csv');
  expect(nulls.text).toBe('a\r\nx\r\n""');
  expect(nulls.warnings.join(' ')).toContain('null became an empty cell');
  // Two columns: an empty cell is still just an empty field, a comma shows where it is.
  expect(writeTable([{ a: 'x', b: '' }], 'csv').text).toBe('a,b\r\nx,');
  expect(writeTable([{ a: '', b: '' }], 'csv').text).toBe('a,b\r\n,');
});

it('TSV warns when the only column holds an empty value, because TSV can only write it as a blank line', () => {
  const lone = writeTable([{ a: 'x' }, { a: '' }], 'tsv');
  expect(lone.text).toBe('a\nx\n');
  expect(lone.warnings.join(' ')).toContain('blank line');
  // Nothing to say when a column is not alone or has no empty value.
  expect(writeTable([{ a: 'x', b: '' }], 'tsv').warnings).toEqual([]);
  expect(writeTable([{ a: 'x' }, { a: 'y' }], 'tsv').warnings).toEqual([]);
});

it('a JSON list whose last record has an empty single value gives CSV text with that record in it', () => {
  const out = convertData('[{"a":"x"},{"a":""}]', { from: 'json', to: 'csv' }).output;
  expect(out.split('\r\n')).toEqual(['a', 'x', '""']);
});

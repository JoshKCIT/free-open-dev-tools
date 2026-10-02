import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readTable } from '../src/table';

// RFC 4180, Common Format and MIME Type for CSV Files: https://www.rfc-editor.org/rfc/rfc4180
//   an optional header line holds the field names. This reader makes each name unique by adding _2, _3 to a repeated
//   name (and column_N to an empty one), so a table always reads as records with distinct keys.

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

it('headers repeated 20,000 times are renamed in linear time and every name is unique', () => {
  const header = Array.from({ length: 20_000 }, () => 'a').join(',');
  const row = Array.from({ length: 20_000 }, (_, i) => String(i)).join(',');
  const started = Date.now();
  const read = readTable(`${header}\n${row}\n`, 'csv', { headerRow: true, inferTypes: false });
  expect(Date.now() - started).toBeLessThan(2_000);
  const record = (read.value as Record<string, string>[])[0]!;
  const names = Object.keys(record);
  expect(names).toHaveLength(20_000);
  expect(names.slice(0, 4)).toEqual(['a', 'a_2', 'a_3', 'a_4']);
  expect(names[19_999]).toBe('a_20000');
  expect(record['a_20000']).toBe('19999');
  expect(read.warnings.join(' ').length).toBeLessThan(1_000);
}, 60_000);

it('a repeated header never takes a name another column already has', () => {
  const read = readTable('a,a,a_2,a\n1,2,3,4\n', 'csv', { headerRow: true, inferTypes: false });
  expect(Object.keys((read.value as object[])[0]!)).toEqual(['a', 'a_2', 'a_2_2', 'a_3']);
});

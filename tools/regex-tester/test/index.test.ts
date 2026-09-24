import { it, expect } from 'vitest';
import { testPattern, replacePattern, RegexToolError, MAX_MATCHES } from '../src/index';

it('test mode lists every match with its index and capture groups', () => {
  const r = testPattern('(?<year>[0-9]{4})-([0-9]{2})', 'g', 'Released 2024-03 and 2025-11.');
  expect(r.mode).toBe('test');
  expect(r.matches).toHaveLength(2);
  expect(r.matches[0]).toEqual({
    index: 9,
    text: '2024-03',
    groups: [
      { name: 'year', value: '2024' },
      { name: '2', value: '03' },
    ],
  });
  expect(r.matches[1]).toEqual({
    index: 21,
    text: '2025-11',
    groups: [
      { name: 'year', value: '2025' },
      { name: '2', value: '11' },
    ],
  });
  expect(r.total).toBe(2);
  expect(r.truncated).toBe(false);
});

it('a zero-length match with the global flag advances instead of repeating forever', () => {
  const r = testPattern('x*', 'g', 'abc');
  expect(r.matches.map((m) => m.index)).toEqual([0, 1, 2, 3]);
  expect(r.matches.every((m) => m.text === '')).toBe(true);
  expect(r.total).toBe(4);
  expect(r.truncated).toBe(false);
});

it('matches beyond the display cap are counted and reported as truncated', () => {
  const input = 'a'.repeat(1500);
  const r = testPattern('a', 'g', input);
  expect(r.matches).toHaveLength(MAX_MATCHES);
  expect(r.total).toBe(1500);
  expect(r.truncated).toBe(true);
});

it('an invalid pattern or unsupported flag is rejected with a plain message', () => {
  expect(() => testPattern('(', 'g', 'abc')).toThrow(RegexToolError);
  expect(() => testPattern('a', 'v', 'abc')).toThrow(RegexToolError);
  expect(() => testPattern('a', 'd', 'abc')).toThrow(RegexToolError);
  expect(() => testPattern('a', 'gg', 'abc')).toThrow(RegexToolError);
});

it('a pattern with no capturing groups reports an empty groups list for each match', () => {
  const r = testPattern('[0-9]+', 'g', 'a1 b22');
  expect(r.matches.map((m) => m.groups)).toEqual([[], []]);
});

it('without the global flag only the first match is returned', () => {
  const r = testPattern('a', '', 'banana');
  expect(r.matches).toHaveLength(1);
  expect(r.matches[0]!.index).toBe(1);
  expect(r.total).toBe(1);
  expect(r.truncated).toBe(false);
});

/**
 * ECMA-262 section 22.1.3.19.1 GetSubstitution defines every replacement
 * pattern this test proves against a real call to replacePattern, quoted
 * from https://tc39.es/ecma262/#sec-getsubstitution (fetched this session):
 * `templateRemainder starts with "$$"` -> `refReplacement be "$"`;
 * `starts with "$&"` -> `refReplacement be matched` (the whole match);
 * `starts with "$" followed by 1 or more decimal digits` -> `refReplacement
 * be capture` at that 1-based index; `starts with "$<"` -> `refReplacement
 * be ... ToString(capture)` for the named group up to the next `>`.
 */
it('ECMA-262 replacement patterns for numbered and named groups, the whole match and a literal dollar are applied', () => {
  const r = replacePattern('(?<year>[0-9]{4})-([0-9]{2})', '', 'Released 2024-03.', '$<year>/$2 ($&) $$');
  expect(r.mode).toBe('replace');
  expect(r.output).toBe('Released 2024/03 (2024-03) $.');
  expect(r.count).toBe(1);
});

it('replace without the global flag changes only the first match', () => {
  const withoutGlobal = replacePattern('a', '', 'aaaa', 'b');
  expect(withoutGlobal.output).toBe('baaa');
  expect(withoutGlobal.count).toBe(1);

  const withGlobal = replacePattern('a', 'g', 'aaaa', 'b');
  expect(withGlobal.output).toBe('bbbb');
  expect(withGlobal.count).toBe(4);
});

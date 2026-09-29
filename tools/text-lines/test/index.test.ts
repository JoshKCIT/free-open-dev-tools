import { it, expect } from 'vitest';
import { splitLines, processLines, OPERATIONS, TextLinesError } from '../src/index';

it('sort orders lines by code point and natural order puts line 2 before line 10', () => {
  const codepoint = processLines('banana\nApple\ncherry', 'sort', { order: 'codepoint' });
  expect(codepoint.output.split('\n')).toEqual(['Apple', 'banana', 'cherry']);

  const natural = processLines('line 10\nline 2\nline 1', 'sort', { order: 'natural' });
  expect(natural.output.split('\n')).toEqual(['line 1', 'line 2', 'line 10']);
});

it('sort can run in descending order', () => {
  const r = processLines('a\nc\nb', 'sort', { descending: true });
  expect(r.output.split('\n')).toEqual(['c', 'b', 'a']);
});

it('dedupe keeps the first occurrence and can ignore case', () => {
  const strict = processLines('a\nA\nb\na', 'dedupe', {});
  expect(strict.output.split('\n')).toEqual(['a', 'A', 'b']);

  const ignoringCase = processLines('a\nA\nb\na', 'dedupe', { ignoreCase: true });
  expect(ignoringCase.output.split('\n')).toEqual(['a', 'b']);
});

it('shuffle with the same seed gives the same order and is a permutation of the input', () => {
  const input = 'one\ntwo\nthree\nfour\nfive';
  const first = processLines(input, 'shuffle', { seed: 'a-repeatable-seed' });
  const second = processLines(input, 'shuffle', { seed: 'a-repeatable-seed' });
  expect(first.output).toBe(second.output);
  expect(first.output.split('\n').sort()).toEqual(input.split('\n').sort());

  const differentSeed = processLines(input, 'shuffle', { seed: 'a-different-seed' });
  expect(differentSeed.output).not.toBe(first.output);
});

it('number prefixes each line starting from the chosen number', () => {
  const r = processLines('a\nb\nc', 'number', { start: 5, separator: ') ' });
  expect(r.output.split('\n')).toEqual(['5) a', '6) b', '7) c']);
});

it('trim removes leading and trailing whitespace and can drop blank lines', () => {
  const r = processLines('  a  \n\n  b  \n   ', 'trim', { mode: 'both', dropBlank: true });
  expect(r.output.split('\n')).toEqual(['a', 'b']);

  const leadingOnly = processLines('  a  ', 'trim', { mode: 'leading' });
  expect(leadingOnly.output).toBe('a  ');
});

it('filter keeps or removes lines containing a literal text', () => {
  const kept = processLines('apple\nbanana\ngrape', 'filter', { filterText: 'an', filterMode: 'keep' });
  expect(kept.output.split('\n')).toEqual(['banana']);

  const removed = processLines('apple\nbanana\ngrape', 'filter', { filterText: 'an', filterMode: 'remove' });
  expect(removed.output.split('\n')).toEqual(['apple', 'grape']);
});

it('join and split round trip a comma separated list', () => {
  const joined = processLines('a\nb\nc', 'join', { joinWith: ', ' });
  expect(joined.output).toBe('a, b, c');

  const split = processLines(joined.output, 'split', { splitOn: ', ' });
  expect(split.output.split('\n')).toEqual(['a', 'b', 'c']);
});

it('CRLF, LF and CR line endings are all read as line breaks', () => {
  expect(splitLines('a\r\nb\nc\rd')).toEqual(['a', 'b', 'c', 'd']);
});

it('an empty split separator throws instead of splitting into single characters', () => {
  expect(() => processLines('abc', 'split', { splitOn: '' })).toThrow(TextLinesError);
});

it('OPERATIONS lists every operation the page can select', () => {
  expect(OPERATIONS).toEqual([
    'sort',
    'dedupe',
    'shuffle',
    'number',
    'trim',
    'filter',
    'join',
    'split',
    'affix',
    'reverse',
  ]);
});

it('affix adds a prefix and/or suffix to every line', () => {
  const r = processLines('a\nb', 'affix', { prefix: '- ', suffix: ';' });
  expect(r.output).toBe('- a;\n- b;');
});

it('affix can skip blank lines, leaving them unchanged in place', () => {
  const skipped = processLines('a\n\n  \nb', 'affix', { prefix: '> ', skipBlank: true });
  expect(skipped.output).toBe('> a\n\n  \n> b');

  const notSkipped = processLines('a\n\n  \nb', 'affix', { prefix: '> ', skipBlank: false });
  expect(notSkipped.output).toBe('> a\n> \n>   \n> b');
});

it('reverse reverses the order of the lines', () => {
  const r = processLines('a\r\nb\r\nc', 'reverse', {});
  expect(r.output).toBe('c\nb\na');
});

it('length sort orders by code-point length, not UTF-16 code units, with ties in original order', () => {
  const input = 'ccc\na\nbb\nd\n😀😀';

  const ascending = processLines(input, 'sort', { order: 'length' });
  expect(ascending.output.split('\n')).toEqual(['a', 'd', 'bb', '😀😀', 'ccc']);

  const descending = processLines(input, 'sort', { order: 'length', descending: true });
  expect(descending.output.split('\n')).toEqual(['ccc', 'bb', '😀😀', 'a', 'd']);
});

it('length sort does not count a stripped carriage return', () => {
  const r = processLines('ccc\r\na\r\nbb', 'sort', { order: 'length' });
  expect(r.output.split('\n')).toEqual(['a', 'bb', 'ccc']);
});

it('affix, reverse and length sort all handle empty input the same way as every other operation', () => {
  for (const [operation, options] of [
    ['affix', { prefix: '> ' }],
    ['reverse', {}],
    ['sort', { order: 'length' }],
  ] as const) {
    const r = processLines('', operation, options);
    expect(r.output, operation).toBe('');
    expect(r.linesIn, operation).toBe(0);
    expect(r.linesOut, operation).toBe(0);
  }
});

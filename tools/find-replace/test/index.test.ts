import { it, expect } from 'vitest';
import { findReplace, FindReplaceError } from '../src/index';

it('a dot or other regex symbol in the find text is matched literally', () => {
  const r = findReplace('a.b axb a.b', 'a.b', 'X');
  expect(r.output).toBe('X axb X');
  expect(r.count).toBe(2);
});

it('a dollar sign sequence in the replacement is inserted literally', () => {
  const r = findReplace('cat', 'cat', '$&-$1');
  expect(r.output).toBe('$&-$1');
  expect(r.count).toBe(1);
});

it('case-insensitive matching finds every case variant and case-sensitive does not', () => {
  const insensitive = findReplace('Cat cat CAT', 'cat', 'dog', { caseSensitive: false });
  expect(insensitive.output).toBe('dog dog dog');
  expect(insensitive.count).toBe(3);

  const sensitive = findReplace('Cat cat CAT', 'cat', 'dog', { caseSensitive: true });
  expect(sensitive.output).toBe('Cat dog CAT');
  expect(sensitive.count).toBe(1);
});

it('whole word does not match inside a longer word, including accented letters and digits', () => {
  const r = findReplace('concatenate cat_1 cats (cat).', 'cat', 'dog', { wholeWord: true });
  expect(r.output).toBe('concatenate cat_1 cats (dog).');
  expect(r.count).toBe(1);

  const adjacent = findReplace('técat cat9 (cat)', 'cat', 'dog', { wholeWord: true });
  expect(adjacent.output).toBe('técat cat9 (dog)');
  expect(adjacent.count).toBe(1);
});

it('multiline find text spanning a line break matches across lines, and is refused with multiline off', () => {
  expect(() => findReplace('line1\nline2\nrest', 'line1\nline2', 'X', { multiline: false })).toThrow(FindReplaceError);

  const r = findReplace('line1\nline2\nrest', 'line1\nline2', 'X', { multiline: true });
  expect(r.output).toBe('X\nrest');
  expect(r.count).toBe(1);
});

it('the replacement count equals the number of non-overlapping matches', () => {
  const r = findReplace('aaaa', 'aa', 'b');
  expect(r.output).toBe('bb');
  expect(r.count).toBe(2);
});

it('an empty text to find leaves the input unchanged with a count of zero', () => {
  const r = findReplace('unchanged text', '', 'X');
  expect(r.output).toBe('unchanged text');
  expect(r.count).toBe(0);
});

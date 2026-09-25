import { it, expect } from 'vitest';
import { compareLists } from '../src/index';

// Fetched with `curl -fsSL https://www.unicode.org/reports/tr15/`, 2026-09-24.
// Quoted (a fragment of the report's own description of Normalization Form C):
//   "Normalization Form C uses canonical composite characters where
//   possible, and maintains the distinction between characters that are
//   compatibility equivalents. Typical strings of composite accented
//   Unicode characters are already in Normalization Form C."
// This is exercised below with e-acute: a single precomposed code point
// (U+00E9) versus the decomposed form "e" followed by a combining acute
// accent (U+0065 U+0301) -- two different code point sequences that NFC
// normalisation treats as the same character.
const PRECOMPOSED_E_ACUTE = 'é';
const DECOMPOSED_E_ACUTE = 'é';

it('union keeps first appearance order and lists each item once', () => {
  const result = compareLists('apple\nbanana\ncherry', 'banana\ncherry\ndate');
  expect(result.union).toEqual(['apple', 'banana', 'cherry', 'date']);
});

it('intersection lists items present in both lists in the order of the first list', () => {
  const result = compareLists('apple\nbanana\ncherry', 'banana\ncherry\ndate');
  expect(result.intersection).toEqual(['banana', 'cherry']);
});

it('only in A and only in B list the one-sided differences', () => {
  const result = compareLists('apple\nbanana\ncherry', 'banana\ncherry\ndate');
  expect(result.onlyA).toEqual(['apple']);
  expect(result.onlyB).toEqual(['date']);
});

it('symmetric difference is the only-in-A items followed by the only-in-B items', () => {
  const result = compareLists('apple\nbanana\ncherry', 'banana\ncherry\ndate');
  expect(result.symmetric).toEqual(['apple', 'date']);
});

it('ignore case and trim options change which lines count as equal', () => {
  const caseSensitive = compareLists('Apple\nbanana', 'apple\nbanana', { ignoreCase: false });
  expect(caseSensitive.intersection).toEqual(['banana']);
  expect(caseSensitive.onlyA).toEqual(['Apple']);
  expect(caseSensitive.onlyB).toEqual(['apple']);

  const caseInsensitive = compareLists('Apple\nbanana', 'apple\nbanana', { ignoreCase: true });
  expect(caseInsensitive.intersection).toEqual(['Apple', 'banana']);
  expect(caseInsensitive.onlyA).toEqual([]);
  expect(caseInsensitive.onlyB).toEqual([]);

  const untrimmed = compareLists('apple \n banana', 'apple\nbanana', { trim: false });
  expect(untrimmed.intersection).toEqual([]);
  const trimmed = compareLists('apple \n banana', 'apple\nbanana', { trim: true });
  expect(trimmed.intersection).toEqual(['apple', 'banana']);
});

it('blank lines are ignored unless kept by option', () => {
  const dropped = compareLists('apple\n\nbanana', 'apple\nbanana', { keepBlank: false });
  expect(dropped.union).toEqual(['apple', 'banana']);

  const kept = compareLists('apple\n\nbanana', 'apple\nbanana', { keepBlank: true });
  expect(kept.onlyA).toEqual(['']);
});

it('CRLF, LF and CR line endings are all read as line breaks', () => {
  const crlf = compareLists('apple\r\nbanana', 'apple\r\nbanana');
  expect(crlf.union).toEqual(['apple', 'banana']);

  const lf = compareLists('apple\nbanana', 'apple\nbanana');
  expect(lf.union).toEqual(['apple', 'banana']);

  const cr = compareLists('apple\rbanana', 'apple\rbanana');
  expect(cr.union).toEqual(['apple', 'banana']);
});

it('UAX 15 NFC normalisation makes composed and decomposed forms equal when switched on', () => {
  const withoutNormalize = compareLists(PRECOMPOSED_E_ACUTE, DECOMPOSED_E_ACUTE, { normalize: false });
  expect(withoutNormalize.intersection).toEqual([]);
  expect(withoutNormalize.union).toHaveLength(2);

  const withNormalize = compareLists(PRECOMPOSED_E_ACUTE, DECOMPOSED_E_ACUTE, { normalize: true });
  expect(withNormalize.intersection).toEqual([PRECOMPOSED_E_ACUTE]);
  expect(withNormalize.union).toEqual([PRECOMPOSED_E_ACUTE]);
});

it('counts report the size of each result list plus duplicates collapsed within each list', () => {
  const result = compareLists('apple\napple\nbanana', 'banana\ndate');
  expect(result.counts).toEqual({
    union: 3,
    intersection: 1,
    onlyA: 1,
    onlyB: 1,
    symmetric: 2,
    duplicatesA: 1,
    duplicatesB: 0,
  });
});

import { it, expect } from 'vitest';
import { EMOJI, EMOJI_DATA_VERSION, FULLY_QUALIFIED_COUNT, searchEmoji, formsOf } from '../src/index';

// Source: https://www.unicode.org/Public/emoji/latest/emoji-test.txt, fetched
// 2026-09-24. The file's own "Status Counts" footer:
//   # fully-qualified : 3963
//   # minimally-qualified : 1029
//   # unqualified : 243
//   # component : 9
const FETCHED_FULLY_QUALIFIED_COUNT = 3963;

it('the bundled data holds exactly the fully-qualified count stated in the emoji-test.txt footer', () => {
  expect(FULLY_QUALIFIED_COUNT).toBe(FETCHED_FULLY_QUALIFIED_COUNT);
  expect(EMOJI.length).toBe(FETCHED_FULLY_QUALIFIED_COUNT);
  expect(EMOJI_DATA_VERSION).toBe('18.0');
});

it('UTS #51 emoji-test.txt minimally-qualified, unqualified and component entries are not bundled', () => {
  // 263A alone is "unqualified" in the fetched file (263A FE0F is the
  // fully-qualified form and IS bundled, checked separately below).
  expect(EMOJI.some(([codePointsHex]) => codePointsHex === '263A')).toBe(false);
  expect(EMOJI.some(([codePointsHex]) => codePointsHex === '263A FE0F')).toBe(true);

  // 1F3FB (light skin tone) alone is "component" status in the fetched file.
  expect(EMOJI.some(([codePointsHex]) => codePointsHex === '1F3FB')).toBe(false);

  // 2764 200D 1F525 (no FE0F) is the "unqualified" form of heart on fire in
  // the fetched file; only the fully-qualified 2764 FE0F 200D 1F525 form is bundled.
  expect(EMOJI.some(([codePointsHex]) => codePointsHex === '2764 200D 1F525')).toBe(false);
});

it('searching grinning face finds U+1F600 first with its escapes', () => {
  const { results } = searchEmoji('grinning face');
  expect(results.length).toBeGreaterThan(0);
  const first = results[0]!;
  expect(first.name).toBe('grinning face');
  expect(first.codePoints).toEqual([0x1f600]);

  const forms = formsOf(first);
  expect(forms.character).toBe('\u{1F600}');
  expect(forms.codePoints).toBe('U+1F600');
  expect(forms.jsEscape).toBe('\\u{1F600}');
  expect(forms.htmlEntity).toBe('&#x1F600;');
  expect(forms.utf16Escape).toBe('\\uD83D\\uDE00');
});

it('a multi-code-point sequence such as heart on fire lists every code point and escape', () => {
  const { results } = searchEmoji('heart on fire');
  expect(results.length).toBeGreaterThan(0);
  const entry = results.find((e) => e.name === 'heart on fire')!;
  expect(entry).toBeDefined();
  expect(entry.codePoints).toEqual([0x2764, 0xfe0f, 0x200d, 0x1f525]);

  const forms = formsOf(entry);
  expect(forms.codePoints).toBe('U+2764 U+FE0F U+200D U+1F525');
  expect(forms.jsEscape).toBe('\\u{2764}\\u{FE0F}\\u{200D}\\u{1F525}');
  expect(forms.htmlEntity).toBe('&#x2764;&#xFE0F;&#x200D;&#x1F525;');
  expect(forms.utf16Escape).toBe('\\u2764\\uFE0F\\u200D\\uD83D\\uDD25');
});

it('skin tone variants are found by their full names', () => {
  const { results } = searchEmoji('waving hand: light skin tone');
  expect(results.length).toBeGreaterThan(0);
  expect(results[0]!.name).toBe('waving hand: light skin tone');
  expect(results[0]!.codePoints).toEqual([0x1f44b, 0x1f3fb]);
});

it('search ranks an exact name match before a prefix match and prefix before other matches', () => {
  const { results } = searchEmoji('grinning face');
  const exactIndex = results.findIndex((e) => e.name === 'grinning face');
  const withBigEyesIndex = results.findIndex((e) => e.name === 'grinning face with big eyes');
  expect(exactIndex).toBe(0);
  expect(withBigEyesIndex).toBeGreaterThan(exactIndex);
});

it('searchEmoji respects the limit and reports the total number of matches', () => {
  const { results, totalMatches } = searchEmoji('face', 5);
  expect(results.length).toBe(5);
  expect(totalMatches).toBeGreaterThan(5);
});

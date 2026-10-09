import { expect, it } from 'vitest';
import { toASCII, toUnicode } from 'tr46';
import { convertNames, visible } from '../src/index';

/**
 * U+2800 BRAILLE PATTERN BLANK is a Braille cell with no dots raised, so it draws as an empty cell that looks like a space
 * (Unicode code chart "Braille Patterns", U+2800 to U+28FF). UTS #46 treats it as a valid code point, so a name holding it
 * converts, and without an escape it displays as a name that looks like one without it. The page shows such characters as
 * an escape (D-243); the glob tester and the keyboard viewer already do. Every character is built with
 * String.fromCodePoint so no invisible character sits in this file.
 *
 * Grounding. The form of an escape is the one the table already gives a neighbouring blank character: U+3000 (the
 * ideographic space) is shown as a backslash, `u`, braces and the code point in upper case hex, asserted in index.test.ts
 * ("control, bidirectional and invisible characters are shown as escapes"). The ASCII form of the name comes from the
 * repository's own tr46 6.0.0, a second opinion that shares no code with this package's display logic.
 */
const cp = (value: number): string => String.fromCodePoint(value);
const BACKSLASH = String.fromCodePoint(92);
const escaped = (code: number): string => BACKSLASH + 'u{' + code.toString(16).toUpperCase() + '}';

it('the Braille blank U+2800 is shown as an escape', () => {
  expect(visible('a' + cp(0x2800) + 'b')).toBe('a' + escaped(0x2800) + 'b');
  // On its own, and repeated, and next to a character that is already escaped (the ideographic space).
  expect(visible(cp(0x2800))).toBe(escaped(0x2800));
  expect(visible(cp(0x2800).repeat(2))).toBe(escaped(0x2800).repeat(2));
  expect(visible(cp(0x3000) + cp(0x2800))).toBe(escaped(0x3000) + escaped(0x2800));
  // The escape form is the one the table gives its other blank characters: the same shape, upper case hex.
  expect(escaped(0x2800)).toBe(BACKSLASH + 'u{2800}');
});

it('the code points beside the Braille blank are shown as they are', () => {
  // U+27FF (the last point of Supplemental Arrows-A, just before the Braille block) and U+2801 (BRAILLE PATTERN DOTS-1,
  // the next cell, which has a dot and so is visible) are not blank, and U+2800 itself is the only escape.
  expect(visible('a' + cp(0x27ff) + 'b')).toBe('a' + cp(0x27ff) + 'b');
  expect(visible('a' + cp(0x2801) + 'b')).toBe('a' + cp(0x2801) + 'b');
  expect(visible(cp(0x27ff) + cp(0x2800) + cp(0x2801))).toBe(cp(0x27ff) + escaped(0x2800) + cp(0x2801));
  // The last Braille cell (all eight dots) is visible too.
  expect(visible(cp(0x28ff))).toBe(cp(0x28ff));
});

it('a name holding the Braille blank converts to its ASCII form with the blank escaped in the input and Unicode columns', () => {
  const name = 'a' + cp(0x2800) + 'b.com';
  // The second opinion: tr46 6.0.0 accepts the name and gives this ASCII form.
  expect(toASCII(name, { checkHyphens: true, checkBidi: true, checkJoiners: true, useSTD3ASCIIRules: true })).toBe(
    'xn--ab-10y.com',
  );
  expect(
    toUnicode(name, { checkHyphens: true, checkBidi: true, checkJoiners: true, useSTD3ASCIIRules: true }).domain,
  ).toBe(name);

  const row = convertNames(name, { direction: 'auto', profile: 'strict' })[0];
  expect(row).toMatchObject({ valid: true, ascii: 'xn--ab-10y.com' });
  // The result keeps the real text; only the display function turns the blank into an escape.
  expect(row?.input).toBe(name);
  expect(row?.unicode).toBe(name);
  expect(visible(row?.input ?? '')).toBe('a' + escaped(0x2800) + 'b.com');
  expect(visible(row?.unicode ?? '')).toBe('a' + escaped(0x2800) + 'b.com');
  // The ASCII column shows the converted name as it is (it holds no blank to hide).
  expect(visible(row?.ascii ?? '')).toBe('xn--ab-10y.com');
});

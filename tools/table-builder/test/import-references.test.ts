import { test, expect } from 'vitest';
import { importTable } from '../src/index';

// GitHub Flavored Markdown 0.29-gfm / CommonMark 0.29, section 6.2 (entity and numeric character references): only
// a valid HTML5 entity name followed by a semicolon, or a decimal or hexadecimal number, is a reference; anything else
// stays exactly as written. The HTML Living Standard, 13.5 (named character references) lists the valid names; the
// legacy names that a browser also reads without a semicolon (copy, not, amp, para) are not valid here with one.

function cell(text: string): string {
  return importTable(`| h |\n| --- |\n| ${text} |\n`, 'markdown').rows[1]![0]!;
}

test('a Markdown cell keeps text that only looks like a character reference exactly as written', () => {
  for (const text of ['&copyright;', '&notit;', '&ampfoo;', '&ltx;', 'q&para=2;', 'x &ampersand; y']) {
    expect(cell(text), text).toBe(text);
  }
});

test('a Markdown cell still reads real named, decimal and hexadecimal references', () => {
  expect(cell('&copy; &amp; &lt;b&gt; &AMP; &notin;')).toBe('© & <b> & ∉');
  expect(cell('&#65;&#x42;&#X43;')).toBe('ABC');
  // A reference that names two characters at once.
  expect(cell('&NotEqualTilde;')).toBe('\u{2242}\u{338}');
});

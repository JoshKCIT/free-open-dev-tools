import { it, expect } from 'vitest';
import {
  inspect,
  normalise,
  toEscapes,
  fromEscapes,
  INVISIBLE,
  UnicodeInspectorError,
  type EscapeStyle,
} from '../src/index';

function cps(hex: string): string {
  return hex
    .trim()
    .split(/\s+/)
    .map((h) => String.fromCodePoint(parseInt(h, 16)))
    .join('');
}

// Five lines taken directly from Unicode's own published conformance file:
// https://www.unicode.org/Public/UNIDATA/NormalizationTest.txt (version 18.0.0,
// 2026-06-24). Format per the file's own header: source;NFC;NFD;NFKC;NFKD.
// Chosen to cover a compatibility-only fold, a canonical accent composition, a
// case where NFC and NFKC diverge, a singleton decomposition, and an
// algorithmic Hangul composition (Hangul syllables are not in the
// decomposition data at all -- the engine must compute them).
const NORMALIZATION_FIXTURES: {
  line: number;
  note: string;
  source: string;
  nfc: string;
  nfd: string;
  nfkc: string;
  nfkd: string;
}[] = [
  {
    line: 98,
    note: 'SUPERSCRIPT TWO -- compatibility-only fold, NFC/NFD unchanged, NFKC/NFKD fold to "2"',
    source: cps('00B2'),
    nfc: cps('00B2'),
    nfd: cps('00B2'),
    nfkc: cps('0032'),
    nfkd: cps('0032'),
  },
  {
    line: 109,
    note: 'LATIN CAPITAL LETTER A WITH ACUTE -- canonical composition/decomposition',
    source: cps('00C1'),
    nfc: cps('00C1'),
    nfd: cps('0041 0301'),
    nfkc: cps('00C1'),
    nfkd: cps('0041 0301'),
  },
  {
    line: 843,
    note: 'LATIN SMALL LETTER LONG S WITH DOT ABOVE -- NFC and NFKC diverge (compatibility mapping resolves the long s)',
    source: cps('1E9B'),
    nfc: cps('1E9B'),
    nfd: cps('017F 0307'),
    nfkc: cps('1E61'),
    nfkd: cps('0073 0307'),
  },
  {
    line: 1270,
    note: 'OHM SIGN -- a singleton: its own code point differs from its canonically equivalent one even though nothing decomposes',
    source: cps('2126'),
    nfc: cps('03A9'),
    nfd: cps('03A9'),
    nfkc: cps('03A9'),
    nfkd: cps('03A9'),
  },
  {
    line: 2450,
    note: 'HANGUL SYLLABLE GA -- algorithmic Hangul composition from two jamo, not listed in any decomposition table',
    source: cps('AC00'),
    nfc: cps('AC00'),
    nfd: cps('1100 1161'),
    nfkc: cps('AC00'),
    nfkd: cps('1100 1161'),
  },
];

it('inspect returns one row per code point for a character outside the basic multilingual plane', () => {
  const grinningFace = String.fromCodePoint(0x1f600);
  const rows = inspect(grinningFace);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.codePoint).toBe('U+1F600');
  expect(rows[0]!.char).toBe(grinningFace);
  expect(rows[0]!.utf8Bytes.split(' ')).toHaveLength(4);
});

it('a zero-width space is reported invisible and normalises to itself in all four forms', () => {
  const zwsp = '​';
  const rows = inspect(zwsp);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.invisible).toBe(true);
  expect(rows[0]!.visibleAs).toBe('[ZWSP]');
  for (const form of ['NFC', 'NFD', 'NFKC', 'NFKD'] as const) {
    expect(normalise(zwsp, form), form).toBe(zwsp);
  }
});

it('a string of ordinary letters that changes under NFKC reports zero invisible characters', () => {
  // Superscript two (U+00B2) is an ordinary, visible character -- not in the
  // invisible table and not in an invisible category -- even though it
  // changes under NFKC/NFKD (folds to the digit "2"). This is the case that
  // proves invisibility and normalisation are separate properties: a
  // character that changes under normalisation is not thereby invisible.
  const superscriptTwo = '²';
  const rows = inspect(`x${superscriptTwo}y`);
  expect(rows.filter((r) => r.invisible)).toHaveLength(0);
  expect(normalise(superscriptTwo, 'NFKC')).not.toBe(superscriptTwo);
});

it('all four normalisation forms match the lines taken from Unicode NormalizationTest.txt', () => {
  for (const fixture of NORMALIZATION_FIXTURES) {
    const label = `line ${fixture.line} (${fixture.note})`;
    expect(normalise(fixture.source, 'NFC'), `${label} NFC`).toBe(fixture.nfc);
    expect(normalise(fixture.source, 'NFD'), `${label} NFD`).toBe(fixture.nfd);
    expect(normalise(fixture.source, 'NFKC'), `${label} NFKC`).toBe(fixture.nfkc);
    expect(normalise(fixture.source, 'NFKD'), `${label} NFKD`).toBe(fixture.nfkd);
  }
});

it('inspect reports an unpaired surrogate as an unpaired surrogate and emits no UTF-8 bytes for it', () => {
  const loneSurrogate = String.fromCharCode(0xd800);
  const rows = inspect(loneSurrogate);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.codePoint).toBe('U+D800');
  expect(rows[0]!.category).toContain('Cs');
  expect(rows[0]!.utf8Bytes).toBe('');
  expect(rows[0]!.note).toBeTruthy();
});

it('toEscapes and fromEscapes round trip in all three escape styles', () => {
  const sample = 'Hi éè ' + String.fromCodePoint(0x1d11e);
  const styles: EscapeStyle[] = ['javascript', 'html-numeric', 'code-point'];
  for (const style of styles) {
    const escaped = toEscapes(sample, { style });
    expect(fromEscapes(escaped, { style }), style).toBe(sample);
  }
});

it('a control character stand-in is the matching Control Pictures glyph', () => {
  const rows = inspect('\t\n');
  expect(rows[0]!.visibleAs).toBe('␉'); // SYMBOL FOR HORIZONTAL TABULATION
  expect(rows[0]!.name).toBe('TAB');
  expect(rows[1]!.visibleAs).toBe('␊'); // SYMBOL FOR LINE FEED
});

it('a character outside the table is labelled by its general category', () => {
  const rows = inspect('q');
  expect(rows[0]!.name).toBe('Lowercase Letter');
  expect(rows[0]!.category).toBe('Ll (Lowercase Letter)');
  expect(rows[0]!.invisible).toBe(false);
  expect(rows[0]!.visibleAs).toBe('q');
});

it('a C1 control not individually named in the table is still caught as invisible by its category', () => {
  const c1 = String.fromCharCode(0x81);
  expect(INVISIBLE.has(0x81)).toBe(false);
  const rows = inspect(c1);
  expect(rows[0]!.invisible).toBe(true);
  expect(rows[0]!.visibleAs).toContain('CONTROL');
});

it('an escape sequence that is malformed is rejected with its position', () => {
  expect(() => fromEscapes('ab\\uZZ', { style: 'javascript' })).toThrow(UnicodeInspectorError);
  let error: UnicodeInspectorError | undefined;
  try {
    fromEscapes('ab\\uZZ', { style: 'javascript' });
  } catch (err) {
    error = err as UnicodeInspectorError;
  }
  expect(error!.position).toBe(2);
});

it('escaping to the JavaScript, HTML numeric and code-point forms produces the expected literal spellings', () => {
  expect(toEscapes('A')).toBe('\\u0041');
  expect(toEscapes('A', { style: 'html-numeric' })).toBe('&#65;');
  expect(toEscapes('A', { style: 'code-point' })).toBe('\\u{41}');
});

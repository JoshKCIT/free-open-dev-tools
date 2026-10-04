import { toASCII as tr46ToASCII, toUnicode as tr46ToUnicode } from 'tr46';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BROWSER, FAMILY_WORDS, PROBLEM_FAMILIES, STRICT, convertName, explainName, visible } from '../src/index';
import { readVendoredRows } from './idna-test-file';

// Expected values here come from Unicode's UTS #46 (the validity criteria and the processing steps), from RFC 5893 for
// the bidirectional rules, from RFC 3492 for Punycode, and from rows of IdnaTestV2.txt 17.0.0 (named by their text in
// the comments). Characters that are invisible, blank or direction-changing are built at run time with
// String.fromCodePoint, because a file-writing tool can turn written-out escapes into the characters themselves.

const cp = (value: number): string => String.fromCodePoint(value);
const PRINTABLE_ASCII = /^[ -~]*$/;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const toAscii = (name: string, profile: 'strict' | 'browser' = 'strict') =>
  convertName(name, { direction: 'to-ascii', profile });
const toUnicode = (name: string, profile: 'strict' | 'browser' = 'strict') =>
  convertName(name, { direction: 'to-unicode', profile });

it('bidi rules are judged on the whole name, not label by label', () => {
  const alef = cp(0x5d0); // a right-to-left letter
  const agrave = cp(0xe0);
  // IdnaTestV2 17.0.0 has the row "0à.א" with status [B1]: the first label starts with a digit, which only matters
  // because the second label is written right to left. Each label alone is fine.
  expect(toAscii('0' + agrave).valid).toBe(true);
  expect(toAscii(alef).valid).toBe(true);
  const together = toAscii('0' + agrave + '.' + alef);
  expect(together.valid).toBe(false);
  expect(together.problems.map((problem) => [problem.family, problem.label])).toEqual([['bidi', 1]]);
  // The right-to-left label is not blamed, and a name with no right-to-left label is not judged by those rules at all.
  expect(toAscii('0a.b').valid).toBe(true);
  // Labels that follow the rules for their own direction are fine whatever the other labels are.
  expect(toAscii('a.b.' + alef).valid).toBe(true);
  // The order of the labels does not matter: the whole name is one bidi domain name.
  const reversed = toAscii(alef + '.0' + agrave);
  expect(reversed.problems.map((problem) => [problem.family, problem.label])).toEqual([['bidi', 2]]);
  // A profile with the bidi check off judges nothing by those rules, and the name is then valid.
  expect(explainName('0' + agrave + '.' + alef, { ...STRICT, checkBidi: false })).toEqual([]);
  // The browser profile keeps the bidi check on.
  expect(toAscii('0' + agrave + '.' + alef, 'browser').problems.map((problem) => problem.family)).toEqual(['bidi']);
});

it('offending code points are shown as U+ values with control and bidirectional characters escaped', () => {
  const override = cp(0x202e); // right-to-left override, a bidirectional control character
  const bell = cp(0x07); // a control character
  const inBidi = toAscii('a' + override + 'b.example');
  expect(inBidi.valid).toBe(false);
  expect(inBidi.problems).toHaveLength(1);
  expect(inBidi.problems[0]?.family).toBe('processing');
  expect(inBidi.problems[0]?.label).toBe(1);
  expect(inBidi.problems[0]?.codePoints).toEqual(['U+202E']);
  expect(inBidi.problems[0]?.message).toContain('U+202E');
  const inControl = toAscii('ab' + bell + '.example');
  expect(inControl.problems[0]?.codePoints).toEqual(['U+0007']);
  // Every explanation is plain printable ASCII: no code point named in one can reorder or hide the text around it.
  for (const result of [inBidi, inControl]) {
    for (const problem of result.problems) {
      expect(PRINTABLE_ASCII.test(problem.message)).toBe(true);
      for (const value of problem.codePoints) expect(/^U\+[0-9A-F]{4,6}$/.test(value)).toBe(true);
    }
  }
  // A code point above U+FFFF shows all its digits, and a long list is cut with a count of the rest.
  const astral = toAscii('a' + cp(0xe0000) + '.example');
  expect(astral.problems[0]?.codePoints).toEqual(['U+E0000']);
  const manyPrivate = Array.from({ length: 12 }, (_, index) => cp(0xe000 + index)).join('');
  const many = toAscii('a' + manyPrivate + '.example');
  expect(many.problems[0]?.codePoints).toHaveLength(8);
  expect(many.problems[0]?.codePoints[0]).toBe('U+E000');
  expect(many.problems[0]?.message).toContain('and 4 more');
});

it('an xn-- label that cannot be decoded is reported as such, never wrapped or cut', () => {
  // The digits of a Punycode value are base 36; a long run of the largest digit overflows any integer width. A decoder
  // that wrapped around would give a short string of other characters; this one must say it cannot decode.
  const overflow = 'xn--' + '9'.repeat(30) + '.example';
  for (const profile of ['strict', 'browser'] as const) {
    for (const direction of ['to-ascii', 'to-unicode'] as const) {
      const result = convertName(overflow, { direction, profile });
      expect(result.valid).toBe(false);
      expect(result.ascii).toBeNull();
      expect(result.unicode).toBeNull();
      expect(result.problems).toHaveLength(1);
      expect(result.problems[0]?.family).toBe('processing');
      expect(result.problems[0]?.label).toBe(1);
      expect(result.problems[0]?.message).toContain('cannot be decoded');
    }
  }
  // The same for a very long run, which must neither hang nor give a result.
  const long = toAscii('xn--' + '9'.repeat(4000));
  expect(long.valid).toBe(false);
  expect(long.problems[0]?.message).toContain('cannot be decoded');
  // A label that starts with xn-- and holds a character that is not ASCII is not Punycode at all.
  const notAscii = toAscii('xn--' + cp(0xe9) + 'a.example');
  expect(notAscii.problems[0]?.family).toBe('processing');
  expect(notAscii.problems[0]?.message).toContain('not ASCII');
  // UTS 46 section 4: a label that decodes to nothing, or to ASCII only, is an error. xn--ab-- decodes to the ASCII text
  // ab-, and xn-- alone decodes to nothing.
  const asciiOnly = toAscii('xn--ab--');
  expect(asciiOnly.valid).toBe(false);
  expect(asciiOnly.problems[0]?.family).toBe('processing');
  expect(asciiOnly.problems[0]?.message).toContain('ASCII');
  expect(toAscii('xn--').problems[0]?.family).toBe('processing');
  // Valid Punycode in a name that is otherwise valid still decodes (IdnaTestV2 17.0.0: xn--bcher-kva.de is bücher.de).
  expect(toUnicode('xn--bcher-kva.de').unicode).toBe('b' + cp(0xfc) + 'cher.de');
});

it('hyphens, STD3 characters, joiners and combining marks are named with their label and code points', () => {
  // UTS 46 4.1: no hyphens in both the third and fourth positions, none at either end (strict profile only).
  const thirdFourth = toAscii('ab--cd.example');
  expect(thirdFourth.problems.map((problem) => [problem.family, problem.label])).toEqual([['hyphen', 1]]);
  expect(toAscii('-ab.example').problems.map((problem) => [problem.family, problem.label])).toEqual([['hyphen', 1]]);
  expect(toAscii('example.ab-').problems.map((problem) => [problem.family, problem.label])).toEqual([['hyphen', 2]]);
  expect(toAscii('ab--cd.example', 'browser').valid).toBe(true);
  expect(toAscii('-ab.example', 'browser').valid).toBe(true);
  // STD3: ASCII characters other than a-z, 0-9 and the hyphen (strict profile only).
  const underscore = toAscii('a_b.example');
  expect(underscore.problems.map((problem) => [problem.family, problem.label])).toEqual([['std3', 1]]);
  expect(underscore.problems[0]?.codePoints).toEqual(['U+005F']);
  expect(toAscii('a_b.example', 'browser').valid).toBe(true);
  // Joiners (RFC 5892 appendix A): a zero width joiner between two Latin letters is not allowed; IdnaTestV2 17.0.0 has
  // the row a, U+200D, b with status C2.
  const joiner = toAscii('a' + cp(0x200d) + 'b.example');
  expect(joiner.problems.map((problem) => [problem.family, problem.label])).toEqual([['joiner', 1]]);
  expect(joiner.problems[0]?.codePoints).toEqual(['U+200D']);
  expect(toAscii('a' + cp(0x200d) + 'b.example', 'browser').problems.map((problem) => problem.family)).toEqual([
    'joiner',
  ]);
  // A label may not begin with a combining mark (UTS 46 4.1, criterion 6).
  const mark = toAscii(cp(0x300) + 'a.example');
  expect(mark.problems.map((problem) => [problem.family, problem.label])).toEqual([['processing', 1]]);
  expect(mark.problems[0]?.codePoints).toEqual(['U+0300']);
  // Two labels with the same problem are one entry that counts the other.
  const twice = toAscii('a_b.c_d.example');
  expect(twice.problems).toHaveLength(1);
  expect(twice.problems[0]?.message).toContain('1 more label');
});

it('an empty label or a lone dot is explained as an empty label and never converted silently', () => {
  for (const name of ['a..b', '.', '..', '.a', cp(0x3002)]) {
    for (const profile of ['strict', 'browser'] as const) {
      for (const direction of ['to-ascii', 'to-unicode'] as const) {
        const result = convertName(name, { direction, profile });
        expect(result.valid, name + ' ' + profile + ' ' + direction).toBe(false);
        expect(result.ascii).toBeNull();
        expect(result.unicode).toBeNull();
        expect(result.problems.some((problem) => problem.family === 'empty-label')).toBe(true);
      }
    }
  }
  const middle = toAscii('a..b');
  expect(middle.problems[0]).toMatchObject({ family: 'empty-label', label: 2 });
  // IdnaTestV2 17.0.0 gives the empty string the status X4_2 for ToUnicode.
  expect(explainName('', STRICT, 'to-unicode').map((problem) => problem.family)).toEqual(['empty-label']);
  // A final full stop is the empty root label: UTS 46 4.2 passes it through unless VerifyDnsLength is on, and the
  // data lists the strict result as A4_2 (a label length error), so the strict profile names a length problem.
  const root = toAscii('example.com.');
  expect(root.valid).toBe(false);
  expect(root.problems.map((problem) => problem.family)).toEqual(['length']);
  expect(toAscii('example.com.', 'browser')).toMatchObject({
    valid: true,
    ascii: 'example.com.',
    unicode: 'example.com.',
  });
  expect(toUnicode('example.com.').valid).toBe(true);
});

it('every explanation is short plain ASCII that repeats nothing pasted', () => {
  const rows = readVendoredRows();
  let explained = 0;
  for (const row of rows) {
    for (const profile of [STRICT, BROWSER]) {
      for (const direction of ['to-ascii', 'to-unicode'] as const) {
        for (const problem of explainName(row.source, profile, direction)) {
          explained++;
          if (!PRINTABLE_ASCII.test(problem.message) || problem.message.length > 400) {
            throw new Error('line ' + row.line + ': an explanation is not short plain ASCII');
          }
          expect(problem.codePoints.length).toBeLessThanOrEqual(8);
          expect(PROBLEM_FAMILIES).toContain(problem.family);
          expect(Number.isInteger(problem.label) && problem.label >= 0).toBe(true);
        }
      }
    }
  }
  expect(explained).toBeGreaterThan(10_000);
}, 60_000);

it('a name made only of dots is explained in a few lines, not one per label', () => {
  const dots = '.'.repeat(4096);
  const result = toAscii(dots);
  expect(result.problems.length).toBeLessThanOrEqual(4);
  const long = toAscii(('a_' + '.').repeat(2000) + 'example');
  expect(long.problems.length).toBeLessThanOrEqual(8);
});

it('family names are looked up in a Map and have words for the page', () => {
  expect([...PROBLEM_FAMILIES]).toEqual(['hyphen', 'bidi', 'joiner', 'std3', 'length', 'processing', 'empty-label']);
  for (const family of PROBLEM_FAMILIES) {
    const words = FAMILY_WORDS.get(family);
    expect(typeof words).toBe('string');
    expect((words ?? '').length).toBeGreaterThan(3);
  }
  for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty'])
    expect(FAMILY_WORDS.get(key)).toBeUndefined();
});

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

it('a name is explained exactly when conversion refuses it, for 6,000 seeded random names', () => {
  // Pieces that exercise every family: letters, digits, hyphens, dots (and the dots UTS 46 maps to dots), underscores,
  // Punycode starts and bad Punycode, combining marks, joiners, Hebrew and Arabic letters and digits, deviation
  // characters, characters with no mapping, controls, emoji and an unpaired surrogate. Built at run time.
  const pieces = [
    'a',
    'b',
    'z',
    'x',
    '0',
    '7',
    '-',
    '--',
    '.',
    '.',
    cp(0x3002),
    cp(0xff0e),
    '_',
    ' ',
    'xn--',
    'xn--a',
    'xn--9999999',
    'xn--bcher-kva',
    'A',
    'B',
    'ab--',
    cp(0xe9),
    cp(0xfc),
    cp(0xdf),
    cp(0x3c2),
    cp(0x300),
    cp(0x308),
    cp(0x200c),
    cp(0x200d),
    cp(0x94d),
    cp(0x5d0),
    cp(0x5d1),
    cp(0x627),
    cp(0x628),
    cp(0x660),
    cp(0x661),
    cp(0x6f1),
    cp(0x4e2d),
    cp(0x6587),
    cp(0xff41),
    cp(0x1f600),
    cp(0x202e),
    cp(0x7),
    cp(0xad),
    cp(0x200b),
    cp(0xe000),
    cp(0xfffd),
    cp(0xa0),
    cp(0x2488),
    String.fromCharCode(0xd800),
  ];
  const random = mulberry32(46);
  let refusedCount = 0;
  for (let i = 0; i < 6000; i++) {
    const count = 1 + Math.floor(random() * 7);
    let name = '';
    for (let j = 0; j < count; j++) name += pieces[Math.floor(random() * pieces.length)] ?? 'a';
    for (const profile of [STRICT, BROWSER]) {
      for (const direction of ['to-ascii', 'to-unicode'] as const) {
        const explained = explainName(name, profile, direction).length > 0;
        const unicode = tr46ToUnicode(name, profile);
        const labels = unicode.domain.split('.');
        const body = labels.length > 1 && labels[labels.length - 1] === '' ? labels.slice(0, -1) : labels;
        const emptyLabel = body.includes('');
        const refused = emptyLabel || (direction === 'to-ascii' ? tr46ToASCII(name, profile) === null : unicode.error);
        if (explained !== refused) {
          throw new Error(
            'seeded name ' +
              i +
              ' ' +
              direction +
              ' explained=' +
              explained +
              ' refused=' +
              refused +
              ' ' +
              visible(name, 40),
          );
        }
        if (refused) refusedCount++;
      }
    }
  }
  expect(refusedCount).toBeGreaterThan(8000);
});

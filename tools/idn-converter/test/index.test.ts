import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  IdnConverterError,
  MAX_INPUT_CHARACTERS,
  MAX_LINES,
  MAX_NAME_CHARACTERS,
  PROFILES,
  checkSizes,
  convertName,
  convertNames,
  visible,
} from '../src/index';

// The number of times the package asked tr46 to convert something, counted by wrapping the real functions (nothing is
// replaced: every call still runs the real code). A refusal before conversion must leave the count at zero.
const counter = vi.hoisted(() => ({ calls: 0 }));
vi.mock('tr46', async (importOriginal) => {
  const real = await importOriginal<typeof import('tr46')>();
  return {
    ...real,
    toASCII: (...args: Parameters<typeof real.toASCII>) => {
      counter.calls++;
      return real.toASCII(...args);
    },
    toUnicode: (...args: Parameters<typeof real.toUnicode>) => {
      counter.calls++;
      return real.toUnicode(...args);
    },
  };
});

const cp = (value: number): string => String.fromCodePoint(value);
const BACKSLASH = String.fromCharCode(92);
const MARKER = 'FODT-IDN-MARKER-4417';
const STRICT_ASCII = { direction: 'to-ascii', profile: 'strict' } as const;
const BROWSER_ASCII = { direction: 'to-ascii', profile: 'browser' } as const;

beforeEach(() => {
  counter.calls = 0;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** What a thrown call threw, or undefined when it did not throw. */
function thrown(call: () => unknown): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  return undefined;
}

it('inputs over the limits are refused before conversion', () => {
  expect(MAX_INPUT_CHARACTERS).toBe(100_000);
  expect(MAX_LINES).toBe(5_000);
  expect(MAX_NAME_CHARACTERS).toBe(4_096);

  // Exactly 100,000 characters in 25 lines is accepted: 24 names of 4,096 characters, 23 line feeds, and a last name
  // that makes up the rest.
  const longName = 'b'.repeat(MAX_NAME_CHARACTERS);
  const head = Array.from({ length: 24 }, () => longName).join('\n') + '\n';
  const exact = head + 'c'.repeat(MAX_INPUT_CHARACTERS - head.length);
  expect(exact.length).toBe(100_000);
  const accepted = convertNames(exact, BROWSER_ASCII);
  expect(accepted).toHaveLength(25);
  expect(accepted.every((row) => row.valid)).toBe(true);
  expect(counter.calls).toBeGreaterThan(0);

  // One more character is refused with nothing converted.
  counter.calls = 0;
  const over = exact + 'c';
  const tooMuch = thrown(() => convertNames(over, STRICT_ASCII));
  expect(tooMuch).toBeInstanceOf(IdnConverterError);
  expect((tooMuch as IdnConverterError).message).toContain('100,001');
  expect((tooMuch as IdnConverterError).message).toContain('100,000');
  expect(counter.calls).toBe(0);

  // 5,000 names is accepted (blank lines do not count), 5,001 is refused and says which line is the first one over.
  const five = Array.from({ length: MAX_LINES }, (_, index) => 'n' + index + '.example');
  expect(convertNames(five.join('\n\n'), BROWSER_ASCII)).toHaveLength(MAX_LINES);
  counter.calls = 0;
  const sixThousand = thrown(() => convertNames([...five, 'one-more.example'].join('\n'), BROWSER_ASCII));
  expect(sixThousand).toBeInstanceOf(IdnConverterError);
  expect((sixThousand as IdnConverterError).line).toBe(MAX_LINES + 1);
  expect((sixThousand as IdnConverterError).message).toContain('5,000');
  expect(counter.calls).toBe(0);

  // A name of 4,096 characters is accepted, 4,097 is refused naming its line, and a marker in the refused name is not
  // repeated by the message.
  expect(convertNames('d'.repeat(MAX_NAME_CHARACTERS), BROWSER_ASCII)).toHaveLength(1);
  counter.calls = 0;
  const longLine = thrown(() => convertNames('a.example\n\n' + MARKER + 'e'.repeat(MAX_NAME_CHARACTERS), STRICT_ASCII));
  expect(longLine).toBeInstanceOf(IdnConverterError);
  expect((longLine as IdnConverterError).line).toBe(3);
  expect((longLine as IdnConverterError).message).toContain('4,096');
  expect((longLine as IdnConverterError).message).not.toContain(MARKER);
  expect((longLine as IdnConverterError).message).not.toContain('FODT');
  expect(counter.calls).toBe(0);
  // Characters are counted as people see them, not as UTF-16 units: a name of 4,096 emoji is accepted.
  expect(thrown(() => checkSizes(cp(0x1f600).repeat(MAX_NAME_CHARACTERS)))).toBeUndefined();
  expect(thrown(() => checkSizes(cp(0x1f600).repeat(MAX_NAME_CHARACTERS + 1)))).toBeInstanceOf(IdnConverterError);
  // The input limit counts characters the same way: 25 names of 2,400 emoji are 60,000 characters (120,000 UTF-16 units)
  // and are accepted; 25 names of 4,000 emoji are 100,024 characters with the line feeds, and are refused.
  const sixtyThousand = Array.from({ length: 25 }, () => cp(0x1f600).repeat(2400)).join('\n');
  expect(thrown(() => checkSizes(sixtyThousand))).toBeUndefined();
  const hundredThousand = Array.from({ length: 25 }, () => cp(0x1f600).repeat(4000)).join('\n');
  const refusedEmoji = thrown(() => checkSizes(hundredThousand));
  expect(refusedEmoji).toBeInstanceOf(IdnConverterError);
  expect((refusedEmoji as IdnConverterError).message).toContain('100,024');
});

it('labels of 63 octets and names of 253 octets pass and one more fails under the strict profile', () => {
  // UTS 46 section 4.2: the name, without a final dot, is 1 to 253 octets and each label 1 to 63 (octets of the ASCII
  // form, so xn-- counts). RFC 1034 section 3.5 has the same limits.
  const label63 = 'a'.repeat(63);
  const label64 = 'a'.repeat(64);
  expect(convertNames(label63 + '.example', STRICT_ASCII)[0]?.valid).toBe(true);
  const sixtyFour = convertNames(label64 + '.example', STRICT_ASCII)[0];
  expect(sixtyFour?.valid).toBe(false);
  expect(sixtyFour?.ascii).toBeNull();
  expect(sixtyFour?.problems).toHaveLength(1);
  expect(sixtyFour?.problems[0]).toMatchObject({ family: 'length', label: 1 });
  expect(sixtyFour?.problems[0]?.message).toContain('64');
  // The browser profile does not check lengths.
  expect(convertNames(label64 + '.example', BROWSER_ASCII)[0]?.valid).toBe(true);
  // Going to Unicode no length is checked (UTS 46 ToUnicode has none), and the ASCII form is still shown.
  expect(convertNames(label64 + '.example', { direction: 'to-unicode', profile: 'strict' })[0]).toMatchObject({
    valid: true,
    ascii: label64 + '.example',
    unicode: label64 + '.example',
  });

  // 253 octets: three labels of 63, one of 61, and three dots.
  const name253 = [label63, label63, label63, 'b'.repeat(61)].join('.');
  expect(name253.length).toBe(253);
  expect(convertNames(name253, STRICT_ASCII)[0]?.valid).toBe(true);
  const name254 = [label63, label63, label63, 'b'.repeat(62)].join('.');
  expect(name254.length).toBe(254);
  const over = convertNames(name254, STRICT_ASCII)[0];
  expect(over?.valid).toBe(false);
  expect(over?.problems).toHaveLength(1);
  expect(over?.problems[0]).toMatchObject({ family: 'length' });
  expect(over?.problems[0]?.message).toContain('254');
  // A final full stop is not counted in the name's length (UTS 46 4.2) but is itself refused by the strict profile.
  const rootOnly = convertNames(name253 + '.', STRICT_ASCII)[0];
  expect(rootOnly?.problems).toHaveLength(1);
  expect(rootOnly?.problems[0]?.message).toContain('ends with a full stop');
  const rootAndLong = convertNames(name254 + '.', STRICT_ASCII)[0];
  expect(rootAndLong?.problems).toHaveLength(2);
  expect(rootAndLong?.problems.some((problem) => problem.message.includes('254'))).toBe(true);
  expect(convertNames(name254, BROWSER_ASCII)[0]?.valid).toBe(true);

  // Lengths are octets of the ASCII form: a label of Han characters counts its xn-- form. Eleven characters (U+4E00 and
  // the ten after it) give "xn--" and Punycode digits; the test finds the length with its own RFC 3492 encoder.
  const han = (count: number): string => Array.from({ length: count }, (_, index) => cp(0x4e00 + index)).join('');
  let at63 = 0;
  for (let count = 1; count < 60; count++) {
    const octets = 4 + rfcPunycode(Array.from(han(count), (ch) => ch.codePointAt(0) ?? 0)).length;
    if (octets === 63) at63 = count;
  }
  expect(at63).toBeGreaterThan(5);
  const exactly63 = convertNames(han(at63), STRICT_ASCII)[0];
  expect(exactly63?.valid).toBe(true);
  expect(exactly63?.ascii?.length).toBe(63);
  const sixtyFourOctets = convertNames(han(at63 + 1), STRICT_ASCII)[0];
  expect(sixtyFourOctets?.valid).toBe(false);
  expect(sixtyFourOctets?.problems[0]).toMatchObject({ family: 'length', label: 1 });
  expect(convertNames(han(at63 + 1), BROWSER_ASCII)[0]?.valid).toBe(true);
});

it('empty input gives no rows and blank lines are skipped while line numbers stay as pasted', () => {
  expect(convertNames('', STRICT_ASCII)).toEqual([]);
  expect(convertNames('   \n\t\n\r\n', STRICT_ASCII)).toEqual([]);
  const rows = convertNames('\n\nexample.com\r\n \n  Example.ORG  \n', STRICT_ASCII);
  expect(rows.map((row) => [row.line, row.input, row.ascii])).toEqual([
    [3, 'example.com', 'example.com'],
    [5, 'Example.ORG', 'example.org'],
  ]);
  // A byte order mark at the start of a paste is not part of the first name.
  expect(convertNames(cp(0xfeff) + 'example.com', STRICT_ASCII)[0]).toMatchObject({
    line: 1,
    valid: true,
    ascii: 'example.com',
  });
});

it('automatic direction goes to ASCII for a non-ASCII name, to Unicode for an xn-- name and shows both otherwise', () => {
  const rows = convertNames(
    ['b' + cp(0xfc) + 'cher.de', 'xn--bcher-kva.de', 'Example.COM', 'XN--BCHER-KVA.DE'].join('\n'),
    {
      direction: 'auto',
      profile: 'strict',
    },
  );
  expect(rows.map((row) => row.direction)).toEqual(['to-ascii', 'to-unicode', 'both', 'to-unicode']);
  // IdnaTestV2 17.0.0 rows: bücher.de is xn--bcher-kva.de, and xn--bcher-kva.de is bücher.de.
  expect(rows[0]).toMatchObject({ valid: true, ascii: 'xn--bcher-kva.de', unicode: 'b' + cp(0xfc) + 'cher.de' });
  expect(rows[1]).toMatchObject({ valid: true, ascii: 'xn--bcher-kva.de', unicode: 'b' + cp(0xfc) + 'cher.de' });
  expect(rows[2]).toMatchObject({ valid: true, ascii: 'example.com', unicode: 'example.com' });
  expect(rows[3]).toMatchObject({ valid: true, ascii: 'xn--bcher-kva.de', unicode: 'b' + cp(0xfc) + 'cher.de' });
  // An xn-- label that is not the first one counts, and so does one in capitals.
  expect(convertNames('www.xn--bcher-kva.de', { direction: 'auto', profile: 'strict' })[0]?.direction).toBe(
    'to-unicode',
  );
  // A name with one non-ASCII character goes to ASCII even when another label is already Punycode.
  expect(convertNames('xn--bcher-kva.' + cp(0xfc) + 'x', { direction: 'auto', profile: 'browser' })[0]?.direction).toBe(
    'to-ascii',
  );
  // Chosen directions are kept.
  expect(convertNames('xn--bcher-kva.de', STRICT_ASCII)[0]?.direction).toBe('to-ascii');
  expect(convertNames('b' + cp(0xfc) + 'cher.de', { direction: 'to-unicode', profile: 'strict' })[0]?.direction).toBe(
    'to-unicode',
  );
});

it('the Unicode form is the one UTS 46 mapping and NFC give, not the pasted spelling', () => {
  // IdnaTestV2 17.0.0: Bu + U+0308 + cher.de, BÜCHER.DE and bücher.de all give bücher.de and xn--bcher-kva.de.
  const decomposed = 'Bu' + cp(0x308) + 'cher.de';
  const row = convertNames(decomposed, { direction: 'auto', profile: 'strict' })[0];
  expect(row).toMatchObject({ valid: true, ascii: 'xn--bcher-kva.de', unicode: 'b' + cp(0xfc) + 'cher.de' });
  expect(row?.input).toBe(decomposed);
  // UTS 46 maps the ideographic full stop (U+3002) to a dot and full-width letters to ASCII; IdnaTestV2 17.0.0 has
  // rows for the full stops.
  const wide = convertNames(cp(0xff41) + cp(0xff42) + cp(0x3002) + cp(0xff43), {
    direction: 'auto',
    profile: 'strict',
  })[0];
  expect(wide).toMatchObject({ valid: true, ascii: 'ab.c', unicode: 'ab.c' });
  // Characters UTS 46 ignores (a soft hyphen, a zero width space) are removed, and the input column still shows them.
  const hidden = convertNames('ex' + cp(0xad) + cp(0x200b) + 'ample.com', { direction: 'auto', profile: 'strict' })[0];
  expect(hidden).toMatchObject({ valid: true, ascii: 'example.com', unicode: 'example.com' });
});

it('control, bidirectional and invisible characters are shown as escapes', () => {
  const escaped = (code: number): string => BACKSLASH + 'u{' + code.toString(16).toUpperCase() + '}';
  for (const code of [0x0, 0x7, 0x1f, 0x7f, 0x85, 0x9f, 0x61c, 0x200e, 0x200f, 0x202a, 0x202e, 0x2066, 0x2069]) {
    expect(visible('a' + cp(code) + 'b')).toBe('a' + escaped(code) + 'b');
  }
  // Invisible characters a name could hide behind: soft hyphen, zero width space, joiners, word joiner, byte order mark,
  // a variation selector, a Hangul filler, a no-break space and an ideographic space.
  for (const code of [
    0xad, 0x34f, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0xfe0f, 0x3164, 0xa0, 0x3000, 0x2003, 0xe0020,
  ]) {
    expect(visible('a' + cp(code) + 'b')).toBe('a' + escaped(code) + 'b');
  }
  // An unpaired surrogate is shown as an escape too.
  expect(visible('a' + String.fromCharCode(0xd800) + 'b')).toBe('a' + escaped(0xd800) + 'b');
  // Ordinary text is not changed, a pair is one character, and a long text is cut with an ellipsis.
  expect(visible('b' + cp(0xfc) + cp(0x1f600) + 'x')).toBe('b' + cp(0xfc) + cp(0x1f600) + 'x');
  expect(visible('abcdef', 3)).toBe('abc' + cp(0x2026));
  expect(visible(cp(0x1f600).repeat(5), 4)).toBe(cp(0x1f600).repeat(4) + cp(0x2026));
});

it('messages never repeat what was pasted', () => {
  // A marker inside names that are invalid in every way the package explains must not come back in any message,
  // code point list or error.
  const names = [
    MARKER + '_x.example',
    'ab--' + MARKER.toLowerCase() + '.example',
    '-' + MARKER + '.example',
    MARKER + cp(0x7) + '.example',
    cp(0x300) + MARKER + '.example',
    'xn--' + MARKER + '.example',
    MARKER + '..example',
    MARKER + '.' + cp(0x5d0),
    ('x'.repeat(64) + MARKER).toLowerCase() + '.example',
  ];
  for (const profile of ['strict', 'browser'] as const) {
    for (const direction of ['to-ascii', 'to-unicode', 'auto'] as const) {
      for (const row of convertNames(names.join('\n'), { direction, profile })) {
        for (const problem of row.problems) {
          expect(problem.message.toUpperCase()).not.toContain('FODT');
          expect(problem.message.toUpperCase()).not.toContain('MARKER');
          expect(problem.codePoints.join(' ').toUpperCase()).not.toContain('MARKER');
        }
      }
    }
  }
  // Bad options are refused without echoing them, even when there is nothing to convert.
  expect(thrown(() => convertNames('', { direction: 'auto', profile: MARKER as never }))).toBeInstanceOf(
    IdnConverterError,
  );
  expect(thrown(() => convertNames('', { direction: MARKER as never, profile: 'strict' }))).toBeInstanceOf(
    IdnConverterError,
  );
  for (const bad of [MARKER, '__proto__', 'constructor', 'toString', '']) {
    const asProfile = thrown(() => convertNames('a.example', { direction: 'auto', profile: bad as never }));
    expect(asProfile).toBeInstanceOf(IdnConverterError);
    expect((asProfile as IdnConverterError).message).not.toContain('FODT');
    const asDirection = thrown(() => convertNames('a.example', { direction: bad as never, profile: 'strict' }));
    expect(asDirection).toBeInstanceOf(IdnConverterError);
    expect((asDirection as IdnConverterError).message).not.toContain('FODT');
  }
});

it('names that are keys of every object are converted as ordinary names', () => {
  const rows = convertNames(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf.example'].join('\n'), {
    direction: 'auto',
    profile: 'strict',
  });
  // Underscores are not letters, digits or hyphens: the strict profile explains them; nothing else goes wrong.
  expect(rows.map((row) => [row.valid, row.problems.map((problem) => problem.family)])).toEqual([
    [false, ['std3']],
    [true, []],
    [true, []],
    [true, []],
    [true, []],
  ]);
  expect(rows[1]).toMatchObject({ ascii: 'constructor', unicode: 'constructor' });
  expect([...PROFILES.keys()]).toEqual(['strict', 'browser']);
  expect(PROFILES.get('__proto__' as never)).toBeUndefined();
  expect(PROFILES.get('constructor' as never)).toBeUndefined();
});

it('5,000 valid names convert in a few seconds', () => {
  const names = Array.from({ length: MAX_LINES }, (_, index) => cp(0xe9) + index + '.example');
  const started = performance.now();
  const rows = convertNames(names.join('\n'), { direction: 'auto', profile: 'strict' });
  const elapsed = performance.now() - started;
  expect(rows).toHaveLength(MAX_LINES);
  expect(
    rows.every((row) => row.valid && row.problems.length === 0 && row.ascii !== null && row.unicode !== null),
  ).toBe(true);
  expect(elapsed).toBeLessThan(20_000);
}, 60_000);

it('5,000 invalid names are explained in a few seconds', () => {
  const names = Array.from(
    { length: MAX_LINES },
    (_, index) => 'x' + index + '_' + cp(0xe9) + '.' + cp(0x5d0) + '.example',
  );
  const started = performance.now();
  const rows = convertNames(names.join('\n'), { direction: 'auto', profile: 'strict' });
  const elapsed = performance.now() - started;
  expect(rows).toHaveLength(MAX_LINES);
  expect(rows.every((row) => !row.valid && row.problems.length > 0)).toBe(true);
  expect(elapsed).toBeLessThan(20_000);
}, 60_000);

// ---------------------------------------------------------------------------------------------------------------
// RFC 3492 section 7.1 sample strings, and a second, independent encoder written from RFC 3492 section 6.3.

interface RfcSample {
  id: string;
  codePoints: number[];
  punycode: string;
}

// Copied from https://www.rfc-editor.org/rfc/rfc3492 section 7.1 (fetched 2026-10-04): the code points as the RFC lists
// them and the Punycode text after it, with the case flags the RFC shows (an upper case letter in the Punycode, which
// decoding ignores).
const RFC_SAMPLES: RfcSample[] = [
  {
    id: 'A',
    codePoints: [
      0x0644, 0x064a, 0x0647, 0x0645, 0x0627, 0x0628, 0x062a, 0x0643, 0x0644, 0x0645, 0x0648, 0x0634, 0x0639, 0x0631,
      0x0628, 0x064a, 0x061f,
    ],
    punycode: 'egbpdaj6bu4bxfgehfvwxn',
  },
  {
    id: 'B',
    codePoints: [0x4ed6, 0x4eec, 0x4e3a, 0x4ec0, 0x4e48, 0x4e0d, 0x8bf4, 0x4e2d, 0x6587],
    punycode: 'ihqwcrb4cv8a8dqg056pqjye',
  },
  {
    id: 'C',
    codePoints: [0x4ed6, 0x5011, 0x7232, 0x4ec0, 0x9ebd, 0x4e0d, 0x8aaa, 0x4e2d, 0x6587],
    punycode: 'ihqwctvzc91f659drss3x8bo0yb',
  },
  {
    id: 'D',
    codePoints: [
      0x0050, 0x0072, 0x006f, 0x010d, 0x0070, 0x0072, 0x006f, 0x0073, 0x0074, 0x011b, 0x006e, 0x0065, 0x006d, 0x006c,
      0x0075, 0x0076, 0x00ed, 0x010d, 0x0065, 0x0073, 0x006b, 0x0079,
    ],
    punycode: 'Proprostnemluvesky-uyb24dma41a',
  },
  {
    id: 'E',
    codePoints: [
      0x05dc, 0x05de, 0x05d4, 0x05d4, 0x05dd, 0x05e4, 0x05e9, 0x05d5, 0x05d8, 0x05dc, 0x05d0, 0x05de, 0x05d3, 0x05d1,
      0x05e8, 0x05d9, 0x05dd, 0x05e2, 0x05d1, 0x05e8, 0x05d9, 0x05ea,
    ],
    punycode: '4dbcagdahymbxekheh6e0a7fei0b',
  },
  {
    id: 'F',
    codePoints: [
      0x092f, 0x0939, 0x0932, 0x094b, 0x0917, 0x0939, 0x093f, 0x0928, 0x094d, 0x0926, 0x0940, 0x0915, 0x094d, 0x092f,
      0x094b, 0x0902, 0x0928, 0x0939, 0x0940, 0x0902, 0x092c, 0x094b, 0x0932, 0x0938, 0x0915, 0x0924, 0x0947, 0x0939,
      0x0948, 0x0902,
    ],
    punycode: 'i1baa7eci9glrd9b2ae1bj0hfcgg6iyaf8o0a1dig0cd',
  },
  {
    id: 'G',
    codePoints: [
      0x306a, 0x305c, 0x307f, 0x3093, 0x306a, 0x65e5, 0x672c, 0x8a9e, 0x3092, 0x8a71, 0x3057, 0x3066, 0x304f, 0x308c,
      0x306a, 0x3044, 0x306e, 0x304b,
    ],
    punycode: 'n8jok5ay5dzabd5bym9f0cm5685rrjetr6pdxa',
  },
  {
    id: 'H',
    codePoints: [
      0xc138, 0xacc4, 0xc758, 0xbaa8, 0xb4e0, 0xc0ac, 0xb78c, 0xb4e4, 0xc774, 0xd55c, 0xad6d, 0xc5b4, 0xb97c, 0xc774,
      0xd574, 0xd55c, 0xb2e4, 0xba74, 0xc5bc, 0xb9c8, 0xb098, 0xc88b, 0xc744, 0xae4c,
    ],
    punycode: '989aomsvi5e83db1d2a355cv1e0vak1dwrv93d5xbh15a0dt30a5jpsd879ccm6fea98c',
  },
  {
    id: 'I',
    codePoints: [
      0x043f, 0x043e, 0x0447, 0x0435, 0x043c, 0x0443, 0x0436, 0x0435, 0x043e, 0x043d, 0x0438, 0x043d, 0x0435, 0x0433,
      0x043e, 0x0432, 0x043e, 0x0440, 0x044f, 0x0442, 0x043f, 0x043e, 0x0440, 0x0443, 0x0441, 0x0441, 0x043a, 0x0438,
    ],
    punycode: 'b1abfaaepdrnnbgefbaDotcwatmq2g4l',
  },
  {
    id: 'J',
    codePoints: [
      0x0050, 0x006f, 0x0072, 0x0071, 0x0075, 0x00e9, 0x006e, 0x006f, 0x0070, 0x0075, 0x0065, 0x0064, 0x0065, 0x006e,
      0x0073, 0x0069, 0x006d, 0x0070, 0x006c, 0x0065, 0x006d, 0x0065, 0x006e, 0x0074, 0x0065, 0x0068, 0x0061, 0x0062,
      0x006c, 0x0061, 0x0072, 0x0065, 0x006e, 0x0045, 0x0073, 0x0070, 0x0061, 0x00f1, 0x006f, 0x006c,
    ],
    punycode: 'PorqunopuedensimplementehablarenEspaol-fmd56a',
  },
  {
    id: 'K',
    codePoints: [
      0x0054, 0x1ea1, 0x0069, 0x0073, 0x0061, 0x006f, 0x0068, 0x1ecd, 0x006b, 0x0068, 0x00f4, 0x006e, 0x0067, 0x0074,
      0x0068, 0x1ec3, 0x0063, 0x0068, 0x1ec9, 0x006e, 0x00f3, 0x0069, 0x0074, 0x0069, 0x1ebf, 0x006e, 0x0067, 0x0056,
      0x0069, 0x1ec7, 0x0074,
    ],
    punycode: 'TisaohkhngthchnitingVit-kjcr8268qyxafd2f1b9g',
  },
  {
    id: 'L',
    codePoints: [0x0033, 0x5e74, 0x0042, 0x7d44, 0x91d1, 0x516b, 0x5148, 0x751f],
    punycode: '3B-ww4c5e180e575a65lsy2b',
  },
  {
    id: 'M',
    codePoints: [
      0x5b89, 0x5ba4, 0x5948, 0x7f8e, 0x6075, 0x002d, 0x0077, 0x0069, 0x0074, 0x0068, 0x002d, 0x0053, 0x0055, 0x0050,
      0x0045, 0x0052, 0x002d, 0x004d, 0x004f, 0x004e, 0x004b, 0x0045, 0x0059, 0x0053,
    ],
    punycode: '-with-SUPER-MONKEYS-pc58ag80a8qai00g7n9n',
  },
  {
    id: 'N',
    codePoints: [
      0x0048, 0x0065, 0x006c, 0x006c, 0x006f, 0x002d, 0x0041, 0x006e, 0x006f, 0x0074, 0x0068, 0x0065, 0x0072, 0x002d,
      0x0057, 0x0061, 0x0079, 0x002d, 0x305d, 0x308c, 0x305e, 0x308c, 0x306e, 0x5834, 0x6240,
    ],
    punycode: 'Hello-Another-Way--fc4qua05auwb3674vfr0b',
  },
  {
    id: 'O',
    codePoints: [0x3072, 0x3068, 0x3064, 0x5c4b, 0x6839, 0x306e, 0x4e0b, 0x0032],
    punycode: '2-u9tlzr9756bt3uc0v',
  },
  {
    id: 'P',
    codePoints: [
      0x004d, 0x0061, 0x006a, 0x0069, 0x3067, 0x004b, 0x006f, 0x0069, 0x3059, 0x308b, 0x0035, 0x79d2, 0x524d,
    ],
    punycode: 'MajiKoi5-783gue6qz075azm5e',
  },
  {
    id: 'Q',
    codePoints: [0x30d1, 0x30d5, 0x30a3, 0x30fc, 0x0064, 0x0065, 0x30eb, 0x30f3, 0x30d0],
    punycode: 'de-jg4avhby1noc0d',
  },
  { id: 'R', codePoints: [0x305d, 0x306e, 0x30b9, 0x30d4, 0x30fc, 0x30c9, 0x3067], punycode: 'd9juau41awczczp' },
  {
    id: 'S',
    codePoints: [0x002d, 0x003e, 0x0020, 0x0024, 0x0031, 0x002e, 0x0030, 0x0030, 0x0020, 0x003c, 0x002d],
    punycode: '-> $1.00 <--',
  },
];

/** The encoder of RFC 3492 section 6.3 (Punycode), written from the RFC's pseudocode; it takes code points. */
function rfcPunycode(input: number[]): string {
  const base = 36;
  const tMin = 1;
  const tMax = 26;
  const skew = 38;
  const damp = 700;
  const digit = (value: number): string => String.fromCharCode(value < 26 ? value + 97 : value + 22);
  const adapt = (previous: number, numPoints: number, first: boolean): number => {
    let delta = first ? Math.floor(previous / damp) : Math.floor(previous / 2);
    delta += Math.floor(delta / numPoints);
    let k = 0;
    while (delta > Math.floor(((base - tMin) * tMax) / 2)) {
      delta = Math.floor(delta / (base - tMin));
      k += base;
    }
    return k + Math.floor(((base - tMin + 1) * delta) / (delta + skew));
  };
  let n = 128;
  let delta = 0;
  let bias = 72;
  let output = input
    .filter((code) => code < 128)
    .map((code) => String.fromCharCode(code))
    .join('');
  const basic = output.length;
  let handled = basic;
  if (basic > 0) output += '-';
  while (handled < input.length) {
    let smallest = Number.POSITIVE_INFINITY;
    for (const code of input) if (code >= n && code < smallest) smallest = code;
    delta += (smallest - n) * (handled + 1);
    n = smallest;
    for (const code of input) {
      if (code < n) delta++;
      if (code === n) {
        let q = delta;
        for (let k = base; ; k += base) {
          const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
          if (q < t) break;
          output += digit(t + ((q - t) % (base - t)));
          q = Math.floor((q - t) / (base - t));
        }
        output += digit(q);
        bias = adapt(delta, handled + 1, handled === basic);
        delta = 0;
        handled++;
      }
    }
    delta++;
    n++;
  }
  return output;
}

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

it('Punycode agrees with the RFC 3492 sample strings and with an independent encoder', () => {
  // First the test's own encoder must reproduce every sample of the RFC (case flags are upper case letters in the
  // RFC's Punycode text, so the comparison ignores case).
  for (const sample of RFC_SAMPLES) {
    expect(rfcPunycode(sample.codePoints).toLowerCase(), sample.id).toBe(sample.punycode.toLowerCase());
  }
  // The samples the converter reproduces: lower case letters and valid characters only. The browser profile is used
  // so a long label (sample H is 72 octets) is not refused for length. Samples not run are listed with their reason:
  // UTS 46 maps upper case to lower case, so the Punycode of a label with capitals (D, J, K, L, M, N, P) differs by
  // design; sample A holds U+061F ARABIC QUESTION MARK and sample S holds spaces and punctuation, which UTS 46 does not
  // allow in a label.
  const notRun = new Map<string, string>([
    ['A', 'U+061F is disallowed'],
    ['D', 'capital letters are mapped'],
    ['J', 'capital letters are mapped'],
    ['K', 'capital letters are mapped'],
    ['L', 'capital letters are mapped'],
    ['M', 'capital letters are mapped'],
    ['N', 'capital letters are mapped'],
    ['P', 'capital letters are mapped'],
    ['S', 'spaces and punctuation are disallowed'],
  ]);
  const ran: string[] = [];
  for (const sample of RFC_SAMPLES) {
    if (notRun.has(sample.id)) continue;
    ran.push(sample.id);
    const label = sample.codePoints.map((code) => String.fromCodePoint(code)).join('');
    const result = convertName(label, BROWSER_ASCII);
    expect(result.problems, sample.id).toEqual([]);
    expect(result.ascii, sample.id).toBe('xn--' + sample.punycode.toLowerCase());
    expect(
      convertName('xn--' + sample.punycode, { direction: 'to-unicode', profile: 'browser' }).unicode,
      sample.id,
    ).toBe(label);
  }
  expect(ran).toEqual(['B', 'C', 'E', 'F', 'G', 'H', 'I', 'O', 'Q', 'R']);
  // The samples not run, and why, are the ones named above: nothing was dropped without a reason.
  expect([...notRun.keys()]).toEqual(['A', 'D', 'J', 'K', 'L', 'M', 'N', 'P', 'S']);

  // Then 400 seeded random labels of valid lower case letters and digits against the independent encoder.
  const pool = [
    ...'abcdefghijklmnopqrstuvwxyz0123456789',
    ...Array.from({ length: 20 }, (_, index) => String.fromCodePoint(0xe0 + index)), // Latin-1 small letters with accents
    ...Array.from({ length: 24 }, (_, index) => String.fromCodePoint(0x3b1 + index)).filter(
      (ch) => ch !== String.fromCodePoint(0x3c2),
    ),
    ...Array.from({ length: 32 }, (_, index) => String.fromCodePoint(0x430 + index)), // Cyrillic small letters
    ...Array.from({ length: 40 }, (_, index) => String.fromCodePoint(0x4e00 + index * 7)), // Han characters
    ...Array.from({ length: 30 }, (_, index) => String.fromCodePoint(0x3042 + index * 2)), // Hiragana
  ];
  const random = mulberry32(20261004);
  let nonAscii = 0;
  for (let i = 0; i < 400; i++) {
    const length = 2 + Math.floor(random() * 11);
    let label = '';
    for (let j = 0; j < length; j++) label += pool[Math.floor(random() * pool.length)] ?? 'a';
    const codePoints = Array.from(label, (ch) => ch.codePointAt(0) ?? 0);
    const wantAscii = codePoints.every((code) => code < 128) ? label : 'xn--' + rfcPunycode(codePoints);
    if (wantAscii !== label) nonAscii++;
    const result = convertName(label, { direction: 'to-ascii', profile: 'browser' });
    expect(result.problems.map((problem) => problem.message)).toEqual([]);
    expect(result.ascii).toBe(wantAscii);
    expect(convertName(wantAscii, { direction: 'to-unicode', profile: 'browser' }).unicode).toBe(label);
  }
  expect(nonAscii).toBeGreaterThan(300);
});

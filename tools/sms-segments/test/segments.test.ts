import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import {
  MAX_MESSAGE_UNITS,
  OFFENDERS,
  SmsSegmentsError,
  analyseMessage,
  describeForced,
  gsmSafeCopy,
  septetsOf,
  visible,
  type Analysis,
} from '../src/index';
import { MAX_SCALING_RATIO, scalingRatio } from './scaling';

// Sources of the expected values in this file:
//  - 3GPP TS 23.040 clause 9.2.3.24.1: "the maximum length of the short message within the TPUD field is 153 (160-7)
//    characters" for GSM 7-bit data, "A character represented by an escape-sequence shall not be split in the middle", 67
//    ((140-6)/2) UCS2 characters a part, "A UCS2 character shall not be split in the middle", and "39015 (255*153)" default
//    alphabet characters as the most a concatenated message holds. One message holds 160 septets or 70 UCS-2 units
//    (TS 23.038 clause 6.2.3).
//  - Hand-derived rows: each is the splitting rule applied by hand (a character that does not fit in what is left of a part
//    starts the next part), with the arithmetic in a comment.
//  - The recorded counts of split-sms 0.1.7 on a seeded corpus (test/fixtures/counts).

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
const SMALL_C_CEDILLA = cp(0xe7);
const EURO = cp(0x20ac);
const SMILE = cp(0x1f600);
const CURLY_APOSTROPHE = cp(0x2019);
const COMBINING_ACUTE = cp(0x301);

function fixture(path: string): string {
  return readFileSync(new URL(`./fixtures/${path}`, import.meta.url), 'utf8');
}

const used = (a: Analysis): number[] => a.segments.map((s) => s.used);
const lengths = (a: Analysis): number[] => a.segments.map((s) => [...s.text].length);

afterEach(() => {
  vi.restoreAllMocks();
});

// 3GPP TS 23.040 clause 9.2.3.24.1: "the maximum length of the short message within the TPUD field is 153 (160-7)
// characters" for uncompressed GSM 7-bit default alphabet data, and a message that fits in one is 160 septets.
it('161 plain letters need 2 segments of 153 and 8 septets', () => {
  const one = analyseMessage('a'.repeat(160));
  expect(one.encoding).toBe('gsm7');
  expect(one.units).toBe(160);
  expect(one.segments.map((s) => s.used)).toEqual([160]);
  expect(one.segments.map((s) => s.capacity)).toEqual([160]);

  const two = analyseMessage('a'.repeat(161));
  expect(two.encoding).toBe('gsm7');
  expect(two.characters).toBe(161);
  expect(two.units).toBe(161);
  expect(two.single).toBe(160);
  expect(two.part).toBe(153);
  expect(two.segments.map((s) => s.used)).toEqual([153, 8]);
  expect(two.segments.map((s) => s.capacity)).toEqual([153, 153]);
  const last = two.segments[two.segments.length - 1]!;
  expect(last.capacity - last.used).toBe(145);
});

it('160, 161, 306 and 307 plain letters give 1, 2, 2 and 3 segments', () => {
  // 306 is two full parts of 153 (TS 23.040: 153 is 160 minus 7); one more letter opens a third part.
  expect(used(analyseMessage('a'.repeat(160)))).toEqual([160]);
  expect(used(analyseMessage('a'.repeat(161)))).toEqual([153, 8]);
  expect(used(analyseMessage('a'.repeat(306)))).toEqual([153, 153]);
  expect(used(analyseMessage('a'.repeat(307)))).toEqual([153, 153, 1]);
  // Nothing is lost: the parts put back together are the message.
  const text = 'a'.repeat(307);
  expect(
    analyseMessage(text)
      .segments.map((s) => s.text)
      .join(''),
  ).toBe(text);
});

it('70, 71, 134 and 135 lower case c cedillas give UCS-2 with 1, 2, 2 and 3 segments', () => {
  // One message holds 70 units, a part of a longer one 67 ((140-6)/2); 134 is two full parts.
  for (const [count, expected] of [
    [70, [70]],
    [71, [67, 4]],
    [134, [67, 67]],
    [135, [67, 67, 1]],
  ] as const) {
    const result = analyseMessage(SMALL_C_CEDILLA.repeat(count));
    expect(result.encoding, String(count)).toBe('ucs2');
    expect(result.single).toBe(70);
    expect(result.part).toBe(67);
    expect(used(result), String(count)).toEqual([...expected]);
  }
});

it('an extension character counts two septets and its escape pair moves whole to the next segment', () => {
  // The ten extension characters, one by one: two septets each.
  for (const character of ['\f', '^', '{', '}', '\\', '[', '~', ']', '|', EURO]) {
    const result = analyseMessage(character);
    expect(result.encoding, character).toBe('gsm7');
    expect(result.units, character).toBe(2);
    expect(result.characters, character).toBe(1);
    expect(used(result), character).toEqual([2]);
  }
  // 80 euro signs are 160 septets: one message. 81 are 162: a part holds 76 (152 septets), because a 77th would end at 154
  // and its escape pair is not split, so it starts the second part with the other 5 (10 septets).
  const eighty = analyseMessage(EURO.repeat(80));
  expect(eighty.units).toBe(160);
  expect(used(eighty)).toEqual([160]);
  const eightyOne = analyseMessage(EURO.repeat(81));
  expect(eightyOne.units).toBe(162);
  expect(used(eightyOne)).toEqual([152, 10]);
  expect(lengths(eightyOne)).toEqual([76, 5]);
  // 158 letters and a euro sign are 160 septets: one message. 159 letters and a euro sign are 161: the 6 letters and the
  // euro sign (8 septets) follow the first 153.
  const fits = analyseMessage('a'.repeat(158) + EURO);
  expect(fits.units).toBe(160);
  expect(used(fits)).toEqual([160]);
  const over = analyseMessage('a'.repeat(159) + EURO);
  expect(over.units).toBe(161);
  expect(used(over)).toEqual([153, 8]);
  expect(lengths(over)).toEqual([153, 7]);
  // 152 letters, a euro sign and 10 letters: the escape pair would end at 154, so it moves whole to the second part,
  // leaving the first with 152; the second holds 2 + 10 septets.
  const moved = analyseMessage('a'.repeat(152) + EURO + 'b'.repeat(10));
  expect(moved.units).toBe(164);
  expect(used(moved)).toEqual([152, 12]);
  expect(lengths(moved)).toEqual([152, 11]);
  expect(moved.segments[1]!.text.startsWith(EURO)).toBe(true);
  // The part left one short is warned about.
  expect(moved.warnings.some((w) => w.includes('one septet short'))).toBe(true);
  // Line breaks: a carriage return and a line feed are one septet each, so 80 pairs are one message and 81 pairs are
  // 162 septets, split after the carriage return that ends the first 153.
  const crlf80 = analyseMessage('\r\n'.repeat(80));
  expect(used(crlf80)).toEqual([160]);
  const crlf81 = analyseMessage('\r\n'.repeat(81));
  expect(used(crlf81)).toEqual([153, 9]);
  // A browser text box gives one character for a line break, so 160 of them are one message.
  expect(used(analyseMessage('\n'.repeat(160)))).toEqual([160]);
});

it('a surrogate pair counts two units and is never split between segments', () => {
  const emoji34 = analyseMessage(SMILE.repeat(34));
  expect(emoji34.encoding).toBe('ucs2');
  expect(emoji34.characters).toBe(34);
  expect(emoji34.units).toBe(68);
  expect(used(emoji34)).toEqual([68]);
  expect(used(analyseMessage(SMILE.repeat(35)))).toEqual([70]);
  // 36 are 72 units: 33 pairs fill 66 of a part's 67, and the 34th pair would end at 68, so it starts the second part.
  const emoji36 = analyseMessage(SMILE.repeat(36));
  expect(emoji36.units).toBe(72);
  expect(used(emoji36)).toEqual([66, 6]);
  expect(lengths(emoji36)).toEqual([33, 3]);
  // 66 letters, a pair and 10 letters are 78 units: the pair would straddle unit 67, so the first part holds 66.
  const straddle = analyseMessage('a'.repeat(66) + SMILE + 'b'.repeat(10));
  expect(straddle.units).toBe(78);
  expect(used(straddle)).toEqual([66, 12]);
  expect(lengths(straddle)).toEqual([66, 11]);
  expect(straddle.warnings.some((w) => w.includes('one unit short'))).toBe(true);
  // With 65 letters the pair ends exactly at 67 and fits.
  const fitting = analyseMessage('a'.repeat(65) + SMILE + 'b'.repeat(10));
  expect(fitting.units).toBe(77);
  expect(used(fitting)).toEqual([67, 10]);
  // However the text is cut, no part ever starts or ends in the middle of a pair.
  for (const count of [30, 34, 35, 36, 40, 67, 68, 100]) {
    for (const lead of [0, 1, 2]) {
      const result = analyseMessage('a'.repeat(lead) + SMILE.repeat(count));
      for (const segment of result.segments) {
        for (let i = 0; i < segment.text.length; i++) {
          const unit = segment.text.charCodeAt(i);
          if (unit >= 0xd800 && unit <= 0xdbff) {
            const next = segment.text.charCodeAt(i + 1);
            expect(next >= 0xdc00 && next <= 0xdfff, `${count} after ${lead}`).toBe(true);
            i++;
          } else {
            expect(unit >= 0xdc00 && unit <= 0xdfff, `${count} after ${lead}`).toBe(false);
          }
        }
      }
    }
  }
});

it('one character outside the alphabet turns the whole message into UCS-2 and is listed with its code point', () => {
  const message = `see you at the caf${CURLY_APOSTROPHE}s`;
  const result = analyseMessage(message);
  expect(result.encoding).toBe('ucs2');
  expect(result.units).toBe(message.length);
  expect(result.forced).toEqual([{ character: CURLY_APOSTROPHE, codePoint: 0x2019, count: 1, firstAt: 19 }]);
  expect(result.warnings[0]).toContain('One character outside the GSM 7-bit alphabet (U+2019)');
  // Every distinct character is listed once, in order of first appearance, with its count.
  const several = analyseMessage(`${CURLY_APOSTROPHE}a${SMILE}${CURLY_APOSTROPHE}b${SMILE}${SMILE}`);
  expect(several.forced.map((f) => [f.codePoint, f.count, f.firstAt])).toEqual([
    [0x2019, 2, 1],
    [0x1f600, 3, 3],
  ]);
  expect(several.warnings[0]).toContain('5 characters outside the GSM 7-bit alphabet (2 kinds, listed below)');
  // One kind repeated is named as one kind (review B-IN-01).
  const repeated = analyseMessage(cp(0x436).repeat(70));
  expect(repeated.warnings[0]).toContain('70 characters outside the GSM 7-bit alphabet (1 kind, listed below)');
  // 159 letters and a curly apostrophe: 160 units, which is more than the 70 of one UCS-2 message and makes 3 parts.
  const flipped = analyseMessage('a'.repeat(159) + CURLY_APOSTROPHE);
  expect(flipped.encoding).toBe('ucs2');
  expect(flipped.units).toBe(160);
  expect(used(flipped)).toEqual([67, 67, 26]);
  // A message with only alphabet characters lists nothing.
  expect(analyseMessage('plain text').forced).toEqual([]);
  expect(describeForced(0x2019).name.length).toBeGreaterThan(0);
});

it('the recorded split-sms counts equal the encoding and segment count on every non-empty corpus row', () => {
  const recorded = JSON.parse(fixture('counts/counts.json')) as {
    recordedAt: string;
    library: string;
    seed: number;
    rows: { text: string; encoding: string; parts: number }[];
  };
  expect(recorded.library).toBe('split-sms 0.1.7');
  expect(recorded.seed).toBe(12345);
  expect(recorded.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  expect(recorded.rows).toHaveLength(690);
  const emptyRows: number[] = [];
  let compared = 0;
  recorded.rows.forEach((row, index) => {
    if (row.text === '') {
      emptyRows.push(index);
      return;
    }
    compared++;
    const result = analyseMessage(row.text);
    expect(result.encoding, `row ${index}`).toBe(row.encoding);
    expect(result.segments.length, `row ${index}`).toBe(row.parts);
  });
  expect(compared).toBe(660);
  // The difference by design, named: for empty text the library reports one part; the specification has nothing to send,
  // so this tool says 0 segments. All 30 empty rows (length 0, five mixes, six each) are the only rows that differ.
  expect(emptyRows).toHaveLength(30);
  for (const index of emptyRows) {
    expect(recorded.rows[index]!.parts).toBe(1);
    expect(analyseMessage('').segments).toHaveLength(0);
  }
  // The corpus reaches both encodings and up to several parts, so the comparison means something.
  expect(recorded.rows.some((r) => r.encoding === 'gsm7' && r.parts > 1)).toBe(true);
  expect(recorded.rows.some((r) => r.encoding === 'ucs2' && r.parts > 1)).toBe(true);
});

it('empty text needs 0 segments and one character needs 1', () => {
  const empty = analyseMessage('');
  expect(empty.segments).toEqual([]);
  expect(empty.units).toBe(0);
  expect(empty.characters).toBe(0);
  expect(empty.codeUnits).toBe(0);
  expect(empty.forced).toEqual([]);
  expect(empty.warnings).toEqual([]);
  expect(empty.encoding).toBe('gsm7');

  const letter = analyseMessage('a');
  expect(letter.encoding).toBe('gsm7');
  expect(letter.units).toBe(1);
  expect(used(letter)).toEqual([1]);

  const euro = analyseMessage(EURO);
  expect(euro.encoding).toBe('gsm7');
  expect(euro.characters).toBe(1);
  expect(euro.units).toBe(2);
  expect(used(euro)).toEqual([2]);

  const smile = analyseMessage(SMILE);
  expect(smile.encoding).toBe('ucs2');
  expect(smile.characters).toBe(1);
  expect(smile.codeUnits).toBe(2);
  expect(smile.units).toBe(2);
  expect(used(smile)).toEqual([2]);
});

it('characters are code points, a lone surrogate counts as one forced unit and the text is never normalised', () => {
  // A pair is one character of two units.
  const pair = analyseMessage(`a${SMILE}b`);
  expect(pair.characters).toBe(3);
  expect(pair.codeUnits).toBe(4);
  // A lone surrogate is one forced character of one unit, shown as an escape.
  for (const unit of [0xd83d, 0xde00]) {
    const lone = String.fromCharCode(unit);
    const result = analyseMessage(`a${lone}b`);
    expect(result.encoding).toBe('ucs2');
    expect(result.characters).toBe(3);
    expect(result.units).toBe(3);
    expect(result.forced).toEqual([{ character: lone, codePoint: unit, count: 1, firstAt: 2 }]);
    expect(visible(lone, 40)).toBe(`${String.fromCharCode(92)}u{${unit.toString(16).toUpperCase()}}`);
    expect(describeForced(unit).name).toContain('Unpaired surrogate');
  }
  // A high surrogate followed by an ordinary letter is not a pair.
  const broken = analyseMessage(String.fromCharCode(0xd83d) + 'a');
  expect(broken.characters).toBe(2);
  expect(broken.units).toBe(2);
  // Text is counted as typed and never normalised: e and a combining acute stay two characters, and each part of the
  // answer carries them as they were.
  const decomposed = `caf${'e' + COMBINING_ACUTE}`;
  const result = analyseMessage(decomposed);
  expect(result.characters).toBe(5);
  expect(result.units).toBe(5);
  expect(result.encoding).toBe('ucs2');
  expect(result.forced.map((f) => f.codePoint)).toEqual([0x301]);
  expect(result.segments[0]!.text).toBe(decomposed);
  // The composed letter e acute is in the alphabet; the Angstrom sign, which NFC would turn into one, is not.
  expect(analyseMessage(`caf${cp(0xe9)}`).encoding).toBe('gsm7');
  const angstrom = analyseMessage(cp(0x212b));
  expect(angstrom.encoding).toBe('ucs2');
  expect(angstrom.segments[0]!.text).toBe(cp(0x212b));
});

it('decomposed text that NFC would shorten and more than 255 parts are warned about', () => {
  // e and a combining acute: five units in UCS-2; joined, café is four septets in the alphabet.
  const decomposed = analyseMessage(`caf${'e' + COMBINING_ACUTE}`);
  const warning = decomposed.warnings.find((w) => w.includes('NFC'));
  expect(warning).toBeDefined();
  expect(warning).toContain('4 septets in 1 segment instead of 5 UTF-16 units in 1 segment.');
  // Forty such letters are 80 units and 2 segments; joined they are 40 septets and 1 segment.
  const forty = analyseMessage(('e' + COMBINING_ACUTE).repeat(40));
  expect(used(forty)).toEqual([67, 13]);
  expect(
    forty.warnings.some(
      (w) => w.includes('NFC') && w.includes('in 1 segment instead of 80 UTF-16 units in 2 segments.'),
    ),
  ).toBe(true);
  // NFC also replaces single signs with the letter they look like: the Angstrom sign, the Ohm sign and the Kelvin sign.
  // The warning names both kinds of change, not only a combining mark (review B-IN-02).
  for (const text of [`Size 5${cp(0x212b)}`, `10 ${cp(0x2126)}`, `300 ${cp(0x212a)}`]) {
    const sign = analyseMessage(text).warnings.find((w) => w.includes('NFC'));
    expect(sign, text).toBeDefined();
    expect(sign).toContain('a sign such as the Angstrom, Ohm or Kelvin sign becomes the letter it looks like');
    expect(sign).toContain('in 1 segment instead of');
    expect(sign).toMatch(/UTF-16 units in 1 segment[.]/);
  }
  expect(warning).toContain('a letter followed by a combining mark becomes one letter');
  // No warning when joining would change nothing: a letter with no composed form, composed text, an emoji.
  for (const text of [`q${COMBINING_ACUTE}`, `caf${cp(0xe9)}`, `${SMALL_C_CEDILLA}${SMILE}`, 'plain']) {
    expect(
      analyseMessage(text).warnings.some((w) => w.includes('NFC')),
      text,
    ).toBe(false);
  }
  // 255 parts of 153 is 39,015 septets, the most TS 23.040 allows; one more makes 256 parts and a warning.
  const most = analyseMessage('a'.repeat(153 * 255));
  expect(most.segments).toHaveLength(255);
  expect(most.warnings).toEqual([]);
  const tooMany = analyseMessage('a'.repeat(153 * 255 + 1));
  expect(tooMany.segments).toHaveLength(256);
  expect(tooMany.warnings.some((w) => w.includes('256 parts') && w.includes('at most 255 parts'))).toBe(true);
  // The same in UCS-2: 255 parts of 67 units is 17,085.
  expect(analyseMessage(SMALL_C_CEDILLA.repeat(67 * 255)).segments).toHaveLength(255);
  expect(analyseMessage(SMALL_C_CEDILLA.repeat(67 * 255 + 1)).segments).toHaveLength(256);
});

it('every listed character has its recorded Unicode name and a suggestion written in the GSM 7-bit alphabet', () => {
  const recorded = JSON.parse(fixture('names/unicode-names.json')) as {
    recordedAt: string;
    python: string;
    aliasOnly: string[];
    names: Record<string, string>;
  };
  expect(recorded.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  expect(recorded.python).toMatch(/^3\./);
  const label = (code: number): string => 'U+' + code.toString(16).toUpperCase().padStart(4, '0');
  // The recording covers exactly the listed characters.
  expect(Object.keys(recorded.names).sort()).toEqual([...OFFENDERS.keys()].map(label).sort());
  expect(OFFENDERS.size).toBeGreaterThanOrEqual(25);
  for (const [code, entry] of OFFENDERS) {
    expect(entry.unicodeName, label(code)).toBe(recorded.names[label(code)]);
    // The listed character really is outside the alphabet, or listing it would be pointless.
    expect(septetsOf(String.fromCodePoint(code)), label(code)).toBeUndefined();
    // The suggestion is entirely GSM 7-bit.
    for (const character of entry.suggestion)
      expect(septetsOf(character), `${label(code)} ${entry.suggestion}`).toBeDefined();
    expect(entry.name.length, label(code)).toBeGreaterThan(0);
    expect(entry.name, label(code)).not.toContain(cp(0x2014));
  }
  // The control characters have an alias only, and they are named.
  expect(recorded.aliasOnly).toEqual(['U+0009']);
  // A character that is not listed is described by its code point.
  expect(describeForced(0x4e2d)).toEqual({ name: 'U+4E2D', suggestion: undefined });
  expect(OFFENDERS.has(0x5f)).toBe(false);
});

it('the GSM-safe copy replaces each listed character and never changes the input', () => {
  for (const [code, entry] of OFFENDERS) {
    const character = String.fromCodePoint(code);
    // Joining characters is not what is under test here: every listed character is already in composed form.
    expect(character.normalize('NFC')).toBe(character);
    const input = `a${character}b`;
    const copy = gsmSafeCopy(input);
    expect(copy.text, `U+${code.toString(16)}`).toBe(`a${entry.suggestion}b`);
    expect(copy.replaced).toBe(1);
    expect(copy.normalised).toBe(false);
    expect(copy.remaining).toBe(0);
    expect(input).toBe(`a${character}b`);
    expect(analyseMessage(copy.text).encoding).toBe('gsm7');
  }
  // One message with all of them turns into a message in the alphabet.
  const everything = [...OFFENDERS.keys()].map((code) => String.fromCodePoint(code)).join(' ');
  const before = analyseMessage(everything);
  const whole = gsmSafeCopy(everything);
  expect(whole.replaced).toBe(OFFENDERS.size);
  expect(whole.remaining).toBe(0);
  expect(analyseMessage(whole.text).encoding).toBe('gsm7');
  expect(analyseMessage(everything)).toEqual(before);
  // Text already in the alphabet comes back the same and counts nothing.
  expect(gsmSafeCopy('plain text, 100%')).toEqual({
    text: 'plain text, 100%',
    replaced: 0,
    normalised: false,
    remaining: 0,
  });
  // Joining a letter and its combining accent gives a letter the alphabet has; nothing was replaced.
  const joined = gsmSafeCopy(`caf${'e' + COMBINING_ACUTE}`);
  expect(joined).toEqual({ text: `caf${cp(0xe9)}`, replaced: 0, normalised: true, remaining: 0 });
  // A character that is not listed stays, and is counted.
  const unlisted = gsmSafeCopy(`${cp(0x4e2d)}${CURLY_APOSTROPHE}`);
  expect(unlisted).toEqual({ text: `${cp(0x4e2d)}'`, replaced: 1, normalised: false, remaining: 1 });
  // A lone surrogate stays and is counted.
  expect(gsmSafeCopy(String.fromCharCode(0xd83d)).remaining).toBe(1);
});

it('a message over 100,000 UTF-16 units is refused before any work naming the limit', () => {
  expect(MAX_MESSAGE_UNITS).toBe(100_000);
  // 100,000 units are read: 654 parts of 153 (the last one short), more than 255, with a warning.
  const atLimit = analyseMessage('a'.repeat(100_000));
  expect(atLimit.units).toBe(100_000);
  expect(atLimit.segments).toHaveLength(654);
  expect(atLimit.warnings.some((w) => w.includes('654 parts'))).toBe(true);
  // 100,001 are refused, naming the limit and the 255 parts a concatenated message can have.
  const refuse = (call: () => unknown): SmsSegmentsError => {
    try {
      call();
    } catch (err) {
      expect(err).toBeInstanceOf(SmsSegmentsError);
      return err as SmsSegmentsError;
    }
    throw new Error('not refused');
  };
  for (const text of ['a'.repeat(100_001), 'a'.repeat(99_999) + SMILE, SMILE.repeat(50_001)]) {
    expect(text.length).toBeGreaterThan(100_000);
    const error = refuse(() => analyseMessage(text));
    expect(error.message).toContain('100,000');
    expect(error.message).toContain('255 parts');
    expect(error.message.length).toBeLessThan(400);
    expect(refuse(() => gsmSafeCopy(text)).message).toContain('100,000');
  }
  // Refused before any work: the string is not walked and not normalised.
  const walk = vi.spyOn(String.prototype, Symbol.iterator);
  const normalize = vi.spyOn(String.prototype, 'normalize');
  refuse(() => analyseMessage('a'.repeat(100_001)));
  refuse(() => gsmSafeCopy('a'.repeat(100_001)));
  expect(walk).not.toHaveBeenCalled();
  expect(normalize).not.toHaveBeenCalled();
});

it('refusals and warnings never show more than 40 characters of the message', () => {
  // A message of consonants only, so no fixed sentence can share a run of letters with it by chance.
  const letters = 'bcdfghjklmnpqrstvwxz';
  let seed = 424242;
  const next = (): number => (seed = (seed * 1664525 + 1013904223) >>> 0);
  let body = '';
  for (let i = 0; i < 1500; i++) body += letters[next() % letters.length];
  const marker = 'QZXJKWVMARKER';
  const messages = [
    marker + body, // GSM-7, many parts
    body + CURLY_APOSTROPHE + marker, // one character forces UCS-2
    body + SMILE.repeat(3) + marker, // surrogate pairs
    `${'e' + COMBINING_ACUTE}${marker}${body}`, // decomposed
    'a'.repeat(153 * 255 + 1) + marker, // too many parts
    `${'a'.repeat(152)}${EURO}${marker}${body}`, // a part left short
  ];
  for (const message of messages) {
    const result = analyseMessage(message);
    for (const warning of result.warnings) {
      expect(warning).not.toContain(marker);
      // No run of 8 characters of the message appears in a warning.
      for (let i = 0; i + 8 <= Math.min(message.length, 1500); i++) {
        expect(warning.includes(message.slice(i, i + 8)), warning).toBe(false);
      }
      expect(warning.length).toBeLessThan(500);
    }
  }
  const error = (() => {
    try {
      analyseMessage(marker + 'a'.repeat(100_001));
    } catch (err) {
      return err as SmsSegmentsError;
    }
    throw new Error('not refused');
  })();
  expect(error.message).not.toContain(marker);
  expect(error.message).not.toContain('aaaaaaaa');
});

it('characters named __proto__, constructor and toString are plain text', () => {
  for (const text of [
    '__proto__',
    'constructor',
    'toString',
    'hasOwnProperty',
    'valueOf',
    '__proto__ constructor toString',
  ]) {
    const result = analyseMessage(text);
    expect(result.encoding, text).toBe('gsm7');
    expect(result.units, text).toBe(text.length);
    expect(result.forced, text).toEqual([]);
    expect(result.segments[0]!.text, text).toBe(text);
    expect(septetsOf(text), text).toBeUndefined();
  }
  // Mixed with a forced character the words are still text, and the copy keeps them.
  const mixed = analyseMessage(`__proto__ constructor toString ${CURLY_APOSTROPHE}`);
  expect(mixed.forced.map((f) => f.codePoint)).toEqual([0x2019]);
  expect(gsmSafeCopy(`__proto__ constructor toString ${CURLY_APOSTROPHE}`).text).toBe(
    "__proto__ constructor toString '",
  );
  // Looking up what is not a code point listed finds nothing, whatever it is called.
  for (const key of ['__proto__', 'constructor', 'toString']) {
    expect((OFFENDERS as unknown as Map<unknown, unknown>).get(key)).toBeUndefined();
  }
  // Nothing was added to the shared object prototype.
  expect(Object.keys(Object.prototype)).toEqual([]);
  expect(({} as Record<string, unknown>)['forced']).toBeUndefined();
});

it('the analysis stays linear on hostile input', () => {
  // Hostile shapes sized so the doubled and the quadrupled string stay under the 100,000 unit limit and are read.
  const shapes: Array<[string, (n: number) => string]> = [
    ['plain letters', (n) => 'a'.repeat(n)],
    ['euro signs', (n) => EURO.repeat(Math.floor(n / 2))],
    ['surrogate pairs', (n) => SMILE.repeat(Math.floor(n / 2))],
    ['carriage return line feed', (n) => '\r\n'.repeat(Math.floor(n / 2))],
    ['one character outside the alphabet at the end', (n) => 'a'.repeat(n - 1) + SMALL_C_CEDILLA],
    ['lone surrogates', (n) => String.fromCharCode(0xd83d).repeat(n)],
    ['decomposed letters', (n) => ('e' + COMBINING_ACUTE).repeat(Math.floor(n / 2))],
    [
      'many different forced characters',
      (n) => Array.from({ length: n }, (_, i) => String.fromCodePoint(0x4e00 + (i % 20000))).join(''),
    ],
    [
      'listed characters',
      (n) =>
        [...OFFENDERS.keys()]
          .map((c) => String.fromCodePoint(c))
          .join('')
          .repeat(Math.ceil(n / 60))
          .slice(0, n),
    ],
  ];
  const analyse = (text: string): unknown => analyseMessage(text);
  const copy = (text: string): unknown => gsmSafeCopy(text);
  const median = (values: number[]): number => [...values].sort((x, y) => x - y)[1] as number;
  for (const [fn, run] of [
    ['analysis', analyse],
    ['copy', copy],
  ] as const) {
    for (const [name, make] of shapes) {
      // The doubling rule (2n against n, over 6 fails) and, because it does not catch quadratic growth by itself, an input
      // four times as long against a limit of 12: the doubling from n to 2n times the doubling from 2n to 4n. Each is the
      // median of three measurements, so one slow moment on a busy machine decides nothing.
      const doublings: number[] = [];
      const fourfold: number[] = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        const first = scalingRatio(run, make, 5000);
        const second = scalingRatio(run, make, 10_000);
        doublings.push(first);
        fourfold.push(first * second);
      }
      expect(Number.isFinite(median(doublings)), `${fn} ${name}`).toBe(true);
      expect(median(doublings), `${fn} ${name}`).toBeLessThanOrEqual(MAX_SCALING_RATIO);
      expect(median(fourfold), `${fn} ${name}`).toBeLessThanOrEqual(12);
    }
  }
  // A refusal at the length limit costs nothing like reading it.
  expect(scalingRatio(analyse, (n) => 'a'.repeat(n), 100_001)).toBeLessThanOrEqual(MAX_SCALING_RATIO);
}, 60_000);

it('analysing the same text twice gives the same segments', () => {
  const message = `Price: ${EURO}5, a curly ${CURLY_APOSTROPHE}quote${CURLY_APOSTROPHE}, ${SMILE} and ^ { } [ ] ~ | ${'x'.repeat(200)}`;
  const first = analyseMessage(message);
  const second = analyseMessage(message);
  expect(second).toEqual(first);
  // Each answer is fresh: changing one does not change the next.
  first.segments.length = 0;
  first.forced.length = 0;
  first.warnings.push('x');
  const third = analyseMessage(message);
  expect(third).toEqual(second);
  expect(third.segments.length).toBeGreaterThan(0);
});

it('the parts always add up to the message, and no part is over its capacity', () => {
  const recorded = JSON.parse(fixture('counts/counts.json')) as { rows: { text: string }[] };
  for (const [index, row] of recorded.rows.entries()) {
    const result = analyseMessage(row.text);
    expect(result.segments.map((s) => s.text).join(''), `row ${index}`).toBe(row.text);
    expect(
      result.segments.reduce((sum, s) => sum + s.used, 0),
      `row ${index}`,
    ).toBe(result.units);
    for (const segment of result.segments) expect(segment.used).toBeLessThanOrEqual(segment.capacity);
    // Every part but the last of a long message is full or one short (a character of two did not fit).
    for (const segment of result.segments.slice(0, -1)) expect(segment.capacity - segment.used).toBeLessThanOrEqual(1);
    expect(result.segments.map((s) => s.index)).toEqual(result.segments.map((_, i) => i + 1));
  }
});

it('the package prints nothing while analysing', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  analyseMessage(`caf${'e' + COMBINING_ACUTE} ${SMILE} ${EURO}`);
  gsmSafeCopy(`${CURLY_APOSTROPHE}`);
  try {
    analyseMessage('a'.repeat(100_001));
  } catch {
    // The refusal is the answer.
  }
  expect(log).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});

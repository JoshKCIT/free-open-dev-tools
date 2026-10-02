import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  MAX_INPUT_BYTES,
  TextEncodingFixerError,
  changeBom,
  convertLineEndings,
  decodeBytes,
  parseHex,
  repairMojibake,
  utf8Bytes,
} from '../src/index';
import { WINDOWS_1252_HIGH, decodeWindows1252, encodeWindows1252 } from '../src/windows-1252';

/*
 * Grounding (D-179, P13-08).
 *
 * The windows-1252 table is checked against the WHATWG Encoding Standard's own index file, copied byte for byte into
 * test/fixtures/whatwg-encoding/ (https://encoding.spec.whatwg.org/index-windows-1252.txt, fetched 2026-10-02, see the
 * UPSTREAM.md beside it). It is never checked against the decoder of the platform running the tests: Node 22 decodes
 * the label windows-1252 as Latin-1 (byte 80 is U+0080), while the browsers decode it as the standard requires (byte 80
 * is U+20AC).
 *
 * The garbled and repaired pairs are from the Python 3.14.3 standard library as a second opinion: encoding the correct
 * text as UTF-8 and decoding the bytes as cp1252, which printed
 *
 *   'café'       636166c3a9            'caf\xc3\xa9'           (U+00C3 U+00A9, a capital A with tilde and a copyright sign)
 *   '’quoted’'   e2809971756f746564e28099
 *                                      '\xe2€™quoted\xe2€™'
 *   'ü'          c3bc                  '\xc3\xbc'
 *   'ñ'          c3b1                  '\xc3\xb1'
 *   'naïve café' 6e61c3af766520636166c3a9
 *                                      'na\xc3\xafve caf\xc3\xa9'
 *
 * Python's cp1252 refuses the five bytes 81, 8D, 8F, 90 and 9D (they are undefined there); the WHATWG table maps them to
 * U+0081, U+008D, U+008F, U+0090 and U+009D, which is what this folder follows. Nothing here treats this folder's own
 * output as the expected value.
 *
 * More grounding for the later tests:
 *  - koi8-r and windows-1251: the index files of the same standard, also copied into test/fixtures/whatwg-encoding/
 *    (index-koi8-r.txt and index-windows-1251.txt, fetched 2026-10-02); every one of the 128 bytes is checked.
 *  - shift_jis: rows of index-jis0208.txt quoted as literals (pointer 0 is U+3000, 1 is U+3001, 3 is U+FF0C, 376 is
 *    U+30A1; the file has 7,724 rows), turned into byte pairs by the standard's Shift_JIS decoder (section 12.3.1: the
 *    leading byte is 0x81 plus the pointer divided by 188, the trailing byte is the pointer modulo 188 plus 0x40), and
 *    the single byte 0xB1 is U+FF71 by the same section (0xFF61 - 0xA1 + byte).
 *  - UTF-8 failures: Python 3.14.3 bytes.decode('utf-8') reports where an ill-formed sequence starts (UnicodeDecodeError
 *    .start): 636166e9 starts at 3, 6162c3 at 2, e280 at 0, e228a1 at 0, 61f09f98 at 1, c0af at 0, eda080 at 0,
 *    f4908080 at 0, and 78e282ac80 at 4.
 *  - byte order marks: Python codecs.BOM_UTF8 is efbbbf, BOM_UTF16_LE is fffe and BOM_UTF16_BE is feff.
 *  - line endings: Python re.sub on 'a\r\nb\nc\rd\r\n' counts 1 LF, 2 CRLF and 1 CR, and gives 'a\nb\nc\nd\n',
 *    'a\r\nb\r\nc\r\nd\r\n' and 'a\rb\rc\rd\r' for the three endings (each unchanged by a second pass);
 *    'x\r\ry\r\n\nz\u{2028}w' counts 1 CRLF, 2 CR and 1 LF and becomes 'x\n\ny\n\nz\u{2028}w' with LF.
 *  - Latin-1: Python '€'.encode('utf-8').decode('latin-1') is '\xe2\x82\xac' (U+00E2 U+0082 U+00AC).
 */

const logs = {
  log: vi.spyOn(console, 'log'),
  warn: vi.spyOn(console, 'warn'),
  error: vi.spyOn(console, 'error'),
};

beforeEach(() => {
  for (const spy of Object.values(logs)) spy.mockClear();
});

afterEach(() => {
  // The package prints nothing.
  for (const spy of Object.values(logs)) expect(spy).not.toHaveBeenCalled();
});

/** The index file's rows as pointer to code point: each row is "pointer, tab, 0xCODEPOINT, tab, the character and its name". */
function parseIndex(text: string): Map<number, number> {
  const rows = new Map<number, number>();
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\t0x([0-9A-Fa-f]+)\t/.exec(line);
    if (match) rows.set(Number(match[1]), parseInt(match[2]!, 16));
  }
  return rows;
}

it('the 32 windows-1252 entries match the WHATWG index file and bytes A0 to FF are the identity', () => {
  const index = parseIndex(
    readFileSync(new URL('./fixtures/whatwg-encoding/index-windows-1252.txt', import.meta.url), 'utf8'),
  );
  // The file lists pointers 0 to 127, one for each byte 0x80 to 0xFF.
  expect(index.size).toBe(128);
  expect(WINDOWS_1252_HIGH).toHaveLength(32);
  for (let pointer = 0; pointer < 32; pointer++) {
    expect(WINDOWS_1252_HIGH[pointer], `pointer ${pointer}`).toBe(index.get(pointer));
  }
  // Pointers 32 to 127 are the bytes A0 to FF, and each maps to the code point with the same number.
  for (let pointer = 32; pointer < 128; pointer++) {
    expect(index.get(pointer), `pointer ${pointer}`).toBe(0x80 + pointer);
  }

  // Every byte decodes to the index's code point, and the bytes below 80 to themselves.
  const all = Uint8Array.from({ length: 256 }, (_, byte) => byte);
  const decoded = decodeWindows1252(all);
  expect(Array.from(decoded, (character) => character.codePointAt(0))).toEqual(
    // Array.from, not all.map: a Uint8Array would cut the code points to eight bits.
    Array.from(all, (byte) => (byte < 0x80 ? byte : index.get(byte - 0x80))),
  );
  // The first and last table entries, as quoted in the research: byte 80 is the euro sign and byte 9F is Y with diaeresis.
  expect(WINDOWS_1252_HIGH[0]).toBe(0x20ac);
  expect(WINDOWS_1252_HIGH[31]).toBe(0x0178);

  // Every one of the 256 characters goes back to its own byte, and a character outside the table is named by position.
  const encoded = encodeWindows1252(decoded);
  expect(encoded.badPosition).toBeUndefined();
  expect(Array.from(encoded.bytes)).toEqual(Array.from(all));
  expect(encodeWindows1252('abĀ').badPosition).toBe(2);
  // U+0080 is not in the windows-1252 index (the byte 80 is the euro sign), so it cannot be written back.
  expect(encodeWindows1252('\u0080').badPosition).toBe(0);
});

it('garbled Windows-1252 text of cafe with an acute accent and of a curly quote repairs to the original UTF-8', () => {
  // Python: 'café'.encode('utf-8').decode('cp1252') is 'caf\xc3\xa9', and '’quoted’' gives '\xe2€™quoted\xe2€™'.
  const garbledCafe = 'cafÃ©';
  const cafe = repairMojibake(garbledCafe, 'windows-1252', { perLine: false });
  expect(cafe.text).toBe('café');
  expect(cafe.changed).toBe(true);
  expect(cafe.unrepairedLines).toEqual([]);

  const garbledQuote = 'â€™quotedâ€™';
  const quote = repairMojibake(garbledQuote, 'windows-1252', { perLine: false });
  expect(quote.text).toBe('’quoted’');
  expect(quote.changed).toBe(true);

  // Python again: 'ü' and 'ñ' garble to '\xc3\xbc' and '\xc3\xb1'.
  expect(repairMojibake('Ã¼', 'windows-1252', { perLine: false }).text).toBe('ü');
  expect(repairMojibake('Ã±', 'windows-1252', { perLine: false }).text).toBe('ñ');
  expect(repairMojibake('naÃ¯ve cafÃ©', 'windows-1252', { perLine: false }).text).toBe('naïve café');
});

/** Prints bytes as the lower case hex pairs the page shows. */
const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(' ');
const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const noLatin1 = { strictLatin1: false };

it('bytes 80 81 9F E9 decode to the euro sign, U+0081, Y with diaeresis and e acute as WHATWG requires', () => {
  const bytes = Uint8Array.from([0x80, 0x81, 0x9f, 0xe9]);
  const result = decodeBytes(bytes, 'windows-1252', noLatin1);
  // Index file rows: pointer 0 is 0x20AC, pointer 1 is 0x0081, pointer 31 is 0x0178, pointer 105 (byte E9) is 0x00E9.
  expect(Array.from(result.text, (character) => character.codePointAt(0))).toEqual([0x20ac, 0x0081, 0x0178, 0x00e9]);
  expect(result.encoding).toBe('windows-1252');
  expect(result.replacements).toBe(0);
  // Text bytes below 80 are themselves.
  expect(decodeBytes(text('Hello, 123!'), 'windows-1252', noLatin1).text).toBe('Hello, 123!');
  // The label is matched the way the standard says: ASCII case is ignored and surrounding white space is dropped.
  expect(decodeBytes(bytes, '  Windows-1252\n', noLatin1).text).toBe('€\u0081Ÿé');
  expect(decodeBytes(bytes, 'CP1252', noLatin1).text).toBe('€\u0081Ÿé');
  // UTF-8 and UTF-16 go through the platform decoder; a byte order mark is kept as U+FEFF, never dropped.
  expect(decodeBytes(text('café'), 'utf-8', noLatin1)).toEqual({
    text: 'café',
    encoding: 'utf-8',
    replacements: 0,
  });
  expect(decodeBytes(Uint8Array.from([0xef, 0xbb, 0xbf, 0x41]), 'utf-8', noLatin1).text).toBe('\u{feff}A');
  expect(decodeBytes(Uint8Array.from([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]), 'utf-16le', noLatin1).text).toBe(
    '\u{feff}hi',
  );
  // Bytes that are not valid in the encoding become U+FFFD and are counted.
  const broken = decodeBytes(Uint8Array.from([0x61, 0xff, 0x62, 0xfe]), 'utf-8', noLatin1);
  expect(broken.text).toBe('a\u{fffd}b\u{fffd}');
  expect(broken.replacements).toBe(2);
});

it('latin1, iso-8859-1, ascii and us-ascii mean windows-1252 while strict ISO-8859-1 keeps C1 controls', () => {
  const bytes = Uint8Array.from([0x80, 0x9f, 0xe9]);
  // The standard's label table gives all of these labels to windows-1252, so byte 80 is the euro sign for each.
  for (const label of ['latin1', 'iso-8859-1', 'ascii', 'us-ascii', 'l1', 'iso8859-1', 'cp819', 'ansi_x3.4-1968']) {
    const result = decodeBytes(bytes, label, noLatin1);
    expect(result.text, label).toBe('€Ÿé');
    expect(result.encoding, label).toBe('windows-1252');
  }
  // The label is matched in any ASCII case, white space around it is ignored, and the choice follows.
  for (const label of ['LATIN1', ' Latin1 ', 'ISO-8859-1', 'L1']) {
    expect(decodeBytes(bytes, label, { strictLatin1: true }).text, label).toBe('\u{80}\u{9f}\u{e9}');
    expect(decodeBytes(bytes, label, noLatin1).text, label).toBe('\u{20ac}\u{178}\u{e9}');
  }
  // True ISO-8859-1 is a choice: bytes 80 to 9F stay the control characters U+0080 to U+009F.
  for (const label of ['latin1', 'iso-8859-1', 'l1', 'iso8859-1', 'cp819']) {
    const result = decodeBytes(bytes, label, { strictLatin1: true });
    expect(result.text, label).toBe('\u0080\u009fé');
    expect(result.encoding, label).toBe('iso-8859-1');
  }
  // The choice applies to the Latin-1 labels only; the labels that name windows-1252 itself, and other encodings, are unchanged.
  expect(decodeBytes(bytes, 'windows-1252', { strictLatin1: true }).text).toBe('€Ÿé');
  expect(decodeBytes(bytes, 'ascii', { strictLatin1: true }).text).toBe('€Ÿé');
  expect(decodeBytes(Uint8Array.from([0xc0]), 'koi8-r', { strictLatin1: true }).text).toBe('ю');
  // Every one of the 256 bytes gives its own code point in true ISO-8859-1.
  const all = Uint8Array.from({ length: 256 }, (_, byte) => byte);
  expect(Array.from(decodeBytes(all, 'iso-8859-1', { strictLatin1: true }).text, (c) => c.codePointAt(0))).toEqual(
    Array.from(all),
  );
});

it('koi8-r, windows-1251 and shift_jis labels decode index-file bytes to their index characters', () => {
  const rows = (name: string): Map<number, number> =>
    parseIndex(readFileSync(new URL(`./fixtures/whatwg-encoding/index-${name}.txt`, import.meta.url), 'utf8'));
  for (const name of ['koi8-r', 'windows-1251']) {
    const index = rows(name);
    expect(index.size, name).toBe(128);
    // Every byte 80 to FF decodes to the code point of pointer byte - 0x80.
    const high = Uint8Array.from({ length: 128 }, (_, pointer) => 0x80 + pointer);
    const decoded = decodeBytes(high, name, noLatin1);
    expect(
      Array.from(decoded.text, (c) => c.codePointAt(0)),
      name,
    ).toEqual(Array.from({ length: 128 }, (_, pointer) => index.get(pointer)));
    expect(decoded.encoding).toBe(name);
    expect(decoded.replacements).toBe(0);
    // The bytes below 80 are ASCII.
    expect(decodeBytes(text('Az09'), name, noLatin1).text).toBe('Az09');
  }
  // Rows quoted from the index files: koi8-r pointer 0 is U+2500, 64 is U+044E, 96 is U+042E; windows-1251 pointer 0 is
  // U+0402, 64 is U+0410, 96 is U+0430.
  expect(decodeBytes(Uint8Array.from([0x80, 0xc0, 0xe0]), 'koi8-r', noLatin1).text).toBe('─юЮ');
  expect(decodeBytes(Uint8Array.from([0x80, 0xc0, 0xe0]), 'windows-1251', noLatin1).text).toBe('ЂАа');
  // Shift_JIS: the byte pairs 81 40, 81 41, 81 43 and 83 40 are the jis0208 pointers 0, 1, 3 and 376, and B1 is U+FF71.
  const shiftJis = Uint8Array.from([0x81, 0x40, 0x81, 0x41, 0x81, 0x43, 0x83, 0x40, 0xb1, 0x41]);
  const kana = decodeBytes(shiftJis, 'shift_jis', noLatin1);
  expect(kana.text).toBe('　、，ァｱA');
  expect(kana.encoding).toBe('shift_jis');
  // Labels of the standard reach the same encodings.
  expect(decodeBytes(shiftJis, 'sjis', noLatin1).encoding).toBe('shift_jis');
  expect(decodeBytes(Uint8Array.from([0xc0]), 'cp1251', noLatin1).encoding).toBe('windows-1251');
});

it('an unknown encoding label is refused naming it', () => {
  for (const label of ['not-a-real-encoding', 'utf-99', 'replacement']) {
    let thrown: unknown;
    try {
      decodeBytes(Uint8Array.from([0x41]), label, noLatin1);
    } catch (err) {
      thrown = err;
    }
    expect(thrown, label).toBeInstanceOf(TextEncodingFixerError);
    expect((thrown as Error).message, label).toContain(`"${label}"`);
  }
  // A blank label is asked for, not guessed.
  expect(() => decodeBytes(Uint8Array.from([0x41]), '   ', noLatin1)).toThrow(/Encoding label/);
  // The label is checked even when there are no bytes.
  expect(() => decodeBytes(new Uint8Array(0), 'not-a-real-encoding', noLatin1)).toThrow(/not-a-real-encoding/);
});

it('text that is already correct UTF-8 needs no repair and a second repair changes nothing', () => {
  const options = { perLine: false };
  // Plain ASCII has nothing to repair.
  const ascii = repairMojibake('Plain text, 123.\nSecond line.', 'windows-1252', options);
  expect(ascii).toEqual({ text: 'Plain text, 123.\nSecond line.', changed: false, unrepairedLines: [] });

  // Correct accented text is returned unchanged. Python 3.14.3: b'caf\xe9'.decode('utf-8') fails at 3, so the single
  // character U+00E9 cannot be the tail of a UTF-8 sequence and the text is not a Windows-1252 reading of UTF-8.
  const correct = repairMojibake('café', 'windows-1252', options);
  expect(correct.text).toBe('café');
  expect(correct.changed).toBe(false);
  expect(correct.problem).toEqual({ kind: 'not-utf8', position: 4 });

  // Text with a character no Windows-1252 reading could produce is returned unchanged too.
  const chinese = repairMojibake('你好', 'windows-1252', options);
  expect(chinese.text).toBe('你好');
  expect(chinese.changed).toBe(false);
  expect(chinese.problem).toEqual({ kind: 'outside-table', position: 1, character: '你' });

  // Repairing garbled text and then repairing the result changes nothing more.
  const once = repairMojibake('cafÃ© â€™s', 'windows-1252', options);
  expect(once.text).toBe('café ’s');
  expect(once.changed).toBe(true);
  const twice = repairMojibake(once.text, 'windows-1252', options);
  expect(twice.text).toBe(once.text);
  expect(twice.changed).toBe(false);
  // Per line, the same.
  const perLine = repairMojibake(once.text, 'windows-1252', { perLine: true });
  expect(perLine.text).toBe(once.text);
  expect(perLine.changed).toBe(false);

  // Python: '\u{80}'.encode('utf-8') is c280, which cp1252 reads as U+00C2 U+20AC; '\u{1f600}' is f09f9880 and reads as
  // U+00F0 U+0178 U+02DC U+20AC, so a text garbled that way repairs, with the text around it, byte by byte.
  expect(repairMojibake('\u{c2}\u{20ac}', 'windows-1252', options).text).toBe('\u{80}');
  expect(repairMojibake('\u{c2}\u{80}', 'iso-8859-1', options).text).toBe('\u{80}');
  expect(repairMojibake('a\u{f0}\u{178}\u{2dc}\u{20ac}b', 'windows-1252', options).text).toBe('a\u{1f600}b');
  // True ISO-8859-1: Python '€'.encode('utf-8').decode('latin-1') is U+00E2 U+0082 U+00AC. Windows-1252 has no
  // character U+0082 (its byte 82 is U+201A), so only the ISO-8859-1 choice can repair it.
  expect(repairMojibake('â\u0082¬', 'iso-8859-1', options).text).toBe('€');
  expect(repairMojibake('â\u0082¬', 'windows-1252', options).problem?.kind).toBe('outside-table');
  // And a text only Windows-1252 can read, the euro sign in the middle of the garbled quote, is not ISO-8859-1.
  expect(repairMojibake('â€™', 'iso-8859-1', options).problem).toEqual({
    kind: 'outside-table',
    position: 2,
    character: '€',
  });
  // The five bytes Microsoft leaves undefined round trip: U+00E2 U+0081 ... is E2 81 ...
  expect(repairMojibake('â\u0081´', 'windows-1252', options).text).toBe('⁴');
  // A byte order mark in the repaired text is kept: EF BB BF read as Windows-1252 is U+00EF U+00BB U+00BF.
  expect(repairMojibake('ï»¿A', 'windows-1252', options).text).toBe('\u{feff}A');
});

it('a character outside the table is reported with its position and per-line repair skips lines that do not decode', () => {
  // Positions count characters (code points) from 1.
  expect(repairMojibake('abcĀ', 'windows-1252', { perLine: false }).problem).toEqual({
    kind: 'outside-table',
    position: 4,
    character: 'Ā',
  });
  expect(repairMojibake('a\u{1f600}b', 'windows-1252', { perLine: false }).problem).toEqual({
    kind: 'outside-table',
    position: 2,
    character: '\u{1f600}',
  });
  // U+0080 is not in the windows-1252 table (the byte 80 is the euro sign) but is the byte 80 in ISO-8859-1.
  expect(repairMojibake('\u0080', 'windows-1252', { perLine: false }).problem?.kind).toBe('outside-table');
  expect(repairMojibake('\u0080\u00e9', 'iso-8859-1', { perLine: false }).problem).toEqual({
    kind: 'not-utf8',
    position: 1,
  });
  // The first character above U+00FF is outside ISO-8859-1.
  expect(repairMojibake('a\u{100}', 'iso-8859-1', { perLine: false }).problem).toEqual({
    kind: 'outside-table',
    position: 2,
    character: '\u{100}',
  });
  expect(repairMojibake('a\u{ff}', 'iso-8859-1', { perLine: false }).problem).toEqual({
    kind: 'not-utf8',
    position: 2,
  });
  // Bytes that are not UTF-8 name where they stop being UTF-8, as Python's UnicodeDecodeError.start does: 6162c3 at 2.
  expect(repairMojibake('abÃ', 'windows-1252', { perLine: false }).problem).toEqual({
    kind: 'not-utf8',
    position: 3,
  });
  expect(repairMojibake('â€', 'windows-1252', { perLine: false }).problem).toEqual({
    kind: 'not-utf8',
    position: 1,
  });

  // Python start offsets for ill-formed UTF-8, as bytes written through ISO-8859-1 (one character per byte).
  const starts: [number[], number][] = [
    [[0x63, 0x61, 0x66, 0xe9], 3],
    [[0x61, 0x62, 0xc3], 2],
    [[0xe2, 0x80], 0],
    [[0xe2, 0x28, 0xa1], 0],
    [[0x61, 0xf0, 0x9f, 0x98], 1],
    [[0xc0, 0xaf], 0],
    [[0xed, 0xa0, 0x80], 0],
    [[0xf4, 0x90, 0x80, 0x80], 0],
    [[0x78, 0xe2, 0x82, 0xac, 0x80], 4],
    // Python: f0808080 and e08080 start at 0 (an overlong form), f5808080 starts at 0 (a lead byte above f4).
    [[0xf0, 0x80, 0x80, 0x80], 0],
    [[0xf5, 0x80, 0x80, 0x80], 0],
    [[0xe0, 0x80, 0x80], 0],
    [[0xc2], 0],
  ];
  for (const [bytes, start] of starts) {
    const garbled = String.fromCharCode(...bytes);
    expect(repairMojibake(garbled, 'iso-8859-1', { perLine: false }).problem, hex(Uint8Array.from(bytes))).toEqual({
      kind: 'not-utf8',
      position: start + 1,
    });
  }

  // Per line: the garbled lines are repaired, ASCII lines are left, and lines that do not decode are listed and kept.
  const mixed = 'cafÃ©\nplain\nnaïve\nÃ¼ber\r\nΩ\rend';
  const result = repairMojibake(mixed, 'windows-1252', { perLine: true });
  expect(result.text).toBe('café\nplain\nnaïve\nüber\r\nΩ\rend');
  expect(result.changed).toBe(true);
  // Lines are numbered from 1 and split at LF, CRLF and a lone CR; the line endings stay exactly as they were.
  expect(result.unrepairedLines).toEqual([3, 5]);
  expect(result.problem).toBeUndefined();
  // The last line may have no line ending: it is read, repaired and listed like the others.
  const tail = repairMojibake('x\nc\u{c3}\u{a9}', 'windows-1252', { perLine: true });
  expect(tail).toEqual({ text: 'x\nc\u{e9}', changed: true, unrepairedLines: [] });
  expect(repairMojibake('a\n\u{e9}', 'windows-1252', { perLine: true })).toEqual({
    text: 'a\n\u{e9}',
    changed: false,
    unrepairedLines: [2],
  });
  // A lone carriage return separates lines too: here the first line cannot be repaired and the second can.
  expect(repairMojibake('na\u{ef}ve\rcaf\u{c3}\u{a9}', 'windows-1252', { perLine: true })).toEqual({
    text: 'na\u{ef}ve\rcaf\u{e9}',
    changed: true,
    unrepairedLines: [1],
  });
  // A line that is only ASCII is never listed, and nothing to repair gives an unchanged text.
  const clean = repairMojibake('one\ntwo\n', 'windows-1252', { perLine: true });
  expect(clean).toEqual({ text: 'one\ntwo\n', changed: false, unrepairedLines: [] });
  // Whole text mode gives up on the same text, naming the first character that cannot come from Windows-1252.
  expect(repairMojibake(mixed, 'windows-1252', { perLine: false }).changed).toBe(false);
});

it('line endings convert LF, CRLF and lone CR in one pass and converting twice equals converting once', () => {
  const source = 'a\r\nb\nc\rd\r\n';
  // Python: 1 LF, 2 CRLF and 1 lone CR.
  const expected = {
    lf: 'a\nb\nc\nd\n',
    crlf: 'a\r\nb\r\nc\r\nd\r\n',
    cr: 'a\rb\rc\rd\r',
  } as const;
  for (const eol of ['lf', 'crlf', 'cr'] as const) {
    const once = convertLineEndings(source, eol);
    expect(once.text, eol).toBe(expected[eol]);
    expect(once.counts, eol).toEqual({ lf: 1, crlf: 2, cr: 1 });
    const twice = convertLineEndings(once.text, eol);
    expect(twice.text, eol).toBe(once.text);
  }
  // A CR before a CRLF is its own line ending, and U+2028 is not a line ending here.
  const mixed = convertLineEndings('x\r\ry\r\n\nz\u{2028}w', 'lf');
  expect(mixed.text).toBe('x\n\ny\n\nz\u{2028}w');
  expect(mixed.counts).toEqual({ lf: 1, crlf: 1, cr: 2 });
  // Nothing to convert is returned as it was, and the counts are zero.
  expect(convertLineEndings('no line ending', 'crlf')).toEqual({
    text: 'no line ending',
    counts: { lf: 0, crlf: 0, cr: 0 },
  });
  // A long text converts in one pass without a stack or size problem.
  const long = 'line\r\n'.repeat(200000);
  expect(convertLineEndings(long, 'lf').text).toBe('line\n'.repeat(200000));
});

it('a BOM is added or removed for UTF-8, UTF-16LE and UTF-16BE and never doubled', () => {
  // Python: codecs.BOM_UTF8 is efbbbf, BOM_UTF16_LE is fffe and BOM_UTF16_BE is feff.
  const hello = text('hello world');
  const adds = [
    ['add-utf8', 'ef bb bf'],
    ['add-utf16le', 'ff fe'],
    ['add-utf16be', 'fe ff'],
  ] as const;
  for (const [action, bom] of adds) {
    const result = changeBom(hello, action);
    expect(hex(result.bytes), action).toBe(`${bom} ${hex(hello)}`);
    // The first 8 bytes before and after are shown as hex.
    expect(result.before, action).toBe('68 65 6c 6c 6f 20 77 6f');
    expect(result.after, action).toBe(`${bom} ${hex(hello)}`.split(' ').slice(0, 8).join(' '));
    // Adding again does not add a second.
    const again = changeBom(result.bytes, action);
    expect(hex(again.bytes), action).toBe(hex(result.bytes));
    // Removing takes it off and gives back the original bytes.
    const removed = changeBom(result.bytes, 'remove');
    expect(hex(removed.bytes), action).toBe(hex(hello));
  }
  // A different mark is replaced, so there is one mark and not two.
  expect(hex(changeBom(Uint8Array.from([0xef, 0xbb, 0xbf, 0x41]), 'add-utf16le').bytes)).toBe('ff fe 41');
  // Only the first mark is removed.
  expect(hex(changeBom(Uint8Array.from([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x41]), 'remove').bytes)).toBe(
    'ef bb bf 41',
  );
  // Bytes without a mark are unchanged by remove; bytes that only look like part of one are not touched.
  expect(hex(changeBom(hello, 'remove').bytes)).toBe(hex(hello));
  expect(hex(changeBom(Uint8Array.from([0xef, 0xbb, 0x41]), 'remove').bytes)).toBe('ef bb 41');
  expect(hex(changeBom(Uint8Array.from([0xff, 0x41]), 'remove').bytes)).toBe('ff 41');
  // A text file with a mark: the mark is removed and the rest is the text.
  const withBom = Uint8Array.from([0xef, 0xbb, 0xbf, ...text('héllo')]);
  expect(new TextDecoder().decode(changeBom(withBom, 'remove').bytes)).toBe('héllo');
  // Text becomes UTF-8 bytes; half of a surrogate pair cannot, and is refused with its position, not replaced.
  expect(hex(utf8Bytes('aé😀'))).toBe('61 c3 a9 f0 9f 98 80');
  expect(() => utf8Bytes('ab\u{d800}')).toThrow(/Character 3/);
  expect(() => utf8Bytes('\u{dc00}')).toThrow(/Character 1/);
  expect(() => utf8Bytes('a\u{d800}b')).toThrow(/Character 2/);
  // A pair counts as one character in the position.
  expect(() => utf8Bytes('a\u{1f600}\u{d800}')).toThrow(/Character 3/);
  // A copy is returned even when nothing changes.
  expect(changeBom(hello, 'remove').bytes).not.toBe(hello);
  expect(changeBom(withBom, 'add-utf8').bytes).not.toBe(withBom);
  // The preview shows each byte as two lower case digits.
  expect(changeBom(Uint8Array.from([0x00, 0x01, 0x0a, 0xab]), 'remove').before).toBe('00 01 0a ab');
  // The input array is not changed.
  const input = Uint8Array.from([0x41, 0x42]);
  changeBom(input, 'add-utf8');
  expect(hex(input)).toBe('41 42');
});

it('empty input gives empty output in every mode', () => {
  // Decoding no bytes gives no text, in every encoding the page offers.
  for (const label of ['windows-1252', 'utf-8', 'utf-16le', 'shift_jis', 'koi8-r']) {
    expect(decodeBytes(new Uint8Array(0), label, noLatin1), label).toEqual({
      text: '',
      encoding: expect.any(String),
      replacements: 0,
    });
  }
  expect(decodeBytes(new Uint8Array(0), 'latin1', { strictLatin1: true }).text).toBe('');
  expect(repairMojibake('', 'windows-1252', { perLine: false })).toEqual({
    text: '',
    changed: false,
    unrepairedLines: [],
  });
  expect(repairMojibake('', 'iso-8859-1', { perLine: true })).toEqual({
    text: '',
    changed: false,
    unrepairedLines: [],
  });
  expect(convertLineEndings('', 'crlf')).toEqual({ text: '', counts: { lf: 0, crlf: 0, cr: 0 } });
  // Removing a mark from no bytes leaves no bytes; adding one to no bytes gives just the mark.
  expect(changeBom(new Uint8Array(0), 'remove')).toEqual({ bytes: new Uint8Array(0), before: '', after: '' });
  const added = changeBom(new Uint8Array(0), 'add-utf8');
  expect(hex(added.bytes)).toBe('ef bb bf');
  expect(added.before).toBe('');
  expect(added.after).toBe('ef bb bf');
  expect(parseHex('')).toEqual(new Uint8Array(0));
  expect(parseHex(' \n ')).toEqual(new Uint8Array(0));
  // Pasted hex is read in pairs, with white space allowed between them, and refused with the character position otherwise.
  expect(hex(parseHex('80 81\n9F e9'))).toBe('80 81 9f e9');
  expect(hex(parseHex('808F'))).toBe('80 8f');
  expect(hex(parseHex('80\t81\r\n82'))).toBe('80 81 82');
  expect(hex(parseHex('ABCDEF abcdef 0123456789'))).toBe('ab cd ef ab cd ef 01 23 45 67 89');
  expect(() => parseHex('0g')).toThrow(/character 2/);
  expect(() => parseHex('G0')).toThrow(/character 1/);
  expect(() => parseHex('0/')).toThrow(/character 2/);
  expect(() => parseHex('0:')).toThrow(/character 2/);
  expect(() => parseHex('0@')).toThrow(/character 2/);
  expect(() => parseHex('0`')).toThrow(/character 2/);
  expect(() => parseHex('80 8')).toThrow(/odd number/);
  expect(() => parseHex('8z')).toThrow(/character 2/);
});

it('input over 20 MiB is refused before decoding and exactly 20 MiB is read', () => {
  expect(MAX_INPUT_BYTES).toBe(20 * 1024 * 1024);
  const decoderSpy = vi.spyOn(globalThis, 'TextDecoder');
  try {
    const tooBig = new Uint8Array(MAX_INPUT_BYTES + 1);
    for (const label of ['windows-1252', 'utf-8']) {
      let thrown: unknown;
      try {
        decodeBytes(tooBig, label, noLatin1);
      } catch (err) {
        thrown = err;
      }
      expect(thrown, label).toBeInstanceOf(TextEncodingFixerError);
      expect((thrown as Error).message, label).toContain('20 MiB');
      expect((thrown as Error).message, label).toContain('20,971,521');
    }
    // Refused before any decoding: the platform decoder was never even built.
    expect(decoderSpy).not.toHaveBeenCalled();
    expect(() => changeBom(tooBig, 'remove')).toThrow(/20 MiB/);
    // Text is counted in bytes as UTF-8: 10 MiB of two-byte characters is exactly the limit and one more is over it.
    expect(() => repairMojibake('é'.repeat(MAX_INPUT_BYTES / 2 + 1), 'windows-1252', { perLine: false })).toThrow(
      /20 MiB/,
    );
    expect(() => convertLineEndings('a'.repeat(MAX_INPUT_BYTES + 1), 'lf')).toThrow(/20 MiB/);
    // Characters outside the BMP are four bytes each: 5,242,881 of them are over the limit by four bytes.
    expect(() => convertLineEndings('\u{1f600}'.repeat(MAX_INPUT_BYTES / 4 + 1), 'lf')).toThrow(/20 MiB/);
    expect(() => utf8Bytes('a'.repeat(MAX_INPUT_BYTES + 1))).toThrow(/20 MiB/);
    // Pasted hex is refused from its length, before the bytes are made.
    expect(() => parseHex('ab'.repeat(MAX_INPUT_BYTES + 1))).toThrow(/20 MiB/);
  } finally {
    decoderSpy.mockRestore();
  }

  // Exactly 20 MiB is read.
  const exact = new Uint8Array(MAX_INPUT_BYTES).fill(0x41);
  const decoded = decodeBytes(exact, 'windows-1252', noLatin1);
  expect(decoded.text.length).toBe(MAX_INPUT_BYTES);
  expect(decoded.text.startsWith('AAAA')).toBe(true);
  expect(changeBom(exact, 'remove').bytes.length).toBe(MAX_INPUT_BYTES);
  expect(decodeBytes(exact, 'utf-8', noLatin1).text.length).toBe(MAX_INPUT_BYTES);
  expect(convertLineEndings('a'.repeat(MAX_INPUT_BYTES), 'lf').text.length).toBe(MAX_INPUT_BYTES);
  expect(convertLineEndings('\u{1f600}'.repeat(MAX_INPUT_BYTES / 4), 'lf').text.length).toBe(MAX_INPUT_BYTES / 2);
  expect(parseHex('ab'.repeat(MAX_INPUT_BYTES)).length).toBe(MAX_INPUT_BYTES);
  expect(utf8Bytes('a'.repeat(MAX_INPUT_BYTES)).length).toBe(MAX_INPUT_BYTES);
});

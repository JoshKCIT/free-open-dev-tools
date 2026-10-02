import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { repairMojibake } from '../src/index';
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

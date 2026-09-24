import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { textToRadix, radixToText, TextRadixError, type Radix, type TextEncodingName } from '../src/index';

const FIXTURE_PATH = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'index-windows-1252.txt');

const RADICES: Radix[] = ['binary', 'octal', 'decimal', 'hexadecimal'];
const ALL_ENCODINGS: TextEncodingName[] = ['utf-8', 'utf-16le', 'utf-16be', 'windows-1252'];

it('three digit characters produce three bytes, not the number they spell', () => {
  // '1' '2' '3' are ASCII 0x31 0x32 0x33, not the sixteen bits of the integer 123.
  const groups = textToRadix('123', { radix: 'binary', fixedWidth: true });
  const parts = groups.split(' ');
  expect(parts).toHaveLength(3);
  expect(parts).toEqual(['00110001', '00110010', '00110011']);
  // The numeric reading (123 -> binary 1111011) never appears.
  expect(groups).not.toBe((123).toString(2));

  const hex = textToRadix('123', { radix: 'hexadecimal' });
  expect(hex).toBe('31 32 33');
  expect(radixToText(hex)).toBe('123');
});

it('windows-1252 decodes byte 0x80 to the euro sign, as the WHATWG label requires', () => {
  expect(radixToText('80', { encoding: 'windows-1252' })).toBe('€');
  expect(textToRadix('€', { encoding: 'windows-1252' })).toBe('80');
});

it('windows-1252 encoding rejects a character it cannot represent, naming the character', () => {
  // U+0100 (Ā) and U+4E2D (中) are both outside the windows-1252 table.
  for (const ch of ['Ā', '中']) {
    let error: TextRadixError | undefined;
    try {
      textToRadix(ch, { encoding: 'windows-1252' });
    } catch (err) {
      error = err as TextRadixError;
    }
    expect(error, `encoding "${ch}" should have thrown`).toBeInstanceOf(TextRadixError);
    expect(error!.message).toContain(ch);
    expect(error!.message).toContain('windows-1252');
  }
});

it('UTF-16LE and UTF-16BE produce the same two bytes in the opposite order', () => {
  const le = textToRadix('A', { encoding: 'utf-16le', radix: 'hexadecimal' });
  const be = textToRadix('A', { encoding: 'utf-16be', radix: 'hexadecimal' });
  expect(le).toBe('41 00');
  expect(be).toBe('00 41');
  expect(le.split(' ').reverse()).toEqual(be.split(' '));
});

it('every radix round trips in every encoding', () => {
  const samples: Record<TextEncodingName, string> = {
    'utf-8': 'Hello, 世界! 👋',
    'utf-16le': 'Hello, 世界! 👋',
    'utf-16be': 'Hello, 世界! 👋',
    'windows-1252': 'Café € 100%',
  };
  for (const encoding of ALL_ENCODINGS) {
    for (const radix of RADICES) {
      const sample = samples[encoding];
      const groups = textToRadix(sample, { radix, encoding });
      expect(radixToText(groups, { radix, encoding }), `${radix}/${encoding} round trip`).toBe(sample);

      // Unpadded groups round trip too.
      const unpadded = textToRadix(sample, { radix, encoding, fixedWidth: false });
      expect(radixToText(unpadded, { radix, encoding }), `${radix}/${encoding} unpadded round trip`).toBe(sample);
    }
  }
});

it('a group whose value exceeds one byte is rejected saying each group is one byte', () => {
  let error: TextRadixError | undefined;
  try {
    radixToText('256');
  } catch (err) {
    error = err as TextRadixError;
  }
  expect(error).toBeInstanceOf(TextRadixError);
  expect(error!.message.toLowerCase()).toContain('each group is one byte');
});

it('windows-1252 decodes 0x81 0x8D 0x8F 0x90 and 0x9D to the matching C1 control code points', () => {
  const text = radixToText('81 8D 8F 90 9D', { encoding: 'windows-1252' });
  expect(text).toBe('\u0081\u008D\u008F\u0090\u009D');
});

it('windows-1252 encodes U+0081 U+008D U+008F U+0090 and U+009D back to their single bytes', () => {
  const groups = textToRadix('\u0081\u008D\u008F\u0090\u009D', { encoding: 'windows-1252', upperCase: true });
  expect(groups).toBe('81 8D 8F 90 9D');
  expect(radixToText(groups, { encoding: 'windows-1252' })).toBe('\u0081\u008D\u008F\u0090\u009D');
});

it('windows-1252 table agrees with the WHATWG index file for every byte 0x00 to 0xFF', () => {
  // Parses the vendored index-windows-1252.txt itself
  // (https://encoding.spec.whatwg.org/index-windows-1252.txt), rather than
  // trusting the package's own transcription -- this is the test that
  // catches a mistranscription, not merely a self-consistency check.
  const raw = readFileSync(FIXTURE_PATH, 'utf8');
  const pointers = new Map<number, number>();
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*(\d+)\t(0x[0-9A-Fa-f]+)\t/.exec(line);
    if (!match) continue;
    pointers.set(Number(match[1]), parseInt(match[2]!, 16));
  }
  expect(pointers.size).toBe(128);
  expect(pointers.get(0)).toBe(0x20ac);

  for (let byte = 0; byte <= 0xff; byte++) {
    const expectedCodePoint = byte < 0x80 ? byte : pointers.get(byte - 0x80)!;
    const hex = byte.toString(16).padStart(2, '0');
    const decoded = radixToText(hex, { encoding: 'windows-1252' });
    expect(decoded.codePointAt(0), `byte 0x${hex}`).toBe(expectedCodePoint);

    const reEncoded = textToRadix(decoded, { encoding: 'windows-1252' });
    expect(reEncoded.toLowerCase(), `byte 0x${hex} round trip`).toBe(hex);
  }
});

it('a group containing a digit that is not valid in the selected radix is rejected with its position', () => {
  let error: TextRadixError | undefined;
  try {
    radixToText('1G', { radix: 'hexadecimal' });
  } catch (err) {
    error = err as TextRadixError;
  }
  expect(error).toBeInstanceOf(TextRadixError);
  expect(error!.position).toBe(1);
});

it('the empty string produces no groups and parses back to the empty string', () => {
  expect(textToRadix('')).toBe('');
  expect(radixToText('')).toBe('');
});

it('parsing accepts groups separated by whitespace even when a different separator is configured', () => {
  expect(radixToText('48\t69  6a', { separator: '-' })).toBe('Hij');
});

it('fixed width and letter case do not change which bytes are produced', () => {
  const padded = textToRadix('A', { radix: 'binary', fixedWidth: true });
  const unpadded = textToRadix('A', { radix: 'binary', fixedWidth: false });
  expect(radixToText(padded, { radix: 'binary' })).toBe('A');
  expect(radixToText(unpadded, { radix: 'binary' })).toBe('A');

  const upper = textToRadix('A', { radix: 'hexadecimal', upperCase: true });
  const lower = textToRadix('A', { radix: 'hexadecimal', upperCase: false });
  expect(upper).toBe('41');
  expect(lower).toBe('41');
});

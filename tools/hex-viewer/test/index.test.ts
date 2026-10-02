import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HexViewerError, formatHexRows, identifyFile, parseHexInput } from '../src/index';

/*
 * Grounding (D-179, P13-08).
 *
 * Row layout. The expected rows are what hexdump from util-linux 2.39.3 (Ubuntu 24.04.2 LTS, run under WSL 2 on this
 * machine, because Git Bash has no hexdump) printed with -vC for the same bytes. Each literal below is its output,
 * minus the closing line that holds only the total length, which has no meaning for a window of a file:
 *
 *   $ printf Hello | hexdump -C
 *   00000000  48 65 6c 6c 6f                                    |Hello|
 *   00000005
 *
 *   $ printf '\x48\x65\x6c\x6c\x6f\x2c\x20\x68\x65\x78\x21\x00\x1f\x20\x7e\x7f\x80\xff\x41\x42\x43\x44\x45\x46\x47\x48\x49\x4a' | hexdump -vC
 *   00000000  48 65 6c 6c 6f 2c 20 68  65 78 21 00 1f 20 7e 7f  |Hello, hex!.. ~.|
 *   00000010  80 ff 41 42 43 44 45 46  47 48 49 4a              |..ABCDEFGHIJ|
 *   0000001c
 *
 *   $ printf '\x41' | hexdump -vC
 *   00000000  41                                                |A|
 *   00000001
 *
 * GNU od (coreutils 8.32, Git Bash) agrees on the bytes and the text column, in its own layout:
 *   $ printf Hello | od -A x -t x1z -v
 *   000000 48 65 6c 6c 6f                                   >Hello<
 *
 * File signature. The W3C PNG specification, Third Edition (https://www.w3.org/TR/png-3/), section 5.2 "PNG signature",
 * fetched 2026-10-02, states: "The first eight bytes of a PNG datastream always contain the following hexadecimal
 * values: 89 50 4E 47 0D 0A 1A 0A".
 */

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  expect(console.log).not.toHaveBeenCalled();
  expect(console.warn).not.toHaveBeenCalled();
  expect(console.error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

const bytesOf = (text: string) => new TextEncoder().encode(text);

const SAMPLE = Uint8Array.from([
  0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x2c, 0x20, 0x68, 0x65, 0x78, 0x21, 0x00, 0x1f, 0x20, 0x7e, 0x7f, 0x80, 0xff, 0x41,
  0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a,
]);

it('pasted Hello shows one row in the canonical layout that hexdump prints for the same bytes', () => {
  // hexdump -C on Hello
  expect(formatHexRows(bytesOf('Hello'), 0, 16)).toBe(
    '00000000  48 65 6c 6c 6f                                    |Hello|',
  );

  // hexdump -vC on the 28 byte sample: two rows, a gap after the eighth byte, DEL and the high bytes as full stops
  expect(formatHexRows(SAMPLE, 0, 16)).toBe(
    [
      '00000000  48 65 6c 6c 6f 2c 20 68  65 78 21 00 1f 20 7e 7f  |Hello, hex!.. ~.|',
      '00000010  80 ff 41 42 43 44 45 46  47 48 49 4a              |..ABCDEFGHIJ|',
    ].join('\n'),
  );

  // hexdump -vC on one byte: a one byte file shows one row at offset 00000000
  expect(formatHexRows(Uint8Array.from([0x41]), 0, 16)).toBe(
    '00000000  41                                                |A|',
  );

  // A window that starts inside a file keeps its real offset, 8 hex digits, lower case.
  expect(formatHexRows(Uint8Array.from([0x41]), 0xabcdef, 16).startsWith('00abcdef  41 ')).toBe(true);

  // No bytes, no rows.
  expect(formatHexRows(new Uint8Array(0), 0, 16)).toBe('');

  // 8 and 32 bytes per row follow the same rule (groups of eight, two spaces between groups, hex area padded to the
  // full row). Their expected rows are built from hexdump's own 16 byte rows above, not from this package: the 8 byte
  // rows are hexdump's two groups on separate lines, the 32 byte row is its two hex areas side by side.
  const first = '00000000  48 65 6c 6c 6f 2c 20 68  65 78 21 00 1f 20 7e 7f  |Hello, hex!.. ~.|';
  const second = '00000010  80 ff 41 42 43 44 45 46  47 48 49 4a              |..ABCDEFGHIJ|';
  const areaOf = (row: string) => row.slice(10, 58);
  const textOf = (row: string) => row.slice(61, -1);
  expect(formatHexRows(SAMPLE, 0, 8).split('\n')).toEqual([
    `00000000  ${areaOf(first).slice(0, 23)}  |${textOf(first).slice(0, 8)}|`,
    `00000008  ${areaOf(first).slice(25)}  |${textOf(first).slice(8)}|`,
    `00000010  ${areaOf(second).slice(0, 23)}  |${textOf(second).slice(0, 8)}|`,
    `00000018  ${areaOf(second).slice(25)}  |${textOf(second).slice(8)}|`,
  ]);
  expect(formatHexRows(SAMPLE, 0, 32)).toBe(
    `00000000  ${areaOf(first)}  ${areaOf(second)}  |${textOf(first)}${textOf(second)}|`,
  );
});

it('the PNG signature is named with the W3C PNG specification as its source', () => {
  // The eight bytes the specification's section 5.2 states, followed by the start of an IHDR chunk.
  const png = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);
  const found = identifyFile(png, png, png.length);
  expect(found).toHaveLength(1);
  expect(found[0]!.name).toBe('PNG image');
  expect(found[0]!.spec).toBe('https://www.w3.org/TR/png-3/');
  expect(found[0]!.evidence).toContain('89 50 4E 47 0D 0A 1A 0A');
  expect(found[0]!.evidence).toContain('offset 0');

  // Seven of the eight bytes is not the signature.
  const almost = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0b]);
  expect(identifyFile(almost, almost, almost.length).some((f) => f.name === 'PNG image')).toBe(false);
});

it('hex input reads pairs with or without spaces and an odd digit count is refused with its position', () => {
  const hello = [0x48, 0x65, 0x6c, 0x6c, 0x6f];
  expect([...parseHexInput('48 65 6c 6c 6f')]).toEqual(hello);
  expect([...parseHexInput('48656c6c6f')]).toEqual(hello);
  expect([...parseHexInput('48 65 6C 6C 6F')]).toEqual(hello);
  expect([...parseHexInput('48 65\n6c\t6c\r\n6f\n')]).toEqual(hello);
  expect(parseHexInput('')).toHaveLength(0);
  expect(parseHexInput('  \n ')).toHaveLength(0);

  // An odd number of digits names the character that has no partner: the 7th character of "48 65 6".
  try {
    parseHexInput('48 65 6');
    expect.unreachable('an odd digit count must be refused');
  } catch (err) {
    expect(err).toBeInstanceOf(HexViewerError);
    expect((err as HexViewerError).position).toBe(7);
    expect((err as HexViewerError).message).toContain('character 7');
  }

  // A character that is not a hex digit names its position too.
  try {
    parseHexInput('48 6g');
    expect.unreachable('a non-hex character must be refused');
  } catch (err) {
    expect(err).toBeInstanceOf(HexViewerError);
    expect((err as HexViewerError).position).toBe(5);
    expect((err as HexViewerError).message).toContain('character 5');
  }
});

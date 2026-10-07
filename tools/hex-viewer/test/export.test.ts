import { expect, it } from 'vitest';
import { cleanIdentifier, exportCodeArray } from '../src/export';

/*
 * Grounding (D-233, 19-01 S8).
 *
 * The C form is the output of `xxd -i`. The program's own source, the Vim repository file src/xxd/xxd.c at blob
 * 9b1ca6ea5555df413546e48126d75ab91e1c8393 (repository head 03e7afb02d952fc117579b141ef8baf503f0ff63 of 2026-10-05),
 * holds these rules, read from the GitHub contents API:
 *   line 971:        case HEX_CINCLUDE: cols = 12; break;
 *   lines 1079-1135: the array name is written as "unsigned char %s", with two underscores first when the first byte
 *                    of the name is a digit; each byte of the name that is not an ASCII letter or digit is written as an
 *                    underscore; each hex byte is "%s0x%02x" and the text before it is ", " inside a line, two spaces
 *                    before the first byte and ",\n  " at a line break; a line feed follows the last byte only when
 *                    there is a byte; then "};\n" and the length line "unsigned int %s_len = %d;\n".
 *
 * The literal below is what `xxd -i b13.bin` printed for the 13 bytes abcdefghijklm (Git for Windows xxd 2025-11-26
 * and Ubuntu 24.04 xxd 2023-10-25 agree), recorded on 2026-10-07 and kept with its recorder in test/fixtures/xxd.
 */

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

it('twelve bytes fill one C line and a thirteenth starts a second line, as xxd -i does', () => {
  const twelve = exportCodeArray(bytesOf('abcdefghijkl'), {
    language: 'c',
    name: 'b12.bin',
    perLine: 12,
    upper: false,
  });
  expect(twelve.text).toBe(
    [
      'unsigned char b12_bin[] = {',
      '  0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x6b, 0x6c',
      '};',
      'unsigned int b12_bin_len = 12;',
      '',
    ].join('\n'),
  );

  const thirteen = exportCodeArray(bytesOf('abcdefghijklm'), {
    language: 'c',
    name: 'b13.bin',
    perLine: 12,
    upper: false,
  });
  expect(thirteen.text).toBe(
    [
      'unsigned char b13_bin[] = {',
      '  0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x6b, 0x6c,',
      '  0x6d',
      '};',
      'unsigned int b13_bin_len = 13;',
      '',
    ].join('\n'),
  );
  expect(thirteen.identifier).toBe('b13_bin');
  expect(thirteen.extension).toBe('h');
  expect(thirteen.bytes).toBe(13);
});

it('every UTF-8 byte of a name that is not an ASCII letter or digit becomes an underscore and a leading digit gets two underscores first', () => {
  // Recorded names (xxd -i on a file of that name, and xxd -i -n): the accent is two bytes, each CJK character three.
  const acute = String.fromCodePoint(0x63, 0x61, 0x66, 0xe9) + '.bin';
  const cjk = String.fromCodePoint(0x65e5, 0x672c) + '.bin';
  expect(cleanIdentifier('c', acute)).toBe('caf___bin');
  expect(cleanIdentifier('c', cjk)).toBe('_______bin');
  expect(cleanIdentifier('c', '9lives-file.v2.bin')).toBe('__9lives_file_v2_bin');
  expect(cleanIdentifier('c', 'a b-c.d.bin')).toBe('a_b_c_d_bin');
  expect(cleanIdentifier('c', '_leading.bin')).toBe('_leading_bin');

  // The identifier a result reports is the cleaned name, and it is what the array is written with.
  const result = exportCodeArray(Uint8Array.of(1), { language: 'c', name: acute, perLine: 12, upper: false });
  expect(result.identifier).toBe('caf___bin');
  expect(result.text.startsWith('unsigned char caf___bin[] = {\n')).toBe(true);
});

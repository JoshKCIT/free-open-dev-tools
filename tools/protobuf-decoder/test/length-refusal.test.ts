import { expect, it } from 'vitest';
import { ProtobufDecoderError, decodeProtobuf, readInputBytes } from '../src/index';

/*
 * The refusal for a length that the input cannot hold names the length exactly (found by the phase 13 review). The
 * encoding guide (https://protobuf.dev/programming-guides/encoding/) writes a varint as 7 bit groups, least significant
 * first, with the top bit of each byte set when another follows: 2^60 + 1 is 0x81, seven bytes of 0x80, then 0x10
 * (the group at index 8 holds bit 60 as the value 16). 2^53 + 1 is 9007199254740993, which a double cannot hold.
 */

const refuse = (hex: string): ProtobufDecoderError => {
  try {
    decodeProtobuf(readInputBytes(hex, 'hex'), { nested: true, packed: false });
  } catch (err) {
    expect(err).toBeInstanceOf(ProtobufDecoderError);
    return err as ProtobufDecoderError;
  }
  throw new Error('the length was not refused');
};

it('a declared length above 2^53 is quoted exactly in the refusal', () => {
  // Field 1, length-delimited, declaring 2^60 + 1 = 1152921504606846977 bytes with none left.
  const refusal = refuse('0a' + '81' + '80'.repeat(7) + '10');
  expect(refusal.offset).toBe(0);
  expect(refusal.message).toContain('declares 1,152,921,504,606,846,977 bytes');
  // 2^53 + 1 = 9007199254740993 is the first whole number a double cannot hold. Bit 0 is in the first group (0x81);
  // bit 53 is in the group at index 7 (bits 49 to 55) at position 4, the value 16 (0x10); groups 1 to 6 are empty (0x80).
  const second = refuse('0a' + '81' + '80'.repeat(6) + '10');
  expect(second.message).toContain('declares 9,007,199,254,740,993 bytes');
  // A length a double holds is quoted as before, with its singular and plural.
  expect(refuse('0a05616263').message).toContain('declares 5 bytes but only 3 are left');
  expect(refuse('0a0261').message).toContain('declares 2 bytes but only 1 is left');
});

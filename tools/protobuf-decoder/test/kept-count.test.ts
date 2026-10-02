import { expect, it } from 'vitest';
import { MAX_FIELDS, countFields, decodeProtobufInfo, readInputBytes } from '../src/index';

/*
 * How many fields a decoded message keeps (found by the phase 13 review). Fields are kept up to MAX_FIELDS, counting the
 * fields inside nested messages and groups, so the length of the top-level list is not the number kept. The inputs are
 * built from the encoding guide's layout (https://protobuf.dev/programming-guides/encoding/): `08 01` is field 1 as the
 * varint 1, and `0a` then a length varint then the bytes is a length-delimited field 1.
 */

const bytes = (hex: string) => readInputBytes(hex, 'hex');
const ON = { nested: true, packed: false };

/** A varint as hex, for lengths. */
function varintHex(value: number): string {
  let out = '';
  let rest = value;
  while (rest >= 0x80) {
    out += ((rest % 0x80) | 0x80).toString(16).padStart(2, '0');
    rest = Math.floor(rest / 0x80);
  }
  return out + rest.toString(16).padStart(2, '0');
}

it('counts every field kept, the fields inside nested messages and groups too', () => {
  // 0a 02 08 01 holds one nested field; 0b 10 05 0c is a group holding one field; 08 01 is a plain field.
  const info = decodeProtobufInfo(bytes('0a020801' + '0b10050c' + '0801'), ON);
  expect(info.fields).toHaveLength(3);
  expect(countFields(info.fields)).toBe(5);
  expect(countFields([])).toBe(0);
});

it('when the cap cuts a message the kept count is MAX_FIELDS, not the length of the top-level list', () => {
  // One nested message of 30,000 fields (60,000 bytes), then 30,000 plain fields: 60,001 fields in all.
  const inner = '0801'.repeat(30000);
  const input = '0a' + varintHex(inner.length / 2) + inner + '0801'.repeat(30000);
  const info = decodeProtobufInfo(bytes(input), ON);
  expect(info.total).toBe(60001);
  expect(info.truncated).toBe(true);
  // The nested message and its 30,000 fields come first (30,001 kept), so 19,999 of the plain fields fit.
  expect(info.fields).toHaveLength(1 + 19999);
  expect(countFields(info.fields)).toBe(MAX_FIELDS);
});

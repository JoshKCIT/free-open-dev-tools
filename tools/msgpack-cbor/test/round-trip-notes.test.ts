import { expect, it } from 'vitest';
import { convert } from '../src/index';

/*
 * What a conversion to JSON cannot keep, and says so (found by the phase 13 review). The inputs are items of RFC 8949
 * (section 3.4.3 bignums; Appendix A's 1.0 is f93c00, 100000.0 is fa47c35000 and 1.1 is fb3ff199999999999a; Appendix B
 * and section 4.1 shortest forms) and of the MessagePack specification (the timestamp extension, type -1, in its 32, 64
 * and 96 bit layouts: 4 bytes of seconds, 8 bytes holding 30 bits of nanoseconds above 34 bits of seconds, or 12 bytes
 * holding 32 bits of nanoseconds and 64 bits of seconds; the specification writes the shortest layout that holds the
 * value). The expected warnings are written by hand, not read from this package.
 */

function warnings(format: 'cbor' | 'msgpack', hex: string): string {
  return convert({
    format,
    direction: 'to-json',
    input: hex,
    inputEncoding: 'hex',
    outputEncoding: 'hex',
    show: 'json',
  }).warnings.join(' | ');
}

it('a CBOR bignum that an ordinary integer would hold, or that starts with a zero byte, comes back shorter and says so', () => {
  // The byte string 01 under tag 2 is the number 1; 00 01 has a leading zero; tag 3 over 01 is -2; the empty string is 0.
  for (const hex of ['c24101', 'c2420001', 'c34101', 'c240', 'c248ffffffffffffffff']) {
    const text = warnings('cbor', hex);
    expect(text, hex).toContain('1 bignum');
    expect(text, hex).toContain('shortest form');
  }
  // RFC 8949 Appendix A: 2^64 (nine bytes) and -2^64 - 1 are bignums that are already in the shortest form.
  expect(warnings('cbor', 'c249010000000000000000')).toBe('');
  expect(warnings('cbor', 'c349010000000000000000')).toBe('');
  // Two in one value are counted together.
  expect(warnings('cbor', '82c24101c34101')).toContain('2 bignums');
});

it('a CBOR float written wider than its value needs comes back narrower and says so, a NaN or infinity and a float that needs its width do not', () => {
  // 1.0 in 8 bytes and in 4 bytes; half precision holds it in 2.
  expect(warnings('cbor', 'fb3ff0000000000000')).toContain('1 float');
  expect(warnings('cbor', 'fa3f800000')).toContain('1 float');
  expect(warnings('cbor', '82fb3ff0000000000000fa3f800000')).toContain('2 floats');
  // The shortest width for each value: 1.0 in half, 100000.0 in single, 1.1 in double.
  for (const hex of ['f93c00', 'fa47c35000', 'fb3ff199999999999a', 'f97e00', 'fa7f800000', 'fb7ff0000000000000']) {
    expect(warnings('cbor', hex), hex).toBe('');
  }
});

it('a CBOR array or map of indefinite length comes back with a definite length and says so', () => {
  // 9f ff is the empty array of indefinite length; bf 61 61 9f ff ff is a map holding one.
  expect(warnings('cbor', '9fff')).toContain('1 indefinite-length array or map');
  expect(warnings('cbor', 'bf61619fffff')).toContain('2 indefinite-length arrays or maps');
  expect(warnings('cbor', '80')).toBe('');
  expect(warnings('cbor', 'a0')).toBe('');
});

it('a MessagePack timestamp in a longer layout than it needs comes back shorter and says so', () => {
  // 1 second and no nanoseconds: the 32 bit layout (d6 ff, 4 bytes) is the shortest.
  expect(warnings('msgpack', 'd6ff00000001')).toBe('');
  // The same value in the 64 bit layout (d7 ff, 8 bytes) and in the 96 bit layout (c7 0c ff, 12 bytes).
  expect(warnings('msgpack', 'd7ff0000000000000001')).toContain('1 timestamp');
  expect(warnings('msgpack', 'c70cff000000000000000000000001')).toContain('1 timestamp');
  // 2^32 seconds needs the 64 bit layout; -1 second and 999999999 nanoseconds needs the 96 bit one.
  expect(warnings('msgpack', 'd7ff0000000100000000')).toBe('');
  expect(warnings('msgpack', 'c70cff3b9ac9ffffffffffffffffff')).toBe('');
  // 1 nanosecond and 1 second in the 96 bit layout would fit the 64 bit one.
  expect(warnings('msgpack', 'c70cff00000001' + '0000000000000001')).toContain('1 timestamp');
});

it('a MessagePack float of 64 bits that 32 bits hold exactly comes back narrower and says so', () => {
  expect(warnings('msgpack', 'cb3ff0000000000000')).toContain('1 float');
  expect(warnings('msgpack', '92cb3ff0000000000000cb4000000000000000')).toContain('2 floats');
  for (const hex of ['ca3f800000', 'cb3ff199999999999a', 'cb7ff0000000000000', 'ca7fc00000']) {
    expect(warnings('msgpack', hex), hex).toBe('');
  }
});

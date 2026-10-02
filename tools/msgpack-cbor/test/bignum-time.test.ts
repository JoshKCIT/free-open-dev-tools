import { expect, it } from 'vitest';
import { convert } from '../src/index';
import { bignumValue } from '../src/cbor';

/*
 * The time a large CBOR bignum takes (found by the phase 13 review). The expected values are worked out from RFC 8949
 * section 3.4.3: a bignum is the value of its bytes read as a big endian number, and a negative one is -1 minus that
 * value.
 */

const hexOf = (data: Uint8Array): string => Array.from(data, (b) => b.toString(16).padStart(2, '0')).join('');

it('a bignum is read as the number its bytes spell: empty is zero, a negative one is minus one minus the value', () => {
  expect(bignumValue(2n, new Uint8Array(0))).toBe(0n);
  expect(bignumValue(3n, new Uint8Array(0))).toBe(-1n);
  expect(bignumValue(2n, Uint8Array.from([0x01, 0x00]))).toBe(256n);
  expect(bignumValue(3n, Uint8Array.from([0x01, 0x00]))).toBe(-257n);
  expect(bignumValue(2n, Uint8Array.from([0x00, 0x00, 0x2a]))).toBe(42n);
  // RFC 8949 Appendix A: c249010000000000000000 is 18446744073709551616, and c349010000000000000000 is
  // -18446744073709551617.
  const bytes = Uint8Array.from([0x01, 0, 0, 0, 0, 0, 0, 0, 0]);
  expect(bignumValue(2n, bytes)).toBe(18446744073709551616n);
  expect(bignumValue(3n, bytes)).toBe(-18446744073709551617n);
  // 2^8192 - 1 is 8192 bytes of ff; its decimal text has 2,467 digits.
  const full = new Uint8Array(8192).fill(0xff);
  expect(bignumValue(2n, full)).toBe(2n ** 65536n - 1n);
});

/** The content bytes of the i-th test bignum: 8,192 bytes of a repeating pattern that is never all zero. */
function content(i: number): Uint8Array {
  const out = new Uint8Array(8192);
  for (let j = 0; j < out.length; j++) out[j] = (j * 31 + i * 7 + 1) & 255;
  return out;
}

it('620 bignums of 8,192 bytes are read in well under the seconds the quadratic code took', () => {
  // 620 of them fill the 5 MiB input limit. Before the fix this loop took about 5 s (7.7 s with the decimal text of
  // each): every byte shifted the whole number. Now each one is a single conversion from hex.
  const inputs: Uint8Array[] = [];
  for (let i = 0; i < 620; i++) inputs.push(content(i));
  const started = performance.now();
  let total = 0n;
  for (const bytes of inputs) total += bignumValue(2n, bytes);
  const elapsed = performance.now() - started;
  expect(total > 0n).toBe(true);
  // A generous limit that a loaded CI machine still meets.
  expect(elapsed).toBeLessThan(1500);
}, 60_000);

it('a CBOR array of bignums of 8,192 bytes is written as their decimal values', () => {
  const count = 3;
  const parts: number[] = [0x80 + count];
  for (let i = 0; i < count; i++) parts.push(0xc2, 0x59, 0x20, 0x00, ...content(i));
  const result = convert({
    format: 'cbor',
    direction: 'to-json',
    input: Uint8Array.from(parts),
    inputEncoding: 'hex',
    outputEncoding: 'hex',
    show: 'json',
  });
  // The expected digits are the value of the bytes, worked out here from the hex text of each.
  // A number past 2^53 is written as the $bigint marker over its decimal text.
  const lines = result.text.split('\n').filter((line) => line.includes('"$bigint"'));
  expect(lines).toHaveLength(count);
  for (let i = 0; i < count; i++) {
    const expected = BigInt(`0x${hexOf(content(i))}`).toString();
    expect(lines[i]).toBe(`    "$bigint": "${expected}"`);
  }
}, 60_000);

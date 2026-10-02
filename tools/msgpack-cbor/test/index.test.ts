import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MsgpackCborError, convert, readInputBytes } from '../src/index';

/*
 * Grounding (D-179, P13-08).
 *
 * The expected values come from RFC 8949 Appendix A, Table 6 (https://www.rfc-editor.org/rfc/rfc8949#appendix-A), which
 * lists the bignum 18446744073709551616 as the bytes 0xc249010000000000000000, and from Python 3.14.3's standard
 * base64 module for the Base64 form of the same eleven bytes:
 *
 *   >>> base64.b64encode(bytes.fromhex('c249010000000000000000')).decode()
 *   'wkkBAAAAAAAAAAA='
 *
 * Nothing here treats this folder's own output as the expected value.
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
  // The package prints nothing, ever.
  for (const spy of Object.values(logs)) expect(spy).not.toHaveBeenCalled();
});

const job = (input: string | Uint8Array, over: Partial<Parameters<typeof convert>[0]> = {}) =>
  convert({
    format: 'cbor',
    direction: 'to-json',
    input,
    inputEncoding: 'hex',
    outputEncoding: 'hex',
    show: 'json',
    ...over,
  });

it('RFC 8949 Appendix A bignum c249010000000000000000 becomes the bigint marker 18446744073709551616', () => {
  const result = job('c249010000000000000000');
  expect(JSON.parse(result.text)).toEqual({ $bigint: '18446744073709551616' });
  expect(result.warnings).toEqual([]);

  // The negative bignum of the same table: -18446744073709551617 is c349010000000000000000.
  expect(JSON.parse(job('c349010000000000000000').text)).toEqual({ $bigint: '-18446744073709551617' });
});

it('hex with spaces and Base64 read the same bytes and an odd hex digit count is refused with its position', () => {
  const bytes = [0xc2, 0x49, 0x01, 0, 0, 0, 0, 0, 0, 0, 0];
  expect([...readInputBytes('c249010000000000000000', 'hex')]).toEqual(bytes);
  expect([...readInputBytes('c2 49 01 00 00 00 00 00 00 00 00', 'hex')]).toEqual(bytes);
  expect([...readInputBytes('C2 49\n01 00 00\t00 00 00 00 00 00\n', 'hex')]).toEqual(bytes);
  expect([...readInputBytes('wkkBAAAAAAAAAAA=', 'base64')]).toEqual(bytes);
  expect([...readInputBytes('wkkBAAAAAAAAAAA', 'base64')]).toEqual(bytes);
  expect(readInputBytes('', 'hex')).toHaveLength(0);

  // An odd digit count names the character that has no partner: the 6th character of "c2 490".
  try {
    readInputBytes('c2 490', 'hex');
    expect.unreachable('an odd digit count must be refused');
  } catch (err) {
    expect(err).toBeInstanceOf(MsgpackCborError);
    expect((err as MsgpackCborError).offset).toBeUndefined();
    expect((err as MsgpackCborError).message).toContain('character 6');
  }

  // A character that is not a hex digit names its position too.
  try {
    readInputBytes('c2 4g', 'hex');
    expect.unreachable('a non-hex character must be refused');
  } catch (err) {
    expect(err).toBeInstanceOf(MsgpackCborError);
    expect((err as MsgpackCborError).message).toContain('character 5');
  }
});

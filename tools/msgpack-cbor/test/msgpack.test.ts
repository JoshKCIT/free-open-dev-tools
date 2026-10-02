import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MsgpackCborError } from '../src/common';
import { decodeMsgpack, encodeMsgpack, type MsgpackItem } from '../src/msgpack';
import { SUITE } from './fixtures/msgpack-test-suite/golden';

/*
 * Grounding (D-179, P13-08).
 *
 * The suite cases are the published MessagePack test suite (kawanet/msgpack-test-suite, commit e04f6ed, MIT), vendored
 * in fixtures/msgpack-test-suite/golden.ts by a script from the suite's own JSON (see UPSTREAM.md). The timestamp
 * layouts and the refusal of 0xc1 are the MessagePack specification
 * (https://github.com/msgpack/msgpack/blob/master/spec.md). The 8 byte timestamp literal was also worked out
 * independently with Python 3.14.3's struct module from the specification's layout (30 bits of nanoseconds above 34 bits
 * of seconds):
 *
 *   >>> struct.pack('>Q', (678901234 << 34) | 1514862245).hex()
 *   'a1dcd7c85a4af6a5'
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

/** Bytes from the suite's notation, hex pairs joined by dashes, or from plain hex. */
const bytes = (notation: string): Uint8Array =>
  Uint8Array.from(notation.replace(/-/g, '').match(/../g) ?? [], (pair) => parseInt(pair, 16));
const hexOf = (data: Uint8Array): string => Array.from(data, (b) => b.toString(16).padStart(2, '0')).join('');

/** What an item is as a plain JavaScript value, for the suite's nested arrays and maps of numbers and strings. */
function plain(item: MsgpackItem): unknown {
  switch (item.type) {
    case 'nil':
      return null;
    case 'bool':
    case 'str':
      return item.value;
    case 'int':
      return Number(item.value);
    case 'float':
      return item.value;
    case 'array':
      return item.items.map(plain);
    case 'map':
      return Object.fromEntries(
        item.entries.map(([key, value]) => [String((plain(key) as string | number) ?? ''), plain(value)]),
      );
    default:
      throw new Error(`no plain value for ${item.type}`);
  }
}

it('the MessagePack test suite: all 233 encodings decode to the suite values', () => {
  // The vendored suite is whole: 15 groups, 85 cases and 233 encodings.
  expect(new Set(SUITE.map((c) => c.group)).size).toBe(15);
  expect(SUITE).toHaveLength(85);
  expect(SUITE.reduce((sum, c) => sum + c.encodings.length, 0)).toBe(233);

  const wrong: string[] = [];
  let checked = 0;
  for (const c of SUITE) {
    for (const encoding of c.encodings) {
      checked++;
      const item = decodeMsgpack(bytes(encoding));
      let ok: boolean;
      switch (c.kind) {
        case 'nil':
          ok = item.type === 'nil';
          break;
        case 'bool':
          ok = item.type === 'bool' && item.value === c.value;
          break;
        case 'binary':
          ok = item.type === 'bin' && hexOf(item.value) === (c.value as string).replace(/-/g, '');
          break;
        case 'number':
          // An integer encoding and a float encoding both stand for the suite's number.
          ok =
            (item.type === 'int' && item.value === BigInt(c.value as number)) ||
            (item.type === 'float' && item.value === c.value);
          break;
        case 'bignum':
          ok =
            (item.type === 'int' && item.value === BigInt(c.value as string)) ||
            (item.type === 'float' && item.value === Number(c.value));
          break;
        case 'string':
          ok = item.type === 'str' && item.value === c.value;
          break;
        case 'array':
        case 'map':
          ok = JSON.stringify(plain(item)) === JSON.stringify(c.value);
          break;
        case 'timestamp': {
          const [seconds, nanoseconds] = c.value as [number, number];
          ok = item.type === 'timestamp' && item.seconds === BigInt(seconds) && item.nanoseconds === nanoseconds;
          break;
        }
        case 'ext': {
          const [extType, data] = c.value as [number, string];
          ok = item.type === 'ext' && item.extType === extType && hexOf(item.data) === data.replace(/-/g, '');
          break;
        }
      }
      if (!ok)
        wrong.push(
          `${c.group} ${JSON.stringify(c.value)}: ${encoding} decoded as ${JSON.stringify(item, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`,
        );
    }
  }
  expect(checked).toBe(233);
  expect(wrong).toEqual([]);
});

it('MessagePack timestamps of 4, 8 and 12 bytes keep seconds and nanoseconds', () => {
  const timestamp = (hex: string) => {
    const item = decodeMsgpack(bytes(hex));
    if (item.type !== 'timestamp') throw new Error(`${hex} is ${item.type}`);
    return item;
  };
  // timestamp 32: 0xd6, type -1, seconds as a 32 bit unsigned integer.
  expect(timestamp('d6ff5a4af6a5')).toMatchObject({ seconds: 1514862245n, nanoseconds: 0, size: 4 });
  expect(timestamp('d6ffffffffff')).toMatchObject({ seconds: 4294967295n, nanoseconds: 0, size: 4 });
  // timestamp 64: 0xd7, type -1, 30 bits of nanoseconds then 34 bits of seconds.
  expect(timestamp('d7ffa1dcd7c85a4af6a5')).toMatchObject({ seconds: 1514862245n, nanoseconds: 678901234, size: 8 });
  expect(timestamp('d7ffee6b27ffffffffff')).toMatchObject({ seconds: 17179869183n, nanoseconds: 999999999, size: 8 });
  // timestamp 96: 0xc7, 12, type -1, 32 bits of nanoseconds then 64 bits of signed seconds.
  expect(timestamp('c70cff0000000000000004' + '00000000')).toMatchObject({
    seconds: 17179869184n,
    nanoseconds: 0,
    size: 12,
  });
  expect(timestamp('c70cff3b9ac9ffffffffffffffffff')).toMatchObject({ seconds: -1n, nanoseconds: 999999999, size: 12 });
  expect(timestamp('c70cff3b9ac9ff0000003afff4417f')).toMatchObject({
    seconds: 253402300799n,
    nanoseconds: 999999999,
    size: 12,
  });

  // The encoder picks the layout the specification's pseudo code picks, so every one of those comes back identical.
  for (const hex of [
    'd6ff5a4af6a5',
    'd7ffa1dcd7c85a4af6a5',
    'd7ffee6b27ffffffffff',
    'c70cff000000000000000400000000',
    'c70cff3b9ac9ffffffffffffffffff',
    'c70cff3b9ac9ff0000003afff4417f',
    'd6ff00000000',
    'd7ff0000000400000000',
    // seconds 4294967296 and no nanoseconds: the first value that no longer fits the 32 bit layout.
    'd7ff0000000100000000',
  ]) {
    expect(hexOf(encodeMsgpack(decodeMsgpack(bytes(hex)))), hex).toBe(hex);
  }

  // Nanoseconds over 999999999 are not a timestamp (the specification forbids them): the bytes stay an extension.
  const odd = decodeMsgpack(bytes('d7ff' + 'fffffffc00000000'));
  expect(odd).toMatchObject({ type: 'ext', extType: -1 });
  expect(hexOf(encodeMsgpack(odd))).toBe('d7fffffffffc00000000');
  // Extension type -1 with another length is an ordinary extension.
  expect(decodeMsgpack(bytes('d5ff0001'))).toMatchObject({ type: 'ext', extType: -1 });
});

it('0xc1 is refused as never used and a length past the end names the byte offset', () => {
  const refuse = (hex: string): MsgpackCborError => {
    try {
      decodeMsgpack(bytes(hex));
    } catch (err) {
      expect(err).toBeInstanceOf(MsgpackCborError);
      return err as MsgpackCborError;
    }
    throw new Error(`${hex} was not refused`);
  };
  const never = refuse('c1');
  expect(never.offset).toBe(0);
  expect(never.message).toContain('never used');
  // Inside an array the byte is at offset 1.
  expect(refuse('91c1').offset).toBe(1);

  // A fixstr of 5 bytes with 2 present: the string starts at byte 0.
  const short = refuse('a56162');
  expect(short.offset).toBe(0);
  expect(short.message).toContain('byte 0');
  // The same inside an array: the string starts at byte 1.
  expect(refuse('91a56162').offset).toBe(1);
  // Lengths of every width run past the end.
  expect(refuse('c4ff').offset).toBe(0); // bin 8
  expect(refuse('c50100aa').offset).toBe(0); // bin 16
  expect(refuse('c6ffffffff00').offset).toBe(0); // bin 32
  expect(refuse('d9ff').offset).toBe(0); // str 8
  expect(refuse('c8000501').offset).toBe(0); // ext 16
  expect(refuse('d6ff00').offset).toBe(0); // fixext 4
  // An array or map that declares more items than there are bytes left is refused before any item is read.
  expect(refuse('dd0000000501').offset).toBe(0);
  expect(refuse('df0000000301020304').offset).toBe(0);
  // Integers and floats missing their bytes.
  expect(refuse('cd01').offset).toBe(0);
  expect(refuse('cb000000').offset).toBe(0);
  // Text that is not UTF-8 names the string's offset: the array is at byte 0, the nil at 1 and the string at 2.
  expect(refuse('92c0a2c328').offset).toBe(2);
  // Bytes after the value.
  expect(refuse('c0c0').offset).toBe(1);
  // Nothing at all.
  expect(refuse('').offset).toBe(0);
});

it('the encoder writes the shortest form of integers, floats, strings and lengths', () => {
  const enc = (item: MsgpackItem): string => hexOf(encodeMsgpack(item));
  const int = (value: bigint): MsgpackItem => ({ type: 'int', value, format: 'int 64' });
  // Positive integers use the smallest unsigned form, negative ones the smallest signed form (specification format table).
  expect(enc(int(0n))).toBe('00');
  expect(enc(int(127n))).toBe('7f');
  expect(enc(int(128n))).toBe('cc80');
  expect(enc(int(256n))).toBe('cd0100');
  expect(enc(int(65536n))).toBe('ce00010000');
  expect(enc(int(4294967296n))).toBe('cf0000000100000000');
  expect(enc(int(18446744073709551615n))).toBe('cfffffffffffffffff');
  expect(enc(int(-1n))).toBe('ff');
  expect(enc(int(-32n))).toBe('e0');
  expect(enc(int(-33n))).toBe('d0df');
  expect(enc(int(-129n))).toBe('d1ff7f');
  expect(enc(int(-32769n))).toBe('d2ffff7fff');
  expect(enc(int(-2147483649n))).toBe('d3ffffffff7fffffff');
  expect(enc(int(-9223372036854775808n))).toBe('d38000000000000000');
  // A float is single precision when that keeps the value, double otherwise.
  expect(enc({ type: 'float', value: 0.5, width: 64 })).toBe('ca3f000000');
  expect(enc({ type: 'float', value: 0.1, width: 32 })).toBe('cb3fb999999999999a');
  expect(enc({ type: 'float', value: NaN, width: 64 })).toBe('ca7fc00000');
  // Strings and binaries pick fixstr, str 8, 16, 32 and bin 8, 16, 32 by length.
  expect(enc({ type: 'str', value: 'a'.repeat(31) }).slice(0, 2)).toBe('bf');
  expect(enc({ type: 'str', value: 'a'.repeat(32) }).slice(0, 4)).toBe('d920');
  expect(enc({ type: 'str', value: 'a'.repeat(256) }).slice(0, 6)).toBe('da0100');
  expect(enc({ type: 'bin', value: new Uint8Array(0) })).toBe('c400');
  expect(enc({ type: 'bin', value: new Uint8Array(256) }).slice(0, 6)).toBe('c50100');
  // Containers: fixarray and fixmap up to 15, then 16 bit counts.
  expect(enc({ type: 'array', items: [] })).toBe('90');
  expect(enc({ type: 'array', items: new Array(16).fill({ type: 'nil' }) as MsgpackItem[] }).slice(0, 6)).toBe(
    'dc0010',
  );
  expect(enc({ type: 'map', entries: [] })).toBe('80');
  // Extensions: fixext for 1, 2, 4, 8 and 16 bytes, ext 8 otherwise.
  expect(enc({ type: 'ext', extType: 5, data: new Uint8Array(3) })).toBe('c70305000000');
  expect(enc({ type: 'ext', extType: -128, data: new Uint8Array(1) })).toBe('d48000');
});

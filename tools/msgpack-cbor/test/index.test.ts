import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MAX_INPUT_BYTES, MsgpackCborError, checkInputSize, convert, readInputBytes } from '../src/index';

/*
 * Grounding (D-179, P13-08).
 *
 * The expected values come from RFC 8949 Appendix A, Table 6 (https://www.rfc-editor.org/rfc/rfc8949#appendix-A), which
 * lists the bignum 18446744073709551616 as the bytes 0xc249010000000000000000, from the RFC's section 3 head layout, from
 * the MessagePack specification's format table, from the published MessagePack test suite (fixtures/), and from
 * Python 3.14.3's standard base64 module for the Base64 forms:
 *
 *   >>> base64.b64encode(bytes.fromhex('c249010000000000000000')).decode()
 *   'wkkBAAAAAAAAAAA='
 *   01020304 -> AQIDBA==    00ff -> AP8=    a26161016162820203 -> omFhAWFiggID    82a16101a162920203 -> gqFhAaFikgID
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

const hexOf = (data: Uint8Array): string => Array.from(data, (b) => b.toString(16).padStart(2, '0')).join('');

const toJson = (format: 'msgpack' | 'cbor', hex: string) => job(hex, { format });
const fromJson = (format: 'msgpack' | 'cbor', json: string, over: Partial<Parameters<typeof convert>[0]> = {}) =>
  job(json, { format, direction: 'from-json', ...over });

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

it('binary values, tags, extensions, non-string keys, big integers, NaN, undefined and simple values use explicit markers and convert back', () => {
  // [format, bytes in the shortest form, the JSON the markers give].
  const cases: ['msgpack' | 'cbor', string, unknown][] = [
    // CBOR (RFC 8949 section 3; the rows and heads are the RFC's).
    ['cbor', '4401020304', { $bytes: 'AQIDBA==' }],
    ['cbor', 'd74401020304', { $tag: 23, $value: { $bytes: 'AQIDBA==' } }],
    ['cbor', 'd9270f01', { $tag: 9999, $value: 1 }],
    ['cbor', 'c11a514b67b0', { $tag: 1, $value: 1363896240 }],
    [
      'cbor',
      'a201020304',
      {
        $map: [
          [1, 2],
          [3, 4],
        ],
      },
    ],
    ['cbor', 'a16624627974657301', { $map: [['$bytes', 1]] }],
    [
      'cbor',
      'a2616101616102',
      {
        $map: [
          ['a', 1],
          ['a', 2],
        ],
      },
    ],
    ['cbor', 'a26161016162820203', { a: 1, b: [2, 3] }],
    ['cbor', 'f97e00', { $float: 'NaN' }],
    ['cbor', 'f97c00', { $float: 'Infinity' }],
    ['cbor', 'f9fc00', { $float: '-Infinity' }],
    ['cbor', 'f7', { $undefined: true }],
    ['cbor', 'f0', { $simple: 16 }],
    ['cbor', 'f8ff', { $simple: 255 }],
    ['cbor', 'f4', false],
    ['cbor', 'f6', null],
    ['cbor', '1bffffffffffffffff', { $bigint: '18446744073709551615' }],
    ['cbor', '3bffffffffffffffff', { $bigint: '-18446744073709551616' }],
    ['cbor', 'c249010000000000000000', { $bigint: '18446744073709551616' }],
    ['cbor', 'c349010000000000000000', { $bigint: '-18446744073709551617' }],
    ['cbor', '1b001fffffffffffff', 9007199254740991],
    ['cbor', '1b0020000000000000', { $bigint: '9007199254740992' }],
    ['cbor', '62c3bc', 'ü'],
    // MessagePack (the specification's format table; extension and timestamp bytes are the suite's).
    ['msgpack', 'c40200ff', { $bytes: 'AP8=' }],
    ['msgpack', 'd40110', { $ext: 1, $hex: '10' }],
    ['msgpack', 'c70307707172', { $ext: 7, $hex: '707172' }],
    ['msgpack', 'd7ffa1dcd7c85a4af6a5', { $timestamp: { seconds: '1514862245', nanoseconds: 678901234 } }],
    ['msgpack', 'd6ff5a4af6a5', { $timestamp: { seconds: '1514862245', nanoseconds: 0 } }],
    ['msgpack', 'c70cff3b9ac9ffffffffffffffffff', { $timestamp: { seconds: '-1', nanoseconds: 999999999 } }],
    ['msgpack', '810102', { $map: [[1, 2]] }],
    ['msgpack', '81a16101', { a: 1 }],
    ['msgpack', '82a16101a162920203', { a: 1, b: [2, 3] }],
    ['msgpack', 'cfffffffffffffffff', { $bigint: '18446744073709551615' }],
    ['msgpack', 'd38000000000000000', { $bigint: '-9223372036854775808' }],
    ['msgpack', 'ca7fc00000', { $float: 'NaN' }],
    ['msgpack', 'ca7f800000', { $float: 'Infinity' }],
    ['msgpack', 'caff800000', { $float: '-Infinity' }],
    ['msgpack', 'c0', null],
    ['msgpack', 'c3', true],
    ['msgpack', 'a3e6b0b4', '水'],
  ];
  for (const [format, hex, expected] of cases) {
    const there = toJson(format, hex);
    expect(JSON.parse(there.text), `${format} ${hex}`).toEqual(expected);
    expect(there.warnings, `${format} ${hex}`).toEqual([]);
    // The same markers convert back to the same bytes.
    const back = fromJson(format, there.text);
    expect(back.text, `${format} ${hex} back`).toBe(hex);
    expect(hexOf(back.bytes!), `${format} ${hex} bytes`).toBe(hex);
    expect(back.warnings, `${format} ${hex} back`).toEqual([]);
  }

  // A float always keeps a fraction or an exponent in the JSON text, so it reads back as a float and not an integer.
  expect(toJson('cbor', 'fa47c35000').text).toBe('100000.0');
  expect(toJson('cbor', 'f98000').text).toBe('-0.0');
  expect(toJson('cbor', 'fb3ff199999999999a').text).toBe('1.1');
  expect(toJson('cbor', 'fb7e37e43c8800759c').text).toBe('1e+300');
  expect(fromJson('cbor', '100000.0').text).toBe('fa47c35000');
  expect(fromJson('cbor', '100000').text).toBe('1a000186a0');
  expect(fromJson('cbor', '-0').text).toBe('f98000');
  expect(fromJson('cbor', '1e2').text).toBe('f95640');
  // An integer written out in full, of any size, is read exactly.
  expect(fromJson('cbor', '18446744073709551616').text).toBe('c249010000000000000000');
  expect(fromJson('cbor', '-18446744073709551617').text).toBe('c349010000000000000000');
});

it('JSON to CBOR and MessagePack writes the shortest form and the output is hex or Base64', () => {
  const json = '{"a": 1, "b": [2, 3]}';
  // RFC 8949 Appendix A, the row {"a": 1, "b": [2, 3]}; the MessagePack bytes follow the specification's format table.
  expect(fromJson('cbor', json).text).toBe('a26161016162820203');
  expect(fromJson('cbor', json, { outputEncoding: 'base64' }).text).toBe('omFhAWFiggID');
  expect(fromJson('msgpack', json).text).toBe('82a16101a162920203');
  expect(fromJson('msgpack', json, { outputEncoding: 'base64' }).text).toBe('gqFhAaFikgID');
  // Base64 input reads the same value as hex.
  expect(JSON.parse(job('omFhAWFiggID', { inputEncoding: 'base64' }).text)).toEqual({ a: 1, b: [2, 3] });
  expect(fromJson('cbor', json).bytes).toHaveLength(9);
  // Diagnostic notation is offered for CBOR.
  expect(job('a26161016162820203', { show: 'diagnostic' }).text).toBe('{"a": 1, "b": [2, 3]}');
  expect(job('bf61610161629f0203ffff', { show: 'diagnostic' }).text).toBe('{_ "a": 1, "b": [_ 2, 3]}');
});

it('nesting deeper than 256 is refused with the byte offset', () => {
  const refuse = (format: 'msgpack' | 'cbor', hex: string) => {
    try {
      toJson(format, hex);
    } catch (err) {
      expect(err).toBeInstanceOf(MsgpackCborError);
      return err as MsgpackCborError;
    }
    throw new Error('the nesting was not refused');
  };
  // 256 levels are read; the 257th container is refused at its own byte.
  const levels = (n: number, one: string, end: string) => one.repeat(n - 1) + end;
  expect(() => toJson('cbor', levels(256, '81', '80'))).not.toThrow();
  expect(refuse('cbor', levels(257, '81', '80')).offset).toBe(256);
  expect(() => toJson('msgpack', levels(256, '91', '90'))).not.toThrow();
  expect(refuse('msgpack', levels(257, '91', '90')).offset).toBe(256);
  // Maps (two bytes a level) and tags count the same way.
  expect(() => toJson('cbor', levels(256, 'a101', 'a0'))).not.toThrow();
  expect(refuse('cbor', levels(257, 'a101', 'a0')).offset).toBe(512);
  expect(() => toJson('msgpack', levels(256, '8101', '80'))).not.toThrow();
  expect(refuse('msgpack', levels(257, '8101', '80')).offset).toBe(512);
  expect(() => toJson('cbor', 'c1'.repeat(256) + '00')).not.toThrow();
  const tags = refuse('cbor', 'c1'.repeat(257) + '00');
  expect(tags.offset).toBe(256);
  expect(tags.message).toContain('256');
  // JSON that nests too deep is refused with its line and column.
  expect(() => fromJson('cbor', '['.repeat(256) + ']'.repeat(256))).not.toThrow();
  try {
    fromJson('msgpack', '['.repeat(257) + ']'.repeat(257));
    expect.unreachable('257 levels of JSON must be refused');
  } catch (err) {
    expect(err).toBeInstanceOf(MsgpackCborError);
    expect((err as MsgpackCborError).message).toContain('256');
    expect((err as MsgpackCborError).line).toBe(1);
    expect((err as MsgpackCborError).column).toBe(257);
  }
});

it('an object that looks like a marker but does not fit is written as an ordinary map after a warning', () => {
  const asMap = (format: 'msgpack' | 'cbor', json: string, key: string) => {
    const result = fromJson(format, json);
    expect(result.warnings, json).toHaveLength(1);
    expect(result.warnings[0], json).toContain(key);
    // The map is real: reading the bytes back gives an object that still holds the marker's key.
    expect(toJson(format, result.text).text, json).toContain(JSON.stringify(key));
    return result;
  };
  // The 66 header is a six character text string, "$bytes" being 24 62 79 74 65 73; "!!!" is 63 21 21 21.
  expect(asMap('cbor', '{"$bytes": "!!!"}', '$bytes').text).toBe('a166246279746573' + '63212121');
  asMap('cbor', '{"$bigint": 5}', '$bigint');
  asMap('cbor', '{"$bigint": "12x"}', '$bigint');
  asMap('cbor', '{"$tag": 1}', '$tag');
  asMap('cbor', '{"$tag": -1, "$value": 2}', '$tag');
  asMap('cbor', '{"$bytes": "AQID", "extra": 1}', '$bytes');
  // Base64 padding must be right when it is there, and may be left off.
  asMap('cbor', '{"$bytes": "AQIDBA="}', '$bytes');
  expect(fromJson('cbor', '{"$bytes": "AQIDBA"}').warnings).toEqual([]);
  expect(fromJson('cbor', '{"$bytes": "AQIDBA=="}').text).toBe('4401020304');
  expect(fromJson('cbor', '{"$bytes": "AQIDBA"}').text).toBe('4401020304');
  asMap('cbor', '{"$float": "nan"}', '$float');
  asMap('cbor', '{"$simple": 22}', '$simple');
  asMap('cbor', '{"$undefined": 1}', '$undefined');
  asMap('cbor', '{"$map": [[1]]}', '$map');
  // A marker for the other format does not fit this one.
  asMap('cbor', '{"$ext": 1, "$hex": "10"}', '$ext');
  asMap('cbor', '{"$timestamp": {"seconds": "1", "nanoseconds": 0}}', '$timestamp');
  asMap('msgpack', '{"$tag": 1, "$value": 2}', '$tag');
  asMap('msgpack', '{"$undefined": true}', '$undefined');
  asMap('msgpack', '{"$simple": 16}', '$simple');
  asMap('msgpack', '{"$ext": 200, "$hex": "10"}', '$ext');
  asMap('msgpack', '{"$ext": -129, "$hex": "10"}', '$ext');
  expect(fromJson('msgpack', '{"$ext": -128, "$hex": "10"}').text).toBe('d48010');
  expect(fromJson('msgpack', '{"$ext": 127, "$hex": "10"}').text).toBe('d47f10');
  asMap('msgpack', '{"$ext": 1, "$hex": "1"}', '$ext');
  asMap('msgpack', '{"$timestamp": {"seconds": "1", "nanoseconds": 1000000000}}', '$timestamp');
  // The warning names where the object is.
  expect(fromJson('cbor', '[1, {"$bytes": 3}]').warnings[0]).toContain('$[1]');
  expect(fromJson('cbor', '{"a": {"$bytes": 3}}').warnings[0]).toContain('$.a');
  // A key that only begins with a dollar sign is an ordinary key and needs no warning.
  expect(fromJson('cbor', '{"$price": 5}').warnings).toEqual([]);
  // A repeated key is kept, with a warning, because JSON text may repeat a key and nothing is dropped.
  const repeated = fromJson('cbor', '{"a": 1, "a": 2}');
  expect(repeated.text).toBe('a2616101616102');
  expect(repeated.warnings).toHaveLength(1);
  expect(repeated.warnings[0]).toContain('"a"');
  // A __proto__ key is an ordinary key, both ways, and nothing on Object.prototype changes.
  const proto = fromJson('cbor', '{"__proto__": {"polluted": true}}');
  expect(proto.warnings).toEqual([]);
  expect(toJson('cbor', proto.text).text).toContain('"__proto__"');
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
  expect(toJson('cbor', 'a1695f5f70726f746f5f5f01').text).toContain('"__proto__": 1');
});

it('input over 5 MiB is refused before decoding and exactly 5 MiB is read', () => {
  const MAX = 5 * 1024 * 1024;
  expect(MAX_INPUT_BYTES).toBe(MAX);
  // A byte string whose whole encoding is exactly 5 MiB: a 5 byte head (5a and a 4 byte length) and the rest.
  const exact = new Uint8Array(MAX);
  exact.set([0x5a, 0x00, 0x4f, 0xff, 0xfb], 0);
  const read = job(exact);
  expect(read.bytesIn).toBe(MAX);
  expect(read.text.startsWith('{\n  "$bytes": "')).toBe(true);

  // One byte more is refused with the limit named and no byte offset: it never reached the decoder, which would have
  // refused 0xff as a break at offset 0.
  const refuse = (run: () => unknown): MsgpackCborError => {
    try {
      run();
    } catch (err) {
      expect(err).toBeInstanceOf(MsgpackCborError);
      return err as MsgpackCborError;
    }
    throw new Error('the input was not refused');
  };
  const over = refuse(() => job(new Uint8Array(MAX + 1).fill(0xff)));
  expect(over.offset).toBeUndefined();
  expect(over.message).toContain('5 MiB');
  expect(() => checkInputSize(MAX)).not.toThrow();
  expect(refuse(() => checkInputSize(MAX + 1)).message).toContain('5 MiB');
  // Pasted hex and Base64 are refused from their length, before the bytes are made.
  expect(refuse(() => readInputBytes('00'.repeat(MAX + 1), 'hex')).message).toContain('5 MiB');
  expect(refuse(() => readInputBytes('AAAA'.repeat(Math.ceil((MAX + 2) / 3)), 'base64')).message).toContain('5 MiB');
  expect(readInputBytes('00'.repeat(MAX), 'hex')).toHaveLength(MAX);
  // JSON text over the limit is refused before it is parsed; exactly 5 MiB of JSON is read.
  const quote = '"';
  expect(fromJson('cbor', quote + 'a'.repeat(MAX - 2) + quote).bytesIn).toBe(MAX);
  const bigJson = refuse(() => fromJson('cbor', quote + 'a'.repeat(MAX - 1) + quote));
  expect(bigJson.offset).toBeUndefined();
  expect(bigJson.message).toContain('5 MiB');
});

it('JSON that is not valid, a lone surrogate or a number out of range is refused with its position', () => {
  const refuse = (format: 'msgpack' | 'cbor', json: string): MsgpackCborError => {
    try {
      fromJson(format, json);
    } catch (err) {
      expect(err).toBeInstanceOf(MsgpackCborError);
      return err as MsgpackCborError;
    }
    throw new Error(`${json} was not refused`);
  };
  const broken = refuse('cbor', '{\n  "a": tru\n}');
  expect(broken.line).toBe(2);
  expect(broken.column).toBe(8);
  expect(refuse('cbor', '[1, 2,]').column).toBe(7);
  expect(refuse('cbor', '{"a": 1} x').column).toBe(10);
  expect(refuse('cbor', '01').column).toBe(2);
  expect(refuse('cbor', '"a\nb"').line).toBe(1);
  // A lone surrogate cannot be written as UTF-8, so it is refused instead of becoming U+FFFD.
  expect(refuse('cbor', '"\\ud800"').message).toContain('surrogate');
  expect(refuse('msgpack', '["ok", "\\udc00x"]').message).toContain('surrogate');
  // A pair is a character and is kept.
  expect(fromJson('cbor', '"\\ud800\\udd51"').text).toBe('64f0908591');
  // A float that does not fit a double, or rounds to zero, is refused, never turned into Infinity or 0.
  expect(refuse('cbor', '1e999').message).toContain('too large');
  expect(refuse('cbor', '1e-999').message).toContain('too small');
  expect(fromJson('cbor', '0.0').text).toBe('f90000');
  // MessagePack has no integers outside its 64 bit range and no bignums.
  expect(refuse('msgpack', '18446744073709551616').message).toContain('18446744073709551615');
  expect(refuse('msgpack', '{"$bigint": "-9223372036854775809"}').message).toContain('-9223372036854775808');
  expect(fromJson('msgpack', '18446744073709551615').text).toBe('cfffffffffffffffff');
  // An integer of more than 20000 digits is refused before it is turned into a number.
  expect(refuse('cbor', '1'.repeat(20001)).message).toContain('20,000');
  expect(refuse('cbor', '{"$bigint": "' + '1'.repeat(20001) + '"}').message).toContain('20,000');
});

it('reports what was changed: joined chunks, a NaN payload, and the integer and float widths', () => {
  // An indefinite-length byte string is joined into one value, and the page says so.
  const joined = toJson('cbor', '5f42010243030405ff');
  expect(JSON.parse(joined.text)).toEqual({ $bytes: 'AQIDBAU=' });
  expect(joined.warnings).toHaveLength(1);
  expect(joined.warnings[0]).toContain('indefinite');
  // A NaN with payload bits keeps its meaning but not its bits, and the page says so; the usual quiet NaN does not warn.
  expect(toJson('cbor', 'fa7fc00001').warnings.join(' ')).toContain('NaN');
  expect(toJson('cbor', 'fb7ff8000000000001').warnings.join(' ')).toContain('NaN');
  expect(toJson('msgpack', 'ca7fc00001').warnings.join(' ')).toContain('NaN');
  expect(toJson('cbor', 'f97e00').warnings).toEqual([]);
  expect(toJson('cbor', 'fa7fc00000').warnings).toEqual([]);
  // Chunks are joined without anything between them.
  expect(JSON.parse(toJson('cbor', '7f657374726561646d696e67ff').text)).toBe('streaming');
  // MessagePack input lists the integer and float widths it used, in the order they first appear.
  const widths = toJson('msgpack', '94cc80d1ff00cb3ff0000000000000ca3f800000').widths;
  expect(widths).toEqual([
    ['uint 8', 1],
    ['int 16', 1],
    ['float 64', 1],
    ['float 32', 1],
  ]);
  expect(toJson('msgpack', '93010101').widths).toEqual([['positive fixint', 3]]);
  expect(toJson('cbor', '01').widths).toBeUndefined();
  expect(toJson('msgpack', 'c0').widths).toBeUndefined();
});

it('a bignum of more than 8192 bytes stays a tag and a bignum of 8192 bytes is a number', () => {
  // Turning a very long bignum into decimal digits would take too long, so past 8192 bytes it is kept as a tag over its
  // bytes, which loses nothing and comes back the same.
  const long = 'c2' + '592001' + '01' + '00'.repeat(8192);
  const asTag = JSON.parse(toJson('cbor', long).text) as Record<string, unknown>;
  expect(Object.keys(asTag)).toEqual(['$tag', '$value']);
  expect(asTag['$tag']).toBe(2);
  expect(fromJson('cbor', toJson('cbor', long).text).text).toBe(long);
  const exact = 'c2' + '592000' + '01' + '00'.repeat(8191);
  const asNumber = JSON.parse(toJson('cbor', exact).text) as { $bigint: string };
  // The byte string 01 followed by 8191 zero bytes is the number 2 to the power of 8 times 8191.
  expect(BigInt(asNumber.$bigint)).toBe(2n ** BigInt(8 * 8191));
  expect(fromJson('cbor', toJson('cbor', exact).text).text).toBe(exact);
});

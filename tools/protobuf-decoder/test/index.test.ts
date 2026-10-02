import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  MAX_FIELDS,
  MAX_GUESS_DEPTH,
  MAX_INPUT_BYTES,
  ProtobufDecoderError,
  decodeProtobuf,
  decodeProtobufInfo,
  formatDecodeRaw,
  readInputBytes,
  type ProtoField,
} from '../src/index';

/*
 * Grounding (D-179, P13-08).
 *
 * The expected values come from the Protocol Buffers encoding guide (https://protobuf.dev/programming-guides/encoding/,
 * fetched 2026-10-02: "08 96 01" is the message Test1 with a set to 150, "-500z is the same as the varint 999", the
 * Test3 bytes 1a03089601, the Test4 bytes 220568656c6c6f2a03010203) and from the real protobuf library as a second
 * opinion: Python 3.14.3 with protobuf 7.34.1, building the guide's message types from descriptors in code (no protoc)
 * and printing SerializeToString().hex(). Its output, quoted as literals here:
 *
 *   Test1 a=150                          089601
 *   Test2 b=testing                      120774657374696e67
 *   Test3 c.a=150                        1a03089601
 *   Test4 d=hello e=[1,2,3]              220568656c6c6f2a03010203   (proto3: packed)
 *   sint32 -500 in field 1               08e707
 *   int64 -2 in field 2                  10feffffffffffffffff01
 *   fixed32 1 in field 3                 1d01000000
 *   double 1.5 in field 4                21000000000000f83f
 *   float 1.5 in field 1                 0d0000c03f
 *   fixed64 1 in field 1                 090100000000000000
 *   sfixed32 -2 in field 1               0dfeffffff
 *   bool true in field 1                 0801
 *   bytes 00 01 ff in field 1            0a030001ff
 *   string "café" in field 1             0a05636166c3a9
 *   uint64 18446744073709551615          08ffffffffffffffffff01
 *   int32 -1                             08ffffffffffffffffff01
 *   int32 2147483647                     08ffffffff07
 *   proto2 group 1 holding field 2 = 5   0b10050c
 *   proto2 unpacked repeated int32 1,2,3 080108020803
 *
 * The same program's struct module gave the number readings: the bytes 000000000000f83f read as the unsigned integer
 * 4609434218613702656 and the double 1.5, 0000c03f as 1069547520 and the float 1.5, 0100000000000000 as the double
 * 5e-324, feffffff as 4294967294, -2 and a NaN, and cdcccc3d as the float 0.1 (the shortest text that reads back as the
 * same single precision number; its double value is 0.10000000149011612). The Base64 forms are from its base64 module.
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

const bytes = (hex: string): Uint8Array => readInputBytes(hex, 'hex');
const ON = { nested: true, packed: false };
const PACKED = { nested: true, packed: true };

const reading = (field: ProtoField, label: string): string | undefined =>
  field.readings.find((r) => r.label === label)?.value;

/** A varint as bytes, for building inputs. */
function varint(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  while (rest >= 0x80) {
    out.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  out.push(rest);
  return out;
}

/** A length-delimited field 1 around `inner`. */
const wrap = (inner: Uint8Array): Uint8Array => Uint8Array.from([0x0a, ...varint(inner.length), ...inner]);

const refuse = (data: Uint8Array, options = ON): ProtobufDecoderError => {
  try {
    decodeProtobuf(data, options);
  } catch (err) {
    expect(err).toBeInstanceOf(ProtobufDecoderError);
    return err as ProtobufDecoderError;
  }
  throw new Error('the bytes were not refused');
};

const LITERALS: Record<string, string> = {
  'Test1 a=150': '089601',
  'Test2 b=testing': '120774657374696e67',
  'Test3 c.a=150': '1a03089601',
  'Test4 d=hello e=[1,2,3]': '220568656c6c6f2a03010203',
  'sint32 -500': '08e707',
  'int64 -2': '10feffffffffffffffff01',
  'fixed32 1': '1d01000000',
  'double 1.5': '21000000000000f83f',
  'float 1.5': '0d0000c03f',
  'fixed64 1': '090100000000000000',
  'sfixed32 -2': '0dfeffffff',
  'bool true': '0801',
  'bytes 00 01 ff': '0a030001ff',
  'string cafe with an acute accent': '0a05636166c3a9',
  'uint64 max': '08ffffffffffffffffff01',
  'int32 -1': '08ffffffffffffffffff01',
  'int32 2147483647': '08ffffffff07',
  'group 1 holding field 2 = 5': '0b10050c',
  'unpacked 1, 2, 3': '080108020803',
};

it('the encoding guide Test1 message 08 96 01 is field 1 with the varint 150', () => {
  const fields = decodeProtobuf(bytes('08 96 01'), ON);
  expect(fields).toEqual([
    {
      path: '1',
      number: 1,
      wireType: 0,
      wireName: 'VARINT',
      offset: 0,
      readings: [
        { label: 'Unsigned', value: '150' },
        { label: 'Signed', value: '150' },
        { label: 'Zigzag', value: '75' },
      ],
    },
  ]);
  // The guide: "if you used a tool to dump those bytes, you would get something like 1: 150".
  expect(formatDecodeRaw(fields)).toBe('1: 150');
});

it('the guide Test2, Test3 and Test4 messages decode as the protobuf library encoded them', () => {
  // Test2: field 2, a string "testing".
  const test2 = decodeProtobuf(bytes('120774657374696e67'), ON);
  expect(test2).toHaveLength(1);
  expect(test2[0]).toMatchObject({ path: '2', number: 2, wireType: 2, wireName: 'LEN', offset: 0, length: 7 });
  expect(test2[0]!.readings).toEqual([
    { label: 'Text', value: 'testing' },
    { label: 'Bytes', value: '74 65 73 74 69 6e 67' },
  ]);
  expect(test2[0]!.children).toBeUndefined();
  expect(formatDecodeRaw(test2)).toBe('2: "testing"');

  // Test3: field 3 holds a Test1 whose a is 150, so the bytes of 08 96 01 are a nested message at byte 2.
  const test3 = decodeProtobuf(bytes('1a03089601'), ON);
  expect(test3[0]).toMatchObject({ path: '3', number: 3, wireName: 'LEN', length: 3 });
  expect(test3[0]!.readings).toEqual([
    { label: 'Nested message', value: '1 field' },
    { label: 'Bytes', value: '08 96 01' },
  ]);
  expect(test3[0]!.children).toHaveLength(1);
  expect(test3[0]!.children![0]).toMatchObject({ path: '3.1', number: 1, wireName: 'VARINT', offset: 2 });
  expect(reading(test3[0]!.children![0]!, 'Unsigned')).toBe('150');
  // The guide writes it as "3: {1: 150}"; the listing writes a message as an indented block.
  expect(formatDecodeRaw(test3)).toBe('3 {\n  1: 150\n}');
  // Without nested guesses the bytes are all there is.
  const flat = decodeProtobuf(bytes('1a03089601'), { nested: false, packed: false });
  expect(flat[0]!.children).toBeUndefined();
  expect(flat[0]!.readings).toEqual([{ label: 'Bytes', value: '08 96 01' }]);

  // Test4: d is "hello" (field 4) and e is [1, 2, 3] packed (field 5), the guide's "220568656c6c6f2a03010203".
  const test4 = decodeProtobuf(bytes('220568656c6c6f2a03010203'), ON);
  expect(test4).toHaveLength(2);
  expect(test4[0]).toMatchObject({ path: '4', number: 4, offset: 0 });
  expect(reading(test4[0]!, 'Text')).toBe('hello');
  expect(test4[1]).toMatchObject({ path: '5', number: 5, offset: 7 });
  expect(test4[1]!.readings).toEqual([{ label: 'Bytes', value: '01 02 03' }]);
  expect(formatDecodeRaw(test4)).toBe('4: "hello"\n5: bytes 01 02 03');
});

it('sint32, int64, fixed32 and double encodings show the reading that matches each declared type', () => {
  const one = (hex: string): ProtoField => {
    const fields = decodeProtobuf(bytes(hex), ON);
    expect(fields).toHaveLength(1);
    return fields[0]!;
  };

  // sint32 -500 in field 1 is the varint 999, and its zigzag reading is -500 (the guide: -500z is the varint 999).
  const sint = one('08e707');
  expect(sint).toMatchObject({ number: 1, wireType: 0, wireName: 'VARINT' });
  expect(reading(sint, 'Unsigned')).toBe('999');
  expect(reading(sint, 'Zigzag')).toBe('-500');

  // int64 -2 in field 2 takes ten bytes (the guide: all ten bytes must be used); its signed reading is -2.
  const int64 = one('10feffffffffffffffff01');
  expect(int64).toMatchObject({ number: 2, wireType: 0 });
  expect(reading(int64, 'Signed')).toBe('-2');
  expect(reading(int64, 'Unsigned')).toBe('18446744073709551614');
  expect(reading(int64, 'Zigzag')).toBe('9223372036854775807');

  // fixed32 1 in field 3.
  const fixed32 = one('1d01000000');
  expect(fixed32).toMatchObject({ number: 3, wireType: 5, wireName: 'I32' });
  expect(reading(fixed32, 'Unsigned integer')).toBe('1');
  expect(reading(fixed32, 'Signed integer')).toBe('1');
  expect(reading(fixed32, 'Float')).toBe('1e-45');

  // double 1.5 in field 4.
  const double = one('21000000000000f83f');
  expect(double).toMatchObject({ number: 4, wireType: 1, wireName: 'I64' });
  expect(reading(double, 'Double')).toBe('1.5');
  expect(reading(double, 'Unsigned integer')).toBe('4609434218613702656');
  expect(reading(double, 'Signed integer')).toBe('4609434218613702656');

  // The other fixed-width encodings.
  expect(reading(one('0d0000c03f'), 'Float')).toBe('1.5');
  expect(reading(one('0d0000c03f'), 'Unsigned integer')).toBe('1069547520');
  expect(reading(one('090100000000000000'), 'Unsigned integer')).toBe('1');
  expect(reading(one('090100000000000000'), 'Double')).toBe('5e-324');
  const sfixed = one('0dfeffffff');
  expect(reading(sfixed, 'Unsigned integer')).toBe('4294967294');
  expect(reading(sfixed, 'Signed integer')).toBe('-2');
  expect(reading(sfixed, 'Float')).toBe('NaN');
  // The shortest text that reads back as the same single precision number: 0.1, not its double value.
  expect(reading(one('0dcdcccc3d'), 'Float')).toBe('0.1');
  // Doubles print as JavaScript prints them, negative zero included.
  expect(reading(one('090000000000000080'), 'Double')).toBe('-0');

  // Varints: bool, the largest uint64 (ten bytes, the longest valid varint), int32 -1 (the same ten bytes), int32 max.
  expect(reading(one('0801'), 'Unsigned')).toBe('1');
  expect(reading(one('0801'), 'Zigzag')).toBe('-1');
  const max = one('08ffffffffffffffffff01');
  expect(reading(max, 'Unsigned')).toBe('18446744073709551615');
  expect(reading(max, 'Signed')).toBe('-1');
  expect(reading(max, 'Zigzag')).toBe('-9223372036854775808');
  expect(reading(one('08ffffffff07'), 'Unsigned')).toBe('2147483647');
  // A varint with more bytes than it needs is accepted, and means the same number.
  expect(reading(one('088000'), 'Unsigned')).toBe('0');

  // Length-delimited readings: bytes that are not text, and text with a multi byte character.
  expect(one('0a030001ff').readings).toEqual([{ label: 'Bytes', value: '00 01 ff' }]);
  expect(one('0a05636166c3a9').readings.slice(0, 1)).toEqual([{ label: 'Text', value: 'café' }]);
});

it('packed repeated varints are read only when asked', () => {
  const hex = '220568656c6c6f2a03010203';
  const off = decodeProtobuf(bytes(hex), ON);
  expect(reading(off[1]!, 'Packed varints')).toBeUndefined();
  const on = decodeProtobuf(bytes(hex), PACKED);
  expect(on[1]!.readings.map((r) => r.label)).toEqual(['Packed varints', 'Bytes']);
  expect(reading(on[1]!, 'Packed varints')).toBe('1, 2, 3');
  expect(formatDecodeRaw(on)).toBe('4: "hello"\n5: [1, 2, 3]');
  // The guide's alternative: the same values as three separate records (what a proto2 repeated int32 writes).
  const unpacked = decodeProtobuf(bytes('080108020803'), PACKED);
  expect(unpacked.map((f) => [f.number, f.offset, reading(f, 'Unsigned')])).toEqual([
    [1, 0, '1'],
    [1, 2, '2'],
    [1, 4, '3'],
  ]);
  // A run that does not end on a varint boundary is not a packed list; a run of ten bytes with every bit set is.
  expect(reading(decodeProtobuf(bytes('0a0280ff'), PACKED)[0]!, 'Packed varints')).toBeUndefined();
  expect(reading(decodeProtobuf(bytes('0a0aff' + 'ff'.repeat(8) + '01'), PACKED)[0]!, 'Packed varints')).toBe(
    '18446744073709551615',
  );
  // Values of 2 to the 63 and above also show as signed, because that is how a negative int32 or int64 is packed.
  expect(reading(decodeProtobuf(bytes('0a0aff' + 'ff'.repeat(8) + '01'), PACKED)[0]!, 'Packed varints (signed)')).toBe(
    '-1',
  );
  // An empty payload is neither a message nor a list.
  expect(decodeProtobuf(bytes('0a00'), PACKED)[0]!.readings).toEqual([
    { label: 'Text', value: '' },
    { label: 'Bytes', value: '' },
  ]);
});

it('a start group and an end group with the same number are matched', () => {
  // proto2 group 1 holding field 2 = 5, as the real library wrote it: 0b 10 05 0c.
  const fields = decodeProtobuf(bytes('0b10050c'), ON);
  expect(fields).toHaveLength(1);
  expect(fields[0]).toMatchObject({ path: '1', number: 1, wireType: 3, wireName: 'SGROUP', offset: 0 });
  expect(fields[0]!.children).toHaveLength(1);
  expect(fields[0]!.children![0]).toMatchObject({ path: '1.2', number: 2, wireType: 0, offset: 1 });
  expect(reading(fields[0]!.children![0]!, 'Unsigned')).toBe('5');
  expect(formatDecodeRaw(fields)).toBe('1 {\n  2: 5\n}');
  // An empty group, and a group followed by a field after its end.
  expect(decodeProtobuf(bytes('0b0c'), ON)[0]!.children).toEqual([]);
  expect(decodeProtobuf(bytes('0b10050c1801'), ON).map((f) => f.number)).toEqual([1, 3]);
  // Groups are real structure, so they are read even when nested guesses are off.
  expect(decodeProtobuf(bytes('0b10050c'), { nested: false, packed: false })[0]!.children).toHaveLength(1);

  // The guide: "If we encounter 7:EGROUP where we expect 8:EGROUP, the message is mal-formed."
  const mismatch = refuse(bytes('0b1005' + '14'));
  expect(mismatch.offset).toBe(3);
  expect(mismatch.message).toContain('byte 3');
  // An end group with no start, and a start group that never ends (named by where it starts).
  expect(refuse(bytes('0c')).offset).toBe(0);
  expect(refuse(bytes('0801' + '0c')).offset).toBe(2);
  const open = refuse(bytes('0801' + '0b1005'));
  expect(open.offset).toBe(2);
  expect(open.message).toContain('never ends');
  // Groups nest, up to 32 levels.
  const nest = (n: number) => bytes('0b'.repeat(n) + '0c'.repeat(n));
  expect(() => decodeProtobuf(nest(32), ON)).not.toThrow();
  expect(refuse(nest(33)).offset).toBe(32);
});

it('a truncated length and an 11 byte varint are refused with their byte offsets', () => {
  // A length of 5 with 3 bytes left: the field starts at byte 0.
  const length = refuse(bytes('0a05616263'));
  expect(length.offset).toBe(0);
  expect(length.message).toContain('byte 0');
  expect(length.message).toContain('5 bytes');
  // The same after a good field: the field starts at byte 2.
  expect(refuse(bytes('0801' + '12ff0161')).offset).toBe(2);
  // A length that is itself cut short, and a value cut short: both name where the field or varint starts.
  expect(refuse(bytes('0a')).offset).toBe(0);
  expect(refuse(bytes('0896')).offset).toBe(1);
  expect(refuse(bytes('0801' + '80')).offset).toBe(2);
  expect(refuse(bytes('09010000')).offset).toBe(0);
  expect(refuse(bytes('0d0100')).offset).toBe(0);
  // An 11 byte varint: ten bytes with the continuation bit and one more, as a value and as a tag.
  const value = refuse(bytes('08' + 'ff'.repeat(10) + '01'));
  expect(value.offset).toBe(1);
  expect(value.message).toContain('10 bytes');
  expect(refuse(bytes('ff'.repeat(10) + '01')).offset).toBe(0);
  // A 10 byte varint whose last byte is above 1 does not fit in 64 bits.
  expect(refuse(bytes('08' + 'ff'.repeat(9) + '02')).offset).toBe(1);

  // Cutting every example at every position either decodes the front part or is refused at a byte inside it.
  for (const [name, hex] of Object.entries(LITERALS)) {
    const all = bytes(hex);
    for (let cut = 1; cut < all.length; cut++) {
      const front = all.slice(0, cut);
      try {
        decodeProtobuf(front, PACKED);
      } catch (err) {
        expect(err, `${name} cut at ${cut}`).toBeInstanceOf(ProtobufDecoderError);
        const offset = (err as ProtobufDecoderError).offset;
        expect(offset, `${name} cut at ${cut}`).toBeGreaterThanOrEqual(0);
        expect(offset, `${name} cut at ${cut}`).toBeLessThan(cut);
      }
    }
  }
});

it('field number 0 and wire types 6 and 7 are refused', () => {
  const zero = refuse(bytes('0001'));
  expect(zero.offset).toBe(0);
  expect(zero.message).toContain('Field number 0');
  expect(refuse(bytes('0801' + '0001')).offset).toBe(2);
  // Tag 0x0e is field 1 with wire type 6, and 0x0f is field 1 with wire type 7.
  const six = refuse(bytes('0e'));
  expect(six.offset).toBe(0);
  expect(six.message).toContain('wire type 6');
  expect(refuse(bytes('0801' + '0f00')).message).toContain('wire type 7');
  expect(refuse(bytes('0801' + '0f00')).offset).toBe(2);
  // The largest field number is 2 to the 29 minus 1 (536,870,911): its tag is f8ffffff0f. One more is refused.
  const largest = decodeProtobuf(bytes('f8ffffff0f' + '00'), ON);
  expect(largest[0]).toMatchObject({ number: 536870911, wireType: 0, path: '536870911' });
  const tooBig = refuse(bytes('8080808010' + '00'));
  expect(tooBig.offset).toBe(0);
  expect(tooBig.message).toContain('536,870,911');
});

it('nested guesses stop at depth 32 and the bytes are still shown', () => {
  expect(MAX_GUESS_DEPTH).toBe(32);
  const chain = (field: ProtoField): ProtoField[] => {
    const out = [field];
    while (out[out.length - 1]!.children?.length) out.push(out[out.length - 1]!.children![0]!);
    return out;
  };
  // 32 wrappers around a varint: every length-delimited field is guessed to be a message, down to the varint.
  let inner = bytes('0801');
  for (let i = 0; i < 32; i++) inner = wrap(inner);
  const thirtyTwo = chain(decodeProtobuf(inner, ON)[0]!);
  expect(thirtyTwo).toHaveLength(33);
  expect(thirtyTwo[32]).toMatchObject({ wireName: 'VARINT', path: Array(33).fill('1').join('.') });

  // 33 wrappers: the deepest length-delimited field is not guessed, and its bytes are shown instead.
  const thirtyThree = chain(decodeProtobuf(wrap(inner), ON)[0]!);
  expect(thirtyThree).toHaveLength(33);
  const deepest = thirtyThree[32]!;
  expect(deepest.wireName).toBe('LEN');
  expect(deepest.children).toBeUndefined();
  expect(deepest.readings).toEqual([{ label: 'Bytes', value: '08 01' }]);

  // 40 wrappers stop at the same place, and turning guesses off shows none at all.
  let forty = bytes('0801');
  for (let i = 0; i < 40; i++) forty = wrap(forty);
  expect(chain(decodeProtobuf(forty, ON)[0]!)).toHaveLength(33);
  expect(decodeProtobuf(forty, { nested: false, packed: false })[0]!.children).toBeUndefined();
});

it('empty input shows nothing and input over 5 MiB is refused', () => {
  expect(decodeProtobuf(new Uint8Array(0), ON)).toEqual([]);
  expect(formatDecodeRaw([])).toBe('');
  expect(decodeProtobufInfo(new Uint8Array(0), ON)).toEqual({ fields: [], total: 0, truncated: false });
  expect(readInputBytes('', 'hex')).toHaveLength(0);
  expect(readInputBytes(' \n ', 'base64')).toHaveLength(0);

  const MAX = 5 * 1024 * 1024;
  expect(MAX_INPUT_BYTES).toBe(MAX);
  // One byte over is refused before decoding: the zeros would otherwise be refused as field number 0.
  const over = refuse(new Uint8Array(MAX + 1));
  expect(over.message).toContain('5 MiB');
  expect(over.message).not.toContain('Field number 0');
  expect(() => readInputBytes('00'.repeat(MAX + 1), 'hex')).toThrow('5 MiB');
  expect(() => readInputBytes('AAAA'.repeat(Math.ceil((MAX + 2) / 3)), 'base64')).toThrow('5 MiB');
  expect(readInputBytes('00'.repeat(MAX), 'hex')).toHaveLength(MAX);

  // Exactly 5 MiB is read: a length-delimited field 1 whose whole encoding is 5 MiB (a tag, a 4 byte length, then bytes).
  const payload = MAX - 5;
  const exact = new Uint8Array(MAX);
  exact.set([0x0a, ...varint(payload)], 0);
  expect(varint(payload)).toHaveLength(4);
  const read = decodeProtobuf(exact, PACKED);
  expect(read).toHaveLength(1);
  expect(read[0]).toMatchObject({ number: 1, wireName: 'LEN', length: payload });
  // The readings of a long field are cut for display, and say so.
  const shown = reading(read[0]!, 'Bytes')!;
  expect(shown.length).toBeLessThan(400);
  expect(shown).toContain(`${payload.toLocaleString('en-US')} bytes`);

  // More fields than the table can hold are counted but not all kept.
  const many = bytes('0801'.repeat(MAX_FIELDS + 10));
  const info = decodeProtobufInfo(many, ON);
  expect(info.fields).toHaveLength(MAX_FIELDS);
  expect(info.total).toBe(MAX_FIELDS + 10);
  expect(info.truncated).toBe(true);
  // Errors past the cut are still found.
  expect(refuse(bytes('0801'.repeat(MAX_FIELDS + 10) + '0001')).offset).toBe((MAX_FIELDS + 10) * 2);
});

it('hex and Base64 input give the same fields', () => {
  // Base64 from Python 3.14.3's base64 module for the guide's messages.
  const pairs: [string, string][] = [
    ['089601', 'CJYB'],
    ['120774657374696e67', 'Egd0ZXN0aW5n'],
    ['1a03089601', 'GgMIlgE='],
    ['220568656c6c6f2a03010203', 'IgVoZWxsbyoDAQID'],
    ['08e707', 'COcH'],
    ['10feffffffffffffffff01', 'EP7//////////wE='],
    ['1d01000000', 'HQEAAAA='],
    ['21000000000000f83f', 'IQAAAAAAAPg/'],
  ];
  for (const [hex, base64] of pairs) {
    const fromHex = readInputBytes(hex, 'hex');
    expect([...readInputBytes(base64, 'base64')], base64).toEqual([...fromHex]);
    expect(decodeProtobuf(readInputBytes(base64, 'base64'), PACKED)).toEqual(decodeProtobuf(fromHex, PACKED));
    // Spaces and line breaks in the middle read the same, in hex and in Base64.
    expect([...readInputBytes(hex.replace(/(..)/g, '$1 ').trim(), 'hex')]).toEqual([...fromHex]);
    expect([...readInputBytes(base64.replace(/(...)/g, '$1\n'), 'base64')]).toEqual([...fromHex]);
    // Padding may be left off, and the URL-safe letters mean the same as the standard ones.
    expect([...readInputBytes(base64.replace(/=+$/, ''), 'base64')]).toEqual([...fromHex]);
    expect([...readInputBytes(base64.replace(/\+/g, '-').replace(/\//g, '_'), 'base64')]).toEqual([...fromHex]);
  }
  // An odd hex digit count and a character outside the alphabet name their character position.
  expect(() => readInputBytes('0896 0', 'hex')).toThrow('character 6');
  expect(() => readInputBytes('08 9g', 'hex')).toThrow('character 5');
  expect(() => readInputBytes('CJY*', 'base64')).toThrow('character 4');
  expect(() => readInputBytes('CJYBA', 'base64')).toThrow(ProtobufDecoderError);
  expect(() => readInputBytes('CJ=Y', 'base64')).toThrow('padding');
});

it('text is shown only when the bytes are valid UTF-8 without control characters', () => {
  const text = (hex: string): string | undefined => reading(decodeProtobuf(bytes(hex), ON)[0]!, 'Text');
  expect(text('0a03616263')).toBe('abc');
  // Tab, line feed and carriage return are allowed.
  expect(text('0a03090a0d')).toBe('\t\n\r');
  expect(formatDecodeRaw(decodeProtobuf(bytes('0a03610a62'), ON))).toBe('1: "a\\nb"');
  // Other control characters, DEL and the C1 controls are not text.
  expect(text('0a0261' + '01')).toBeUndefined();
  expect(text('0a0261' + '7f')).toBeUndefined();
  expect(text('0a03' + '61c285')).toBeUndefined();
  // Bytes that are not UTF-8 are not text: a lone continuation byte, an overlong form, a surrogate, a value past U+10FFFF.
  expect(text('0a01ff')).toBeUndefined();
  expect(text('0a02c080')).toBeUndefined();
  expect(text('0a03eda080')).toBeUndefined();
  expect(text('0a04f4908080')).toBeUndefined();
  expect(text('0a03e28261')).toBeUndefined();
  // Four byte characters and the byte order mark are text.
  expect(text('0a04f0908591')).toBe('\u{10151}');
  expect(text('0a03efbbbf')).toBe('﻿');
});

it('fields keep the order and offsets of the bytes, and a length-delimited field can be both text and a message', () => {
  // 28 41 is the field 5 varint 65, and also the two printable characters "(A": the bytes parse as a message and read as text.
  const both = decodeProtobuf(bytes('0a022841'), ON)[0]!;
  expect(both.readings).toEqual([
    { label: 'Text', value: '(A' },
    { label: 'Nested message', value: '1 field' },
    { label: 'Bytes', value: '28 41' },
  ]);
  expect(both.children).toHaveLength(1);
  expect(formatDecodeRaw([both])).toBe('1: "(A"');
  // Bytes that start like a message but end inside a field are not one: 08 2a is a complete varint field, then 2a is a
  // tag (field 5, length-delimited) with nothing after it.
  expect(decodeProtobuf(bytes('1203082a2a'), ON)[0]!.children).toBeUndefined();
  // Interleaved repeats of one field keep their order and each one's own offset.
  const repeated = decodeProtobuf(bytes('2801' + '220161' + '2802'), ON);
  expect(repeated.map((f) => [f.number, f.offset])).toEqual([
    [5, 0],
    [4, 2],
    [5, 5],
  ]);
});

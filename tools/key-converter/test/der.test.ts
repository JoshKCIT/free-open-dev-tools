import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  DER_LIMITS,
  DerError,
  derBitString,
  derBoolean,
  derChild,
  derContent,
  derExpect,
  derHex,
  derIntegerContent,
  derOid,
  derString,
  derTime,
  derUnsigned,
  readDer,
} from '../src/der';

/**
 * Specification: ITU-T X.690 (DER) as profiled by RFC 5280 section 4.1.2.5 (times), appendix B and RFC 8017 appendix A
 * (the object identifier of rsaEncryption). Every input below is spelled out byte by byte here, never written by the
 * package's own writer, so the reader is tested against bytes it did not make.
 */

// The package prints nothing, whatever it is given.
const spies = {
  log: vi.spyOn(console, 'log'),
  warn: vi.spyOn(console, 'warn'),
  error: vi.spyOn(console, 'error'),
};
beforeEach(() => {
  for (const spy of Object.values(spies)) spy.mockImplementation(() => undefined);
});
afterEach(() => {
  for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  for (const spy of Object.values(spies)) spy.mockReset();
});

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);
/** The replacement character, written as a code point so no invisible or look-alike character sits in this file. */
const REPLACEMENT = String.fromCodePoint(0xfffd);
const ascii = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0));

/** Catches what a call throws, so a test can look at the error itself. */
function thrown(call: () => unknown): unknown {
  try {
    call();
  } catch (err) {
    return err;
  }
  throw new Error('the call did not throw');
}

function expectDerError(call: () => unknown, pattern: RegExp, offset?: number): void {
  const err = thrown(call);
  expect(err).toBeInstanceOf(DerError);
  const derError = err as DerError;
  expect(derError.name).toBe('DerError');
  expect(derError.message).toMatch(pattern);
  // Every message names a byte offset and the problem.
  expect(derError.message).toMatch(/offset \d+/);
  expect(typeof derError.offset).toBe('number');
  if (offset !== undefined) expect(derError.offset).toBe(offset);
}

/** A SEQUENCE around a body, with the length written the shortest way, for building nesting by hand in the test. */
function sequenceAround(body: Uint8Array): Uint8Array {
  const length = body.length;
  const header =
    length < 128
      ? [0x30, length]
      : length < 256
        ? [0x30, 0x81, length]
        : length < 65536
          ? [0x30, 0x82, length >> 8, length & 255]
          : [0x30, 0x83, length >> 16, (length >> 8) & 255, length & 255];
  const out = new Uint8Array(header.length + length);
  out.set(header, 0);
  out.set(body, header.length);
  return out;
}

it('the DER reader accepts definite lengths only and refuses indefinite, non-minimal and overlong lengths with a plain message', () => {
  // A good element first: SEQUENCE { INTEGER 5, NULL }.
  const good = readDer(bytes(0x30, 0x05, 0x02, 0x01, 0x05, 0x05, 0x00));
  expect(good.tag).toBe(16);
  expect(good.cls).toBe('universal');
  expect(good.constructed).toBe(true);
  expect(good.start).toBe(0);
  expect(good.headerLength).toBe(2);
  expect(good.length).toBe(5);
  expect(good.end).toBe(7);
  expect(good.children.map((c) => c.tag)).toEqual([2, 5]);
  expect(good.children[0]!.start).toBe(2);
  expect(good.children[1]!.end).toBe(7);

  // Indefinite length (BER only) at the length octet, offset 1.
  expectDerError(() => readDer(bytes(0x30, 0x80, 0x05, 0x00, 0x00, 0x00)), /indefinite/i, 1);
  // A long-form length below 128 should have been short form.
  expectDerError(() => readDer(bytes(0x04, 0x81, 0x03, 1, 2, 3)), /shortest|minimal/i, 1);
  // A length with a leading zero octet is not minimal.
  const padded = new Uint8Array(4 + 200);
  padded.set([0x04, 0x82, 0x00, 0xc8], 0);
  expectDerError(() => readDer(padded), /shortest|minimal/i, 1);
  // A length past the end of the data, checked before any slice is taken.
  expectDerError(() => readDer(bytes(0x04, 0x05, 0xaa, 0xbb)), /runs past the end/i, 0);
  expectDerError(() => readDer(bytes(0x04, 0x84, 0xff, 0xff, 0xff, 0xff, 0x01)), /runs past the end/i, 0);
  // A child that overruns its parent, even though the file as a whole has the bytes.
  expectDerError(() => readDer(bytes(0x30, 0x03, 0x04, 0x05, 0xaa, 0xbb, 0xcc, 0xdd, 0xee)), /runs past the end/i, 2);
  // The reserved length octet 0xff and a length field too large to be real.
  expectDerError(() => readDer(bytes(0x04, 0xff, 0x00)), /reserved|too large/i, 1);
  expectDerError(() => readDer(bytes(0x04, 0x85, 0x01, 0x00, 0x00, 0x00, 0x00)), /too large/i, 1);
  // Data that stops inside the length, inside the tag, or before any tag.
  expectDerError(() => readDer(bytes(0x04, 0x82, 0x01)), /ends|end of the data/i);
  expectDerError(() => readDer(bytes(0x1f)), /ends|end of the data/i);
  expectDerError(() => readDer(new Uint8Array(0)), /ends|end of the data/i, 0);
  expectDerError(() => readDer(bytes(0x30)), /ends|end of the data/i);

  // Bytes after the one element are refused unless the caller says they are expected.
  expectDerError(() => readDer(bytes(0x05, 0x00, 0xff)), /after|trailing/i, 2);
  expect(readDer(bytes(0x05, 0x00, 0xff), { allowTrailing: true }).end).toBe(2);

  // A tag number written in the long form must be minimal: 30 fits in one octet, and 0x80 is a padding octet.
  expectDerError(() => readDer(bytes(0x1f, 0x1e, 0x00)), /tag/i);
  expectDerError(() => readDer(bytes(0x1f, 0x80, 0x1f, 0x00)), /tag/i);
  // Tag number 31 is the smallest that needs the long form, and is accepted.
  expect(readDer(bytes(0x1f, 0x1f, 0x00)).tag).toBe(31);
  expect(readDer(bytes(0x9f, 0x81, 0x00, 0x00)).tag).toBe(128);
  expect(readDer(bytes(0xa0, 0x03, 0x02, 0x01, 0x02)).cls).toBe('context');
  expect(readDer(bytes(0x40, 0x00)).cls).toBe('application');
  expect(readDer(bytes(0xc0, 0x00)).cls).toBe('private');
});

it('the DER reader stops at 24 levels of nesting and 200000 elements', () => {
  // Level 1 is the outermost element. 24 levels are read, 25 are refused with a plain message and an offset.
  const body: Uint8Array = bytes(0x05, 0x00);
  const levels = (count: number): Uint8Array => {
    let current = body;
    for (let i = 1; i < count; i++) current = sequenceAround(current);
    return current;
  };
  const deepest = (node: ReturnType<typeof readDer>): number => {
    let depth = 1;
    let current = node;
    while (current.children.length > 0) {
      current = current.children[0]!;
      depth++;
    }
    return depth;
  };
  expect(DER_LIMITS.maxDepth).toBe(24);
  expect(DER_LIMITS.maxNodes).toBe(200000);
  expect(deepest(readDer(levels(24)))).toBe(24);
  expectDerError(() => readDer(levels(25)), /nested|deep/i);
  // The caller may lower the limit.
  expect(deepest(readDer(levels(3), { maxDepth: 3 }))).toBe(3);
  expectDerError(() => readDer(levels(4), { maxDepth: 3 }), /nested|deep/i);

  // Elements: a SEQUENCE of NULLs. The SEQUENCE itself is element 1, so 199999 NULLs make exactly 200000.
  const withNulls = (count: number): Uint8Array => {
    const out = new Uint8Array(5 + count * 2);
    const total = count * 2;
    out.set([0x30, 0x83, (total >> 16) & 255, (total >> 8) & 255, total & 255], 0);
    for (let i = 0; i < count; i++) out[5 + i * 2] = 0x05;
    return out;
  };
  expect(readDer(withNulls(199999)).children.length).toBe(199999);
  expectDerError(() => readDer(withNulls(200000)), /too many|elements/i);
  expectDerError(() => readDer(withNulls(20), { maxNodes: 20 }), /too many|elements/i);
  expect(readDer(withNulls(19), { maxNodes: 20 }).children.length).toBe(19);
}, 60_000);

it('DER times, strings and object identifiers decode as RFC 5280 writes them', () => {
  const time = (tag: number, text: string) => {
    const input = bytes(tag, text.length, ...ascii(text));
    return derTime(input, readDer(input));
  };
  // RFC 5280 section 4.1.2.5.1: a two digit year of 50 or more is 19YY, below 50 is 20YY.
  expect(time(0x17, '490101000000Z')).toEqual({ iso: '2049-01-01T00:00:00Z', epochMs: Date.UTC(2049, 0, 1) });
  expect(time(0x17, '500101000000Z')).toEqual({ iso: '1950-01-01T00:00:00Z', epochMs: Date.UTC(1950, 0, 1) });
  expect(time(0x17, '991231235959Z').iso).toBe('1999-12-31T23:59:59Z');
  // Section 4.1.2.5.2: GeneralizedTime in the form YYYYMMDDHHMMSSZ.
  expect(time(0x18, '20491231235959Z')).toEqual({
    iso: '2049-12-31T23:59:59Z',
    epochMs: Date.UTC(2049, 11, 31, 23, 59, 59),
  });
  expect(time(0x18, '20000229120000Z').iso).toBe('2000-02-29T12:00:00Z');
  // Not the Z form, a month that does not exist and a day the month does not have are refused.
  for (const [tag, text] of [
    [0x17, '490101000000+0100'],
    [0x17, '4901010000Z'],
    [0x17, '491301000000Z'],
    [0x18, '20010229000000Z'],
    [0x18, '20490101250000Z'],
    [0x18, '2049010100000Z'],
  ] as const) {
    const input = bytes(tag, text.length, ...ascii(text));
    expectDerError(() => derTime(input, readDer(input)), /time/i);
  }

  const text = (tag: number, ...content: number[]) => {
    const input = bytes(tag, content.length, ...content);
    return derString(input, readDer(input));
  };
  expect(text(0x0c, 0xc3, 0xa9)).toEqual({ text: String.fromCodePoint(0xe9), kind: 'UTF8String', replaced: false });
  // Invalid UTF-8 never throws: the bad byte becomes U+FFFD and the string says it was replaced.
  expect(text(0x0c, 0x41, 0xff, 0x42)).toEqual({ text: 'A' + REPLACEMENT + 'B', kind: 'UTF8String', replaced: true });
  expect(text(0x13, ...ascii('Example CA'))).toEqual({ text: 'Example CA', kind: 'PrintableString', replaced: false });
  expect(text(0x16, ...ascii('a@example.org')).kind).toBe('IA5String');
  expect(text(0x1a, ...ascii('visible')).kind).toBe('VisibleString');
  expect(text(0x12, ...ascii('0123')).kind).toBe('NumericString');
  // TeletexString is read as Latin-1.
  expect(text(0x14, 0x41, 0xe9)).toEqual({
    text: 'A' + String.fromCodePoint(0xe9),
    kind: 'TeletexString',
    replaced: false,
  });
  // BMPString is UTF-16 big endian, UniversalString is UTF-32 big endian.
  expect(text(0x1e, 0x00, 0x41, 0x00, 0xe9)).toEqual({
    text: 'A' + String.fromCodePoint(0xe9),
    kind: 'BMPString',
    replaced: false,
  });
  expect(text(0x1c, 0x00, 0x00, 0x00, 0x41, 0x00, 0x01, 0xf6, 0x00)).toEqual({
    text: 'A' + String.fromCodePoint(0x1f600),
    kind: 'UniversalString',
    replaced: false,
  });
  // An odd number of bytes in a BMPString and a code point past U+10FFFF are replaced, not thrown.
  expect(text(0x1e, 0x00, 0x41, 0x00).replaced).toBe(true);
  expect(text(0x1c, 0x00, 0x11, 0x00, 0x00).replaced).toBe(true);
  // A byte above 127 in an IA5String is replaced.
  expect(text(0x16, 0x41, 0xe9)).toEqual({ text: 'A' + REPLACEMENT, kind: 'IA5String', replaced: true });
  // Anything that is not a character string is refused.
  const notAString = bytes(0x02, 0x01, 0x05);
  expectDerError(() => derString(notAString, readDer(notAString)), /string/i);

  const oid = (...content: number[]) => {
    const input = bytes(0x06, content.length, ...content);
    return derOid(input, readDer(input));
  };
  // RFC 8017 appendix A.1: rsaEncryption is 1.2.840.113549.1.1.1.
  expect(oid(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01)).toBe('1.2.840.113549.1.1.1');
  expect(oid(0x2b, 0x65, 0x70)).toBe('1.3.101.112');
  expect(oid(0x55, 0x04, 0x03)).toBe('2.5.4.3');
  // ITU-T X.667: the UUID f81d4fae-7dec-11d0-a765-00a0c91e6bf6 is the arc 2.25.329800735698586629295641978511506172918,
  // far above 2 to the 64. The bytes were computed with Python's integer arithmetic.
  expect(oid(...Array.from(Buffer.from('6983f09da7ebcfdee0c7a1a7b2c0948cc8f9d776', 'hex')))).toBe(
    '2.25.329800735698586629295641978511506172918',
  );
  // An arc of exactly 2 to the 64 is kept exact, not rounded.
  expect(oid(...Array.from(Buffer.from('2b82808080808080808000', 'hex')))).toBe('1.3.18446744073709551616');
  // Empty, ending in the middle of an arc, and an arc that starts with a padding octet are refused.
  for (const content of [[], [0x2a, 0x86], [0x2a, 0x80, 0x01]]) {
    const input = bytes(0x06, content.length, ...content);
    expectDerError(() => derOid(input, readDer(input)), /object identifier/i);
  }

  // INTEGER, BOOLEAN, BIT STRING and the helpers that walk a tree.
  const integer = bytes(0x02, 0x02, 0x00, 0x80);
  const integerNode = readDer(integer);
  expect(Array.from(derUnsigned(integer, integerNode))).toEqual([0x80]);
  expect(Array.from(derIntegerContent(integer, integerNode))).toEqual([0x00, 0x80]);
  const negative = bytes(0x02, 0x01, 0x80);
  expectDerError(() => derUnsigned(negative, readDer(negative)), /negative/i);
  const empty = bytes(0x02, 0x00);
  expectDerError(() => derUnsigned(empty, readDer(empty)), /integer/i);
  const yes = bytes(0x01, 0x01, 0xff);
  const no = bytes(0x01, 0x01, 0x00);
  const odd = bytes(0x01, 0x01, 0x01);
  expect(derBoolean(yes, readDer(yes))).toBe(true);
  expect(derBoolean(no, readDer(no))).toBe(false);
  expectDerError(() => derBoolean(odd, readDer(odd)), /boolean/i);
  const bits = bytes(0x03, 0x03, 0x05, 0xa0, 0xe0);
  const bitString = derBitString(bits, readDer(bits));
  expect(bitString.unusedBits).toBe(5);
  expect(Array.from(bitString.bytes)).toEqual([0xa0, 0xe0]);
  const badBits = bytes(0x03, 0x02, 0x08, 0x00);
  expectDerError(() => derBitString(badBits, readDer(badBits)), /bit string/i);

  const tree = bytes(0x30, 0x08, 0x02, 0x01, 0x01, 0x04, 0x03, 0xaa, 0xbb, 0xcc);
  const root = readDer(tree);
  expect(Array.from(derContent(tree, derChild(root, 1)))).toEqual([0xaa, 0xbb, 0xcc]);
  expectDerError(() => derChild(root, 2), /element/i);
  expectDerError(() => derChild(root, -1), /element/i);
  expect(() => derExpect(root, 16)).not.toThrow();
  expectDerError(() => derExpect(root, 17), /SET|expected/i);
  expectDerError(() => derExpect(root, 16, 'context'), /expected/i);
  expectDerError(() => derExpect(derChild(root, 0), 2, 'universal', true), /expected/i);
  expect(derHex(bytes(0x00, 0xab, 0x0f))).toBe('00ab0f');
  expect(derHex(bytes(0x00, 0xab, 0x0f), ':')).toBe('00:ab:0f');
  expect(derHex(new Uint8Array(0))).toBe('');
});

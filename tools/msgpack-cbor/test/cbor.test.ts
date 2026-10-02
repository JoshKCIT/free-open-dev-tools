import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cborToDiagnostic, decodeCbor, encodeCbor } from '../src/cbor';
import { MsgpackCborError } from '../src/common';
import { fromJsonValue, parseJson, stringifyJson, toJsonValue } from '../src/json-markers';
import { APPENDIX_A } from './fixtures/rfc8949-appendix-a/golden';

/*
 * Grounding (D-179, P13-08).
 *
 * Every expected value in this file is a row of Table 6 in RFC 8949 Appendix A, vendored in
 * fixtures/rfc8949-appendix-a/golden.ts by a script that reads the RFC text (see UPSTREAM.md), or a literal written
 * from the RFC's own sections 3 and 8. The package is never its own oracle: the diagnostic notation is the RFC's text
 * and the hex is the RFC's encoding.
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

const bytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));
const hexOf = (data: Uint8Array): string => Array.from(data, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The rows of Table 6 that cannot come back byte for byte from their JSON form, each with the reason. JSON to CBOR writes
 * the preferred serialization (RFC 8949 section 4.1: the shortest head and the shortest float that keeps the value), so
 * an item first written with an indefinite length, or with a float wider than it needs, is written again in the
 * shortest form. Naming them here, with the reason, is what keeps this list from hiding a real failure: a row that is
 * listed but does come back identical fails the test too.
 */
const NOT_PREFERRED: Record<string, string> = {
  fa7f800000: 'Infinity in single precision; the shortest form is half precision (f97c00)',
  fa7fc00000: 'NaN in single precision; the shortest form is half precision (f97e00)',
  faff800000: '-Infinity in single precision; the shortest form is half precision (f9fc00)',
  fb7ff0000000000000: 'Infinity in double precision; the shortest form is half precision (f97c00)',
  fb7ff8000000000000: 'NaN in double precision; the shortest form is half precision (f97e00)',
  fbfff0000000000000: '-Infinity in double precision; the shortest form is half precision (f9fc00)',
  '5f42010243030405ff':
    'an indefinite-length byte string; JSON holds the joined value, which is written with a definite length',
  '7f657374726561646d696e67ff': 'an indefinite-length text string; written joined with a definite length',
  '9fff': 'an indefinite-length array; written with a definite length',
  '9f018202039f0405ffff': 'indefinite-length arrays; written with definite lengths',
  '9f01820203820405ff': 'an indefinite-length array; written with a definite length',
  '83018202039f0405ff': 'an indefinite-length array; written with a definite length',
  '83019f0203ff820405': 'an indefinite-length array; written with a definite length',
  '9f0102030405060708090a0b0c0d0e0f101112131415161718181819ff':
    'an indefinite-length array; written with a definite length',
  bf61610161629f0203ffff: 'indefinite-length map and array; written with definite lengths',
  '826161bf61626163ff': 'an indefinite-length map; written with a definite length',
  bf6346756ef563416d7421ff: 'an indefinite-length map; written with a definite length',
};

it('RFC 8949 Appendix A: all 81 items decode and print in diagnostic notation exactly as the RFC prints them', () => {
  expect(APPENDIX_A).toHaveLength(81);
  // The named rows of the plan are really in the vendored table.
  const diagnostics = APPENDIX_A.map((row) => row.diagnostic);
  for (const named of [
    "(_ h'0102', h'030405')",
    '{_ "a": 1, "b": [_ 2, 3]}',
    'simple(16)',
    '1.0e+300',
    '-18446744073709551617',
  ]) {
    expect(diagnostics, named).toContain(named);
  }

  const wrong: string[] = [];
  for (const row of APPENDIX_A) {
    const printed = cborToDiagnostic(decodeCbor(bytes(row.hex)));
    if (printed !== row.diagnostic) wrong.push(`${row.hex}: printed ${printed} but the RFC prints ${row.diagnostic}`);
  }
  expect(wrong).toEqual([]);
});

it('RFC 8949 Appendix A: items in preferred form re-encode from JSON to the RFC bytes and the rest are named', () => {
  const unlisted: string[] = [];
  const stale: string[] = [];
  const unfaithful: string[] = [];
  const unstable: string[] = [];
  for (const row of APPENDIX_A) {
    const item = decodeCbor(bytes(row.hex));

    // The item model keeps everything the encoding says (widths, indefinite lengths): encoding it again gives the
    // RFC's bytes for every one of the 81 rows.
    if (hexOf(encodeCbor(item)) !== row.hex) unfaithful.push(row.hex);

    // Through JSON text and back: the markers carry the value, and the shortest form is written.
    const text = stringifyJson(toJsonValue(item, 'cbor'));
    const back = fromJsonValue(parseJson(text), 'cbor');
    expect(back.warnings, row.hex).toEqual([]);
    const again = hexOf(encodeCbor(back.item));
    const reason = NOT_PREFERRED[row.hex];
    if (reason === undefined) {
      if (again !== row.hex) unlisted.push(`${row.hex} (${row.diagnostic}) came back as ${again}`);
    } else {
      if (again === row.hex) stale.push(`${row.hex} is listed as not preferred but comes back identical`);
      // The value is the same: the rewritten form decodes to the same diagnostic notation, apart from the lengths and
      // widths the notation itself shows for indefinite items.
      const second = stringifyJson(toJsonValue(decodeCbor(bytes(again)), 'cbor'));
      if (second !== text) unstable.push(`${row.hex}: ${text} became ${second}`);
    }
  }
  expect(unfaithful).toEqual([]);
  expect(unlisted).toEqual([]);
  expect(stale).toEqual([]);
  expect(unstable).toEqual([]);
  // Every listed row is a row of the table.
  for (const hex of Object.keys(NOT_PREFERRED))
    expect(
      APPENDIX_A.map((row) => row.hex),
      hex,
    ).toContain(hex);
});

it('half precision floats decode by hand from the RFC 8949 Appendix D layout', () => {
  // Appendix D prints the decoder: exponent 0 is subnormal (mantissa times 2 to the minus 24), 31 is infinity or NaN.
  const half = (hex: string): number => {
    const item = decodeCbor(bytes(hex));
    if (item.type !== 'float') throw new Error('not a float');
    expect(item.width).toBe(16);
    return item.value;
  };
  expect(half('f90000')).toBe(0);
  expect(Object.is(half('f98000'), -0)).toBe(true);
  expect(half('f93c00')).toBe(1);
  expect(half('f97bff')).toBe(65504);
  expect(half('f90001')).toBe(5.960464477539063e-8);
  expect(half('f90400')).toBe(0.00006103515625);
  expect(half('f9c400')).toBe(-4);
  expect(half('f97c00')).toBe(Infinity);
  expect(half('f9fc00')).toBe(-Infinity);
  expect(Number.isNaN(half('f97e00'))).toBe(true);
  // A half precision NaN with a payload is still a NaN.
  expect(Number.isNaN(half('f97e01'))).toBe(true);
});

it('malformed CBOR is refused with the byte offset of the problem', () => {
  const refuse = (hex: string): MsgpackCborError => {
    try {
      decodeCbor(bytes(hex));
    } catch (err) {
      expect(err).toBeInstanceOf(MsgpackCborError);
      return err as MsgpackCborError;
    }
    throw new Error(`${hex} was not refused`);
  };
  // A head that needs more bytes than there are: 0x19 wants two argument bytes and one follows.
  expect(refuse('1901').offset).toBe(0);
  // A byte string whose length runs past the end, inside an array: the string starts at byte 1.
  const truncated = refuse('8144010203');
  expect(truncated.offset).toBe(1);
  expect(truncated.message).toContain('byte 1');
  // An array that declares more items than there are bytes left is refused before any item is read.
  expect(refuse('9b0000000100000000').offset).toBe(0);
  // Additional information 28 to 30 is reserved.
  expect(refuse('1c').offset).toBe(0);
  // A break with no indefinite item to end.
  expect(refuse('ff').offset).toBe(0);
  // An indefinite array never ended.
  expect(refuse('9f01').message).toContain('ends');
  // A break where a map's value belongs.
  expect(refuse('bf01ff').offset).toBe(2);
  // Chunks of an indefinite byte string must be byte strings, and definite ones.
  expect(refuse('5f6161ff').offset).toBe(1);
  expect(refuse('5f5f4101ffff').offset).toBe(1);
  // Simple values 24 to 31 are not well-formed in the two byte form.
  expect(refuse('f81f').offset).toBe(0);
  // Text that is not UTF-8 names the string's own offset.
  expect(refuse('62c328').offset).toBe(0);
  // Extra bytes after the item.
  expect(refuse('0000').offset).toBe(1);
  // Indefinite lengths are only for strings, arrays and maps.
  expect(refuse('1f').offset).toBe(0);
  expect(refuse('df').offset).toBe(0);
  expect(refuse('ff00').offset).toBe(0);
});

it('a text string keeps a leading byte order mark and a bignum keeps its value', () => {
  // The decoder must not drop U+FEFF: TextDecoder removes it unless told to keep it.
  const item = decodeCbor(bytes('63efbbbf'));
  expect(item).toMatchObject({ type: 'text', value: '﻿' });
  expect(cborToDiagnostic(item)).toBe('"\\ufeff"');
  // The negative bignum of Table 6, tag 3 over the bytes 01 followed by eight zero bytes.
  expect(cborToDiagnostic(decodeCbor(bytes('c349010000000000000000')))).toBe('-18446744073709551617');
});

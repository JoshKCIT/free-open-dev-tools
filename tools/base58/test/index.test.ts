import { describe, it, expect } from 'vitest';
import { encodeBytes, decodeToBytes, encodeCheck, decodeCheck, ALPHABETS, Base58Error } from '../src/index';

const hex = (h: string) => Buffer.from(h, 'hex');

// Independently transcribed a SECOND time, from the sources named in
// meta.json testNotes, so a mistranscription of one copy cannot hide behind
// a length-and-duplicate check against the other.
//
// Bitcoin: bitcoin/bitcoin src/base58.cpp `pszBase58`.
const BITCOIN_ALPHABET_SECOND_TRANSCRIPTION = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
// Ripple: @scure/base `base58xrp` (the alphabet xrpl.js's ripple-address-codec uses at runtime).
const RIPPLE_ALPHABET_SECOND_TRANSCRIPTION = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';
// Flickr: @scure/base `base58flickr`.
const FLICKR_ALPHABET_SECOND_TRANSCRIPTION = '123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';

// A published, source-attributed known-answer triple. Version byte 0x00,
// payload the RIPEMD-160 hash from the Bitcoin Wiki's own worked example
// ("Technical background of version 1 Bitcoin addresses" §"How to create
// Bitcoin Address", steps 3-9), and the resulting address that same page
// publishes. Independently recomputed with Node's own crypto module
// (double SHA-256, first four bytes) before being fixed as a test vector,
// confirming it matches the page's own published checksum c7f18fe8.
const KNOWN_ANSWER = {
  version: 0x00,
  payloadHex: 'f54a5851e9372b87810a8e60cdd2e7cfd80b6e31',
  address: '1PMycacnJaSqwwJqjawXBErnLsZ7RkXUAs',
};

it('an independently sourced Base58Check address encodes to its published string', () => {
  expect(encodeCheck(KNOWN_ANSWER.version, hex(KNOWN_ANSWER.payloadHex))).toBe(KNOWN_ANSWER.address);
});

it('that published address decodes back to its version byte and payload', () => {
  const { version, payload } = decodeCheck(KNOWN_ANSWER.address);
  expect(version).toBe(KNOWN_ANSWER.version);
  expect(Buffer.from(payload).toString('hex')).toBe(KNOWN_ANSWER.payloadHex);
});

it('each leading zero byte becomes exactly one leading 1', () => {
  expect(encodeBytes(new Uint8Array([0, 1, 2, 3]))).toMatch(/^1[^1]/);
  const oneZero = encodeBytes(new Uint8Array([0, 1, 2, 3]));
  const twoZeros = encodeBytes(new Uint8Array([0, 0, 1, 2, 3]));
  const threeZeros = encodeBytes(new Uint8Array([0, 0, 0, 1, 2, 3]));
  expect(oneZero.startsWith('1')).toBe(true);
  expect(oneZero.startsWith('11')).toBe(false);
  expect(twoZeros.startsWith('11')).toBe(true);
  expect(twoZeros.startsWith('111')).toBe(false);
  expect(threeZeros.startsWith('111')).toBe(true);
  expect(threeZeros.startsWith('1111')).toBe(false);
});

it('decoding returns the leading zero bytes intact', () => {
  const input = new Uint8Array([0, 0, 1, 2, 3]);
  const decoded = decodeToBytes(encodeBytes(input));
  expect(decoded).toEqual(input);
  expect(decoded.length).toBe(5);
});

it('a Base58Check value with a corrupted checksum is rejected saying the checksum did not match', () => {
  const address = encodeCheck(KNOWN_ANSWER.version, hex(KNOWN_ANSWER.payloadHex));
  const lastChar = address[address.length - 1]!;
  const replacement = ALPHABETS.bitcoin.split('').find((c) => c !== lastChar)!;
  const corrupted = address.slice(0, -1) + replacement;
  try {
    decodeCheck(corrupted);
    expect.fail('expected to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(Base58Error);
    expect((err as Base58Error).message).toMatch(/checksum did not match/i);
  }
});

it('each of the three alphabets equals its independently transcribed copy', () => {
  expect(ALPHABETS.bitcoin).toBe(BITCOIN_ALPHABET_SECOND_TRANSCRIPTION);
  expect(ALPHABETS.ripple).toBe(RIPPLE_ALPHABET_SECOND_TRANSCRIPTION);
  expect(ALPHABETS.flickr).toBe(FLICKR_ALPHABET_SECOND_TRANSCRIPTION);
});

// Additional coverage beyond the six mandated titles.

describe('alphabet shape', () => {
  it('each alphabet is 58 characters with no repeated character', () => {
    for (const alphabet of Object.values(ALPHABETS)) {
      expect(alphabet).toHaveLength(58);
      expect(new Set(alphabet).size).toBe(58);
    }
  });
});

describe('round trips', () => {
  it('round trips arbitrary bytes on all three alphabets', () => {
    const input = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0x01, 0xff]);
    for (const alphabet of ['bitcoin', 'ripple', 'flickr'] as const) {
      const encoded = encodeBytes(input, { alphabet });
      expect(decodeToBytes(encoded, { alphabet })).toEqual(input);
    }
  });

  it('encodeCheck/decodeCheck round trip an arbitrary version and payload', () => {
    const version = 5;
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const encoded = encodeCheck(version, payload);
    const decoded = decodeCheck(encoded);
    expect(decoded.version).toBe(version);
    expect(decoded.payload).toEqual(payload);
  });
});

describe('error handling', () => {
  it('rejects a character outside the selected alphabet, with its position', () => {
    // '0' is not in the Bitcoin alphabet (0, O, I, l are all excluded).
    try {
      decodeToBytes('1A0B', { alphabet: 'bitcoin' });
      expect.fail('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(Base58Error);
      expect((err as Base58Error).position).toBe(2);
    }
  });
});

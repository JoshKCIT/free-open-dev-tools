import { IdentifierError, checkCount } from './id-errors';

/**
 * NanoID: a random id of a chosen size drawn from a chosen alphabet. The default is the 64 symbol URL alphabet and size
 * 21 of the published library (https://github.com/ai/nanoid). Every symbol is drawn from whole random bytes by
 * rejection sampling, so no symbol is more likely than another whatever the alphabet size.
 */

/** The 64 symbol alphabet of the published library: A-Z, a-z, 0-9, underscore and hyphen, in its published order. */
export const NANOID_URL_ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';
export const NANOID_DEFAULT_SIZE = 21;

/** Gives `n` bytes. Injected in tests; the real source is the browser cryptographic generator. */
export type ByteSource = (n: number) => Uint8Array;

export interface NanoIdOptions {
  count: number;
  /** Characters per id, 1 to 255. Defaults to 21. */
  size?: number;
  /** 2 to 255 different characters. Defaults to the URL alphabet. */
  alphabet?: string;
}

function cryptoBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  // Always the cryptographic source, and only whole bytes of it.
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** Most bytes one pick looks at before it gives up. With real random bytes (each usable at least half the time) it is never reached. */
const MAX_PICK_TRIES = 1000;

/**
 * A uniformly distributed index from 0 to size - 1 by rejection sampling. Own code, the same shape as this
 * repository's other picking functions: a byte at or above floor(256 / size) * size is thrown away before the
 * remainder is taken, because 256 is not a multiple of every size and a plain remainder would favour the first symbols.
 * A byte source that never gives a usable byte (a constant 255 over 3 symbols) ends the pick after 1,000 tries with a
 * fixed sentence instead of looping for ever.
 */
export function pickAlphabetIndex(size: number, nextByte: () => number): number {
  if (!Number.isInteger(size) || size < 1 || size > 256)
    throw new IdentifierError('Alphabet must hold 2 to 255 different characters.');
  if (size === 1) return 0;
  const limit = Math.floor(256 / size) * size;
  for (let tries = 0; tries < MAX_PICK_TRIES; tries++) {
    const byte = nextByte();
    if (byte < limit) return byte % size;
  }
  throw new IdentifierError('The byte source does not produce usable values.');
}

const CHUNK = 1024;

/** Hands out one byte at a time from chunks of the source. */
function bytePool(source: ByteSource): () => number {
  let chunk: Uint8Array = new Uint8Array(0);
  let at = 0;
  return () => {
    if (at >= chunk.length) {
      chunk = source(CHUNK);
      at = 0;
      if (chunk.length === 0) throw new IdentifierError('The random source gave no bytes.');
    }
    return chunk[at++]!;
  };
}

// Control characters, direction controls and other format characters, paragraph and line separators, lone surrogates.
const FORBIDDEN = /^[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]$/u;

function readAlphabet(alphabet: string): string[] {
  // 255 symbols are at most 510 UTF-16 units; anything longer is refused before it is split.
  if (alphabet.length > 510) throw new IdentifierError('Alphabet must hold 2 to 255 different characters.');
  const symbols = Array.from(alphabet);
  if (symbols.length < 2 || symbols.length > 255) {
    throw new IdentifierError('Alphabet must hold 2 to 255 different characters.');
  }
  for (const symbol of symbols) {
    if (FORBIDDEN.test(symbol)) {
      throw new IdentifierError('Alphabet holds a control or direction character, which is not allowed.');
    }
  }
  if (new Set(symbols).size !== symbols.length) {
    throw new IdentifierError('Alphabet repeats a character: each character may appear only once.');
  }
  return symbols;
}

/** Makes `count` NanoIDs of `size` characters from `alphabet`. */
export function generateNanoIds(options: NanoIdOptions, source: ByteSource = cryptoBytes): string[] {
  const { count, size = NANOID_DEFAULT_SIZE, alphabet = NANOID_URL_ALPHABET } = options;
  checkCount(count);
  if (!Number.isInteger(size) || size < 1 || size > 255) {
    throw new IdentifierError('Size must be a whole number from 1 to 255.');
  }
  const symbols = readAlphabet(alphabet);
  const nextByte = bytePool(source);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const chars = new Array<string>(size);
    for (let j = 0; j < size; j++) chars[j] = symbols[pickAlphabetIndex(symbols.length, nextByte)]!;
    out.push(chars.join(''));
  }
  return out;
}

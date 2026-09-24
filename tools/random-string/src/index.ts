import meta from './meta.json';

export { meta };

/** Reads bytes from a source. Injected in tests so rejection sampling can be exercised deterministically. */
export type ByteSource = (n: number) => Uint8Array;

/** The only randomness source this package ever uses in production. Never Math.random. */
export const RANDOM_SOURCE_NAME = 'crypto.getRandomValues';

function cryptoRandomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  // Always the cryptographic source. A predictable identifier is a real
  // security weakness, not a theoretical one.
  globalThis.crypto.getRandomValues(out);
  return out;
}

/**
 * Picks a uniformly distributed index in [0, size) using rejection sampling.
 * Copied, not imported, from tools/password-generator/src/index.ts's
 * `pickIndex` -- a tool package may not depend on another tool package, and
 * the gate enforces it. Keep both copies in agreement if either changes.
 *
 * Draws `ceil(log2(size) / 8)` bytes, assembles them into an unsigned
 * integer, and rejects any draw at or above `floor(max / size) * size`
 * before reducing modulo size, so the range is always at least as wide as
 * the alphabet being picked from.
 */
export function pickIndex(size: number, randomBytes: ByteSource): number {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RandomStringError('Cannot pick an index from a non-positive size.');
  }
  if (size === 1) return 0;

  const nBytes = Math.max(1, Math.ceil(Math.log2(size) / 8));
  const range = 256 ** nBytes;
  const limit = Math.floor(range / size) * size;

  for (;;) {
    const bytes = randomBytes(nBytes);
    let value = 0;
    for (let i = 0; i < nBytes; i++) value = value * 256 + bytes[i]!;
    if (value < limit) return value % size;
  }
}

export class RandomStringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RandomStringError';
  }
}

/**
 * Named alphabet presets. Each labelled by what it contains, never by a
 * format name that is also a tool in this catalog (D-02): "urlSafe" not
 * "base64url", "unambiguous" not any specific format.
 */
export const ALPHABETS = {
  urlSafe: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
  unambiguous: 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789',
  hex: '0123456789abcdef',
  alphanumeric: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
} as const;

export type AlphabetName = keyof typeof ALPHABETS;

export interface GenerateOptions {
  /** A named preset from ALPHABETS, or 'custom' to use customAlphabet instead. */
  alphabet: AlphabetName | 'custom';
  /** Required and used when alphabet is 'custom'. Duplicate characters are removed and the removal reported. */
  customAlphabet?: string;
  length: number;
  count?: number;
  /** Injected in tests only; production always defaults to crypto.getRandomValues. */
  randomSource?: ByteSource;
}

export interface RandomStringResult {
  values: string[];
  distinctCount: number;
  /** The alphabet actually used, after duplicate removal for a custom alphabet. */
  alphabet: string;
  duplicatesRemoved: number;
  bitsPerValue: number;
  /** Sum of bitsPerValue across every returned value, since each is drawn independently. */
  totalBits: number;
  source: string;
}

/**
 * Generates one or more random identifiers over a chosen alphabet. Always
 * draws through the cryptographic random source (or the injected
 * `randomSource` in tests) via `pickIndex`'s rejection sampling -- never
 * `Math.random`.
 */
export function generate(options: GenerateOptions): RandomStringResult {
  const { alphabet: presetKey, customAlphabet, length, count = 1, randomSource } = options;

  if (!Number.isInteger(length) || length < 1) {
    throw new RandomStringError('A length of at least one character is required.');
  }

  let rawAlphabet: string;
  if (presetKey === 'custom') {
    if (!customAlphabet) {
      throw new RandomStringError('A custom alphabet is required when the "custom" preset is selected.');
    }
    rawAlphabet = customAlphabet;
  } else {
    const preset: string | undefined = ALPHABETS[presetKey];
    if (!preset) {
      throw new RandomStringError(`Unknown alphabet preset: ${String(presetKey)}`);
    }
    rawAlphabet = preset;
  }

  const rawChars = [...rawAlphabet];
  const distinctChars = [...new Set(rawChars)];
  const duplicatesRemoved = rawChars.length - distinctChars.length;
  const effectiveAlphabet = distinctChars.join('');

  if (effectiveAlphabet.length < 2) {
    throw new RandomStringError(
      'An alphabet needs at least two distinct characters, since a single-character alphabet carries no information.',
    );
  }

  const randomBytes = randomSource ?? cryptoRandomBytes;
  const requestedCount = Math.max(1, count);
  const values: string[] = [];
  for (let v = 0; v < requestedCount; v++) {
    let value = '';
    for (let i = 0; i < length; i++) {
      value += effectiveAlphabet[pickIndex(effectiveAlphabet.length, randomBytes)];
    }
    values.push(value);
  }

  const bitsPerValue = length * Math.log2(effectiveAlphabet.length);

  return {
    values,
    distinctCount: new Set(values).size,
    alphabet: effectiveAlphabet,
    duplicatesRemoved,
    bitsPerValue,
    totalBits: bitsPerValue * values.length,
    source: RANDOM_SOURCE_NAME,
  };
}

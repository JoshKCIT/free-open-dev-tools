import meta from './meta.json';
import { EFF_LONG_WORDLIST, BITS_PER_WORD } from './eff-long-wordlist';

export { meta };

export type PasswordMode = 'characters' | 'passphrase';

export type CharacterClass = 'lower' | 'upper' | 'digits' | 'symbols';

export type Capitalisation = 'none' | 'first-word' | 'each-word';

/** Reads bytes from a source. Injected in tests so rejection sampling can be exercised deterministically. */
export type ByteSource = (n: number) => Uint8Array;

/** The only randomness source this package ever uses in production. Never Math.random. */
export const RANDOM_SOURCE_NAME = 'crypto.getRandomValues';

function cryptoRandomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  // Always the cryptographic source. A password built from Math.random is a
  // real guessability risk, not a theoretical one.
  globalThis.crypto.getRandomValues(out);
  return out;
}

const CHARACTER_CLASSES: Record<CharacterClass, string> = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{}:;,.<>/?',
};

/** Characters excluded when excludeLookAlikes is on: 0/O/o and 1/l/I, the pairs people actually confuse. */
const LOOK_ALIKE_CHARS = new Set(['0', 'O', 'o', '1', 'l', 'I']);

export class PasswordGeneratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasswordGeneratorError';
  }
}

/**
 * Picks a uniformly distributed index in [0, size) using rejection sampling.
 *
 * Draws `ceil(log2(size) / 8)` bytes, assembles them into an unsigned
 * integer, and rejects any draw at or above `floor(max / size) * size`
 * before reducing modulo size. A byte-only picker that never widens beyond
 * one byte computes a threshold of zero for a size above 256 (256 divided
 * by a bigger number rounds down to zero) and would reject forever; the
 * range must be at least as wide as the alphabet it is picking from.
 *
 * Exported (beyond what tools/password-generator/src/meta.json's
 * `primaryExport` names) purely so scripts/test/... and this package's own
 * tests can exercise the picker directly at controlled sizes with a
 * controlled byte source, without going through a full password or
 * passphrase generation. tools/random-string copies this implementation
 * rather than importing it, since a tool package may not depend on another
 * tool package.
 */
export function pickIndex(size: number, randomBytes: ByteSource): number {
  if (!Number.isInteger(size) || size <= 0) {
    throw new PasswordGeneratorError('Cannot pick an index from a non-positive size.');
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

function buildAlphabet(
  classes: CharacterClass[],
  excludeLookAlikes: boolean,
): { alphabet: string; byClass: Record<CharacterClass, string> } {
  const byClass = {} as Record<CharacterClass, string>;
  let alphabet = '';
  for (const c of classes) {
    let chars = CHARACTER_CLASSES[c];
    if (excludeLookAlikes) chars = [...chars].filter((ch) => !LOOK_ALIKE_CHARS.has(ch)).join('');
    byClass[c] = chars;
    alphabet += chars;
  }
  return { alphabet, byClass };
}

export interface CharacterOptions {
  mode: 'characters';
  length: number;
  classes: CharacterClass[];
  excludeLookAlikes?: boolean;
  requireOneOfEach?: boolean;
  count?: number;
  randomSource?: ByteSource;
}

export interface PassphraseOptions {
  mode: 'passphrase';
  words: number;
  separator?: string;
  capitalisation?: Capitalisation;
  count?: number;
  randomSource?: ByteSource;
}

export type GenerateOptions = CharacterOptions | PassphraseOptions;

export interface PasswordEntropyReport {
  /** Bits of entropy per generated value. */
  bits: number;
  /** False when a class constraint (requireOneOfEach) makes this an upper bound rather than the true figure. */
  exact: boolean;
  /** Size of the alphabet a character-mode value is drawn from, after look-alike exclusion. */
  effectiveAlphabetSize?: number;
}

export interface PasswordGeneratorResult {
  values: string[];
  distinctCount: number;
  source: string;
  entropy: PasswordEntropyReport;
}

const MAX_RETRY_ATTEMPTS = 100000;

/**
 * Computes the entropy a set of options would produce, without drawing any
 * randomness. `generate` calls this internally so the reported figure and
 * the actual draw can never disagree.
 */
export function estimateEntropy(options: GenerateOptions): PasswordEntropyReport {
  if (options.mode === 'passphrase') {
    const words = options.words;
    if (!Number.isInteger(words) || words < 1) {
      throw new PasswordGeneratorError('A passphrase needs at least one word.');
    }
    return { bits: words * BITS_PER_WORD, exact: true };
  }

  const { length, classes, excludeLookAlikes = false, requireOneOfEach = false } = options;
  if (!classes || classes.length === 0) {
    throw new PasswordGeneratorError('Select at least one character class.');
  }
  if (!Number.isInteger(length) || length < 1) {
    throw new PasswordGeneratorError('A password needs a length of at least one character.');
  }
  if (requireOneOfEach && length < classes.length) {
    throw new PasswordGeneratorError(
      `Requiring one of every selected class needs a password at least ${classes.length} characters long.`,
    );
  }

  const { alphabet } = buildAlphabet(classes, excludeLookAlikes);
  if (alphabet.length === 0) {
    throw new PasswordGeneratorError('The selected classes have no characters left after excluding look-alikes.');
  }

  return {
    bits: length * Math.log2(alphabet.length),
    // Constraining the output to contain at least one character from every
    // selected class removes some of the unconstrained entropy. The figure
    // reported is the unconstrained one, marked as an upper bound rather
    // than presented as exact.
    exact: !requireOneOfEach,
    effectiveAlphabetSize: alphabet.length,
  };
}

function generateOnePassword(options: CharacterOptions, randomBytes: ByteSource): string {
  const { length, classes, excludeLookAlikes = false, requireOneOfEach = false } = options;
  const { alphabet, byClass } = buildAlphabet(classes, excludeLookAlikes);

  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
    let value = '';
    for (let i = 0; i < length; i++) {
      value += alphabet[pickIndex(alphabet.length, randomBytes)];
    }
    if (!requireOneOfEach) return value;

    // Generate-test-retry, not fixed positions: every character is drawn
    // independently and uniformly, then the whole password is checked and
    // redrawn if a selected class is missing. Forcing e.g. the first
    // character lowercase and the second uppercase would also guarantee
    // every class appears, but it leaks positional structure and costs a
    // further bit of the entropy the upper-bound figure claims.
    const covered = classes.every((c) => [...byClass[c]].some((ch) => value.includes(ch)));
    if (covered) return value;
  }
  throw new PasswordGeneratorError(
    'Could not satisfy the one-of-each-class requirement in a reasonable number of attempts.',
  );
}

function generateOnePassphrase(options: PassphraseOptions, randomBytes: ByteSource): string {
  const { words, separator = '-', capitalisation = 'none' } = options;
  const picked: string[] = [];
  for (let i = 0; i < words; i++) {
    picked.push(EFF_LONG_WORDLIST[pickIndex(EFF_LONG_WORDLIST.length, randomBytes)]!);
  }
  const cased = picked.map((w, i) => {
    if (capitalisation === 'each-word') return w[0]!.toUpperCase() + w.slice(1);
    if (capitalisation === 'first-word' && i === 0) return w[0]!.toUpperCase() + w.slice(1);
    return w;
  });
  return cased.join(separator);
}

/**
 * Generates one or more passwords or passphrases. Always draws through the
 * cryptographic random source (or the injected `randomSource` in tests) via
 * `pickIndex`'s rejection sampling -- never `Math.random`, not even for
 * placing a required character.
 */
export function generate(options: GenerateOptions): PasswordGeneratorResult {
  const entropy = estimateEntropy(options);
  const count = Math.max(1, options.count ?? 1);
  const randomBytes = options.randomSource ?? cryptoRandomBytes;

  const values: string[] =
    options.mode === 'passphrase'
      ? Array.from({ length: count }, () => generateOnePassphrase(options, randomBytes))
      : Array.from({ length: count }, () => generateOnePassword(options, randomBytes));

  return {
    values,
    distinctCount: new Set(values).size,
    source: RANDOM_SOURCE_NAME,
    entropy,
  };
}

import meta from './meta.json';
import { LOREM_WORDS } from './words';

export { meta };

export class LoremError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoremError';
  }
}

export type LoremUnit = 'words' | 'sentences' | 'paragraphs';

/** Inclusive minimum and maximum count for each unit. */
export const LIMITS: Record<LoremUnit, { min: number; max: number }> = {
  words: { min: 1, max: 1000 },
  sentences: { min: 1, max: 200 },
  paragraphs: { min: 1, max: 50 },
};

/**
 * The opening line every real Lorem ipsum generator uses. Held with its
 * comma, exactly as the fetched passage reads (see words.ts for the source
 * chain); word-unit output strips the comma back out, since a word list has
 * no punctuation of its own.
 */
export const CLASSIC_OPENING = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit';

/** The classic opening's own words, lower-case and punctuation-free, in order. */
const CLASSIC_OPENING_WORDS = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit'];

export interface GenerateOptions {
  unit: LoremUnit;
  /** How many words, sentences or paragraphs to produce, per `LIMITS[unit]`. */
  count: number;
  /** Any string. The same seed and unit/count/classicOpening always produce the same output. Default '1'. */
  seed?: string;
  /** Whether the output starts with `CLASSIC_OPENING`. Default true. */
  classicOpening?: boolean;
}

export interface LoremResult {
  text: string;
  words: number;
  sentences: number;
  paragraphs: number;
}

/**
 * FNV-1a, 32-bit variant: offset basis 2166136261 (0x811c9dc5), prime
 * 16777619 (2^24 + 2^8 + 0x93). Hashes the UTF-8 bytes of `text`. Matches the
 * published test vectors in this tool's own test file, fetched live from the
 * FNV internet-draft rather than typed from memory.
 */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  const bytes = new TextEncoder().encode(text);
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * mulberry32: a small, fast, public-domain 32-bit generator. Returns a
 * function that yields successive 32-bit UNSIGNED INTEGERS (not the [0, 1)
 * float most published versions divide down to), so an independent
 * implementation -- this tool's test re-implements the same steps with
 * BigInt arithmetic -- can compare raw outputs exactly rather than through
 * floating-point division.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** Picks a word from `LOREM_WORDS` using the generator's next output. Not uniform-perfect, fine for placeholder text. */
function pickWord(rng: () => number): string {
  const index = Math.floor((rng() / 4294967296) * LOREM_WORDS.length);
  return LOREM_WORDS[index]!;
}

/** A count in [4, 16], as the plan's own sentence-length rule requires. */
function sentenceLength(rng: () => number): number {
  return 4 + Math.floor((rng() / 4294967296) * 13);
}

/** A count in [3, 7]. */
function paragraphLength(rng: () => number): number {
  return 3 + Math.floor((rng() / 4294967296) * 5);
}

function capitalise(word: string): string {
  return word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1);
}

/**
 * Builds one generated sentence (never the classic opening) of `wordCount`
 * words: an occasional comma inserted after an interior word, capitalised,
 * ending in a period.
 */
function generateSentence(rng: () => number, wordCount: number): string {
  const words = Array.from({ length: wordCount }, () => pickWord(rng));
  // An "occasional" comma: roughly one sentence in three, and never after
  // the last word (that would read as a comma splice into the period).
  if (wordCount > 2 && rng() / 4294967296 < 0.3) {
    const commaAt = 1 + Math.floor((rng() / 4294967296) * (wordCount - 2));
    words[commaAt] = `${words[commaAt]},`;
  }
  return `${capitalise(words[0]!)} ${words.slice(1).join(' ')}.`;
}

/** Counts words in a block of already-generated text: whitespace-separated tokens. */
function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/** Counts sentences: every period is one generated sentence, since this tool never emits any other terminator. */
function countSentences(text: string): number {
  return (text.match(/\./g) ?? []).length;
}

/**
 * Generates deterministic placeholder text. The same `unit`, `count`, `seed`
 * and `classicOpening` always produce byte-identical output; a different
 * seed (almost always) produces different output. Throws `LoremError` for a
 * non-integer count or one outside `LIMITS[unit]`.
 */
export function generateLorem(options: GenerateOptions): LoremResult {
  const { unit, count, seed = '1', classicOpening = true } = options;
  const { min, max } = LIMITS[unit];
  if (!Number.isInteger(count) || count < min || count > max) {
    throw new LoremError(`count for "${unit}" must be an integer between ${min} and ${max}.`);
  }

  const rng = mulberry32(fnv1a32(seed));

  if (unit === 'words') {
    const words: string[] = [];
    if (classicOpening) {
      words.push(...CLASSIC_OPENING_WORDS.slice(0, count));
    }
    while (words.length < count) words.push(pickWord(rng));
    const text = words.map((w, i) => (i === 0 ? capitalise(w) : w)).join(' ');
    return { text, words: words.length, sentences: 0, paragraphs: 0 };
  }

  if (unit === 'sentences') {
    const sentences: string[] = [];
    if (classicOpening) sentences.push(`${CLASSIC_OPENING}.`);
    while (sentences.length < count) sentences.push(generateSentence(rng, sentenceLength(rng)));
    const text = sentences.join(' ');
    return { text, words: countWords(text), sentences: sentences.length, paragraphs: 1 };
  }

  // paragraphs
  const paragraphs: string[] = [];
  while (paragraphs.length < count) {
    const isFirst = paragraphs.length === 0;
    const sentenceCount = paragraphLength(rng);
    const sentences: string[] = [];
    if (isFirst && classicOpening) sentences.push(`${CLASSIC_OPENING}.`);
    while (sentences.length < sentenceCount) sentences.push(generateSentence(rng, sentenceLength(rng)));
    paragraphs.push(sentences.join(' '));
  }
  const text = paragraphs.join('\n\n');
  return {
    text,
    words: countWords(text),
    sentences: countSentences(text),
    paragraphs: paragraphs.length,
  };
}

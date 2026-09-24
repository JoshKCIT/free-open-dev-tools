import { it, expect } from 'vitest';
import { generateLorem, fnv1a32, mulberry32, CLASSIC_OPENING, LoremError, LIMITS } from '../src/index';

it('the same seed and settings produce byte-identical output on every call', () => {
  const options = { unit: 'sentences' as const, count: 5, seed: 'reproducible', classicOpening: true };
  const first = generateLorem(options);
  const second = generateLorem(options);
  expect(second.text).toBe(first.text);
  expect(second).toEqual(first);
});

it('different seeds produce different output', () => {
  const alpha = generateLorem({ unit: 'words', count: 50, seed: 'alpha', classicOpening: false });
  const beta = generateLorem({ unit: 'words', count: 50, seed: 'beta', classicOpening: false });
  expect(alpha.text).not.toBe(beta.text);
});

it('FNV-1a 32-bit hashes match the published test vectors', () => {
  // Table 3 (strings without null termination), FNV internet-draft
  // draft-eastlake-fnv-21, https://www.ietf.org/archive/id/draft-eastlake-fnv-21.txt,
  // fetched live 2026-09-24:
  //   ""       -> 0x811c9dc5
  //   "a"      -> 0xe40c292c
  //   "foobar" -> 0xbf9cf968
  expect(fnv1a32('')).toBe(0x811c9dc5);
  expect(fnv1a32('a')).toBe(0xe40c292c);
  expect(fnv1a32('foobar')).toBe(0xbf9cf968);
});

it('mulberry32 matches an independent BigInt implementation for the first 1000 outputs', () => {
  // Re-implements mulberry32's steps with BigInt arithmetic, entirely
  // independently of the production function, so this is a second opinion
  // rather than a restatement of the same code. Every intermediate value is
  // kept in [0, 2^32) and masked after every add/multiply, which is what the
  // production version gets implicitly from 32-bit JS bitwise operators.
  const MASK = 0xffffffffn;
  function bigMulberry32(seed: number): () => number {
    let a = BigInt(seed >>> 0);
    return function next(): number {
      a = (a + 0x6d2b79f5n) & MASK;
      let t = a;
      t = ((t ^ (t >> 15n)) * (t | 1n)) & MASK;
      const step2 = ((t ^ (t >> 7n)) * (t | 61n)) & MASK;
      const sum = (t + step2) & MASK;
      t = (t ^ sum) & MASK;
      const result = (t ^ (t >> 14n)) & MASK;
      return Number(result);
    };
  }

  const seed = fnv1a32('mulberry-cross-check');
  const production = mulberry32(seed);
  const reference = bigMulberry32(seed);
  for (let i = 0; i < 1000; i++) {
    expect(production()).toBe(reference());
  }
});

it('word, sentence and paragraph counts are exactly what was asked for', () => {
  const words = generateLorem({ unit: 'words', count: 37, seed: 'w', classicOpening: false });
  expect(words.words).toBe(37);
  expect(words.text.trim().split(/\s+/).length).toBe(37);

  const sentences = generateLorem({ unit: 'sentences', count: 12, seed: 's', classicOpening: false });
  expect(sentences.sentences).toBe(12);
  expect((sentences.text.match(/\./g) ?? []).length).toBe(12);

  const paragraphs = generateLorem({ unit: 'paragraphs', count: 4, seed: 'p', classicOpening: false });
  expect(paragraphs.paragraphs).toBe(4);
  expect(paragraphs.text.split('\n\n').length).toBe(4);
});

it('the classic opening appears only when requested', () => {
  const openingWords = generateLorem({ unit: 'words', count: 10, seed: 'shared', classicOpening: true });
  expect(openingWords.text.startsWith('Lorem ipsum dolor sit amet consectetur adipiscing elit')).toBe(true);
  const noOpeningWords = generateLorem({ unit: 'words', count: 10, seed: 'shared', classicOpening: false });
  expect(noOpeningWords.text.startsWith('Lorem ipsum dolor sit amet consectetur adipiscing elit')).toBe(false);

  const openingSentences = generateLorem({ unit: 'sentences', count: 2, seed: 'shared', classicOpening: true });
  expect(openingSentences.text.startsWith(`${CLASSIC_OPENING}.`)).toBe(true);
  const noOpeningSentences = generateLorem({ unit: 'sentences', count: 2, seed: 'shared', classicOpening: false });
  expect(noOpeningSentences.text.startsWith(`${CLASSIC_OPENING}.`)).toBe(false);

  const openingParagraphs = generateLorem({ unit: 'paragraphs', count: 2, seed: 'shared', classicOpening: true });
  expect(openingParagraphs.text.startsWith(`${CLASSIC_OPENING}.`)).toBe(true);
});

it('a count below one or above the maximum is rejected naming the valid range', () => {
  expect(() => generateLorem({ unit: 'words', count: 0 })).toThrow(LoremError);
  expect(() => generateLorem({ unit: 'words', count: 0 })).toThrow(/1 and 1000/);
  expect(() => generateLorem({ unit: 'words', count: LIMITS.words.max + 1 })).toThrow(/1 and 1000/);
  expect(() => generateLorem({ unit: 'sentences', count: LIMITS.sentences.max + 1 })).toThrow(/1 and 200/);
  expect(() => generateLorem({ unit: 'paragraphs', count: LIMITS.paragraphs.max + 1 })).toThrow(/1 and 50/);
  expect(() => generateLorem({ unit: 'words', count: 2.5 })).toThrow(LoremError);
});

it('the maximum count for a unit is accepted, not rejected as out of range', () => {
  const max = generateLorem({ unit: 'words', count: LIMITS.words.max, seed: 'cap', classicOpening: false });
  expect(max.words).toBe(LIMITS.words.max);
});

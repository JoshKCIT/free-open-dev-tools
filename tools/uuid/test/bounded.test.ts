import { expect, it } from 'vitest';
import { IdentifierError, generateNanoIds, pickAlphabetIndex } from '../src/index';

// A byte source that never gives a usable value must end in a fixed sentence, not an endless loop. The sources below
// count their reads and give up themselves after 100,000, so a sampler without a bound fails these tests quickly
// instead of hanging.

const SENTENCE = 'The byte source does not produce usable values.';
const RUNAWAY = 100_000;

function constantReader(value: number): { read: () => number; reads: () => number } {
  let reads = 0;
  return {
    read: () => {
      reads++;
      if (reads > RUNAWAY) throw new Error('the sampler kept redrawing without a bound');
      return value;
    },
    reads: () => reads,
  };
}

function refusal(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected a refusal, but the call returned');
}

it('a byte reader that is always 255 ends the pick of an index among 3 with a fixed sentence after 1,000 tries', () => {
  // Among 3 symbols the largest usable byte is 254, so 255 is thrown away every time.
  const source = constantReader(255);
  const error = refusal(() => pickAlphabetIndex(3, source.read));
  expect(error).toBeInstanceOf(IdentifierError);
  expect(error.message).toBe(SENTENCE);
  expect(source.reads()).toBe(1000);
});

it('999 unusable bytes followed by a usable one still pick, and 1,000 unusable bytes do not', () => {
  const sequence = (rejected: number): (() => number) => {
    let at = 0;
    return () => (at++ < rejected ? 255 : 4);
  };
  expect(pickAlphabetIndex(3, sequence(999))).toBe(1);
  const error = refusal(() => pickAlphabetIndex(3, sequence(1000)));
  expect(error).toBeInstanceOf(IdentifierError);
  expect(error.message).toBe(SENTENCE);
});

it('generating NanoIDs from a byte source that is always 255 ends with the fixed sentence', () => {
  let reads = 0;
  const source = (n: number): Uint8Array => {
    reads += n;
    if (reads > RUNAWAY) throw new Error('the generator kept redrawing without a bound');
    return new Uint8Array(n).fill(255);
  };
  const error = refusal(() => generateNanoIds({ count: 1, size: 4, alphabet: 'abc' }, source));
  expect(error).toBeInstanceOf(IdentifierError);
  expect(error.message).toBe(SENTENCE);
  // Other alphabets with unusable top bytes too: sizes 5, 7 and 100 all have a limit below 256.
  for (const alphabet of [
    'abcde',
    'abcdefg',
    Array.from({ length: 100 }, (_, i) => String.fromCharCode(0x4e00 + i)).join(''),
  ]) {
    reads = 0;
    expect(refusal(() => generateNanoIds({ count: 2, size: 3, alphabet }, source)).message).toBe(SENTENCE);
  }
  // A power of two never rejects a byte, so a constant source still makes ids (all the same symbol), as before.
  reads = 0;
  expect(generateNanoIds({ count: 1, size: 3, alphabet: 'abcd' }, source)).toEqual(['ddd']);
});

it('with usable bytes the pick gives exactly what the unbounded rule gives, and the byte count is the same', () => {
  let state = 20261004;
  const next = (): number => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state >>> 24;
  };
  for (let size = 2; size <= 256; size++) {
    for (let round = 0; round < 60; round++) {
      const bytes = Array.from({ length: 400 }, next);
      let used = 0;
      const got = pickAlphabetIndex(size, () => bytes[used++]!);
      // The rule written out: skip bytes at or above floor(256 / size) * size, then take the remainder.
      const limit = Math.floor(256 / size) * size;
      let at = 0;
      while (bytes[at]! >= limit) at++;
      expect([size, got, used]).toEqual([size, bytes[at]! % size, at + 1]);
    }
  }
  // A size of 1 reads nothing; sizes outside 1 to 256 keep their refusal.
  expect(pickAlphabetIndex(1, () => 255)).toBe(0);
  expect(refusal(() => pickAlphabetIndex(257, () => 0)).message).toBe(
    'Alphabet must hold 2 to 255 different characters.',
  );
});

import { expect, it } from 'vitest';
import { RandomDrawError, drawLottery, flipCoins, parseDiceNotation, pickItems, rollDice } from '../src/index';
import { drawUniformInt, drawUniformIntBounded } from '../src/sampler';

// A byte source that never gives a usable value must end in a fixed sentence, not an endless loop. The sources below
// count their reads and give up themselves after 100,000, so a sampler without a bound fails these tests quickly
// instead of hanging.

const SENTENCE = 'The byte source does not produce usable values.';
const RUNAWAY = 100_000;

function constantSource(value: number): { read: () => number; reads: () => number } {
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

it('a byte source that is always 255 ends the draw of a span of 3 with a fixed sentence after 1,000 tries', () => {
  // For a span of 3 over one byte the largest usable byte is 254, so 255 is thrown away every time.
  const source = constantSource(255);
  const error = refusal(() => drawUniformIntBounded(3, source.read));
  expect(error).toBeInstanceOf(RandomDrawError);
  expect(error.message).toBe(SENTENCE);
  expect(source.reads()).toBe(1000);
});

it('a span that needs two bytes is bounded the same way, in tries and not in bytes', () => {
  // A span of 300 reads two bytes a try and uses values up to 65,399, so 255 and 255 (65,535) is never usable.
  const source = constantSource(255);
  const error = refusal(() => drawUniformIntBounded(300, source.read));
  expect(error).toBeInstanceOf(RandomDrawError);
  expect(error.message).toBe(SENTENCE);
  expect(source.reads()).toBe(2000);
});

it('999 unusable tries followed by a usable one still draw, and 1,000 unusable tries do not', () => {
  const sequence = (rejected: number): (() => number) => {
    let at = 0;
    return () => (at++ < rejected ? 255 : 1);
  };
  expect(drawUniformIntBounded(3, sequence(999))).toBe(1);
  const error = refusal(() => drawUniformIntBounded(3, sequence(1000)));
  expect(error).toBeInstanceOf(RandomDrawError);
  expect(error.message).toBe(SENTENCE);
});

it('with usable bytes the bounded draw gives exactly what the plain draw gives, byte for byte', () => {
  let state = 20261004;
  const next = (): number => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state >>> 24;
  };
  for (const span of [2, 3, 5, 6, 7, 10, 100, 255, 256, 257, 300, 1000, 65_536, 1_000_000]) {
    for (let round = 0; round < 200; round++) {
      const bytes = Array.from({ length: 4000 }, next);
      let a = 0;
      let b = 0;
      const plain = drawUniformInt(span, () => bytes[a++]!);
      const bounded = drawUniformIntBounded(span, () => bytes[b++]!);
      expect([span, bounded, b]).toEqual([span, plain, a]);
    }
  }
  // A span of 1 or less reads nothing, as before.
  expect(drawUniformIntBounded(1, () => 255)).toBe(0);
  expect(drawUniformIntBounded(0, () => 255)).toBe(0);
});

it('dice, coins, lottery draws and list picks over a constant 255 byte sequence end with the fixed sentence', () => {
  // The test sequence is long enough for the bound to be reached before it runs out.
  const bytes = new Array<number>(5000).fill(255);
  const dice = parseDiceNotation('1d6');
  expect(refusal(() => rollDice(dice, { byteSource: bytes.slice() })).message).toBe(SENTENCE);
  expect(refusal(() => drawLottery({ poolSize: 49, drawSize: 6 }, { byteSource: bytes.slice() })).message).toBe(
    SENTENCE,
  );
  expect(
    refusal(() => pickItems({ items: ['a', 'b', 'c'], count: 1, replace: true }, { byteSource: bytes.slice() }))
      .message,
  ).toBe(SENTENCE);
  // A coin is a span of 2, over which 255 is usable (every byte is), so the flips complete.
  expect(flipCoins(5, { byteSource: bytes.slice() }).flips).toHaveLength(5);
  // And the older sentence for a sequence that runs out is kept.
  expect(refusal(() => drawLottery({ poolSize: 49, drawSize: 6 }, { byteSource: [255, 255] })).message).toBe(
    'The supplied test byte sequence ran out before generation finished.',
  );
});

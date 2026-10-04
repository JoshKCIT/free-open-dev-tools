import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  flipCoins,
  drawLottery,
  pickItems,
  readItemLines,
  MAX_FLIPS,
  MIN_POOL_SIZE,
  MAX_POOL_SIZE,
  MAX_DRAW_SIZE,
  MAX_PICKS,
  MAX_ITEMS,
  MAX_ITEM_CHARACTERS,
  MAX_LIST_CHARACTERS,
} from '../src/picks';
import { RandomDrawError } from '../src/sampler';

// New tests for coin flips, lottery draws and list picks (plan 16-09). Fixed byte sequences are worked by hand through
// the rejection rule of the shared sampler (see dice.test.ts for the rule):
//   span 2 (a coin)        every byte is kept (256 divides by 2), an even byte is heads and an odd byte is tails
//   span 3                 byte 255 is redrawn (largest multiple 255, so bytes 0 to 254 are kept)
//   span 5                 51 * 5 = 255, so bytes 0 to 254 are kept and 255 is redrawn
//   span 4                 every byte is kept
// A lottery draw is a partial Fisher-Yates shuffle of the numbers 1 to the pool size: at step i it picks a position j
// from i to the end (j = i + draw of span pool - i), takes the number there and moves the number at i into j.

let logSpy: { log: ReturnType<typeof vi.spyOn>; warn: ReturnType<typeof vi.spyOn>; error: ReturnType<typeof vi.spyOn> };

beforeEach(() => {
  logSpy = {
    log: vi.spyOn(console, 'log').mockImplementation(() => undefined),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
  };
});

afterEach(() => {
  const { log, warn, error } = logSpy;
  vi.restoreAllMocks();
  expect(log).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});

function thrown(run: () => unknown): string {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(RandomDrawError);
    return (err as Error).message;
  }
  throw new Error('the call did not throw');
}

it('coin flips report heads and tails counts that add up to the flips', () => {
  // Bytes 0, 1, 2, 3, 255: even is heads, odd is tails, so heads, tails, heads, tails, tails.
  const fixed = flipCoins(5, { byteSource: [0, 1, 2, 3, 255] });
  expect(fixed.flips).toEqual(['heads', 'tails', 'heads', 'tails', 'tails']);
  expect(fixed.heads).toBe(2);
  expect(fixed.tails).toBe(3);

  for (const n of [1, 2, 10, 999, 10_000]) {
    const r = flipCoins(n);
    expect(r.flips).toHaveLength(n);
    expect(r.heads + r.tails).toBe(n);
    expect(r.flips.filter((f) => f === 'heads')).toHaveLength(r.heads);
    expect(r.flips.filter((f) => f === 'tails')).toHaveLength(r.tails);
    for (const f of r.flips) expect(['heads', 'tails']).toContain(f);
  }
  // Both sides turn up in a large run, and a fair coin stays well inside a wide band around half.
  const many = flipCoins(10_000);
  expect(many.heads).toBeGreaterThan(4_500);
  expect(many.heads).toBeLessThan(5_500);
});

it('lottery draws never repeat a number and stay within the pool', () => {
  // Pool 5, draw 3, bytes [4, 2, 1]: the numbers 1 to 5 start as [1, 2, 3, 4, 5].
  //   step 0: span 5, byte 4 gives position 4: take 5, and 1 moves to position 4 -> [5, 2, 3, 4, 1]
  //   step 1: span 4, byte 2 gives position 3: take 4, and 2 moves to position 3 -> [5, 4, 3, 2, 1]
  //   step 2: span 3, byte 1 gives position 3: take 2 -> draw order [5, 4, 2], sorted [2, 4, 5]
  const fixed = drawLottery({ poolSize: 5, drawSize: 3 }, { byteSource: [4, 2, 1] });
  expect(fixed.drawOrder).toEqual([5, 4, 2]);
  expect(fixed.sorted).toEqual([2, 4, 5]);

  // Pool 3, draw 2, bytes [255, 1, 0]: byte 255 is redrawn (a modulo would take 255 mod 3 = 0 and give 1 first).
  //   step 0: span 3, 255 redrawn, byte 1 gives position 1: take 2, and 1 moves to position 1 -> [2, 1, 3]
  //   step 1: span 2, byte 0 gives position 1: take the number now there, 1 -> draw order [2, 1], sorted [1, 2]
  const redrawn = drawLottery({ poolSize: 3, drawSize: 2 }, { byteSource: [255, 1, 0] });
  expect(redrawn.drawOrder).toEqual([2, 1]);
  expect(redrawn.sorted).toEqual([1, 2]);

  // A pool of 1,000,000 needs three bytes: the word is 16,777,216 and the largest multiple of the pool is
  // 16,000,000, so bytes 255, 255, 255 are redrawn and 0, 0, 5 gives position 5, the number 6.
  expect(drawLottery({ poolSize: 1_000_000, drawSize: 1 }, { byteSource: [255, 255, 255, 0, 0, 5] }).drawOrder).toEqual(
    [6],
  );
  // The first and last numbers of the pool can be drawn: position 0 is 1 and position 999,999 is 1,000,000.
  expect(drawLottery({ poolSize: 1_000_000, drawSize: 1 }, { byteSource: [0, 0, 0] }).drawOrder).toEqual([1]);
  // 999,999 is 0x0F423F: bytes 15, 66, 63.
  expect(drawLottery({ poolSize: 1_000_000, drawSize: 1 }, { byteSource: [15, 66, 63] }).drawOrder).toEqual([
    1_000_000,
  ]);

  // Pool 49, draw 6, many times with the real source: six different numbers inside 1 to 49, sorted ascending.
  for (let i = 0; i < 300; i++) {
    const r = drawLottery({ poolSize: 49, drawSize: 6 });
    expect(r.drawOrder).toHaveLength(6);
    expect(new Set(r.drawOrder).size).toBe(6);
    for (const n of r.drawOrder) {
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(49);
    }
    expect(r.sorted).toEqual([...r.drawOrder].sort((a, b) => a - b));
  }
  // A draw equal to the pool is a full shuffle: every number once.
  const full = drawLottery({ poolSize: 49, drawSize: 49 });
  expect(full.sorted).toEqual(Array.from({ length: 49 }, (_, i) => i + 1));
  expect(new Set(full.drawOrder).size).toBe(49);
  const two = drawLottery({ poolSize: 2, drawSize: 2 });
  expect(two.sorted).toEqual([1, 2]);
});

it('list picks ignore blank lines and pick with or without replacement', () => {
  // Four items, count 2, no replacement, bytes [2, 0]:
  //   step 0: span 4, byte 2 gives position 2: take c, and a moves to position 2 -> [c, b, a, d]
  //   step 1: span 3, byte 0 gives position 1: take b -> picks [c, b]
  expect(pickItems({ items: ['a', 'b', 'c', 'd'], count: 2, replace: false }, { byteSource: [2, 0] })).toEqual([
    'c',
    'b',
  ]);
  // With replacement each pick is one draw over all four items: bytes 3, 0, 1 give d, a, b.
  expect(pickItems({ items: ['a', 'b', 'c', 'd'], count: 3, replace: true }, { byteSource: [3, 0, 1] })).toEqual([
    'd',
    'a',
    'b',
  ]);
  // Byte 255 is redrawn for three items: [255, 1] gives the second item, not 255 mod 3 = 0.
  expect(pickItems({ items: ['a', 'b', 'c'], count: 1, replace: false }, { byteSource: [255, 1] })).toEqual(['b']);

  // Blank lines (empty or only spaces) are not items.
  expect(pickItems({ items: ['a', '', '   ', 'b', ''], count: 2, replace: false }).sort()).toEqual(['a', 'b']);
  // After blank lines are dropped, only two items remain, so three without replacement is refused and with it is not.
  expect(thrown(() => pickItems({ items: ['a', '', '  ', 'b'], count: 3, replace: false }))).toBe(
    'The list holds 2 items, so 3 cannot be picked without replacement.',
  );
  expect(pickItems({ items: ['a', '', '  ', 'b'], count: 3, replace: true })).toHaveLength(3);
  // A list of only blank lines is refused with a sentence.
  expect(thrown(() => pickItems({ items: ['', '  ', ''], count: 1, replace: false }))).toBe(
    'The list has no items: every line is blank.',
  );
  expect(thrown(() => readItemLines('\n  \n\n'))).toBe('The list has no items: every line is blank.');

  // Without replacement no line is returned twice; two identical pasted lines are two items.
  for (let i = 0; i < 100; i++) {
    const picks = pickItems({ items: ['a', 'a', 'b'], count: 3, replace: false });
    expect([...picks].sort()).toEqual(['a', 'a', 'b']);
    const distinct = pickItems({ items: ['p', 'q', 'r', 's', 't', 'u'], count: 6, replace: false });
    expect(new Set(distinct).size).toBe(6);
  }
  // With replacement a single item can come up every time.
  expect(pickItems({ items: ['only'], count: 5, replace: true })).toEqual(['only', 'only', 'only', 'only', 'only']);
  // Without replacement a pick of the whole list is allowed, and one more is refused.
  expect(pickItems({ items: ['a', 'b'], count: 2, replace: false })).toHaveLength(2);
  expect(thrown(() => pickItems({ items: ['a', 'b'], count: 3, replace: false }))).toContain('without replacement');

  // Reading pasted text: line endings of every kind, blank lines dropped, lines kept as pasted.
  const cr = String.fromCharCode(13);
  expect(readItemLines(['one', ' two', '', 'three '].join(cr + '\n'))).toEqual(['one', ' two', 'three ']);
  expect(readItemLines('x' + cr + 'y' + cr + cr + 'z')).toEqual(['x', 'y', 'z']);
  expect(readItemLines('single')).toEqual(['single']);
});

it('limits on flips, lottery draws, picks and list items are refused before any draw', () => {
  const drawn = vi.spyOn(globalThis.crypto, 'getRandomValues');
  const noBytes = { byteSource: [] as number[] };
  const ranOut = 'ran out';

  // Flips run from 1 to 10,000.
  expect([MAX_FLIPS, MAX_PICKS, MAX_DRAW_SIZE, MIN_POOL_SIZE, MAX_POOL_SIZE]).toEqual([
    10_000, 10_000, 10_000, 2, 1_000_000,
  ]);
  expect(flipCoins(1).flips).toHaveLength(1);
  expect(flipCoins(10_000).flips).toHaveLength(10_000);
  for (const bad of [0, -1, 10_001, 1.5, Number.NaN, Number.POSITIVE_INFINITY, -98765123456]) {
    const message = thrown(() => flipCoins(bad, noBytes));
    expect(message).toBe('The number of flips must be a whole number from 1 to 10,000.');
    expect(message).not.toContain(ranOut);
  }

  // Lottery: pool 2 to 1,000,000, draw 1 to 10,000, a draw never above the pool.
  expect(drawLottery({ poolSize: 2, drawSize: 1 }).drawOrder).toHaveLength(1);
  expect(drawLottery({ poolSize: 1_000_000, drawSize: 1 }).drawOrder).toHaveLength(1);
  for (const bad of [1, 0, -1, 1_000_001, 2.5, Number.NaN, -98765123456]) {
    expect(thrown(() => drawLottery({ poolSize: bad, drawSize: 1 }, noBytes))).toBe(
      'The pool size must be a whole number from 2 to 1,000,000.',
    );
  }
  for (const bad of [0, -1, 10_001, 1.5, Number.NaN, -98765123456]) {
    expect(thrown(() => drawLottery({ poolSize: 49, drawSize: bad }, noBytes))).toBe(
      'The draw size must be a whole number from 1 to 10,000.',
    );
  }
  expect(thrown(() => drawLottery({ poolSize: 49, drawSize: 50 }, noBytes))).toBe(
    'The draw size cannot be larger than the pool size: only 49 different numbers exist.',
  );
  expect(drawLottery({ poolSize: 49, drawSize: 49 }).drawOrder).toHaveLength(49);
  // The largest draw from the largest pool costs only the numbers drawn (a sparse shuffle), so it is quick.
  const startedAt = Date.now();
  const big = drawLottery({ poolSize: 1_000_000, drawSize: 10_000 });
  const elapsed = Date.now() - startedAt;
  expect(elapsed).toBeLessThan(10_000);
  expect(new Set(big.drawOrder).size).toBe(10_000);
  expect(Math.min(...big.sorted)).toBeGreaterThanOrEqual(1);
  expect(Math.max(...big.sorted)).toBeLessThanOrEqual(1_000_000);

  // Picks run from 1 to 10,000 and a list holds at most 10,000 items of at most 200 characters each.
  expect([MAX_ITEMS, MAX_ITEM_CHARACTERS, MAX_LIST_CHARACTERS]).toEqual([10_000, 200, 2_100_000]);
  for (const bad of [0, -1, 10_001, 1.5, Number.NaN, -98765123456]) {
    expect(thrown(() => pickItems({ items: ['a', 'b'], count: bad, replace: true }, noBytes))).toBe(
      'The number of picks must be a whole number from 1 to 10,000.',
    );
  }
  expect(pickItems({ items: ['a'], count: 10_000, replace: true })).toHaveLength(10_000);
  const manyItems = Array.from({ length: 10_000 }, (_, i) => 'item ' + String(i));
  expect(pickItems({ items: manyItems, count: 10_000, replace: false })).toHaveLength(10_000);
  expect(thrown(() => pickItems({ items: [...manyItems, 'one more'], count: 1, replace: true }, noBytes))).toBe(
    'The list has more than 10,000 items.',
  );
  // Blank lines do not count towards the 10,000 items.
  expect(pickItems({ items: [...manyItems, '', '  '], count: 1, replace: true })).toHaveLength(1);

  // An item of 200 characters is accepted; 201 is refused with its line number and no repeat of the text.
  const marker = 'FODT-MARKER-3141';
  const ok = marker + 'y'.repeat(200 - marker.length);
  expect(ok).toHaveLength(200);
  expect(readItemLines('first\n' + ok)).toEqual(['first', ok]);
  const long = marker + 'y'.repeat(201 - marker.length);
  const message = thrown(() => readItemLines('first\n\n' + long + '\nlast'));
  expect(message).toBe('Line 3 is longer than 200 characters.');
  expect(message).not.toContain('FODT');
  // A paste above 2,100,000 characters is refused by its length before it is split.
  const hugeStart = Date.now();
  const hugeMessage = thrown(() => readItemLines('a\n'.repeat(1_050_001)));
  expect(hugeMessage).toBe(
    'This paste is 2,100,002 characters. The limit is 2,100,000 because 10,000 items of 200 characters with their line breaks fit in it.',
  );
  expect(Date.now() - hugeStart).toBeLessThan(1_000);
  // 10,001 non-blank lines in a paste are refused.
  expect(thrown(() => readItemLines(Array.from({ length: 10_001 }, () => 'x').join('\n')))).toBe(
    'The list has more than 10,000 items.',
  );
  expect(readItemLines(Array.from({ length: 10_000 }, () => 'x').join('\n'))).toHaveLength(10_000);

  // Nothing above drew a byte for a refused call: the only draws were the accepted calls, so count refusals alone.
  drawn.mockClear();
  thrown(() => flipCoins(0));
  thrown(() => drawLottery({ poolSize: 1, drawSize: 1 }));
  thrown(() => drawLottery({ poolSize: 5, drawSize: 6 }));
  thrown(() => pickItems({ items: [], count: 1, replace: false }));
  thrown(() => pickItems({ items: ['a'], count: 2, replace: false }));
  expect(drawn).not.toHaveBeenCalled();
}, 60_000);

it('the cryptographic source is the only source of randomness for flips, lottery draws and picks', () => {
  const random = vi.spyOn(Math, 'random').mockImplementation(() => {
    throw new Error('Math.random was called');
  });
  const drawn = vi.spyOn(globalThis.crypto, 'getRandomValues');
  flipCoins(20);
  expect(drawn).toHaveBeenCalledTimes(20);
  drawn.mockClear();
  drawLottery({ poolSize: 49, drawSize: 6 });
  expect(drawn).toHaveBeenCalled();
  drawn.mockClear();
  pickItems({ items: ['a', 'b', 'c'], count: 4, replace: true });
  expect(drawn).toHaveBeenCalled();
  drawn.mockClear();
  pickItems({ items: ['a', 'b', 'c'], count: 2, replace: false });
  expect(drawn).toHaveBeenCalled();
  expect(random).not.toHaveBeenCalled();
  // A supplied byte sequence replaces the source entirely.
  drawn.mockClear();
  flipCoins(2, { byteSource: [0, 1] });
  expect(drawn).not.toHaveBeenCalled();
});

it('nothing is written to the console while flipping, drawing or picking', () => {
  flipCoins(100);
  drawLottery({ poolSize: 1_000_000, drawSize: 100 });
  pickItems({ items: ['a', 'b', 'c'], count: 3, replace: false });
  thrown(() => flipCoins(0));
  expect(logSpy.log).not.toHaveBeenCalled();
  expect(logSpy.warn).not.toHaveBeenCalled();
  expect(logSpy.error).not.toHaveBeenCalled();
});

it('messages about lists and counts never repeat a pasted line', () => {
  const marker = 'FODT-MARKER-3141';
  const messages = [
    thrown(() => readItemLines(marker.repeat(20))),
    thrown(() => readItemLines('a\n' + marker.repeat(20))),
    thrown(() => pickItems({ items: [marker, marker + '1'], count: 3, replace: false })),
    thrown(() => pickItems({ items: [marker], count: 0, replace: false })),
  ];
  for (const m of messages) {
    expect(m).not.toContain('FODT');
    expect(m).not.toContain('MARKER');
  }
});

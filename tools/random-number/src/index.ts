import meta from './meta.json';
import { drawUniformInt } from './sampler';

export { meta };

export class RandomNumberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RandomNumberError';
  }
}

export type RandomNumberMode = 'integer' | 'decimal';
export type RandomNumberSource = 'crypto' | 'math';

export interface RandomNumberOptions {
  mode: RandomNumberMode;
  min: number;
  max: number;
  /** How many values to produce. Defaults to 1. Coerced down to an integer, must be at least 1. */
  count?: number;
  /** Decimal places for `mode: 'decimal'`. Defaults to 2. Coerced down to an integer, floored at 0. */
  places?: number;
  /** Integer mode only: no repeated value within one request. */
  unique?: boolean;
  /** Defaults to 'crypto'. 'math' is Math.random, offered for reproducible-looking test data only. */
  source?: RandomNumberSource;
  /**
   * Testing-only. Supplies raw bytes (0-255) consumed in order instead of
   * drawing from `source`, so the rejection-sampling path can be proven
   * deterministically rather than merely asserted. Never surfaced on the page.
   */
  byteSource?: number[];
}

export interface RandomNumberResult {
  /** Formatted strings, ready to display or copy. Decimals carry exactly `places` digits. */
  values: string[];
  source: RandomNumberSource;
  min: number;
  max: number;
  mode: RandomNumberMode;
}

function cryptoByteReader(): () => number {
  return () => {
    const out = new Uint8Array(1);
    globalThis.crypto.getRandomValues(out);
    return out[0]!;
  };
}

function mathByteReader(): () => number {
  return () => Math.floor(Math.random() * 256);
}

function fixedByteReader(bytes: number[]): () => number {
  let i = 0;
  return () => {
    if (i >= bytes.length) {
      throw new RandomNumberError('The supplied test byte sequence ran out before generation finished.');
    }
    return bytes[i++]!;
  };
}

function makeByteReader(source: RandomNumberSource, byteSource?: number[]): () => number {
  if (byteSource) return fixedByteReader(byteSource);
  return source === 'math' ? mathByteReader() : cryptoByteReader();
}

function generateIntegers(lo: number, hi: number, count: number, unique: boolean, readByte: () => number): string[] {
  const span = hi - lo + 1;

  if (!unique) {
    const values: string[] = [];
    for (let i = 0; i < count; i++) values.push(String(drawUniformInt(span, readByte) + lo));
    return values;
  }

  if (span < count) {
    throw new RandomNumberError(
      `${count} unique integers were requested but the range ${lo} to ${hi} only holds ${span} distinct value${span === 1 ? '' : 's'}.`,
    );
  }

  const seen = new Set<number>();
  const values: string[] = [];
  // span >= count guarantees this terminates; the guard is only a belt
  // against an implausibly unlucky run, not a real limit on legitimate use.
  const guardLimit = Math.max(count * 50, 10000);
  let attempts = 0;
  while (values.length < count) {
    attempts++;
    if (attempts > guardLimit) {
      throw new RandomNumberError('Could not draw enough unique values within a reasonable number of attempts.');
    }
    const candidate = drawUniformInt(span, readByte) + lo;
    if (!seen.has(candidate)) {
      seen.add(candidate);
      values.push(String(candidate));
    }
  }
  return values;
}

// Float multiplication by a power of ten can land a fraction of a unit off
// an intended integer tick (0.004 * 100 is not guaranteed to be exactly
// 0.4). This epsilon is small enough not to swallow a genuinely different
// tick, and large enough to absorb that noise so a boundary that is meant to
// be inclusive is not excluded by a rounding artefact.
const TICK_EPSILON = 1e-6;

function generateDecimals(min: number, max: number, places: number, count: number, readByte: () => number): string[] {
  const scale = 10 ** places;
  const minTick = Math.ceil(min * scale - TICK_EPSILON);
  const maxTick = Math.floor(max * scale + TICK_EPSILON);

  if (minTick > maxTick) {
    throw new RandomNumberError(
      `No value between ${min} and ${max} is representable at ${places} decimal place${places === 1 ? '' : 's'}.`,
    );
  }

  const span = maxTick - minTick + 1;
  const values: string[] = [];
  for (let i = 0; i < count; i++) {
    const tick = drawUniformInt(span, readByte) + minTick;
    values.push((tick / scale).toFixed(places));
  }
  return values;
}

export function generate(options: RandomNumberOptions): RandomNumberResult {
  const {
    mode,
    min,
    max,
    count: rawCount = 1,
    places: rawPlaces = 2,
    unique = false,
    source = 'crypto',
    byteSource,
  } = options;

  if (!Number.isFinite(min)) throw new RandomNumberError(`The lower bound "${min}" is not a finite number.`);
  if (!Number.isFinite(max)) throw new RandomNumberError(`The upper bound "${max}" is not a finite number.`);
  if (min > max) throw new RandomNumberError(`The lower bound (${min}) is above the upper bound (${max}).`);

  const count = Math.floor(rawCount);
  if (!(count >= 1)) throw new RandomNumberError(`The count "${rawCount}" must be at least 1.`);

  const readByte = makeByteReader(source, byteSource);

  if (mode === 'decimal') {
    const places = Math.max(0, Math.floor(rawPlaces));
    const values = generateDecimals(min, max, places, count, readByte);
    return { values, source, min, max, mode };
  }

  const lo = Math.round(min);
  const hi = Math.round(max);
  const values = generateIntegers(lo, hi, count, unique, readByte);
  return { values, source, min: lo, max: hi, mode };
}

// Dice, coin flips, lottery draws and list picks: new files that draw only through the shared rejection sampler.
export { RandomDrawError } from './sampler';
export {
  DICE_GRAMMAR,
  DiceError,
  MAX_CONSTANT,
  MAX_DICE_PER_TERM,
  MAX_DICE_TOTAL,
  MAX_NOTATION_CHARACTERS,
  MAX_SIDES,
  MIN_SIDES,
  parseDiceNotation,
  rollDice,
} from './dice';
export type {
  DiceConstantTerm,
  DiceDiceTerm,
  DiceExpression,
  DiceModifier,
  DiceModifierKind,
  DiceRoll,
  DiceTerm,
  RolledTerm,
} from './dice';
export {
  MAX_DRAW_SIZE,
  MAX_FLIPS,
  MAX_ITEM_CHARACTERS,
  MAX_ITEMS,
  MAX_LIST_CHARACTERS,
  MAX_PICKS,
  MAX_POOL_SIZE,
  MIN_POOL_SIZE,
  drawLottery,
  flipCoins,
  pickItems,
  readItemLines,
} from './picks';
export type { CoinFlips, CoinSide, LotteryDraw, PickOptions } from './picks';

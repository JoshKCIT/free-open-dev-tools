import { drawUniformIntBounded, newModeByteReader, RandomDrawError } from './sampler';

/** Coin flips and list picks run from 1 to 10,000. */
export const MAX_FLIPS = 10_000;
export const MAX_PICKS = 10_000;
/** A lottery pool holds 2 to 1,000,000 numbers and a draw takes 1 to 10,000 of them. */
export const MIN_POOL_SIZE = 2;
export const MAX_POOL_SIZE = 1_000_000;
export const MAX_DRAW_SIZE = 10_000;
/** A list holds at most 10,000 items of at most 200 characters, so the longest answer stays a few megabytes. */
export const MAX_ITEMS = 10_000;
export const MAX_ITEM_CHARACTERS = 200;
/** 10,000 items of 200 characters and their line breaks, with room for blank lines between them. */
export const MAX_LIST_CHARACTERS = 2_100_000;

export type CoinSide = 'heads' | 'tails';

export interface CoinFlips {
  flips: CoinSide[];
  heads: number;
  tails: number;
}

export interface LotteryDraw {
  /** The numbers in the order they were drawn. */
  drawOrder: number[];
  /** The same numbers from smallest to largest. */
  sorted: number[];
}

export interface PickOptions {
  /** Testing only: a fixed byte sequence replacing the cryptographic source. */
  byteSource?: number[];
}

function isWholeNumberFrom(value: number, low: number, high: number): boolean {
  return Number.isInteger(value) && value >= low && value <= high;
}

/** Flips a coin `count` times: an even draw is heads and an odd one is tails. */
export function flipCoins(count: number, options?: PickOptions): CoinFlips {
  if (!isWholeNumberFrom(count, 1, MAX_FLIPS)) {
    throw new RandomDrawError('The number of flips must be a whole number from 1 to 10,000.');
  }
  const readByte = newModeByteReader(options?.byteSource);
  const flips: CoinSide[] = [];
  let heads = 0;
  for (let i = 0; i < count; i++) {
    if (drawUniformIntBounded(2, readByte) === 0) {
      flips.push('heads');
      heads++;
    } else {
      flips.push('tails');
    }
  }
  return { flips, heads, tails: count - heads };
}

/**
 * Draws `drawSize` different numbers from 1 to `poolSize` by a partial Fisher-Yates shuffle kept in a sparse map, so
 * a pool of 1,000,000 costs only the numbers drawn. A draw as large as the pool is a full shuffle.
 */
export function drawLottery(request: { poolSize: number; drawSize: number }, options?: PickOptions): LotteryDraw {
  const { poolSize, drawSize } = request;
  if (!isWholeNumberFrom(poolSize, MIN_POOL_SIZE, MAX_POOL_SIZE)) {
    throw new RandomDrawError('The pool size must be a whole number from 2 to 1,000,000.');
  }
  if (!isWholeNumberFrom(drawSize, 1, MAX_DRAW_SIZE)) {
    throw new RandomDrawError('The draw size must be a whole number from 1 to 10,000.');
  }
  if (drawSize > poolSize) {
    throw new RandomDrawError(
      `The draw size cannot be larger than the pool size: only ${poolSize} different numbers exist.`,
    );
  }
  const readByte = newModeByteReader(options?.byteSource);
  // Position p holds the number p + 1 unless it has been moved; only moved positions are stored.
  const moved = new Map<number, number>();
  const drawOrder: number[] = [];
  for (let i = 0; i < drawSize; i++) {
    const j = i + drawUniformIntBounded(poolSize - i, readByte);
    const atJ = moved.get(j) ?? j + 1;
    const atI = moved.get(i) ?? i + 1;
    drawOrder.push(atJ);
    moved.set(j, atI);
  }
  const sorted = [...drawOrder].sort((a, b) => a - b);
  return { drawOrder, sorted };
}

function withCommas(n: number): string {
  const digits = String(n);
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}

/**
 * Reads pasted text as one item per line. Line endings of every kind are understood, blank lines (empty or only
 * spaces) are ignored and lines are kept as pasted. Text over the limit is refused before it is split.
 */
export function readItemLines(text: string): string[] {
  if (text.length > MAX_LIST_CHARACTERS) {
    throw new RandomDrawError(
      `This paste is ${withCommas(text.length)} characters. The limit is ${withCommas(MAX_LIST_CHARACTERS)} because 10,000 items of 200 characters with their line breaks fit in it.`,
    );
  }
  const items: string[] = [];
  let lineNumber = 0;
  let position = 0;
  for (;;) {
    let end = position;
    while (end < text.length) {
      const c = text.charCodeAt(end);
      if (c === 10 || c === 13) break;
      end++;
    }
    lineNumber++;
    const line = text.slice(position, end);
    if (line.trim() !== '') {
      if (line.length > MAX_ITEM_CHARACTERS) {
        throw new RandomDrawError(`Line ${lineNumber} is longer than 200 characters.`);
      }
      if (items.length >= MAX_ITEMS) throw new RandomDrawError('The list has more than 10,000 items.');
      items.push(line);
    }
    if (end >= text.length) break;
    position = end + (text.charCodeAt(end) === 13 && text.charCodeAt(end + 1) === 10 ? 2 : 1);
  }
  if (items.length === 0) throw new RandomDrawError('The list has no items: every line is blank.');
  return items;
}

/**
 * Picks `count` items from a list, with or without replacement. Blank entries are ignored; two identical lines are two
 * items. Without replacement the picks are a partial shuffle, so no line comes up twice.
 */
export function pickItems(
  request: { items: readonly string[]; count: number; replace: boolean },
  options?: PickOptions,
): string[] {
  const { items, count, replace } = request;
  if (!isWholeNumberFrom(count, 1, MAX_PICKS)) {
    throw new RandomDrawError('The number of picks must be a whole number from 1 to 10,000.');
  }
  const list: string[] = [];
  for (const item of items) {
    if (item.trim() === '') continue;
    if (item.length > MAX_ITEM_CHARACTERS) throw new RandomDrawError('An item is longer than 200 characters.');
    if (list.length >= MAX_ITEMS) throw new RandomDrawError('The list has more than 10,000 items.');
    list.push(item);
  }
  if (list.length === 0) throw new RandomDrawError('The list has no items: every line is blank.');
  if (!replace && count > list.length) {
    throw new RandomDrawError(
      `The list holds ${list.length} item${list.length === 1 ? '' : 's'}, so ${count} cannot be picked without replacement.`,
    );
  }

  const readByte = newModeByteReader(options?.byteSource);
  const picks: string[] = [];
  if (replace) {
    for (let i = 0; i < count; i++) picks.push(list[drawUniformIntBounded(list.length, readByte)]!);
    return picks;
  }
  const order = Array.from({ length: list.length }, (_, index) => index);
  for (let i = 0; i < count; i++) {
    const j = i + drawUniformIntBounded(list.length - i, readByte);
    const chosen = order[j]!;
    order[j] = order[i]!;
    order[i] = chosen;
    picks.push(list[chosen]!);
  }
  return picks;
}

/**
 * The linear-time check every parser of this phase is held to. It never states an absolute time (a machine can be slow or
 * busy): it times a function on an input of size n and on one of size 2n and returns how many times longer the bigger one
 * took. A parser that reads its input once gives a ratio near 2; one that rescans for every character gives about 4 or more,
 * and anything exponential is far above. A test fails when the ratio is over 6.
 *
 * Each timing is the median of 5 samples, after two warm-up calls, and every sample repeats the call enough times to last
 * about two milliseconds, so the clock's resolution never decides the answer.
 *
 * This file is copied byte for byte into every tool folder of the phase that uses it. It imports nothing.
 */

/** The ratio the tests allow when an input doubles. */
export const MAX_SCALING_RATIO = 6;

/** The time in milliseconds of calling `fn` on `input` `reps` times. */
function time(fn: (input: string) => unknown, input: string, reps: number): number {
  const start = performance.now();
  for (let i = 0; i < reps; i++) fn(input);
  return performance.now() - start;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * How many times longer `fn` takes on `make(2 * n)` than on `make(n)`. `fn` may throw (a refusal is an answer too): it is
 * called through a guard, so a thrown error costs what it costs and never ends the measurement.
 */
export function scalingRatio(fn: (input: string) => unknown, make: (n: number) => string, n: number): number {
  const guarded = (input: string): void => {
    try {
      fn(input);
    } catch {
      // A refusal is a valid outcome of a hostile input.
    }
  };
  const small = make(n);
  const large = make(2 * n);
  time(guarded, small, 1);
  time(guarded, large, 1);
  const probe = time(guarded, small, 1);
  const reps = Math.min(500, Math.max(1, Math.ceil(2 / Math.max(probe, 0.001))));
  const samples = (input: string): number => {
    const timings: number[] = [];
    for (let i = 0; i < 5; i++) timings.push(time(guarded, input, reps));
    return median(timings);
  };
  const a = samples(small);
  const b = samples(large);
  return b / Math.max(a, 0.0005);
}

/** The six strings every parser is tried with, each built for a size n. */
export const HOSTILE: ReadonlyArray<(n: number) => string> = [
  (n) => 'a'.repeat(n),
  (n) => ' '.repeat(n) + '!',
  (n) => ';'.repeat(n),
  (n) => '=?'.repeat(Math.floor(n / 2)),
  (n) => '{'.repeat(n),
  (n) => ','.repeat(n),
];

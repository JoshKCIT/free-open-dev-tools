import { expect, it } from 'vitest';
import { meta as toolMeta } from '../src/index';

/**
 * Top-level `it(...)` only, never nested in `describe(...)`: the verify scripts match a required title by exact
 * equality with the name the JSON reporter writes.
 *
 * The page stops a run after 5 seconds. The first limits entry says so in general; this one says which very large
 * paste can reach that stop, with three times measured on one laptop. The numbers themselves are measured, not
 * derived (see the plan summary for the bench arguments), so this test checks the shape of the sentence, not the
 * seconds: every phrase must have a number, the path lengths must grow, and the seconds must not shrink with them.
 */

const TIMED_PHRASE = /(\d+(?:\.\d+)?) seconds with (\d+) character paths/g;

it('the limits state the very large paste that reaches the 5 second stop, with three measured path lengths', () => {
  const limits = toolMeta.limits as string[];
  const stopEntries = limits.filter((entry) => entry.includes('5 second stop'));
  expect(stopEntries).toHaveLength(1);

  const entry = stopEntries[0] as string;
  for (const part of [
    '1,000 rules',
    '5,000 paths',
    're-includes',
    'only the longer pastes of that shape end with the stop message',
    'split it into smaller pastes',
  ]) {
    expect(entry).toContain(part);
  }

  const phrases = [...entry.matchAll(TIMED_PHRASE)];
  expect(phrases).toHaveLength(3);
  const seconds = phrases.map((p) => Number(p[1]));
  const lengths = phrases.map((p) => Number(p[2]));
  expect(lengths[0]).toBeLessThan(lengths[1] as number);
  expect(lengths[1]).toBeLessThan(lengths[2] as number);
  expect(seconds[0]).toBeLessThanOrEqual(seconds[1] as number);
  expect(seconds[1]).toBeLessThanOrEqual(seconds[2] as number);
  // The longest measured paste is the one that went past the stop, and the shortest finished inside it, which is why
  // the sentence says only the longer pastes reach the stop.
  expect(seconds[2]).toBeGreaterThan(5);
  expect(seconds[0]).toBeLessThan(5);

  // The entry was added after the earlier ones, so every earlier entry keeps its place.
  expect(limits[limits.length - 1]).toBe(entry);
});

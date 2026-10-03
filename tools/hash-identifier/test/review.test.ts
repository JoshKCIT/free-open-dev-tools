import { expect, it } from 'vitest';
import { identifyLine, identifyText, RULES } from '../src/index';

// Tests for the findings of the phase 14 code review (part B) against the hash identifier.

const tiersOf = (line: string): Record<string, number> =>
  Object.fromEntries(identifyLine(line).map((c) => [c.ruleId, c.tier]));

// B-WR-04: descrypt and bigcrypt fired on any string of the right length in ./0-9A-Za-z, and ranked above digest rules.
it('a MongoDB object id and a 13 digit timestamp are length-only guesses for the two DES crypt shapes, not shapes', () => {
  // 24 hexadecimal characters: 2 + 2 x 11, so it has the length of a two-block bigcrypt string and nothing more.
  const objectId = '507f1f77bcf86cd799439011';
  const found = identifyLine(objectId);
  expect(found.map((c) => c.ruleId)).toEqual(['bigcrypt']);
  expect(found[0]?.tier).toBe(3);
  expect(found[0]?.reason).toMatch(/length and alphabet only/);
  // 13 digits: the length of a traditional DES crypt string and the first block of a bigcrypt string.
  const timestamp = '1727970000000';
  const stamp = identifyLine(timestamp);
  expect(stamp.map((c) => [c.ruleId, c.tier])).toEqual([
    ['descrypt', 3],
    ['bigcrypt', 3],
  ]);
  for (const c of stamp) expect(c.reason).toMatch(/length and alphabet only/);
  // RFC 2307's own example is still listed, with the same plain wording.
  expect(tiersOf('X5/DBrWPOQQaI')).toEqual({ descrypt: 3, bigcrypt: 3 });
  // The two rules say in their own table entries that they are length-only.
  for (const id of ['descrypt', 'bigcrypt']) expect(RULES.find((r) => r.id === id)?.tier).toBe(3);
});

it('a crypt length-only line gets a note of its own, not the sentence about bare hex strings', () => {
  const result = identifyText('1727970000000');
  expect(result.notes).toHaveLength(1);
  expect(result.notes[0]).toMatch(/without a marker/);
  expect(result.notes[0]).not.toMatch(/bare hex/);
  // A bare hex digest keeps its own sentence, and both notes come out when a paste holds both kinds.
  expect(identifyText('5f4dcc3b5aa765d61d8327deb882cf99').notes).toHaveLength(1);
  const both = identifyText('1727970000000\n5f4dcc3b5aa765d61d8327deb882cf99');
  expect(both.notes).toHaveLength(2);
  // The wrapped copies count too.
  expect(identifyText('{CRYPT}1727970000000').notes[0]).toMatch(/without a marker/);
});

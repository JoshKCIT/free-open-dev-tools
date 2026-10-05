import { expect, it } from 'vitest';
import { SNOWFLAKE_DEFAULT_EPOCH, detectIdentifier, parse, truncatedUuidNote } from '../src/index';

// Hexadecimal digits are also in the ULID, KSUID and ObjectId alphabets, so a UUID that lost its last digits still has
// a shape and decodes. The decode is kept; the page adds a warning that the text may be a UUID missing digits.

const EPOCH = SNOWFLAKE_DEFAULT_EPOCH;
const NOTE = 'These characters are also a UUID missing digits: a UUID has 32 hexadecimal digits.';
const FULL = '2ed6657de927568b95e12665a8aea6a2';

it('a UUID cut to 24, 26 or 27 hexadecimal digits still decodes and carries the missing-digits note', () => {
  expect(parse(FULL).valid).toBe(true);
  const cut24 = FULL.slice(0, 24);
  const cut26 = FULL.slice(0, 26);
  const cut27 = FULL.slice(0, 27);
  expect(parse(cut24).valid).toBe(false);
  expect(parse(cut26).valid).toBe(false);
  expect(parse(cut27).valid).toBe(false);

  // The decodes are unchanged: an ObjectId, a ULID and a KSUID.
  expect(detectIdentifier(cut24, EPOCH)).toMatchObject({ format: 'objectid', iso: '1994-11-25T22:30:21.000Z' });
  expect(detectIdentifier(cut26, EPOCH)).toMatchObject({ format: 'ulid' });
  expect(detectIdentifier(cut27, EPOCH)).toMatchObject({ format: 'ksuid' });

  // The note: the same sentence for each, also with white space around, in upper case and for a hex-only ULID or ObjectId.
  for (const text of [cut24, cut26, cut27, `  ${cut24}\n`, cut26.toUpperCase(), '507f1f77bcf86cd799439011']) {
    expect(truncatedUuidNote(text), text).toBe(NOTE);
  }
});

it('text that is not all hexadecimal digits, or not 24, 26 or 27 characters long, gets no missing-digits note', () => {
  expect(truncatedUuidNote(FULL)).toBeNull();
  expect(truncatedUuidNote(FULL.slice(0, 23))).toBeNull();
  expect(truncatedUuidNote(FULL.slice(0, 25))).toBeNull();
  expect(truncatedUuidNote(FULL.slice(0, 28))).toBeNull();
  // A real ULID and a real KSUID have letters that are not hexadecimal digits.
  expect(truncatedUuidNote('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBeNull();
  expect(truncatedUuidNote('0uk1Hbc9dQ9pxyTqJ93IUrfhdGq')).toBeNull();
  // A hexadecimal run with a stray character, inner white space or a hyphen is not all hexadecimal digits.
  expect(truncatedUuidNote('2ed6657de927568b95e1266g')).toBeNull();
  expect(truncatedUuidNote('2ed6657de927568b 95e12665')).toBeNull();
  expect(truncatedUuidNote('2ed6657d-e927568b95e12665')).toBeNull();
  expect(truncatedUuidNote('')).toBeNull();
  // A Snowflake-length number is not a cut UUID.
  expect(truncatedUuidNote('1888944671579078978')).toBeNull();
});

import { expect, it, vi } from 'vitest';
import { IdentifierError, SNOWFLAKE_DEFAULT_EPOCH, detectIdentifier, generate, parse } from '../src/index';

// Shape detection runs only after the UUID parse has said no. The shapes are the published ones: a ULID is 26 Crockford
// base32 characters (https://github.com/ulid/spec), a KSUID is 27 base62 characters (https://github.com/segmentio/ksuid),
// an ObjectId is 24 hexadecimal digits (https://www.mongodb.com/docs/manual/reference/method/ObjectId/) and a Snowflake
// ID is a whole number of up to 19 digits (https://en.wikipedia.org/wiki/Snowflake_ID).

const EPOCH = SNOWFLAKE_DEFAULT_EPOCH;

function refusal(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(IdentifierError);
    return (error as Error).message;
  }
  throw new Error('expected a refusal, but the call returned');
}

it('inspect tries a UUID first and then ULID, KSUID, ObjectId and Snowflake shapes in that order', () => {
  // A UUID is judged by the existing parser. Whatever it accepts is never offered to the shape detector by the page,
  // and the detector itself says nothing about a UUID written with or without hyphens.
  const uuid = generate({ version: 4, count: 1 })[0]!;
  expect(parse(uuid).valid).toBe(true);
  expect(detectIdentifier(uuid, EPOCH)).toBeNull();
  expect(parse(uuid.replace(/-/g, '')).valid).toBe(true);
  expect(detectIdentifier(uuid.replace(/-/g, ''), EPOCH)).toBeNull();
  expect(detectIdentifier('urn:uuid:' + uuid, EPOCH)).toBeNull();

  // None of the other shapes is a UUID, so the parser says no and the detector takes over.
  const ulid = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
  const ksuid = '0uk1Hbc9dQ9pxyTqJ93IUrfhdGq';
  const objectId = '507f1f77bcf86cd799439011';
  const snowflake = '1888944671579078978';
  for (const text of [ulid, ksuid, objectId, snowflake]) expect(parse(text).valid, text).toBe(false);

  // The epoch is read only when a Snowflake shape is reached, so it comes last: a pasted ULID, KSUID or ObjectId never
  // depends on it, even when it is unusable.
  const unusable = vi.fn((): number => {
    throw new IdentifierError('Epoch is not usable.');
  });
  expect(detectIdentifier(ulid, unusable)).toMatchObject({
    format: 'ulid',
    ms: 1469922850259,
    iso: '2016-07-30T23:54:10.259Z',
  });
  expect(detectIdentifier(ksuid, unusable)).toMatchObject({
    format: 'ksuid',
    timestamp: 107611700,
    payloadHex: '9850EEEC191BF4FF26F99315CE43B0C8',
  });
  expect(detectIdentifier(objectId, unusable)).toMatchObject({
    format: 'objectid',
    timestamp: 1350508407,
    randomHex: 'bcf86cd799',
    counter: 0x439011,
  });
  expect(unusable).not.toHaveBeenCalled();
  expect(refusal(() => detectIdentifier(snowflake, unusable))).toBe('Epoch is not usable.');
  expect(unusable).toHaveBeenCalledTimes(1);

  // The Snowflake worked example of the published layout, then the same id against another epoch.
  expect(detectIdentifier(snowflake, EPOCH)).toEqual({
    format: 'snowflake',
    ms: 1739194479256,
    iso: '2025-02-10T13:34:39.256Z',
    datacenter: 11,
    worker: 8,
    sequence: 322,
  });
  expect(detectIdentifier(snowflake, () => 0)).toMatchObject({ format: 'snowflake', ms: 450359504599 });
  expect(detectIdentifier(snowflake, 0)).toMatchObject({ format: 'snowflake', ms: 450359504599 });

  // Case does not matter for ULIDs and ObjectIds, white space around the text is ignored, and white space inside is not.
  expect(detectIdentifier(ulid.toLowerCase(), EPOCH)).toMatchObject({ format: 'ulid', ms: 1469922850259 });
  expect(detectIdentifier('  ' + objectId.toUpperCase() + '\n', EPOCH)).toMatchObject({ format: 'objectid' });
  expect(detectIdentifier('01ARZ3NDEKTSV4RRFFQ69 G5FAV', EPOCH)).toBeNull();
});

it('a shape that is right but a value that cannot exist is refused with the format named', () => {
  // The length and the characters say which format was meant; the value says it cannot be one.
  expect(refusal(() => detectIdentifier('8ZZZZZZZZZZZZZZZZZZZZZZZZZ', EPOCH))).toBe(
    'A ULID cannot start with a character above 7: the largest ULID is 7ZZZZZZZZZZZZZZZZZZZZZZZZZ.',
  );
  expect(refusal(() => detectIdentifier('99999999999999999999999999', EPOCH))).toMatch(/above 7/);
  expect(refusal(() => detectIdentifier('zzzzzzzzzzzzzzzzzzzzzzzzzzz', EPOCH))).toBe(
    'A KSUID cannot be larger than aWgEPTl1tmebfsQzFP4bxwgy80V.',
  );
  expect(refusal(() => detectIdentifier('9223372036854775808', EPOCH))).toBe(
    'A Snowflake ID cannot be larger than 9223372036854775807 (2^63 - 1).',
  );
  expect(refusal(() => detectIdentifier('9999999999999999999', EPOCH))).toMatch(/cannot be larger/);
  expect(detectIdentifier('aWgEPTl1tmebfsQzFP4bxwgy80V', EPOCH)).toMatchObject({
    format: 'ksuid',
    timestamp: 4294967295,
  });
  expect(detectIdentifier('9223372036854775807', EPOCH)).toMatchObject({ format: 'snowflake', sequence: 4095 });
});

it('text of no known shape is not an identifier', () => {
  for (const text of [
    '',
    '   ',
    'hello',
    'not an id',
    // Close to a shape but not one: a wrong length or a character the format does not use.
    '0'.repeat(25),
    '0'.repeat(28),
    'U'.repeat(26), // U is not in the Crockford alphabet, and 26 characters is not a KSUID length
    'I'.repeat(26),
    '01ARZ3NDEKTSV4RRFFQ69G5FA!',
    '0uk1Hbc9dQ9pxyTqJ93IUrfhdG-',
    'a'.repeat(23),
    'a'.repeat(25),
    '507f1f77bcf86cd79943901g',
    '12345678901234567890', // 20 digits: more than a Snowflake ID holds, and not an ObjectId length
    '-1',
    '1.5',
    '1e5',
    '0x1f',
    '2ed6657d-e927-568b-9',
  ]) {
    expect(detectIdentifier(text, EPOCH), JSON.stringify(text)).toBeNull();
  }
  // Digits alone are a Snowflake ID up to 19 of them, an ObjectId at 24 (hexadecimal digits include 0 to 9), and the
  // shapes of 26 and 27 characters are a ULID or a KSUID when their characters and value allow it.
  expect(detectIdentifier('0', EPOCH)).toMatchObject({ format: 'snowflake', ms: EPOCH });
  expect(detectIdentifier('1234567890123456789', EPOCH)).toMatchObject({ format: 'snowflake' });
  expect(detectIdentifier('123456789012345678901234', EPOCH)).toMatchObject({ format: 'objectid' });
  expect(detectIdentifier('01234567890123456789012345', EPOCH)).toMatchObject({ format: 'ulid' });
  expect(detectIdentifier('123456789012345678901234567', EPOCH)).toMatchObject({ format: 'ksuid' });
});

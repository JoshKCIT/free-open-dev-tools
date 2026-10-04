import { decodeKsuid, type DecodedKsuid } from './ksuid';
import { decodeObjectId, type DecodedObjectId } from './objectid';
import { decodeSnowflake, type DecodedSnowflake } from './snowflake';
import { decodeUlid, type DecodedUlid } from './ulid';

export type DetectedIdentifier =
  | ({ format: 'ulid' } & DecodedUlid)
  | ({ format: 'ksuid' } & DecodedKsuid)
  | ({ format: 'objectid' } & DecodedObjectId)
  | ({ format: 'snowflake' } & DecodedSnowflake);

// The published shapes, tested by length first so a long paste is never scanned.
const ULID_SHAPE = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
const KSUID_SHAPE = /^[0-9A-Za-z]{27}$/;
const OBJECT_ID_SHAPE = /^[0-9a-fA-F]{24}$/;
const SNOWFLAKE_SHAPE = /^[0-9]{1,19}$/;

/**
 * Names what a pasted text is when it is not a UUID, by shape and in this order: a ULID (26 Crockford base32
 * characters), a KSUID (27 base62 characters), an ObjectId (24 hexadecimal digits), a Snowflake ID (1 to 19 digits).
 * Returns null when no shape fits. A text that has a shape but a value that cannot exist (a ULID starting above 7, a
 * KSUID past its largest value, a number past 2^63 - 1) is refused with that format's own sentence.
 *
 * The epoch is read only when the Snowflake shape is reached, so a ULID, KSUID or ObjectId never depends on it. It may
 * be a number of milliseconds or a function that gives one (and may refuse).
 */
export function detectIdentifier(text: string, epoch: number | (() => number)): DetectedIdentifier | null {
  const trimmed = text.trim();
  const length = trimmed.length;
  if (length === 26 && ULID_SHAPE.test(trimmed)) return { format: 'ulid', ...decodeUlid(trimmed) };
  if (length === 27 && KSUID_SHAPE.test(trimmed)) return { format: 'ksuid', ...decodeKsuid(trimmed) };
  if (length === 24 && OBJECT_ID_SHAPE.test(trimmed)) return { format: 'objectid', ...decodeObjectId(trimmed) };
  if (length >= 1 && length <= 19 && SNOWFLAKE_SHAPE.test(trimmed)) {
    const chosen = typeof epoch === 'function' ? epoch() : epoch;
    return { format: 'snowflake', ...decodeSnowflake(trimmed, chosen) };
  }
  return null;
}

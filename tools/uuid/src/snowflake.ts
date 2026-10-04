import { IdentifierError, checkCount } from './id-errors';

/**
 * Snowflake ID: a 63-bit number (the top bit is always zero) made of 41 bits of milliseconds since a chosen epoch,
 * 5 datacenter bits, 5 worker bits and 12 sequence bits, written in decimal. All arithmetic is done with BigInt
 * because the number is too large for a double. Layout: https://en.wikipedia.org/wiki/Snowflake_ID
 */

/** 1288834974657, the reference epoch of the published layout: 2010-11-04T01:42:54.657Z. */
export const SNOWFLAKE_DEFAULT_EPOCH = 1288834974657;

const MAX_OFFSET = 2199023255551; // 2^41 - 1 milliseconds after the epoch
const MAX_ID = (1n << 63n) - 1n;
const MAX_SEQUENCE = 4095;
const MAX_EPOCH = 8_000_000_000_000_000; // keeps every time inside what a JavaScript date can show

const EPOCH_FORMAT_MESSAGE =
  'Epoch must be a whole number of milliseconds since 1970-01-01, or an ISO 8601 date such as 2010-11-04 or 2010-11-04T01:42:54.657Z (a time needs an offset such as Z or +02:00).';
const EPOCH_FUTURE_MESSAGE = 'Epoch cannot be in the future.';
const EPOCH_BEFORE_MESSAGE = 'Epoch cannot be before 1970-01-01.';
const TIME_MESSAGE =
  'The time is before the epoch or more than 2^41 - 1 milliseconds after it, which a Snowflake ID cannot hold.';

export interface SnowflakeParts {
  /** Milliseconds since 1970-01-01T00:00:00Z. */
  ms: number;
  datacenter: number;
  worker: number;
  sequence: number;
}

export interface DecodedSnowflake extends SnowflakeParts {
  iso: string;
}

export interface SnowflakeOptions {
  count: number;
  /** Milliseconds since 1970-01-01, usually from parseEpoch. */
  epoch: number;
  datacenter: number;
  worker: number;
}

const DATE_TIME =
  /^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:T([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:[.]([0-9]{1,3}))?)?(Z|[+-][0-9]{2}:[0-9]{2}))?$/;

/**
 * Reads the epoch a visitor typed: whole milliseconds since 1970-01-01, or an ISO 8601 date (midnight UTC) or date and
 * time with an offset (Z or +hh:mm). It must lie between 1970-01-01 and `now`.
 */
export function parseEpoch(text: string, now: number = Date.now()): number {
  if (text.length > 100) throw new IdentifierError(EPOCH_FORMAT_MESSAGE);
  const trimmed = text.trim();
  let value: number;
  if (/^[0-9]{1,16}$/.test(trimmed)) {
    value = Number(trimmed);
  } else {
    const match = DATE_TIME.exec(trimmed);
    if (match === null) throw new IdentifierError(EPOCH_FORMAT_MESSAGE);
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = match[4] === undefined ? 0 : Number(match[4]);
    const minute = match[5] === undefined ? 0 : Number(match[5]);
    const second = match[6] === undefined ? 0 : Number(match[6]);
    const milli = match[7] === undefined ? 0 : Number(match[7].padEnd(3, '0'));
    if (year < 1970) {
      // Years under 100 would be read as 19xx by the date functions, so they are judged here.
      if (month < 1 || month > 12 || day < 1 || day > 31) throw new IdentifierError(EPOCH_FORMAT_MESSAGE);
      throw new IdentifierError(EPOCH_BEFORE_MESSAGE);
    }
    if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) {
      throw new IdentifierError(EPOCH_FORMAT_MESSAGE);
    }
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, milli));
    if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new IdentifierError(EPOCH_FORMAT_MESSAGE);
    let offsetMinutes = 0;
    const zone = match[8];
    if (zone !== undefined && zone !== 'Z') {
      const offsetHours = Number(zone.slice(1, 3));
      const offsetRest = Number(zone.slice(4, 6));
      if (offsetHours > 23 || offsetRest > 59) throw new IdentifierError(EPOCH_FORMAT_MESSAGE);
      offsetMinutes = (offsetHours * 60 + offsetRest) * (zone.startsWith('-') ? -1 : 1);
    }
    value = date.getTime() - offsetMinutes * 60000;
    if (value < 0) throw new IdentifierError(EPOCH_BEFORE_MESSAGE);
  }
  if (value > now) throw new IdentifierError(EPOCH_FUTURE_MESSAGE);
  return value;
}

function checkEpoch(epoch: number): void {
  if (!Number.isSafeInteger(epoch) || epoch < 0 || epoch > MAX_EPOCH) throw new IdentifierError(EPOCH_FORMAT_MESSAGE);
}

function checkMachine(name: 'Datacenter' | 'Worker', value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 31) {
    throw new IdentifierError(`${name} must be a whole number from 0 to 31.`);
  }
}

/** The decimal text of one Snowflake ID built from its parts, for a chosen epoch. */
export function encodeSnowflake(parts: SnowflakeParts, epoch: number): string {
  checkEpoch(epoch);
  checkMachine('Datacenter', parts.datacenter);
  checkMachine('Worker', parts.worker);
  const offset = parts.ms - epoch;
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) throw new IdentifierError(TIME_MESSAGE);
  if (!Number.isInteger(parts.sequence) || parts.sequence < 0 || parts.sequence > MAX_SEQUENCE) {
    throw new IdentifierError('The sequence must be a whole number from 0 to 4095.');
  }
  const id =
    (BigInt(offset) << 22n) |
    (BigInt(parts.datacenter) << 17n) |
    (BigInt(parts.worker) << 12n) |
    BigInt(parts.sequence);
  return id.toString();
}

// The next sequence to hand out for each machine and epoch: the millisecond and sequence of the last id made, so two
// calls in the same millisecond never repeat an id. Only the most recent combinations are kept.
const last = new Map<string, { ms: number; sequence: number }>();
const LAST_LIMIT = 256;

/**
 * Makes `count` Snowflake IDs for the time `now`. The sequence starts at 0 in each millisecond and counts up; after
 * 4096 ids in one millisecond the next id belongs to the next millisecond (nothing waits).
 */
export function generateSnowflakes(options: SnowflakeOptions, now: number = Date.now()): string[] {
  const { count, epoch, datacenter, worker } = options;
  checkCount(count);
  checkEpoch(epoch);
  checkMachine('Datacenter', datacenter);
  checkMachine('Worker', worker);
  if (!Number.isInteger(now)) throw new IdentifierError(TIME_MESSAGE);
  const key = `${epoch}/${datacenter}/${worker}`;
  const previous = last.get(key);
  let ms = now;
  let sequence = 0;
  if (previous !== undefined && now <= previous.ms) {
    ms = previous.ms;
    sequence = previous.sequence + 1;
    if (sequence > MAX_SEQUENCE) {
      ms += 1;
      sequence = 0;
    }
  }
  const out: string[] = [];
  let usedMs = ms;
  let usedSequence = sequence;
  for (let i = 0; i < count; i++) {
    out.push(encodeSnowflake({ ms, datacenter, worker, sequence }, epoch));
    usedMs = ms;
    usedSequence = sequence;
    sequence += 1;
    if (sequence > MAX_SEQUENCE) {
      ms += 1;
      sequence = 0;
    }
  }
  last.delete(key);
  last.set(key, { ms: usedMs, sequence: usedSequence });
  if (last.size > LAST_LIMIT) last.delete(last.keys().next().value as string);
  return out;
}

/** Reads a Snowflake ID (decimal digits) into its time, machine numbers and sequence for a chosen epoch. */
export function decodeSnowflake(text: string, epoch: number): DecodedSnowflake {
  checkEpoch(epoch);
  const trimmed = text.trim();
  if (trimmed.length < 1 || trimmed.length > 19 || !/^[0-9]+$/.test(trimmed)) {
    throw new IdentifierError('A Snowflake ID is a whole number of 1 to 19 digits.');
  }
  const id = BigInt(trimmed);
  if (id > MAX_ID) throw new IdentifierError('A Snowflake ID cannot be larger than 9223372036854775807 (2^63 - 1).');
  const ms = Number(id >> 22n) + epoch;
  return {
    ms,
    iso: new Date(ms).toISOString(),
    datacenter: Number((id >> 17n) & 31n),
    worker: Number((id >> 12n) & 31n),
    sequence: Number(id & 4095n),
  };
}

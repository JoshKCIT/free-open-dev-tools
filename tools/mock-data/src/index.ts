import meta from './meta.json';
import { formatCsv } from './csv';
import {
  FIRST_NAMES,
  LAST_NAMES,
  CITIES,
  STREET_NAMES,
  STREET_SUFFIXES,
  WORDS,
  COMPANY_SUFFIXES,
  EXAMPLE_DOMAINS,
} from './words';

export { meta };

export class MockDataError extends Error {
  readonly line?: number;
  constructor(message: string, line?: number) {
    super(message);
    this.name = 'MockDataError';
    if (line !== undefined) this.line = line;
  }
}

/**
 * FNV-1a, 32-bit variant: offset basis 2166136261 (0x811c9dc5), prime
 * 16777619 (2^24 + 2^8 + 0x93). Hashes the UTF-8 bytes of `text`. Matches
 * the published test vectors in this package's own test file, fetched
 * live rather than typed from memory. Written by hand for this package
 * (D-56); the algorithm is the same published one every FNV-1a
 * implementation follows, not a copy of any other folder's file.
 */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  const bytes = new TextEncoder().encode(text);
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * mulberry32: a small, fast, public-domain 32-bit generator. Returns a
 * function that yields successive 32-bit UNSIGNED INTEGERS, so an
 * independent implementation (this package's own test re-implements the
 * same steps with BigInt arithmetic) can compare raw outputs exactly.
 * Written by hand for this package (D-56) from the published algorithm,
 * not imported or copied from any other folder.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** Draws one fraction in [0, 1) from a raw mulberry32 output. */
function fraction(rng: () => number): number {
  return rng() / 4294967296;
}

/** Draws an integer in [min, max], inclusive on both ends. */
function drawInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(fraction(rng) * (max - min + 1));
}

function pick<T>(rng: () => number, list: readonly T[]): T {
  return list[Math.floor(fraction(rng) * list.length)]!;
}

/** Bytes drawn four at a time from `rng`'s own 32-bit output, big-endian, trimmed to `n`. */
function randomBytes(rng: () => number, n: number): number[] {
  const bytes: number[] = [];
  while (bytes.length < n) {
    const v = rng();
    bytes.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
  }
  return bytes.slice(0, n);
}

const HEX_DIGITS = '0123456789abcdef'.split('');

/** Two lowercase hex characters for one byte, built from a fixed lookup table rather than a built-in number-to-string conversion. */
function hexByte(byte: number): string {
  return HEX_DIGITS[(byte >> 4) & 0xf]! + HEX_DIGITS[byte & 0xf]!;
}

function hexBytes(bytes: number[]): string {
  return bytes.map(hexByte).join('');
}

function capitalise(word: string): string {
  return word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1);
}

/** A two-digit, zero-padded string for a number already known to be in [0, 99]. */
function twoDigits(n: number): string {
  return (n < 10 ? '0' : '') + String(n);
}

// --- Civil calendar day arithmetic --------------------------------------
//
// Ported by hand from the published days_from_civil / civil_from_days
// algorithms (see this package's own test file for the fetched source and
// citation). Counts days since 1970-01-01, so a date never touches the
// host's own idea of the current day or its local time zone.

function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/** Days since 1970-01-01 for a proleptic Gregorian y/m/d triple (m in [1,12], d valid for that month). */
export function daysFromCivil(y: number, m: number, d: number): number {
  const yy = y - (m <= 2 ? 1 : 0);
  const era = floorDiv(yy >= 0 ? yy : yy - 399, 400);
  const yoe = yy - era * 400; // [0, 399]
  const doy = floorDiv(153 * (m > 2 ? m - 3 : m + 9) + 2, 5) + d - 1; // [0, 365]
  const doe = yoe * 365 + floorDiv(yoe, 4) - floorDiv(yoe, 100) + doy; // [0, 146096]
  return era * 146097 + doe - 719468;
}

/** The inverse of `daysFromCivil`: the proleptic Gregorian y/m/d triple for a day count since 1970-01-01. */
export function civilFromDays(z: number): { y: number; m: number; d: number } {
  const zz = z + 719468;
  const era = floorDiv(zz >= 0 ? zz : zz - 146096, 146097);
  const doe = zz - era * 146097; // [0, 146096]
  const yoe = floorDiv(doe - floorDiv(doe, 1460) + floorDiv(doe, 36524) - floorDiv(doe, 146096), 365); // [0, 399]
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + floorDiv(yoe, 4) - floorDiv(yoe, 100)); // [0, 365]
  const mp = floorDiv(5 * doy + 2, 153); // [0, 11]
  const d = doy - floorDiv(153 * mp + 2, 5) + 1; // [1, 31]
  const m = mp < 10 ? mp + 3 : mp - 9; // [1, 12]
  return { y: y + (m <= 2 ? 1 : 0), m, d };
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDate(spec: string, label: string, line: number): { y: number; m: number; d: number } {
  const match = DATE_PATTERN.exec(spec.trim());
  if (!match) throw new MockDataError(`${label} must be a date written as YYYY-MM-DD, not "${spec}".`, line);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function formatDate(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${twoDigits(m)}-${twoDigits(d)}`;
}

/** A decimal string built from an integer numerator and a fixed number of places, never from a built-in float-to-string conversion. */
function formatDecimal(scaledInt: number, places: number): string {
  const negative = scaledInt < 0;
  const digits = String(Math.abs(scaledInt)).padStart(places + 1, '0');
  const intPart = digits.slice(0, digits.length - places) || '0';
  const fracPart = places > 0 ? '.' + digits.slice(digits.length - places) : '';
  return (negative ? '-' : '') + intPart + fracPart;
}

// --- Field kinds ----------------------------------------------------------

/** Every field kind this package understands. */
export const FIELD_KINDS = [
  'id',
  'uuid',
  'firstName',
  'lastName',
  'fullName',
  'email',
  'username',
  'company',
  'city',
  'street',
  'word',
  'sentence',
  'boolean',
  'integer',
  'decimal',
  'date',
  'datetime',
  'ipv4',
  'url',
  'color',
  'oneOf',
] as const;

export type FieldKind = (typeof FIELD_KINDS)[number];

interface FieldDef {
  name: string;
  kind: FieldKind;
  args: string[];
  line: number;
}

export interface ParsedFieldSpec {
  fields: FieldDef[];
}

/** One field's rendered value: `raw` distinguishes a bare JSON number/boolean literal from a quoted string. */
interface FieldValue {
  name: string;
  text: string;
  raw: boolean;
}

const KIND_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)(?:\(([\s\S]*)\))?$/;

/**
 * Reads one field per line as `name: kind` or `name: kind(arg, arg)`,
 * skipping blank lines and lines starting with `#`. Throws `MockDataError`
 * naming the line for an unknown kind, a bad argument, or a duplicate
 * field name.
 */
export function parseFieldSpec(text: string): ParsedFieldSpec {
  const lines = text.split(/\r\n|\r|\n/);
  const fields: FieldDef[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const rawLine = lines[i]!;
    const trimmed = rawLine.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const colonAt = trimmed.indexOf(':');
    if (colonAt < 0) {
      throw new MockDataError(`Line ${lineNumber} must be written as "name: kind", but has no colon.`, lineNumber);
    }
    const name = trimmed.slice(0, colonAt).trim();
    const kindSpec = trimmed.slice(colonAt + 1).trim();
    if (name === '') throw new MockDataError(`Line ${lineNumber} has no field name before the colon.`, lineNumber);
    if (seen.has(name))
      throw new MockDataError(`Field name "${name}" on line ${lineNumber} is a duplicate.`, lineNumber);

    const kindMatch = KIND_PATTERN.exec(kindSpec);
    if (!kindMatch) {
      throw new MockDataError(`Line ${lineNumber} has an unrecognised field kind "${kindSpec}".`, lineNumber);
    }
    const kindName = kindMatch[1]!;
    const argsText = kindMatch[2];
    if (!(FIELD_KINDS as readonly string[]).includes(kindName)) {
      throw new MockDataError(`Unknown field kind "${kindName}" on line ${lineNumber}.`, lineNumber);
    }
    const kind = kindName as FieldKind;
    const separator = kind === 'oneOf' ? '|' : ',';
    const args = argsText === undefined ? [] : argsText.split(separator).map((s) => s.trim());

    seen.add(name);
    fields.push({ name, kind, args, line: lineNumber });
  }

  return { fields };
}

function requireArgCount(field: FieldDef, count: number): void {
  if (field.args.length !== count) {
    throw new MockDataError(
      `"${field.kind}" on line ${field.line} needs ${count} argument${count === 1 ? '' : 's'}, got ${field.args.length}.`,
      field.line,
    );
  }
}

function requireInt(value: string, label: string, line: number): number {
  const n = Number(value);
  if (!Number.isInteger(n))
    throw new MockDataError(`${label} on line ${line} must be a whole number, not "${value}".`, line);
  return n;
}

/**
 * Generates one field's value for one record. Draws exactly the random
 * numbers this kind needs from `rng`, in a fixed order, so the same seed
 * always produces the same sequence for the same field list.
 */
function generateField(field: FieldDef, rng: () => number, recordIndex: number): FieldValue {
  const { name, kind, args, line } = field;

  switch (kind) {
    case 'id':
      return { name, text: String(recordIndex + 1), raw: true };

    case 'uuid': {
      const bytes = randomBytes(rng, 16);
      bytes[6] = (bytes[6]! & 0x0f) | 0x40; // RFC 9562 §5.4: version nibble
      bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 9562 §4.1: variant bits 10
      const hex = hexBytes(bytes);
      const text = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
      return { name, text, raw: false };
    }

    case 'firstName':
      return { name, text: pick(rng, FIRST_NAMES), raw: false };

    case 'lastName':
      return { name, text: pick(rng, LAST_NAMES), raw: false };

    case 'fullName': {
      const first = pick(rng, FIRST_NAMES);
      const last = pick(rng, LAST_NAMES);
      return { name, text: `${first} ${last}`, raw: false };
    }

    case 'email': {
      const first = pick(rng, FIRST_NAMES).toLowerCase();
      const last = pick(rng, LAST_NAMES)
        .toLowerCase()
        .replace(/[^a-z]/g, '');
      const suffix = twoDigits(drawInt(rng, 0, 99));
      const domain = pick(rng, EXAMPLE_DOMAINS);
      return { name, text: `${first}.${last}${suffix}@${domain}`, raw: false };
    }

    case 'username': {
      const word = pick(rng, WORDS).toLowerCase();
      const suffix = twoDigits(drawInt(rng, 0, 99));
      return { name, text: `${word}${suffix}`, raw: false };
    }

    case 'company': {
      const word = capitalise(pick(rng, WORDS));
      const suffix = pick(rng, COMPANY_SUFFIXES);
      return { name, text: `${word} ${suffix}`, raw: false };
    }

    case 'city':
      return { name, text: pick(rng, CITIES), raw: false };

    case 'street': {
      const number = drawInt(rng, 1, 9999);
      const street = pick(rng, STREET_NAMES);
      const suffix = pick(rng, STREET_SUFFIXES);
      return { name, text: `${number} ${street} ${suffix}`, raw: false };
    }

    case 'word':
      return { name, text: pick(rng, WORDS), raw: false };

    case 'sentence': {
      const count = drawInt(rng, 5, 10);
      const words = Array.from({ length: count }, () => pick(rng, WORDS));
      const text = `${capitalise(words[0]!)} ${words.slice(1).join(' ')}.`;
      return { name, text, raw: false };
    }

    case 'boolean':
      return { name, text: fraction(rng) < 0.5 ? 'true' : 'false', raw: true };

    case 'integer': {
      requireArgCount(field, 2);
      const min = requireInt(args[0]!, 'integer min', line);
      const max = requireInt(args[1]!, 'integer max', line);
      if (max < min) throw new MockDataError(`integer on line ${line} has max less than min.`, line);
      return { name, text: String(drawInt(rng, min, max)), raw: true };
    }

    case 'decimal': {
      requireArgCount(field, 3);
      const min = Number(args[0]);
      const max = Number(args[1]);
      const places = requireInt(args[2]!, 'decimal places', line);
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        throw new MockDataError(`decimal on line ${line} has a min or max that is not a number.`, line);
      }
      if (max < min) throw new MockDataError(`decimal on line ${line} has max less than min.`, line);
      if (places < 0) throw new MockDataError(`decimal on line ${line} needs a non-negative places argument.`, line);
      const scale = Math.pow(10, places);
      const minScaled = Math.round(min * scale);
      const maxScaled = Math.round(max * scale);
      const scaled = drawInt(rng, minScaled, maxScaled);
      return { name, text: formatDecimal(scaled, places), raw: true };
    }

    case 'date': {
      requireArgCount(field, 2);
      const from = parseDate(args[0]!, 'date from', line);
      const to = parseDate(args[1]!, 'date to', line);
      const fromDays = daysFromCivil(from.y, from.m, from.d);
      const toDays = daysFromCivil(to.y, to.m, to.d);
      if (toDays < fromDays) throw new MockDataError(`date on line ${line} has "to" before "from".`, line);
      const day = drawInt(rng, fromDays, toDays);
      const civil = civilFromDays(day);
      return { name, text: formatDate(civil.y, civil.m, civil.d), raw: false };
    }

    case 'datetime': {
      requireArgCount(field, 2);
      const from = parseDate(args[0]!, 'datetime from', line);
      const to = parseDate(args[1]!, 'datetime to', line);
      const fromDays = daysFromCivil(from.y, from.m, from.d);
      const toDays = daysFromCivil(to.y, to.m, to.d);
      if (toDays < fromDays) throw new MockDataError(`datetime on line ${line} has "to" before "from".`, line);
      const day = drawInt(rng, fromDays, toDays);
      const secondOfDay = drawInt(rng, 0, 86399);
      const civil = civilFromDays(day);
      const h = Math.floor(secondOfDay / 3600);
      const m = Math.floor((secondOfDay % 3600) / 60);
      const s = secondOfDay % 60;
      const text = `${formatDate(civil.y, civil.m, civil.d)}T${twoDigits(h)}:${twoDigits(m)}:${twoDigits(s)}Z`;
      return { name, text, raw: false };
    }

    case 'ipv4': {
      // RFC 5737 TEST-NET-1/2/3: 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24.
      const blocks = ['192.0.2.', '198.51.100.', '203.0.113.'];
      const block = pick(rng, blocks);
      const host = drawInt(rng, 0, 255);
      return { name, text: `${block}${host}`, raw: false };
    }

    case 'url': {
      const first = pick(rng, WORDS).toLowerCase();
      const second = pick(rng, WORDS).toLowerCase();
      const domain = pick(rng, EXAMPLE_DOMAINS);
      return { name, text: `https://www.${domain}/${first}-${second}`, raw: false };
    }

    case 'color': {
      const bytes = randomBytes(rng, 3);
      return { name, text: `#${hexBytes(bytes)}`, raw: false };
    }

    case 'oneOf': {
      if (args.length === 0 || args.every((a) => a === '')) {
        throw new MockDataError(`oneOf on line ${line} needs at least one option.`, line);
      }
      return { name, text: pick(rng, args), raw: false };
    }

    /* istanbul ignore next -- FIELD_KINDS is exhaustive; kept for a future kind added without a case here. */
    default: {
      const exhaustive: never = kind;
      throw new MockDataError(`Unknown field kind "${String(exhaustive)}" on line ${line}.`, line);
    }
  }
}

export type MockDataFormat = 'json' | 'jsonl' | 'csv';

export interface GenerateMockDataOptions {
  seed: string;
  /** Field spec text, one field per line (see `parseFieldSpec`). */
  fields: string;
  /** An integer from 1 to 1000. */
  count: number;
  format: MockDataFormat;
}

export interface GenerateMockDataResult {
  output: string;
  records: number;
  fields: number;
}

function fieldLine(field: FieldValue): string {
  return `${JSON.stringify(field.name)}: ${field.raw ? field.text : JSON.stringify(field.text)}`;
}

function recordBlock(fields: FieldValue[]): string {
  const lines = fields.map((f) => '    ' + fieldLine(f));
  return '  {\n' + lines.join(',\n') + '\n  }';
}

function formatJsonArray(records: FieldValue[][]): string {
  if (records.length === 0) return '[]';
  return '[\n' + records.map(recordBlock).join(',\n') + '\n]';
}

function recordCompact(fields: FieldValue[]): string {
  return (
    '{' + fields.map((f) => `${JSON.stringify(f.name)}:${f.raw ? f.text : JSON.stringify(f.text)}`).join(',') + '}'
  );
}

function formatJsonl(records: FieldValue[][]): string {
  return records.map(recordCompact).join('\n');
}

function formatCsvRecords(fieldNames: string[], records: FieldValue[][]): string {
  const rows = records.map((record) => record.map((f) => f.text));
  return formatCsv([fieldNames, ...rows]);
}

/**
 * Generates deterministic fake records. The same `seed`, `fields` and
 * `count` always give byte-identical output, on every run and in every
 * browser: one `mulberry32(fnv1a32(seed))` stream is seeded once and every
 * field of every record draws from it in field-declaration order, so
 * earlier records never depend on how many records were asked for.
 * Throws `MockDataError` for a field spec problem or a `count` outside
 * [1, 1000].
 */
export function generateMockData(options: GenerateMockDataOptions): GenerateMockDataResult {
  const { seed, count, format } = options;
  if (!Number.isInteger(count) || count < 1 || count > 1000) {
    throw new MockDataError(`count must be a whole number from 1 to 1000, not "${count}".`);
  }

  const { fields } = parseFieldSpec(options.fields);
  if (fields.length === 0) throw new MockDataError('At least one field is needed.');

  const rng = mulberry32(fnv1a32(seed));
  const records: FieldValue[][] = [];
  for (let i = 0; i < count; i++) {
    records.push(fields.map((field) => generateField(field, rng, i)));
  }

  const output =
    format === 'json'
      ? formatJsonArray(records)
      : format === 'jsonl'
        ? formatJsonl(records)
        : formatCsvRecords(
            fields.map((f) => f.name),
            records,
          );

  return { output, records: count, fields: fields.length };
}

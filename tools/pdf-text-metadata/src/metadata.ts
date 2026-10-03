/**
 * The document information dictionary and the XMP properties of a PDF, as rows a page can show.
 *
 * ISO 32000-1:2008 section 14.3.3 and Table 317 define the document information dictionary: Title, Author, Subject,
 * Keywords, Creator, Producer, CreationDate, ModDate and Trapped, plus any other key a producer adds. Section 7.9.4
 * defines the date format `D:YYYYMMDDHHmmSSOHH'mm'`. Section 14.3.2 defines metadata streams, whose XMP packet PDF.js
 * parses into properties.
 *
 * Every value that came from a file goes through `visible` and is cut at 1,000 characters; every lookup in an object
 * that came from a file is `Object.hasOwn`, so a key named like a member of Object.prototype is a key and nothing more.
 */
import { MAX_ROWS, MAX_VALUE_CHARS, head, visible } from './shared';

/** The keys of Table 317 in the order the standard lists them. */
export const INFO_KEYS = [
  'Title',
  'Author',
  'Subject',
  'Keywords',
  'Creator',
  'Producer',
  'CreationDate',
  'ModDate',
  'Trapped',
] as const;

export interface MetadataRows {
  info: [string, string][];
  xmp: [string, string][];
  /** Plain sentences about rows that were left out. */
  notes: string[];
}

const STANDARD = new Set<string>(INFO_KEYS);

/** Members PDF.js adds to the information object itself; they describe the document and are not Info keys. */
const COMPUTED = new Set([
  'PDFFormatVersion',
  'Language',
  'EncryptFilterName',
  'IsLinearized',
  'IsAcroFormPresent',
  'IsXFAPresent',
  'IsCollectionPresent',
  'IsSignaturesPresent',
  'Custom',
]);

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

/** The number written as exactly `count` digits at `at`, or null. */
function digits(text: string, at: number, count: number): number | null {
  if (at + count > text.length) return null;
  let value = 0;
  for (let i = 0; i < count; i++) {
    const code = text.charCodeAt(at + i);
    if (!isDigit(code)) return null;
    value = value * 10 + (code - 0x30);
  }
  return value;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function two(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * A PDF date (`D:YYYYMMDDHHmmSSOHH'mm'`, every part after the year optional) as ISO 8601, or null when the text is not a
 * valid date. Missing parts are the start of the year, month, day, hour, minute or second. The offset is kept as written:
 * `Z`, or a sign with hours and minutes.
 */
export function pdfDateToIso(raw: string): string | null {
  if (raw.charCodeAt(0) !== 0x44 || raw.charCodeAt(1) !== 0x3a) return null;
  const year = digits(raw, 2, 4);
  if (year === null) return null;
  let at = 6;
  const parts = [1, 1, 0, 0, 0];
  for (let i = 0; i < parts.length; i++) {
    if (at >= raw.length || !isDigit(raw.charCodeAt(at))) break;
    const value = digits(raw, at, 2);
    if (value === null) return null;
    parts[i] = value;
    at += 2;
  }
  const [month, day, hour, minute, second] = parts as [number, number, number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  const apostrophe = String.fromCharCode(39);
  let zone = '';
  if (at < raw.length) {
    const sign = raw[at]!;
    at++;
    if (sign === 'Z') {
      zone = 'Z';
      // The zero offset may be written out after the Z.
      if (at < raw.length) {
        if (digits(raw, at, 2) !== 0) return null;
        at += 2;
        if (raw[at] === apostrophe) at++;
        if (at < raw.length) {
          if (digits(raw, at, 2) !== 0) return null;
          at += 2;
          if (raw[at] === apostrophe) at++;
        }
      }
    } else if (sign === '+' || sign === '-') {
      const zoneHours = digits(raw, at, 2);
      if (zoneHours === null || zoneHours > 23) return null;
      at += 2;
      if (raw[at] === apostrophe) at++;
      let zoneMinutes = 0;
      if (at < raw.length) {
        const value = digits(raw, at, 2);
        if (value === null || value > 59) return null;
        zoneMinutes = value;
        at += 2;
        if (raw[at] === apostrophe) at++;
      }
      zone = `${sign}${two(zoneHours)}:${two(zoneMinutes)}`;
    } else {
      return null;
    }
    if (at < raw.length) return null;
  }
  return `${String(year).padStart(4, '0')}-${two(month)}-${two(day)}T${two(hour)}:${two(minute)}:${two(second)}${zone}`;
}

/** The text of a value PDF.js reports: a string, a number, a flag, a name object, or a list of these. */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(textOf).join(', ');
  if (typeof value === 'object' && value !== null && Object.hasOwn(value, 'name')) {
    const name = (value as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return '';
}

/** A value ready to show: cut at 1,000 characters (with the cut said) and written with every control character escaped. */
function shown(text: string): string {
  if (text.length <= MAX_VALUE_CHARS) return visible(text);
  return `${visible(head(text, MAX_VALUE_CHARS))} [cut at 1,000 characters]`;
}

function byKey(a: [string, unknown], b: [string, unknown]): number {
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
}

/** The custom keys of an information object: PDF.js's `Custom` map (or a plain object) and any other own key. */
function customEntries(info: Record<string, unknown>): [string, unknown][] {
  const merged = new Map<string, unknown>();
  if (Object.hasOwn(info, 'Custom')) {
    const custom = info.Custom;
    if (custom instanceof Map) {
      for (const [key, value] of custom) merged.set(String(key), value);
    } else if (typeof custom === 'object' && custom !== null) {
      for (const key of Object.keys(custom)) merged.set(key, (custom as Record<string, unknown>)[key]);
    }
  }
  for (const key of Object.keys(info)) {
    if (!STANDARD.has(key) && !COMPUTED.has(key)) merged.set(key, info[key]);
  }
  return [...merged.entries()].sort(byKey);
}

/**
 * Rows for the information dictionary (the nine standard keys in the order of Table 317, then custom keys sorted) and for
 * the XMP properties (sorted by name). Dates are shown as written and as ISO 8601. At most 200 custom keys and 200 XMP
 * properties are listed, and a note says how many were left out. `info` is what PDF.js's `getMetadata` returns as
 * `info`; `xmp` is its `metadata` object, or any iterable of name and value pairs, or null when the file has no XMP.
 */
export function describeMetadata(info: Record<string, unknown>, xmp: Iterable<[string, unknown]> | null): MetadataRows {
  const rows: MetadataRows = { info: [], xmp: [], notes: [] };

  for (const key of INFO_KEYS) {
    if (!Object.hasOwn(info, key)) continue;
    const value = info[key];
    if (value === undefined || value === null) continue;
    let row = shown(textOf(value));
    if ((key === 'CreationDate' || key === 'ModDate') && typeof value === 'string') {
      const iso = pdfDateToIso(value);
      if (iso !== null) row = `${row} (${iso})`;
    }
    rows.info.push([key, row]);
  }

  const custom = customEntries(info);
  for (const [key, value] of custom.slice(0, MAX_ROWS)) rows.info.push([shown(key), shown(textOf(value))]);
  if (custom.length > MAX_ROWS) {
    const left = custom.length - MAX_ROWS;
    rows.notes.push(`${left} more custom ${left === 1 ? 'key is' : 'keys are'} not shown.`);
  }

  if (xmp !== null) {
    const properties: [string, unknown][] = [];
    for (const [key, value] of xmp) properties.push([String(key), value]);
    properties.sort(byKey);
    for (const [key, value] of properties.slice(0, MAX_ROWS)) rows.xmp.push([shown(key), shown(textOf(value))]);
    if (properties.length > MAX_ROWS) {
      const left = properties.length - MAX_ROWS;
      rows.notes.push(`${left} more XMP ${left === 1 ? 'property is' : 'properties are'} not shown.`);
    }
  }
  return rows;
}

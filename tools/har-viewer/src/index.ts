import meta from './meta.json';
import { parseJsonText } from './json-text';

export { meta };

export class HarViewerError extends Error {
  readonly path?: string;
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { path?: string; line?: number; column?: number } = {}) {
    super(message);
    this.name = 'HarViewerError';
    this.path = detail.path;
    this.line = detail.line;
    this.column = detail.column;
  }
}

/** The largest recording read: 50 MiB. */
export const MAX_FILE_BYTES = 52428800;
/** The most requests listed from one recording; the rest are counted and not listed. */
export const MAX_ENTRIES = 20000;
/** Requests on one page of the list. */
export const PAGE_SIZE = 500;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One listed request: its 1-based position in the recording and the entry object as the recording holds it. */
export interface HarEntry {
  index: number;
  raw: JsonObject;
}

/** A recording read into memory. */
export interface Har {
  /** `log.version`, or 1.1 when the recording leaves it empty (the specification's rule). */
  version: string;
  /** The name and version of the application that wrote the recording, or an empty text. */
  creator: string;
  /** How many entries the recording holds. */
  total: number;
  /** The first `MAX_ENTRIES` entries. */
  entries: HarEntry[];
  /** True when the recording holds more entries than are listed. */
  truncated: boolean;
}

export interface HarRequestRow {
  index: number;
  started: string;
  method: string;
  url: string;
  status: number;
  size: string;
  time: string;
  flags: number;
}

export interface ListOptions {
  filter: string;
  method: string;
  status: string;
  sort: 'start' | 'time' | 'size' | 'status';
  reveal: boolean;
  page: number;
}

export interface ListResult {
  rows: HarRequestRow[];
  /** How many requests match the filters, on every page. */
  total: number;
  /** How many rows this page holds. */
  shown: number;
}

// ---------------------------------------------------------------------------------------------------------------------
// Sizes

/** Refuses a size over the limit before anything is read. `subject` starts the sentence. */
export function checkFileSize(size: number, subject = 'This file'): void {
  if (size > MAX_FILE_BYTES) {
    throw new HarViewerError(
      `${subject} is ${size.toLocaleString('en-US')} bytes. The limit is 50 MiB (${MAX_FILE_BYTES.toLocaleString('en-US')} bytes) because the whole recording is held in the page while it is read.`,
    );
  }
}

/** How many bytes a text takes as UTF-8, counted without making the bytes. */
function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading

/** The version rule of the specification: a reader that supports HAR since 1.1 refuses a major other than 1 and a minor below 1. */
function readVersion(log: JsonObject): string {
  const raw = log.version;
  if (raw !== undefined && typeof raw !== 'string') {
    throw new HarViewerError('The version of the recording must be a text such as "1.2" (/log/version).', {
      path: '/log/version',
    });
  }
  const version = raw === undefined || raw.trim() === '' ? '1.1' : raw.trim();
  const parts = /^(\d+)\.(\d+)$/.exec(version);
  if (!parts || Number(parts[1]) !== 1 || Number(parts[2]) < 1) {
    throw new HarViewerError(
      `HAR version "${version}" cannot be read: this page reads version 1.1 and later 1.x versions (/log/version).`,
      { path: '/log/version' },
    );
  }
  return version;
}

function creatorOf(log: JsonObject): string {
  const creator = log.creator;
  if (!isObject(creator)) return '';
  const name = typeof creator.name === 'string' ? creator.name : '';
  const version = typeof creator.version === 'string' ? creator.version : '';
  return [name, version].filter((part) => part !== '').join(' ');
}

/**
 * Reads a recording from its text: JSON per RFC 8259 (a syntax error names its line and column), then the parts of
 * HAR 1.2 this page needs. Custom fields (names that start with an underscore) are never looked at. A part that is
 * missing or of the wrong kind is refused with its RFC 6901 path.
 */
export function readHar(text: string): Har {
  if (text.length * 3 > MAX_FILE_BYTES) checkFileSize(utf8Length(text), 'This text');
  const parsed = parseJsonText(text);
  if (!parsed.ok) {
    throw new HarViewerError(parsed.message ?? 'The recording is not valid JSON.', {
      line: parsed.line,
      column: parsed.column,
    });
  }
  const root = parsed.value;
  if (!isObject(root) || !isObject(root.log)) {
    throw new HarViewerError('This is not a HAR recording: the top level must hold a "log" object (/log).', {
      path: '/log',
    });
  }
  const log = root.log;
  const version = readVersion(log);
  const list = log.entries;
  if (!Array.isArray(list)) {
    throw new HarViewerError(
      list === undefined
        ? 'The recording has no list of requests: /log/entries is missing.'
        : 'The list of requests must be an array: /log/entries is not.',
      { path: '/log/entries' },
    );
  }
  const entries: HarEntry[] = [];
  const count = Math.min(list.length, MAX_ENTRIES);
  for (let i = 0; i < count; i++) {
    const raw: unknown = list[i];
    const at = `/log/entries/${i}`;
    if (!isObject(raw)) throw new HarViewerError(`Entry ${i + 1} is not an object (${at}).`, { path: at });
    for (const part of ['request', 'response'] as const) {
      if (!isObject(raw[part])) {
        throw new HarViewerError(`Entry ${i + 1} has no "${part}" object (${at}/${part}).`, {
          path: `${at}/${part}`,
        });
      }
    }
    entries.push({ index: i + 1, raw });
  }
  return { version, creator: creatorOf(log), total: list.length, entries, truncated: list.length > MAX_ENTRIES };
}

// ---------------------------------------------------------------------------------------------------------------------
// The list

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * The size of a response: the size of the returned content when the recording has one, else the size of the body as
 * received. A size of -1 means the recording does not have it, and nothing is returned for it.
 */
function responseSize(response: JsonObject): number | undefined {
  const content = isObject(response.content) ? response.content : {};
  const size = numberOf(content.size);
  if (size !== undefined && size >= 0) return size;
  const body = numberOf(response.bodySize);
  if (body !== undefined && body >= 0) return body;
  return undefined;
}

/** The timings the specification adds up: ssl is part of connect, so it is not one of them. */
const SUMMED_TIMINGS = ['blocked', 'dns', 'connect', 'send', 'wait', 'receive'] as const;

/**
 * The total time of a request: "the sum of all timings available in the timings object (i.e. not including -1
 * values)". A request without timings uses the entry's own time field.
 */
function totalTime(raw: JsonObject): number | undefined {
  const timings = isObject(raw.timings) ? raw.timings : {};
  let sum = 0;
  let found = false;
  for (const name of SUMMED_TIMINGS) {
    const value = numberOf(timings[name]);
    if (value === undefined || value === -1) continue;
    sum += value;
    found = true;
  }
  if (found) return sum;
  const own = numberOf(raw.time);
  return own !== undefined && own >= 0 ? own : undefined;
}

function formatSize(size: number | undefined): string {
  return size === undefined ? 'unknown' : `${size.toLocaleString('en-US')} B`;
}

function formatTime(time: number | undefined): string {
  return time === undefined ? 'unknown' : String(Math.round(time * 1000) / 1000);
}

function rowOf(entry: HarEntry): HarRequestRow {
  const request = entry.raw.request as JsonObject;
  const response = entry.raw.response as JsonObject;
  return {
    index: entry.index,
    started: textOf(entry.raw.startedDateTime),
    method: textOf(request.method),
    url: textOf(request.url),
    status: numberOf(response.status) ?? 0,
    size: formatSize(responseSize(response)),
    time: formatTime(totalTime(entry.raw)),
    flags: 0,
  };
}

/** Lists the requests of a recording, one page of `PAGE_SIZE` rows. */
export function listRequests(har: Har, options: ListOptions): ListResult {
  const page = options.page;
  if (!Number.isInteger(page) || page < 1) {
    throw new HarViewerError('Page must be a whole number from 1 to 40.');
  }
  const matching = har.entries;
  const start = (page - 1) * PAGE_SIZE;
  const rows = matching.slice(start, start + PAGE_SIZE).map(rowOf);
  return { rows, total: matching.length, shown: rows.length };
}

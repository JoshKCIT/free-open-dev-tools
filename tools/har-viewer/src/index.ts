import meta from './meta.json';
import { parseJsonText } from './json-text';
import { isSensitive, maskBodyText, maskUrl, maskValue, type ValueKind } from './sensitive';

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
// Values of an entry

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function objectOf(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

/** The objects of an array the recording holds; anything else in it is skipped. */
function objectsOf(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

/**
 * The size of a response: the size of the returned content when the recording has one, else the size of the body as
 * received. A size of -1 means the recording does not have it, and nothing is returned for it.
 */
function responseSize(response: JsonObject): number | undefined {
  const size = numberOf(objectOf(response.content).size);
  if (size !== undefined && size >= 0) return size;
  const body = numberOf(response.bodySize);
  if (body !== undefined && body >= 0) return body;
  return undefined;
}

/** The timings the specification adds up: ssl is part of connect, so it is not one of them. */
const SUMMED_TIMINGS = ['blocked', 'dns', 'connect', 'send', 'wait', 'receive'] as const;

/**
 * The total time of a request: "the sum of all timings available in the timings object (i.e. not including -1
 * values)". A request whose timings object holds none of the timings uses the entry's own time field.
 */
function totalTime(raw: JsonObject): number | undefined {
  const timings = objectOf(raw.timings);
  let sum = 0;
  let present = false;
  for (const name of SUMMED_TIMINGS) {
    const value = numberOf(timings[name]);
    if (value === undefined) continue;
    present = true;
    if (value !== -1) sum += value;
  }
  if (present) return sum;
  const own = numberOf(raw.time);
  return own !== undefined && own >= 0 ? own : undefined;
}

function formatSize(size: number | undefined): string {
  return size === undefined ? 'unknown' : `${size.toLocaleString('en-US')} B`;
}

function formatTime(time: number | undefined): string {
  return time === undefined ? 'unknown' : String(Math.round(time * 1000) / 1000);
}

/** A name and value as the page shows them: masked unless revealed, and whether the rules flagged it. */
export interface NameValue {
  name: string;
  value: string;
  sensitive: boolean;
}

/** A cookie: its name and masked value, and its other attributes as text. */
export interface CookieRow extends NameValue {
  details: string;
}

function pairOf(kind: ValueKind, item: JsonObject, reveal: boolean): NameValue {
  const name = textOf(item.name);
  const value = textOf(item.value);
  const sensitive = isSensitive(kind, name, value);
  return { name, value: sensitive && !reveal ? maskValue(value, name) : value, sensitive };
}

function cookieOf(item: JsonObject, reveal: boolean): CookieRow {
  const base = pairOf('cookie', item, reveal);
  const details: string[] = [];
  if (textOf(item.path) !== '') details.push(`Path=${textOf(item.path)}`);
  if (textOf(item.domain) !== '') details.push(`Domain=${textOf(item.domain)}`);
  if (textOf(item.expires) !== '') details.push(`Expires=${textOf(item.expires)}`);
  if (item.httpOnly === true) details.push('HttpOnly');
  if (item.secure === true) details.push('Secure');
  return { ...base, details: details.join('; ') };
}

/** How many values of a list the rules flag. */
function countFlagged(kind: ValueKind, items: JsonObject[]): number {
  let count = 0;
  for (const item of items) if (isSensitive(kind, textOf(item.name), textOf(item.value))) count++;
  return count;
}

/**
 * How many sensitive values an entry holds in its headers, cookies, parameters and address. The parameters of the
 * address are counted only when the entry has no query list of its own, because the list repeats them.
 */
function flagCount(raw: JsonObject): number {
  const request = objectOf(raw.request);
  const response = objectOf(raw.response);
  const query = objectsOf(request.queryString);
  const address = maskUrl(textOf(request.url));
  return (
    countFlagged('header', objectsOf(request.headers)) +
    countFlagged('cookie', objectsOf(request.cookies)) +
    countFlagged('param', query) +
    countFlagged('param', objectsOf(objectOf(request.postData).params)) +
    countFlagged('header', objectsOf(response.headers)) +
    countFlagged('cookie', objectsOf(response.cookies)) +
    address.userinfo +
    (query.length === 0 ? address.params : 0)
  );
}

/** The address as shown: masked unless the visitor asked to see sensitive values. */
function shownUrl(url: string, reveal: boolean): string {
  return reveal ? url : maskUrl(url).url;
}

// ---------------------------------------------------------------------------------------------------------------------
// The list

type StatusFilter = { exact: number } | { digit: number } | undefined;

/** A status filter: blank for any, a whole code (404) or a class (4xx). */
function parseStatusFilter(text: string): StatusFilter {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  if (/^\d{1,3}$/.test(trimmed)) return { exact: Number(trimmed) };
  if (/^\dxx$/i.test(trimmed)) return { digit: Number(trimmed[0]) };
  throw new HarViewerError('Status must be a number such as 404 or a class such as 4xx.');
}

function statusOf(raw: JsonObject): number {
  return numberOf(objectOf(raw.response).status) ?? 0;
}

function rowOf(entry: HarEntry, reveal: boolean): HarRequestRow {
  const request = objectOf(entry.raw.request);
  const response = objectOf(entry.raw.response);
  return {
    index: entry.index,
    started: textOf(entry.raw.startedDateTime),
    method: textOf(request.method),
    url: shownUrl(textOf(request.url), reveal),
    status: statusOf(entry.raw),
    size: formatSize(responseSize(response)),
    time: formatTime(totalTime(entry.raw)),
    flags: flagCount(entry.raw),
  };
}

/** Sort keys, largest first for time and size and lowest first for status; a missing value goes last. */
const SORTS: Record<string, (raw: JsonObject) => number> = {
  time: (raw) => -(totalTime(raw) ?? -Infinity),
  size: (raw) => -(responseSize(objectOf(raw.response)) ?? -Infinity),
  status: (raw) => statusOf(raw),
};

/**
 * Lists the requests of a recording, one page of `PAGE_SIZE` rows. The list keeps the order of the recording, which
 * the specification prefers to be by start time; sorting by time, size or status is stable, so requests with equal
 * keys keep their recording order. The address filter looks at the address as it is shown.
 */
export function listRequests(har: Har, options: ListOptions): ListResult {
  const page = options.page;
  if (!Number.isInteger(page) || page < 1) {
    throw new HarViewerError('Page must be a whole number from 1 to 40.');
  }
  const sort = options.sort as string;
  if (sort !== 'start' && !Object.prototype.hasOwnProperty.call(SORTS, sort)) {
    throw new HarViewerError('Sort by must be one of start, time, size or status.');
  }
  const status = parseStatusFilter(options.status);
  const method = options.method.trim().toUpperCase();
  const needle = options.filter.toLowerCase();

  let matching = har.entries.filter((entry) => {
    const request = objectOf(entry.raw.request);
    if (method !== '' && textOf(request.method).toUpperCase() !== method) return false;
    if (status !== undefined) {
      const code = statusOf(entry.raw);
      if ('exact' in status ? code !== status.exact : Math.floor(code / 100) !== status.digit) return false;
    }
    if (needle !== '' && !shownUrl(textOf(request.url), options.reveal).toLowerCase().includes(needle)) return false;
    return true;
  });
  if (sort !== 'start') {
    const key = SORTS[sort]!;
    const keyed = matching.map((entry) => ({ entry, key: key(entry.raw) }));
    keyed.sort((a, b) => (a.key === b.key ? a.entry.index - b.entry.index : a.key < b.key ? -1 : 1));
    matching = keyed.map((item) => item.entry);
  }

  const start = (page - 1) * PAGE_SIZE;
  const rows = matching.slice(start, start + PAGE_SIZE).map((entry) => rowOf(entry, options.reveal));
  return { rows, total: matching.length, shown: rows.length };
}

// ---------------------------------------------------------------------------------------------------------------------
// One request

/** The most characters of a body that are shown; a longer body is cut with a note. */
export const MAX_BODY_CHARS = 102400;
/** How far a cut may move on to keep a credential or a quoted value whole. */
const CUT_EXTENSION = 4096;

/** The detail of one request, as the page shows it. */
export interface RequestDetail {
  index: number;
  /** The start time as the recording writes it. */
  started: string;
  method: string;
  url: string;
  httpVersion: string;
  headers: NameValue[];
  query: NameValue[];
  cookies: CookieRow[];
  postData?: { mimeType: string; params: NameValue[]; text?: string; note?: string };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    headers: NameValue[];
    cookies: CookieRow[];
    mimeType: string;
    size: string;
    redirectURL: string;
  };
  /** The response body as text, when bodies were asked for and the body can be shown. */
  body?: string;
  /** Why there is no body, or that it was cut. */
  bodyNote?: string;
  timings: [string, string][];
  flags: number;
}

/** A character that can be part of a credential or a form value: the b64token alphabet of RFC 6750 without its padding. */
function isRunCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9._~+/-]/.test(character);
}

/** How many characters (code points) a text holds. */
function characterCount(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) i++;
    count++;
  }
  return count;
}

/**
 * Where to cut a long text: at `MAX_BODY_CHARS`, moved on to the end of a credential (a JWT, a Bearer value or a form
 * value) or of a quoted string that the cut would split, so no part of a secret is shown unmasked, and never inside a
 * surrogate pair.
 */
function cutPoint(text: string): number {
  let end = MAX_BODY_CHARS;
  const limit = Math.min(text.length, end + CUT_EXTENSION);
  // The cut is inside a run of characters of a credential: it moves on to the end of the run (and its padding) when the
  // run is a JWT, a Bearer value or the value of a form field, and not for any other run of letters.
  if (isRunCharacter(text[end - 1]) && (isRunCharacter(text[end]) || text[end] === '=')) {
    let start = end - 1;
    const floor = Math.max(0, end - CUT_EXTENSION);
    while (start > floor && isRunCharacter(text[start - 1])) start--;
    const before = text.slice(Math.max(0, start - 16), start);
    if (text.startsWith('eyJ', start) || /bearer[ \t]+$/i.test(before) || before.endsWith('=')) {
      while (end < limit && (isRunCharacter(text[end]) || text[end] === '=')) end++;
    }
  }
  // The cut is inside a quoted string: it moves on to the closing quote.
  let inside = false;
  for (let i = 0; i < end; i++) {
    const character = text[i];
    if (character === '\\') i++;
    else if (character === '"') inside = !inside;
  }
  if (inside) {
    while (end < limit && text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
    if (text[end] === '"') end++;
  }
  end = Math.min(end, text.length);
  const last = text.charCodeAt(end - 1);
  if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
  return end;
}

/** Whether a MIME type is text this page shows (a blank type is tried as text). */
function isTextType(mimeType: string): boolean {
  const type = mimeType.split(';')[0]!.trim().toLowerCase();
  if (type === '') return true;
  return (
    type.startsWith('text/') ||
    /^application\/(?:[\w.-]+\+)?(?:json|xml|yaml)$/.test(type) ||
    /^application\/(?:x-)?(?:javascript|ecmascript|ndjson|yaml|www-form-urlencoded|graphql|sql)$/.test(type) ||
    type === 'image/svg+xml'
  );
}

function byteCount(bytes: number): string {
  return `${bytes.toLocaleString('en-US')} ${bytes === 1 ? 'byte' : 'bytes'}`;
}

/** A text cut for display and masked, with the note that says so. */
function displayText(full: string, mimeType: string, reveal: boolean): { text: string; note?: string } {
  const end = full.length <= MAX_BODY_CHARS ? full.length : cutPoint(full);
  // Nothing is left out when the cut moved on to the end of the text.
  if (end >= full.length) return { text: reveal ? full : maskBodyText(full, mimeType) };
  const shown = full.slice(0, end);
  return {
    text: reveal ? shown : maskBodyText(shown, mimeType),
    note: `The body is ${characterCount(full).toLocaleString('en-US')} characters long. The first ${characterCount(shown).toLocaleString('en-US')} are shown.`,
  };
}

/** The response body of an entry as text, or the reason it is not shown. */
function responseBody(content: JsonObject, reveal: boolean): { body?: string; note?: string } {
  const text = content.text;
  if (typeof text !== 'string') return { note: 'The recording holds no body for this response.' };
  const mimeType = textOf(content.mimeType);
  let full = text;
  if (textOf(content.encoding).toLowerCase() === 'base64') {
    const clean = text.replace(/\s+/g, '');
    const padding = /=*$/.exec(clean)![0].length;
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1) {
      return { note: 'The body is marked Base64 but is not valid Base64, so it is not shown.' };
    }
    const length = Math.floor(((clean.length - padding) * 3) / 4);
    if (!isTextType(mimeType)) return { note: `Binary body not shown (${byteCount(length)}).` };
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    try {
      full = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return { note: `Binary body not shown (${byteCount(length)}).` };
    }
  } else if (!isTextType(mimeType)) {
    const declared = numberOf(content.size);
    const length = declared !== undefined && declared >= 0 ? declared : new TextEncoder().encode(text).length;
    return { note: `Binary body not shown (${byteCount(length)}).` };
  }
  if (full === '') return { body: '', note: 'The body is empty.' };
  const shown = displayText(full, mimeType, reveal);
  return { body: shown.text, note: shown.note };
}

const PHASES: [string, string][] = [
  ['Blocked', 'blocked'],
  ['DNS', 'dns'],
  ['Connect', 'connect'],
  ['SSL', 'ssl'],
  ['Send', 'send'],
  ['Wait', 'wait'],
  ['Receive', 'receive'],
];

function timingsOf(raw: JsonObject): [string, string][] {
  const timings = objectOf(raw.timings);
  const rows: [string, string][] = PHASES.map(([label, key]) => {
    const value = numberOf(timings[key]);
    if (value === undefined) return [label, 'not recorded'];
    return [label, value === -1 ? 'not applicable' : `${formatTime(value)} ms`];
  });
  const total = totalTime(raw);
  rows.push(['Total', total === undefined ? 'unknown' : `${formatTime(total)} ms`]);
  return rows;
}

/**
 * Opens one request of the recording, by its 1-based position, with everything shown as text. Sensitive values are
 * masked unless `reveal` is true; bodies are included only when `bodies` is true.
 */
export function requestDetail(har: Har, index: number, options: { reveal: boolean; bodies: boolean }): RequestDetail {
  const entry = Number.isInteger(index) ? har.entries[index - 1] : undefined;
  if (entry === undefined) {
    throw new HarViewerError(
      `Request ${index} is not in this recording. It lists ${har.entries.length.toLocaleString('en-US')} requests, numbered from 1.`,
    );
  }
  const { reveal, bodies } = options;
  const request = objectOf(entry.raw.request);
  const response = objectOf(entry.raw.response);
  const content = objectOf(response.content);
  const post = isObject(request.postData) ? request.postData : undefined;

  const detail: RequestDetail = {
    index: entry.index,
    started: textOf(entry.raw.startedDateTime),
    method: textOf(request.method),
    url: shownUrl(textOf(request.url), reveal),
    httpVersion: textOf(request.httpVersion),
    headers: objectsOf(request.headers).map((item) => pairOf('header', item, reveal)),
    query: objectsOf(request.queryString).map((item) => pairOf('param', item, reveal)),
    cookies: objectsOf(request.cookies).map((item) => cookieOf(item, reveal)),
    response: {
      status: statusOf(entry.raw),
      statusText: textOf(response.statusText),
      httpVersion: textOf(response.httpVersion),
      headers: objectsOf(response.headers).map((item) => pairOf('header', item, reveal)),
      cookies: objectsOf(response.cookies).map((item) => cookieOf(item, reveal)),
      mimeType: textOf(content.mimeType),
      size: formatSize(responseSize(response)),
      redirectURL: shownUrl(textOf(response.redirectURL), reveal),
    },
    timings: timingsOf(entry.raw),
    flags: flagCount(entry.raw),
  };

  if (post) {
    const mimeType = textOf(post.mimeType);
    detail.postData = { mimeType, params: objectsOf(post.params).map((item) => pairOf('param', item, reveal)) };
    if (bodies && typeof post.text === 'string' && post.text !== '') {
      const shown = displayText(post.text, mimeType, reveal);
      detail.postData.text = shown.text;
      if (shown.note !== undefined) detail.postData.note = shown.note;
    }
  }
  if (bodies) {
    const shown = responseBody(content, reveal);
    if (shown.body !== undefined) detail.body = shown.body;
    if (shown.note !== undefined) detail.bodyNote = shown.note;
  }
  return detail;
}

import { explainError } from './errors-table';
import { PkceBuilderError } from './errors';
import { MAX_PARAMETERS, MAX_PASTE_CHARACTERS, MAX_URL_CHARACTERS, checkLength, withCommas } from './limits';
import { schemeOf } from './redirect-uri';
import { visible } from './visible';

export type Place = 'query' | 'fragment' | 'body';
export type RedirectForm = 'address' | 'query' | 'fragment' | 'form body';
export type NoteTone = 'success' | 'warn' | 'info';

/** One parameter of the pasted text, in the order written. A token-like value is held only as its masked text. */
export interface RedirectParameter {
  place: Place;
  name: string;
  /** The decoded value, or for a token the first characters and the length. */
  value: string;
  masked: boolean;
  /** The length of the decoded value in characters. */
  length: number;
}

/** A response parameter that was found: the first value, where it was, and how many times the name appears. */
export interface FoundItem {
  name: string;
  value: string;
  place: Place;
  count: number;
}

/** An access token or an ID token that is present, shown only as its first characters and its length. */
export interface TokenItem {
  name: string;
  value: string;
  place: Place;
  length: number;
}

export interface Note {
  tone: NoteTone;
  message: string;
}

export interface RedirectReport {
  form: RedirectForm;
  /** The places that held at least one parameter, query first. */
  readFrom: Place[];
  parameters: RedirectParameter[];
  found: FoundItem[];
  tokens: TokenItem[];
  error: { code: string; sentence: string; known: boolean } | null;
  notes: Note[];
}

/** What the page expects to come back; an empty or missing value means nothing is compared. */
export interface Expected {
  state?: string;
  issuer?: string;
}

/** The response parameters that are listed as found, in this order. */
const FOUND_NAMES: readonly string[] = [
  'code',
  'state',
  'error',
  'error_description',
  'error_uri',
  'iss',
  'session_state',
];

/** Names whose values are shown only as their first characters and their length. */
const MASKED_NAMES: ReadonlySet<string> = new Set([
  'access_token',
  'id_token',
  'refresh_token',
  'client_secret',
  'code_verifier',
  'password',
  'assertion',
  'token',
]);

const TOKEN_NAMES: readonly string[] = ['access_token', 'id_token'];

/** The first characters (at most 4, never more than half) and the length of a value; never the whole value. */
function maskValue(value: string): string {
  const points = Array.from(value);
  const length = points.length;
  if (length === 0) return '(empty)';
  const keep = Math.min(4, Math.floor(length / 2));
  const size = length === 1 ? '1 character' : `${length} characters`;
  return `${points.slice(0, keep).join('')}... (${size})`;
}

function hexValue(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
}

function pushUtf8(bytes: number[], point: number): void {
  const code = point >= 0xd800 && point <= 0xdfff ? 0xfffd : point;
  if (code < 0x80) bytes.push(code);
  else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
  else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
}

/**
 * Reads one name or value the way application/x-www-form-urlencoded does (RFC 6749 appendix B): a plus sign is a space,
 * then each %XX is a byte, and the bytes are read as UTF-8. A percent sign not followed by two hex digits stays as it is.
 */
function decodeComponent(raw: string): string {
  const spaced = raw.indexOf('+') >= 0 ? raw.split('+').join(' ') : raw;
  if (spaced.indexOf('%') < 0) return spaced;
  const bytes: number[] = [];
  for (let i = 0; i < spaced.length; i++) {
    const code = spaced.charCodeAt(i);
    if (code === 37 && i + 2 < spaced.length) {
      const high = hexValue(spaced.charCodeAt(i + 1));
      const low = hexValue(spaced.charCodeAt(i + 2));
      if (high >= 0 && low >= 0) {
        bytes.push(high * 16 + low);
        i += 2;
        continue;
      }
    }
    const point = spaced.codePointAt(i) ?? 0;
    pushUtf8(bytes, point);
    if (point > 0xffff) i += 1;
  }
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(Uint8Array.from(bytes));
}

/** Tab, carriage return and line feed are dropped from an address, as an address parser drops them. */
function dropBreaks(text: string): string {
  let out = text;
  for (const mark of ['\t', '\r', '\n']) {
    if (out.indexOf(mark) >= 0) out = out.split(mark).join('');
  }
  return out;
}

interface Located {
  form: RedirectForm;
  query: string | null;
  fragment: string | null;
  body: string | null;
}

function locate(text: string): Located | null {
  let t = dropBreaks(text).trim();
  if (t.slice(0, 9).toLowerCase() === 'location:') t = t.slice(9).trim();
  if (t === '') return null;
  const lead = t.charAt(0);
  const addressLike = lead === '?' || lead === '#' || lead === '/' || schemeOf(t) !== null;
  if (!addressLike) return { form: 'form body', query: null, fragment: null, body: t };
  const hash = t.indexOf('#');
  const beforeHash = hash < 0 ? t : t.slice(0, hash);
  const mark = beforeHash.indexOf('?');
  return {
    form: lead === '#' ? 'fragment' : lead === '?' ? 'query' : 'address',
    query: mark < 0 ? null : beforeHash.slice(mark + 1),
    fragment: hash < 0 ? null : t.slice(hash + 1),
    body: null,
  };
}

/** Appends the parameters of one part, in order. Empty pieces between ampersands are skipped. */
function readParts(source: string, place: Place, out: RedirectParameter[]): void {
  let start = 0;
  while (start <= source.length) {
    let end = source.indexOf('&', start);
    if (end < 0) end = source.length;
    if (end > start) {
      let eq = end;
      for (let i = start; i < end; i++) {
        if (source.charCodeAt(i) === 61) {
          eq = i;
          break;
        }
      }
      if (out.length >= MAX_PARAMETERS) {
        throw new PkceBuilderError(
          `The paste holds more than ${withCommas(MAX_PARAMETERS)} parameters. The limit is ${withCommas(MAX_PARAMETERS)}.`,
          'redirect',
        );
      }
      const name = decodeComponent(source.slice(start, eq));
      const value = eq < end ? decodeComponent(source.slice(eq + 1, end)) : '';
      const masked = MASKED_NAMES.has(name.toLowerCase());
      out.push({
        place,
        name,
        value: masked ? maskValue(value) : value,
        masked,
        length: Array.from(value).length,
      });
    }
    start = end + 1;
  }
}

/** The raw value of a found response parameter: masked ones are never found, so this is the decoded text. */
function foundOf(parameters: readonly RedirectParameter[], name: string): FoundItem | null {
  let first: RedirectParameter | null = null;
  let count = 0;
  for (const parameter of parameters) {
    if (parameter.name !== name) continue;
    count += 1;
    if (first === null) first = parameter;
  }
  return first === null ? null : { name, value: first.value, place: first.place, count };
}

/**
 * Reads a pasted redirect: a full address, a bare query beginning with a question mark, a bare fragment beginning with a
 * hash sign, or a form body. Both the query and the fragment are read, a plus sign is a space, and every parameter is kept
 * in the order written, repeats included, as a list of pairs (never an object keyed by pasted names). Codes and states are
 * shown; an access token or an ID token only as its first characters and its length. `expected` holds the state and the
 * issuer the page expects; they are compared as simple strings.
 */
export function readRedirect(text: string, expected: Expected): RedirectReport {
  checkLength(text, MAX_PASTE_CHARACTERS, 'redirect', 'paste');
  const expectedState = expected.state ?? '';
  const expectedIssuer = expected.issuer ?? '';
  checkLength(expectedState, MAX_URL_CHARACTERS, 'length', 'expected state');
  checkLength(expectedIssuer, MAX_URL_CHARACTERS, 'length', 'expected issuer');
  const located = locate(text);
  if (located === null) {
    return { form: 'form body', readFrom: [], parameters: [], found: [], tokens: [], error: null, notes: [] };
  }
  const parameters: RedirectParameter[] = [];
  if (located.query !== null) readParts(located.query, 'query', parameters);
  if (located.fragment !== null) readParts(located.fragment, 'fragment', parameters);
  if (located.body !== null) readParts(located.body, 'body', parameters);

  const readFrom: Place[] = [];
  for (const parameter of parameters) {
    if (!readFrom.includes(parameter.place)) readFrom.push(parameter.place);
  }
  const found: FoundItem[] = [];
  for (const name of FOUND_NAMES) {
    const item = foundOf(parameters, name);
    if (item !== null) found.push(item);
  }
  const tokens: TokenItem[] = [];
  for (const parameter of parameters) {
    if (parameter.masked && TOKEN_NAMES.includes(parameter.name)) {
      tokens.push({ name: parameter.name, value: parameter.value, place: parameter.place, length: parameter.length });
    }
  }
  const byName = (name: string): FoundItem | undefined => found.find((item) => item.name === name);
  const codeItem = byName('code');
  const errorItem = byName('error');
  const stateItem = byName('state');
  const issItem = byName('iss');
  const error = errorItem === undefined ? null : { code: errorItem.value, ...explainError(errorItem.value) };

  const notes: Note[] = [];
  const hasAccessToken = tokens.some((token) => token.name === 'access_token');
  if (codeItem === undefined && errorItem === undefined && tokens.length === 0) {
    notes.push({ tone: 'info', message: 'No code, error or token was found in this text.' });
    return { form: located.form, readFrom, parameters, found, tokens, error, notes };
  }
  if (error !== null) {
    notes.push({
      tone: 'warn',
      message: `The authorization server returned the error ${visible(error.code, 40)}: ${error.sentence}`,
    });
  }
  if (codeItem !== undefined && errorItem !== undefined) {
    notes.push({
      tone: 'warn',
      message: 'The text holds both a code and an error. A response holds one or the other (RFC 6749 section 4.1.2).',
    });
  }
  for (const item of found) {
    if (item.count > 1) {
      notes.push({
        tone: 'warn',
        message: `The parameter ${item.name} appears more than once (${item.count} times). RFC 6749 section 3.1 says request and response parameters must not be included more than once; the first one is shown here.`,
      });
    }
  }
  if (stateItem === undefined) {
    notes.push({
      tone: 'warn',
      message:
        'No state came back. If your request carried a state, RFC 6749 section 4.1.2 says it must be returned, and without it the check against cross-site request forgery (RFC 6749 section 10.12) cannot be made.',
    });
  } else if (expectedState !== '') {
    notes.push(
      stateItem.value === expectedState
        ? { tone: 'success', message: 'The returned state matches the expected state.' }
        : {
            tone: 'warn',
            message:
              'The returned state does not match the expected state. A response to a request your application did not make, or one that was tampered with, looks like this: do not go on with it.',
          },
    );
  } else {
    notes.push({
      tone: 'info',
      message: 'A state came back. It was not compared because no expected state was given.',
    });
  }
  if (expectedIssuer !== '') {
    if (issItem === undefined) {
      notes.push({
        tone: 'warn',
        message:
          'No iss parameter came back, but an expected issuer was given. RFC 9207 section 2.4 says a client must reject a response without iss from a server that is set up to send it.',
      });
    } else {
      notes.push(
        issItem.value === expectedIssuer
          ? {
              tone: 'success',
              message: 'The returned iss equals the expected issuer (simple string comparison, RFC 9207 section 2.4).',
            }
          : {
              tone: 'warn',
              message:
                'The returned iss does not match the expected issuer. RFC 9207 section 2.4 says a client must reject the response.',
            },
      );
    }
  } else if (issItem !== undefined) {
    notes.push({
      tone: 'info',
      message: 'The response has an iss parameter. Give the expected issuer to compare it (RFC 9207 section 2.4).',
    });
  }
  if (hasAccessToken) {
    notes.push({
      tone: 'warn',
      message:
        'An access token is in the address. That is the implicit grant, and RFC 9700 section 2.1.2 says clients should not use it: the address can leak into history, logs and referrers. Use the code flow with PKCE.',
    });
  }
  return { form: located.form, readFrom, parameters, found, tokens, error, notes };
}

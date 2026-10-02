import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  HarViewerError,
  MAX_ENTRIES,
  MAX_FILE_BYTES,
  PAGE_SIZE,
  checkFileSize,
  listRequests,
  readHar,
  requestDetail,
} from '../src/index';
import {
  SENSITIVE_HEADERS,
  SENSITIVE_PARAMS,
  isSensitive,
  maskBodyText,
  maskPairs,
  maskUrl,
  maskValue,
} from '../src/sensitive';

/*
 * Grounding (D-179, P13-08).
 *
 * Every recording here is built in the test from the field list of the HAR 1.2 specification
 * (http://www.softwareishard.com/blog/har-12-spec/, fetched 2026-10-02): the objects log, entries, request, response,
 * content and timings, with the names and meanings the specification gives. The expected values are the specification's
 * own definitions and example values, never the output of this package:
 *
 *  - timings: "blocked": 0, "dns": -1, "connect": 15, "send": 20, "wait": 38, "receive": 12, "ssl": -1 is the
 *    specification's own example, and "The time value for the request must be equal to the sum of the timings supplied
 *    in this section (excluding any -1 values)": 0 + 15 + 20 + 38 + 12 = 85. The specification says the ssl time "is
 *    also included in the connect field", so it is not added a second time. "Use -1 if the timing does not apply".
 *  - the example request address is http://www.example.com/path/?param=value and the example start time
 *    2009-04-16T12:07:23.596Z; the example content size is 33 and bodySize 850, where "size: Length of the returned
 *    content in bytes" is the size of the content and "bodySize: Size of the received response body in bytes" the
 *    size as received, and -1 means the information is not available.
 *  - "version [string] - Version number of the format. If empty, string 1.1 is assumed by default", and the
 *    specification's own check for a reader that supports HAR since 1.1: a major version other than 1 or a minor
 *    version below 1 is incompatible (so 0.8, 0.9 and 1.0 and 2.x are refused, 1.1, 1.2 and 1.112 are read).
 *  - "encoding [string, optional] (new in 1.2) - Encoding used for response text field e.g base64", with the example
 *    text PGh0bWw+PGhlYWQ+PC9oZWFkPjxib2R5Lz48L2h0bWw+XG4= . Python 3.14.3 base64.b64decode (second opinion) gives
 *    b'<html><head></head><body/></html>\\n' (the example writes the line feed as a backslash and the letter n).
 *    The PNG signature 89 50 4e 47 0d 0a 1a 0a is iVBORw0KGgo= and the single byte ff is /w== (Python base64.b64encode).
 *  - "Custom fields and elements MUST start with an underscore" and a reader must ignore them.
 *  - Sensitive values: RFC 6265 section 4.1 (Set-Cookie) and 4.2 (Cookie), RFC 7235 section 4.2 (Authorization) and
 *    4.4 (Proxy-Authorization), RFC 6750 section 2.1 (the Bearer scheme and its b64token syntax, the example
 *    Authorization: Bearer mF_9.B5f-4.1JqM), 2.2 and 2.3 (the access_token form field and query parameter), RFC 7519
 *    section 3 (a JWT is URL-safe parts separated by periods; the example in 3.1 is used below, assembled from pieces)
 *    and RFC 3986 section 3.2.1 ("Applications should not render as clear text any data after the first colon (":")
 *    character found within a userinfo subcomponent").
 *
 * Nothing here treats this folder's own output as the expected value.
 */

const SPEC_TIMINGS = { blocked: 0, dns: -1, connect: 15, send: 20, wait: 38, receive: 12, ssl: -1, comment: '' };

/** The RFC 7519 section 3.1 example JWT, assembled from pieces so no test file holds a literal that looks like a credential. */
const JWT = [
  'eyJ0eXAi' + 'OiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9',
  'eyJpc3Mi' + 'OiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ',
  'dBjftJeZ4CVP' + '-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
].join('.');

const TOKEN = ['abcd', 'efgh', 'ijkl', 'mnop', 'qrst'].join('');
const BEARER = ['Bearer', TOKEN].join(' ');

interface EntryParts {
  started?: string;
  method?: string;
  url?: string;
  status?: number;
  content?: Record<string, unknown>;
  bodySize?: number;
  timings?: Record<string, unknown>;
  time?: number;
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

/** One entry with the fields the specification lists for it; `request`, `response` and `extra` are merged over them. */
function entry(parts: EntryParts = {}): Record<string, unknown> {
  return {
    startedDateTime: parts.started ?? '2009-04-16T12:07:23.596Z',
    time: parts.time ?? 85,
    request: {
      method: parts.method ?? 'GET',
      url: parts.url ?? 'http://www.example.com/path/?param=value',
      httpVersion: 'HTTP/1.1',
      cookies: [],
      headers: [],
      queryString: [],
      headersSize: 150,
      bodySize: 0,
      ...parts.request,
    },
    response: {
      status: parts.status ?? 200,
      statusText: 'OK',
      httpVersion: 'HTTP/1.1',
      cookies: [],
      headers: [],
      content: parts.content ?? { size: 33, compression: 0, mimeType: 'text/html; charset=utf-8' },
      redirectURL: '',
      headersSize: 160,
      bodySize: parts.bodySize ?? 850,
      ...parts.response,
    },
    cache: {},
    timings: parts.timings ?? SPEC_TIMINGS,
    ...parts.extra,
  };
}

/** The text of a log with the given entries, as the specification's root object shows it. */
function harText(entries: unknown[], version: unknown = '1.2'): string {
  return JSON.stringify({ log: { version, creator: { name: 'Firebug', version: '1.6' }, entries } });
}

const LIST = { filter: '', method: '', status: '', sort: 'start', reveal: false, page: 1 } as const;

const spies = {
  log: vi.spyOn(console, 'log'),
  warn: vi.spyOn(console, 'warn'),
  error: vi.spyOn(console, 'error'),
};

beforeEach(() => {
  for (const spy of Object.values(spies)) spy.mockImplementation(() => undefined);
});

afterEach(() => {
  // The package prints nothing, whatever it is given.
  for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  for (const spy of Object.values(spies)) spy.mockReset();
});

function refusal(run: () => unknown): HarViewerError {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(HarViewerError);
    return err as HarViewerError;
  }
  throw new Error('expected a HarViewerError');
}

it('a HAR 1.2 log with two entries lists method, URL, status, size and time as the specification defines them', () => {
  const first = entry();
  // Entry two: no content size, so the size of the body as received is used; the timings that are not given are not
  // part of the sum (send 1 + wait 2 + receive 3).
  const second = entry({
    started: '2009-04-16T12:07:24.100Z',
    method: 'POST',
    url: 'http://www.example.com/submit',
    status: 404,
    content: { mimeType: 'text/plain' },
    bodySize: 1234,
    timings: { send: 1, wait: 2, receive: 3 },
    time: 6,
  });
  const har = readHar(harText([first, second]));
  expect(har.version).toBe('1.2');
  expect(har.total).toBe(2);

  const result = listRequests(har, { ...LIST });
  expect(result.total).toBe(2);
  expect(result.shown).toBe(2);
  expect(result.rows).toEqual([
    {
      index: 1,
      started: '2009-04-16T12:07:23.596Z',
      method: 'GET',
      url: 'http://www.example.com/path/?param=value',
      status: 200,
      size: '33 B',
      time: '85',
      flags: 0,
    },
    {
      index: 2,
      started: '2009-04-16T12:07:24.100Z',
      method: 'POST',
      url: 'http://www.example.com/submit',
      status: 404,
      size: '1,234 B',
      time: '6',
      flags: 0,
    },
  ]);
});

it('an empty entries array lists no requests and a missing log.entries is refused naming its path', () => {
  const empty = readHar(harText([]));
  expect(empty.total).toBe(0);
  expect(listRequests(empty, { ...LIST })).toEqual({ rows: [], total: 0, shown: 0 });

  // log.entries is required by the specification: a log without it, or with something else in its place, is refused
  // and the path of the missing part is named (RFC 6901 pointer).
  const missing = refusal(() =>
    readHar(JSON.stringify({ log: { version: '1.2', creator: { name: 'x', version: '1' } } })),
  );
  expect(missing.path).toBe('/log/entries');
  expect(missing.message).toContain('/log/entries');
  const notAnArray = refusal(() => readHar(JSON.stringify({ log: { version: '1.2', entries: {} } })));
  expect(notAnArray.path).toBe('/log/entries');
  const noLog = refusal(() => readHar(JSON.stringify({ entries: [] })));
  expect(noLog.path).toBe('/log');
  expect(noLog.message).toContain('/log');
});

it('an empty version means 1.1 and a version before 1.1 or after 1.x is refused naming its path', () => {
  expect(readHar(harText([], '')).version).toBe('1.1');
  expect(readHar(harText([], '1.1')).version).toBe('1.1');
  expect(readHar(harText([], '1.112')).version).toBe('1.112');
  for (const version of ['1.0', '0.8', '0.9', '2.0', '2.1', 'one']) {
    const refused = refusal(() => readHar(harText([], version)));
    expect(refused.path, version).toBe('/log/version');
    expect(refused.message, version).toContain(version);
  }
  // A version that is not a string is refused too.
  expect(refusal(() => readHar(harText([], 1.2))).path).toBe('/log/version');
});

it('timings of -1 are left out of the total and sizes of -1 show unknown', () => {
  const har = readHar(
    harText([
      // The specification's own timings: dns and ssl are -1, so the total is 0 + 15 + 20 + 38 + 12.
      entry({ timings: SPEC_TIMINGS }),
      // Every timing is -1: nothing is added, so the total is 0 and each phase reads not applicable.
      entry({
        timings: { blocked: -1, dns: -1, connect: -1, send: -1, wait: -1, receive: -1, ssl: -1 },
        time: 0,
      }),
      // ssl is part of connect: 30 + 20 is not added up as 50 + 30.
      entry({ timings: { connect: 30, ssl: 20, send: 1, wait: 2, receive: 3 }, time: 36 }),
      // No timings object at all: the entry's own time field is the total.
      entry({ timings: {}, time: 41 }),
      // content.size is -1 and bodySize is 120: the body as received is used.
      entry({ content: { size: -1, mimeType: 'text/plain' }, bodySize: 120 }),
      // Both sizes are -1: the size is unknown. A size of 0 is a real size, not unknown.
      entry({ content: { size: -1, mimeType: 'text/plain' }, bodySize: -1 }),
      entry({ content: { size: 0, mimeType: 'text/plain' }, bodySize: 500 }),
      // A fractional time keeps its fraction.
      entry({ timings: { send: 1.25, wait: 2.5, receive: 0.5 } }),
    ]),
  );
  const rows = listRequests(har, { ...LIST }).rows;
  expect(rows.map((row) => row.time)).toEqual(['85', '0', '36', '41', '85', '85', '85', '4.25']);
  expect(rows.map((row) => row.size)).toEqual(['33 B', '33 B', '33 B', '33 B', '120 B', 'unknown', '0 B', '33 B']);

  // The opened request shows each phase, -1 as not applicable, and the same total.
  const detail = requestDetail(har, 1, { reveal: false, bodies: false });
  expect(detail.timings).toEqual([
    ['Blocked', '0 ms'],
    ['DNS', 'not applicable'],
    ['Connect', '15 ms'],
    ['SSL', 'not applicable'],
    ['Send', '20 ms'],
    ['Wait', '38 ms'],
    ['Receive', '12 ms'],
    ['Total', '85 ms'],
  ]);
  expect(requestDetail(har, 6, { reveal: false, bodies: false }).response.size).toBe('unknown');
});

it('a base64 body is decoded before it is shown, only text bodies are shown, and long bodies are cut with a note', () => {
  const spec = { size: 33, compression: 0, mimeType: 'text/html; charset=utf-8', text: '', encoding: 'base64' };
  const long = 'a'.repeat(102400 + 50);
  // Index 5: a pair of UTF-16 units that the cut at 102,400 would split in half.
  const emoji = `${'b'.repeat(102399)}${String.fromCodePoint(0x1f600)}tail`;
  const har = readHar(
    harText([
      entry({ content: { ...spec, text: 'PGh0bWw+PGhlYWQ+PC9oZWFkPjxib2R5Lz48L2h0bWw+XG4=' } }),
      entry({ content: { size: 8, mimeType: 'image/png', text: 'iVBORw0KGgo=', encoding: 'base64' } }),
      entry({ content: { size: 1, mimeType: 'text/plain', text: '/w==', encoding: 'base64' } }),
      entry({ content: { size: 3, mimeType: 'application/json', text: '{"a":1}' } }),
      entry({ content: { size: long.length, mimeType: 'text/plain', text: long } }),
      entry({ content: { size: emoji.length, mimeType: 'text/plain', text: emoji } }),
      entry({ content: { size: 0, mimeType: 'text/plain' } }),
      entry({ content: { size: 0, mimeType: 'text/plain', text: '' } }),
      entry({ content: { size: 5, mimeType: 'text/plain', text: '!!!not base64!!!', encoding: 'base64' } }),
      entry({ content: { size: 5, mimeType: 'image/png', text: 'not really an image' } }),
    ]),
  );
  const open = (index: number) => requestDetail(har, index, { reveal: false, bodies: true });

  // The specification's own base64 example decodes to its original body.
  expect(open(1).body).toBe('<html><head></head><body/></html>\\n');
  // A base64 body of a non-text type, and bytes that are not UTF-8: not shown, with the byte count.
  expect(open(2).body).toBeUndefined();
  expect(open(2).bodyNote).toBe('Binary body not shown (8 bytes).');
  expect(open(3).body).toBeUndefined();
  expect(open(3).bodyNote).toBe('Binary body not shown (1 byte).');
  // A JSON body that is not encoded is shown as it is.
  expect(open(4).body).toBe('{"a":1}');
  expect(open(4).bodyNote).toBeUndefined();
  // A long body is cut at 102,400 characters with a note that gives both numbers.
  expect(open(5).body).toBe('a'.repeat(102400));
  expect(open(5).bodyNote).toBe('The body is 102,450 characters long. The first 102,400 are shown.');
  // The cut never splits a pair: the pair is left out whole.
  expect(open(6).body).toBe('b'.repeat(102399));
  expect(open(6).bodyNote).toBe('The body is 102,404 characters long. The first 102,399 are shown.');
  // No text in the recording, and an empty text.
  expect(open(7).body).toBeUndefined();
  expect(open(7).bodyNote).toBe('The recording holds no body for this response.');
  expect(open(8).body).toBe('');
  expect(open(8).bodyNote).toBe('The body is empty.');
  // Text that claims to be base64 and is not.
  expect(open(9).body).toBeUndefined();
  expect(open(9).bodyNote).toBe('The body is marked Base64 but is not valid Base64, so it is not shown.');
  // A non-text type is not shown even when it is not encoded.
  expect(open(10).body).toBeUndefined();
  expect(open(10).bodyNote).toBe('Binary body not shown (5 bytes).');

  // Without bodies, no body and no note are returned.
  const closed = requestDetail(har, 1, { reveal: false, bodies: false });
  expect(closed.body).toBeUndefined();
  expect(closed.bodyNote).toBeUndefined();
});

/** The entry of the sensitive-value tests: every rule of the page appears once, with harmless values beside them. */
function sensitiveEntry(): Record<string, unknown> {
  return entry({
    url: 'https://ann:s3cretpassword@example.com/path?token=abcdefghijklmnop&q=1#frag',
    request: {
      headers: [
        { name: 'Host', value: 'example.com' },
        { name: 'Accept', value: '*/*' },
        { name: 'Authorization', value: BEARER },
        { name: 'Proxy-Authorization', value: 'Basic dXNlcjpwYXNzd29yZA==' },
        { name: 'Cookie', value: 'theme=dark; session=abcdef123456' },
        { name: 'X-API-Key', value: 'key-1234567890' },
        { name: 'X-Auth-Token', value: 'tok-1234567890' },
        { name: 'X-CSRF-Token', value: 'csrf-1234567890' },
        { name: 'X-XSRF-Token', value: 'xsrf-1234567890' },
        { name: 'X-Trace', value: JWT },
      ],
      cookies: [
        { name: 'session', value: 'abcdef123456', path: '/', httpOnly: true },
        { name: 'empty', value: '' },
      ],
      queryString: [
        { name: 'access_token', value: '0123456789abcdef' },
        { name: 'page', value: '2' },
        { name: 'Signature', value: 'sigsigsigsig' },
      ],
      postData: {
        mimeType: 'application/x-www-form-urlencoded',
        params: [
          { name: 'username', value: 'ann' },
          { name: 'password', value: 'hunter2hunter2' },
        ],
      },
    },
    response: {
      headers: [
        { name: 'Content-Type', value: 'text/html' },
        { name: 'Set-Cookie', value: 'sid=abcdef123456; Path=/; HttpOnly' },
        { name: 'Cache-Control', value: 'no-cache' },
      ],
      cookies: [{ name: 'sid', value: 'abcdef123456' }],
    },
  });
}

it('sensitive headers, cookies, token-named parameters, JWT-shaped and Bearer values are flagged and masked until revealed', () => {
  const har = readHar(harText([sensitiveEntry()]));

  // Masked: the first four characters and the length; every sensitive value is flagged.
  const hidden = requestDetail(har, 1, { reveal: false, bodies: false });
  const pairs = (list: { name: string; value: string; sensitive: boolean }[]) =>
    list.map((item) => [item.name, item.value, item.sensitive]);
  expect(pairs(hidden.headers)).toEqual([
    ['Host', 'example.com', false],
    ['Accept', '*/*', false],
    ['Authorization', 'Bear… (27 characters)', true],
    ['Proxy-Authorization', 'Basi… (26 characters)', true],
    ['Cookie', 'them… (32 characters)', true],
    ['X-API-Key', 'key-… (14 characters)', true],
    ['X-Auth-Token', 'tok-… (14 characters)', true],
    ['X-CSRF-Token', 'csrf… (15 characters)', true],
    ['X-XSRF-Token', 'xsrf… (15 characters)', true],
    // A JWT-shaped value is flagged under any header name.
    ['X-Trace', `eyJ0… (${JWT.length} characters)`, true],
  ]);
  expect(hidden.cookies).toEqual([
    { name: 'session', value: 'abcd… (12 characters)', sensitive: true, details: 'Path=/; HttpOnly' },
    // An empty value has nothing to hide.
    { name: 'empty', value: '', sensitive: false, details: '' },
  ]);
  expect(pairs(hidden.query)).toEqual([
    ['access_token', '0123… (16 characters)', true],
    ['page', '2', false],
    ['Signature', 'sigs… (12 characters)', true],
  ]);
  expect(pairs(hidden.postData!.params)).toEqual([
    ['username', 'ann', false],
    ['password', 'hunt… (14 characters)', true],
  ]);
  expect(pairs(hidden.response.headers)).toEqual([
    ['Content-Type', 'text/html', false],
    ['Set-Cookie', 'sid=… (34 characters)', true],
    ['Cache-Control', 'no-cache', false],
  ]);
  expect(hidden.response.cookies).toEqual([
    { name: 'sid', value: 'abcd… (12 characters)', sensitive: true, details: '' },
  ]);
  // The address: the password after the first colon of the user information (RFC 3986 section 3.2.1) and the
  // token parameter, in the query, are masked in place.
  expect(hidden.url).toBe('https://ann:s3cr… (14 characters)@example.com/path?token=abcd… (16 characters)&q=1#frag');
  // 8 request headers + 1 cookie + 2 query + 1 posted + 1 user information + 1 response header + 1 response cookie.
  expect(hidden.flags).toBe(15);
  const row = listRequests(har, { ...LIST }).rows[0]!;
  expect(row.flags).toBe(15);
  expect(row.url).toBe(hidden.url);

  // Revealed: the values as recorded, and the flags still say which were sensitive.
  const shown = requestDetail(har, 1, { reveal: true, bodies: false });
  expect(pairs(shown.headers)[2]).toEqual(['Authorization', BEARER, true]);
  expect(pairs(shown.headers)[4]).toEqual(['Cookie', 'theme=dark; session=abcdef123456', true]);
  expect(pairs(shown.headers)[9]).toEqual(['X-Trace', JWT, true]);
  expect(shown.cookies[0]).toEqual({
    name: 'session',
    value: 'abcdef123456',
    sensitive: true,
    details: 'Path=/; HttpOnly',
  });
  expect(shown.postData!.params[1]).toEqual({ name: 'password', value: 'hunter2hunter2', sensitive: true });
  expect(shown.url).toBe('https://ann:s3cretpassword@example.com/path?token=abcdefghijklmnop&q=1#frag');
  expect(shown.flags).toBe(15);
  expect(listRequests(har, { ...LIST, reveal: true }).rows[0]!.url).toBe(shown.url);

  // The rules themselves.
  expect(SENSITIVE_HEADERS).toEqual([
    'authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'x-auth-token',
    'x-csrf-token',
    'x-xsrf-token',
  ]);
  for (const name of [
    'token',
    'access_token',
    'id_token',
    'refresh_token',
    'api_key',
    'apikey',
    'key',
    'secret',
    'password',
    'passwd',
    'signature',
    'sig',
  ]) {
    expect(SENSITIVE_PARAMS, name).toContain(name);
    expect(isSensitive('param', name.toUpperCase(), 'some-value'), name).toBe(true);
  }
  // Names that hold the word token, secret or password are sensitive too; names that only look similar are not.
  for (const name of ['csrf_token', 'X-Amz-Security-Token', 'client_secret', 'new_password']) {
    expect(isSensitive('param', name, 'some-value'), name).toBe(true);
  }
  for (const name of ['page', 'q', 'monkey', 'keyboard', 'design', 'sort']) {
    expect(isSensitive('param', name, 'some-value'), name).toBe(false);
  }
  expect(isSensitive('header', 'authorization', 'x')).toBe(true);
  expect(isSensitive('header', 'AUTHORIZATION', 'x')).toBe(true);
  expect(isSensitive('header', 'Host', 'example.com')).toBe(false);
  expect(isSensitive('cookie', 'anything', 'x')).toBe(true);
  expect(isSensitive('cookie', 'anything', '')).toBe(false);
  expect(isSensitive('header', 'authorization', '')).toBe(false);
  // The value shapes: a JWT (three parts, or five for an encrypted one), and a Bearer credential in any case
  // (RFC 7235 section 2.1: scheme names are case-insensitive).
  expect(isSensitive('header', 'X-Any', JWT)).toBe(true);
  expect(isSensitive('param', 'any', ['eyJhbGciOiJkaXIifQ', '', 'aXY', 'Y2lwaGVy', 'dGFn'].join('.'))).toBe(true);
  expect(isSensitive('param', 'any', 'eyJhbGciOiJIUzI1NiJ9.e30.')).toBe(true);
  expect(isSensitive('header', 'X-Any', 'bearer mF_9.B5f-4.1JqM')).toBe(true);
  expect(isSensitive('header', 'X-Any', 'BEARER mF_9.B5f-4.1JqM')).toBe(true);
  expect(isSensitive('header', 'X-Any', 'Bearer')).toBe(false);
  expect(isSensitive('header', 'X-Any', 'Bearers are mammals')).toBe(false);
  expect(isSensitive('header', 'X-Any', 'eyJhbGciOiJIUzI1NiJ9.e30')).toBe(false);
  expect(isSensitive('header', 'X-Any', 'eyJ0 not a token')).toBe(false);

  // Masking keeps four characters of a value longer than eight, nothing of a value of eight or fewer (showing four
  // of five would show most of it), counts characters and not UTF-16 units, and leaves an empty value empty.
  expect(maskValue('abcdefghij')).toBe('abcd… (10 characters)');
  expect(maskValue('abcdefghi')).toBe('abcd… (9 characters)');
  expect(maskValue('abcdefgh')).toBe('… (8 characters)');
  expect(maskValue('a')).toBe('… (1 characters)');
  expect(maskValue('')).toBe('');
  const faces = String.fromCodePoint(0x1f600).repeat(10);
  expect(maskValue(faces)).toBe(`${String.fromCodePoint(0x1f600).repeat(4)}… (10 characters)`);
});

it('sensitive values inside bodies are masked: form fields, JSON members and token-shaped text', () => {
  const form = `grant_type=password&username=ann&password=hunter2hunter2&access_token=${TOKEN}&note=hello+there`;
  const json = JSON.stringify({
    access_token: TOKEN,
    name: 'ann',
    nested: { password: 'zzzzzzzzzzzz', Key: ['k-12', '34567890'].join('') },
  });
  const text = `first ${JWT} then ${BEARER} done`;
  const har = readHar(
    harText([
      entry({
        request: {
          postData: { mimeType: 'application/x-www-form-urlencoded; charset=UTF-8', text: form },
        },
        content: { size: json.length, mimeType: 'application/json', text: json },
      }),
      entry({ content: { size: text.length, mimeType: 'text/plain', text } }),
    ]),
  );
  const hidden = requestDetail(har, 1, { reveal: false, bodies: true });
  expect(hidden.postData!.text).toBe(
    'grant_type=password&username=ann&password=hunt… (14 characters)&access_token=abcd… (20 characters)&note=hello+there',
  );
  expect(hidden.body).toBe(
    '{"access_token":"abcd… (20 characters)","name":"ann","nested":{"password":"zzzz… (12 characters)","Key":"k-12… (12 characters)"}}',
  );
  expect(JSON.parse(hidden.body!).name).toBe('ann');
  const plain = requestDetail(har, 2, { reveal: false, bodies: true });
  expect(plain.body).toBe(`first eyJ0… (${JWT.length} characters) then Bear… (${BEARER.length} characters) done`);

  const shown = requestDetail(har, 1, { reveal: true, bodies: true });
  expect(shown.postData!.text).toBe(form);
  expect(shown.body).toBe(json);
  expect(requestDetail(har, 2, { reveal: true, bodies: true }).body).toBe(text);
});

it('a token that straddles the cut of a long body is masked whole', () => {
  // The Bearer credential starts ten characters before the cut at 102,400 and ends thirty after it.
  const body = `${' '.repeat(102390)}Bearer ${'A'.repeat(33)} end`;
  const har = readHar(harText([entry({ content: { size: body.length, mimeType: 'text/plain', text: body } })]));
  const detail = requestDetail(har, 1, { reveal: false, bodies: true });
  expect(detail.body).toBe(`${' '.repeat(102390)}Bear… (40 characters)`);
  expect(detail.bodyNote).toContain('are shown');
});

/** A recording of six requests whose statuses, times, sizes, methods and addresses tell the filters and sorts apart. */
function sixRequests(): string {
  const make = (url: string, method: string, status: number, time: number, size: number) =>
    entry({
      url,
      method,
      status,
      timings: { send: time },
      content: { size, mimeType: 'text/plain' },
      bodySize: size,
    });
  return harText([
    make('https://example.com/api/users', 'GET', 200, 30, 500),
    make('https://example.com/images/logo.png', 'GET', 404, 10, 500),
    make('https://example.com/API/orders', 'POST', 404, 30, 100),
    make('https://example.com/api/orders', 'POST', 500, 10, -1),
    make('https://example.com/old', 'GET', 301, 5, 0),
    make('https://example.com/private', 'GET', 403, 30, 5000),
  ]);
}

it('filters by URL text, method and status class keep recording order and sorting is stable', () => {
  const har = readHar(sixRequests());
  const indexes = (options: Partial<Parameters<typeof listRequests>[1]>) =>
    listRequests(har, { ...LIST, ...options }).rows.map((row) => row.index);

  // Recording order by default, and every request has the same start time here, so nothing is reordered.
  expect(indexes({})).toEqual([1, 2, 3, 4, 5, 6]);

  // Status: a whole code matches exactly (404 is listed and 403 is not), a class matches every code in it.
  expect(indexes({ status: '404' })).toEqual([2, 3]);
  expect(indexes({ status: '4xx' })).toEqual([2, 3, 6]);
  expect(indexes({ status: '4XX' })).toEqual([2, 3, 6]);
  expect(indexes({ status: ' 5xx ' })).toEqual([4]);
  expect(indexes({ status: '3xx' })).toEqual([5]);
  expect(indexes({ status: '2xx' })).toEqual([1]);
  expect(indexes({ status: '40' })).toEqual([]);
  expect(indexes({ status: '200' })).toEqual([1]);
  for (const bad of ['abc', '4x', '4xxx', '1234', '-1', 'https://example.invalid/x']) {
    const refused = refusal(() => listRequests(har, { ...LIST, status: bad }));
    expect(refused.message, bad).toContain('Status');
  }

  // Address text: a substring, in any letter case.
  expect(indexes({ filter: 'api' })).toEqual([1, 3, 4]);
  expect(indexes({ filter: 'API' })).toEqual([1, 3, 4]);
  expect(indexes({ filter: 'orders' })).toEqual([3, 4]);
  expect(indexes({ filter: 'no such text' })).toEqual([]);

  // Method: the whole method, in any letter case.
  expect(indexes({ method: 'POST' })).toEqual([3, 4]);
  expect(indexes({ method: 'post' })).toEqual([3, 4]);
  expect(indexes({ method: 'POS' })).toEqual([]);

  // All three together.
  expect(indexes({ filter: 'api', method: 'POST', status: '4xx' })).toEqual([3]);
  const combined = listRequests(har, { ...LIST, filter: 'api' });
  expect(combined.total).toBe(3);
  expect(combined.shown).toBe(3);

  // Sorting: time, size and status are stable, so equal keys keep their recording order.
  expect(indexes({ sort: 'time' })).toEqual([1, 3, 6, 2, 4, 5]);
  expect(indexes({ sort: 'size' })).toEqual([6, 1, 2, 3, 5, 4]);
  expect(indexes({ sort: 'status' })).toEqual([1, 5, 6, 2, 3, 4]);
  expect(indexes({ sort: 'time', status: '4xx' })).toEqual([3, 6, 2]);
  expect(refusal(() => listRequests(har, { ...LIST, sort: 'nope' as 'time' })).message).toContain('Sort by');

  // Two entries with the same start time keep their recording order, also when their start times are not in order.
  const same = readHar(
    harText([
      entry({ started: '2009-04-16T12:07:25.000Z', url: 'https://example.com/late' }),
      entry({ started: '2009-04-16T12:07:23.000Z', url: 'https://example.com/early-1' }),
      entry({ started: '2009-04-16T12:07:23.000Z', url: 'https://example.com/early-2' }),
    ]),
  );
  expect(listRequests(same, { ...LIST }).rows.map((row) => row.index)).toEqual([1, 2, 3]);

  // The filter looks at the address as shown: a hidden token cannot be found until it is revealed.
  const hiddenToken = readHar(harText([entry({ url: 'https://example.com/p?access_token=abcdefghijklmnop&q=1' })]));
  expect(listRequests(hiddenToken, { ...LIST, filter: 'abcdefghijklmnop' }).total).toBe(0);
  expect(listRequests(hiddenToken, { ...LIST, filter: 'abcdefghijklmnop', reveal: true }).total).toBe(1);
  expect(listRequests(hiddenToken, { ...LIST, filter: 'access_token=abcd…' }).total).toBe(1);

  // Pages hold 500 rows; the total counts every page.
  const many = readHar(harText(Array.from({ length: 1200 }, (_, i) => entry({ url: `https://example.com/${i}` }))));
  expect(PAGE_SIZE).toBe(500);
  const pages = [1, 2, 3, 4].map((page) => listRequests(many, { ...LIST, page }));
  expect(pages.map((p) => p.shown)).toEqual([500, 500, 200, 0]);
  expect(pages.map((p) => p.total)).toEqual([1200, 1200, 1200, 1200]);
  expect(pages[2]!.rows[0]!.index).toBe(1001);
  expect(refusal(() => listRequests(many, { ...LIST, page: 0 })).message).toContain('Page');
});

it('custom fields that start with an underscore are ignored', () => {
  const marker = 'CUSTOM-SENTINEL';
  const plain = harText([
    entry({ url: 'https://example.com/a' }),
    entry({ url: 'https://example.com/b', status: 404 }),
  ]);
  const withCustom = JSON.stringify({
    log: {
      version: '1.2',
      creator: { name: 'Firebug', version: '1.6', _flag: marker },
      _log: marker,
      entries: [
        entry({
          url: 'https://example.com/a',
          extra: { _initiator: { url: marker }, _status: 999, _url: marker, _priority: 'High' },
          request: {
            _url: marker,
            headers: [{ name: 'Host', value: 'example.com', _hint: marker }],
            _headers: [marker],
          },
          response: { _transferSize: 12345, _status: 500, content: { size: 33, _size: 1, mimeType: 'text/html' } },
        }),
        entry({ url: 'https://example.com/b', status: 404, extra: { _time: 1, time: 85 } }),
      ],
    },
  });
  const a = readHar(plain);
  const b = readHar(withCustom);
  expect(listRequests(b, { ...LIST })).toEqual(listRequests(a, { ...LIST }));
  const detail = requestDetail(b, 1, { reveal: true, bodies: true });
  expect(JSON.stringify(detail)).not.toContain(marker);
  expect(JSON.stringify(detail)).not.toContain('"_');
  // A custom field in the place of a required one is not read as that field.
  const noRequest = refusal(() => readHar(harText([{ _request: {}, response: {} }])));
  expect(noRequest.path).toBe('/log/entries/0/request');
});

it('invalid JSON is refused with its line and column', () => {
  // The first character that cannot begin a value: the comma after the bracket on line 3 (RFC 8259 section 5), the
  // seventeenth character of that line.
  const comma = refusal(() => readHar('{\n  "log": {\n    "entries": [,\n  ]\n  }\n}'));
  expect(comma.line).toBe(3);
  expect(comma.column).toBe(17);
  expect(comma.path).toBeUndefined();
  // Text that stops early is refused at its end.
  const early = refusal(() => readHar('{"log":'));
  expect(early.line).toBe(1);
  expect(early.column).toBe(8);
  // An unquoted name is refused where it starts.
  const unquoted = refusal(() => readHar('{\n  log: {}\n}'));
  expect(unquoted.line).toBe(2);
  expect(unquoted.column).toBe(3);
  // Empty text, and valid JSON that is not a HAR log.
  const empty = refusal(() => readHar(''));
  expect(empty.line).toBe(1);
  expect(empty.column).toBe(1);
  expect(refusal(() => readHar('[]')).path).toBe('/log');
  expect(refusal(() => readHar('{"log":[]}')).path).toBe('/log');
  // A byte order mark in front of the text is allowed.
  expect(readHar(`\u{feff}${harText([])}`).total).toBe(0);
});

it('an entry without a request or response object is refused naming its path', () => {
  const noResponse = refusal(() => readHar(harText([entry(), { startedDateTime: 'x', request: {} }])));
  expect(noResponse.path).toBe('/log/entries/1/response');
  expect(noResponse.message).toContain('/log/entries/1/response');
  expect(refusal(() => readHar(harText([5]))).path).toBe('/log/entries/0');
});

it('a file over 50 MiB is refused before it is read and more than 20000 entries list the first 20000', () => {
  expect(MAX_FILE_BYTES).toBe(52428800);
  expect(MAX_ENTRIES).toBe(20000);
  // The size is checked from the number alone, so a file is refused before any of it is read.
  expect(() => checkFileSize(MAX_FILE_BYTES)).not.toThrow();
  const refused = refusal(() => checkFileSize(MAX_FILE_BYTES + 1));
  expect(refused.message).toContain('52,428,801');
  expect(refused.message).toContain('50 MiB');
  expect(refused.message).toContain('This file');

  // Pasted text over the limit is refused before it is parsed (it is not JSON, so parsing would say so).
  const huge = refusal(() => readHar('x'.repeat(MAX_FILE_BYTES + 1)));
  expect(huge.message).toContain('50 MiB');
  expect(huge.message).toContain('This text');
  // Text of exactly the limit is read: a small recording padded with white space to 52,428,800 bytes.
  const recording = harText([]);
  const exact = recording + ' '.repeat(MAX_FILE_BYTES - recording.length);
  expect(exact.length).toBe(MAX_FILE_BYTES);
  expect(readHar(exact).total).toBe(0);
  // Characters count as bytes: a text of 17,476,267 three-byte characters is over 50 MiB although it is short.
  const wide = '\u{20ac}'.repeat(Math.floor(MAX_FILE_BYTES / 3) + 1);
  expect(refusal(() => readHar(wide)).message).toContain('50 MiB');

  // 20,001 entries: the first 20,000 are listed, all 20,001 are counted, and the recording says it was cut.
  const list = Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => ({
    startedDateTime: '2009-04-16T12:07:23.596Z',
    time: 1,
    request: { method: 'GET', url: `https://example.com/${i}` },
    response: { status: 200, content: { size: 1 } },
    timings: { send: 1 },
  }));
  const har = readHar(harText(list));
  expect(har.total).toBe(MAX_ENTRIES + 1);
  expect(har.entries).toHaveLength(MAX_ENTRIES);
  expect(har.truncated).toBe(true);
  const last = listRequests(har, { ...LIST, page: MAX_ENTRIES / PAGE_SIZE });
  expect(last.total).toBe(MAX_ENTRIES);
  expect(last.rows.at(-1)!.index).toBe(MAX_ENTRIES);
  expect(last.rows.at(-1)!.url).toBe(`https://example.com/${MAX_ENTRIES - 1}`);
  expect(readHar(harText(list.slice(0, MAX_ENTRIES))).truncated).toBe(false);
});

it('a request that is not in the recording is refused naming its number', () => {
  const har = readHar(harText([entry(), entry()]));
  for (const index of [0, 3, -1, 1.5]) {
    const refused = refusal(() => requestDetail(har, index, { reveal: false, bodies: false }));
    expect(refused.message, String(index)).toContain('Request');
  }
  expect(requestDetail(har, 2, { reveal: false, bodies: false }).index).toBe(2);
});

it('a recorded address is never requested and reading, listing and opening change nothing', async () => {
  // A local server named in the recording as the address of a request, its redirect, a header, a cookie domain and
  // inside a body; every part of the package is run on it, and the server must see no request at all.
  const seen: string[] = [];
  const server = createServer((request, response) => {
    seen.push(`${request.method} ${request.url}`);
    response.end('x');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const address = `http://127.0.0.1:${port}`;
  try {
    const text = harText([
      entry({
        url: `${address}/page?token=abcdefghijklmnop`,
        request: {
          headers: [{ name: 'Referer', value: `${address}/from` }],
          cookies: [{ name: 'a', value: 'b', domain: `127.0.0.1:${port}`, path: '/' }],
        },
        response: {
          redirectURL: `${address}/next`,
          headers: [{ name: 'Location', value: `${address}/next` }],
          content: {
            size: 80,
            mimeType: 'text/html',
            text: `<img src="${address}/pixel.png"><script src="${address}/x.js"></script><a href="${address}/y">y</a>`,
          },
        },
      }),
    ]);
    const har = readHar(text);
    const before = JSON.stringify(har);
    const first = [listRequests(har, { ...LIST }), requestDetail(har, 1, { reveal: true, bodies: true })];
    const second = [listRequests(har, { ...LIST }), requestDetail(har, 1, { reveal: true, bodies: true })];
    // The same answer twice, and the recording in memory is the same after as before.
    expect(second).toEqual(first);
    expect(JSON.stringify(har)).toBe(before);
    // The body is only text: the markup in it is returned as it is, never loaded.
    expect(first[1]).toMatchObject({ body: expect.stringContaining(`<img src="${address}/pixel.png">`) });
    await new Promise((resolve) => setTimeout(resolve, 150));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  expect(seen).toEqual([]);
});

it('a recording without a version reads as 1.1 and names the application that wrote it', () => {
  const noVersion = readHar(JSON.stringify({ log: { entries: [] } }));
  expect(noVersion.version).toBe('1.1');
  expect(noVersion.creator).toBe('');
  const named = readHar(harText([]));
  expect(named.creator).toBe('Firebug 1.6');
  expect(readHar(JSON.stringify({ log: { creator: { name: 'Charles' }, entries: [] } })).creator).toBe('Charles');
});

it('times, sizes and statuses at the edges: a blocked time counts, a negative entry time and a missing time are unknown', () => {
  const noStatus = entry();
  delete (noStatus.response as Record<string, unknown>).status;
  const har = readHar(
    harText([
      // blocked 5 + send 1 (the others are not given)
      entry({ timings: { blocked: 5, send: 1 } }),
      // No timings: the entry time is the total, and a negative one is not a time.
      entry({ timings: {}, time: -1 }),
      entry({ timings: {}, extra: { time: undefined } }),
      // bodySize is zero for a response from the cache (the specification's 304 case), and that is a size.
      entry({ content: { size: -1, mimeType: 'text/plain' }, bodySize: 0 }),
      noStatus,
    ]),
  );
  const rows = listRequests(har, { ...LIST }).rows;
  expect(rows.map((row) => row.time)).toEqual(['6', 'unknown', 'unknown', '85', '85']);
  expect(rows[3]!.size).toBe('0 B');
  // A response without a status code reads as 0, and so is not in the class 2xx.
  expect(rows[4]!.status).toBe(0);
  expect(listRequests(har, { ...LIST, status: '2xx' }).rows.map((row) => row.index)).toEqual([1, 2, 3, 4]);

  // The phases a recording leaves out are not recorded, and the entry time is the total then.
  const detail = requestDetail(har, 2, { reveal: false, bodies: false });
  expect(detail.timings).toEqual([
    ['Blocked', 'not recorded'],
    ['DNS', 'not recorded'],
    ['Connect', 'not recorded'],
    ['SSL', 'not recorded'],
    ['Send', 'not recorded'],
    ['Wait', 'not recorded'],
    ['Receive', 'not recorded'],
    ['Total', 'unknown'],
  ]);
  expect(requestDetail(har, 3, { reveal: false, bodies: false }).timings.at(-1)).toEqual(['Total', 'unknown']);
  const own = readHar(harText([entry({ timings: {}, time: 41 })]));
  expect(requestDetail(own, 1, { reveal: false, bodies: false }).timings.at(-1)).toEqual(['Total', '41 ms']);
  expect(requestDetail(har, 1, { reveal: false, bodies: false }).timings.at(-1)).toEqual(['Total', '6 ms']);
});

it('the method filter ignores letter case and white space, and a page must be a whole number', () => {
  const har = readHar(
    harText([
      entry({ method: 'get', url: 'https://example.com/a' }),
      entry({ method: 'POST', url: 'https://example.com/b' }),
    ]),
  );
  const indexes = (method: string) => listRequests(har, { ...LIST, method }).rows.map((row) => row.index);
  expect(indexes('GET')).toEqual([1]);
  expect(indexes('get')).toEqual([1]);
  expect(indexes(' post ')).toEqual([2]);
  expect(indexes('')).toEqual([1, 2]);
  expect(indexes('   ')).toEqual([1, 2]);
  expect(refusal(() => listRequests(har, { ...LIST, page: 1.5 })).message).toContain('Page');
  expect(refusal(() => listRequests(har, { ...LIST, page: Number.NaN })).message).toContain('Page');
});

it('size limits count bytes: two-byte and four-byte characters are counted at their size', () => {
  // 26,214,401 characters of two bytes each are 52,428,802 bytes, over the limit although they are 26 million characters.
  const twoByte = '\u{e9}'.repeat(MAX_FILE_BYTES / 2 + 1);
  expect(refusal(() => readHar(twoByte)).message).toContain('52,428,802');
  // Exactly the limit in two-byte characters is not refused for its size (it is not JSON, so it is refused for that).
  const exactly = refusal(() => readHar('\u{e9}'.repeat(MAX_FILE_BYTES / 2)));
  expect(exactly.message).not.toContain('50 MiB');
  // 13,107,201 characters outside the basic plane are four bytes each: 52,428,804 bytes.
  const fourByte = String.fromCodePoint(0x1f600).repeat(MAX_FILE_BYTES / 4 + 1);
  expect(refusal(() => readHar(fourByte)).message).toContain('52,428,804');
  const fourExactly = refusal(() => readHar(String.fromCodePoint(0x1f600).repeat(MAX_FILE_BYTES / 4)));
  expect(fourExactly.message).not.toContain('50 MiB');
  // Three-byte characters: 17,476,267 of them are 52,428,801 bytes.
  expect(refusal(() => readHar('\u{20ac}'.repeat(Math.floor(MAX_FILE_BYTES / 3) + 1))).message).toContain('52,428,801');
});

it('which MIME types are shown as text: text, JSON, XML, YAML, JavaScript, forms and SVG in any case, with or without parameters', () => {
  const shown = [
    'text/plain',
    'TEXT/HTML',
    'application/json',
    'application/json; charset=utf-8',
    'Application/JSON',
    'application/vnd.api+json',
    'application/ld+json',
    'application/xml',
    'application/atom+xml',
    'application/soap+xml; charset=utf-8',
    'application/yaml',
    'application/x-yaml',
    'application/javascript',
    'application/x-javascript',
    'application/ecmascript',
    'application/x-www-form-urlencoded',
    'application/graphql',
    'application/x-ndjson',
    'image/svg+xml',
    '',
  ];
  const hidden = [
    'image/png',
    'application/octet-stream',
    'application/pdf',
    'font/woff2',
    'audio/mpeg',
    'video/mp4',
    'application/zip',
  ];
  const har = readHar(
    harText([
      ...shown.map((mimeType) => entry({ content: { size: 5, mimeType, text: 'hello' } })),
      ...shown.map((mimeType) => entry({ content: { size: 5, mimeType, text: 'aGVsbG8=', encoding: 'base64' } })),
      ...hidden.map((mimeType) => entry({ content: { size: 5, mimeType, text: 'aGVsbG8=', encoding: 'base64' } })),
      ...hidden.map((mimeType) => entry({ content: { size: 5, mimeType, text: 'hello' } })),
    ]),
  );
  const open = (index: number) => requestDetail(har, index, { reveal: false, bodies: true });
  let index = 1;
  for (const mimeType of [...shown, ...shown]) {
    expect(open(index).body, `${mimeType || '(blank)'} #${index}`).toBe('hello');
    index++;
  }
  for (const mimeType of [...hidden, ...hidden]) {
    expect(open(index).body, `${mimeType} #${index}`).toBeUndefined();
    expect(open(index).bodyNote, `${mimeType} #${index}`).toBe('Binary body not shown (5 bytes).');
    index++;
  }
});

it('binary notes count bytes with grouping, from the Base64 text, or from the declared size, or from the text', () => {
  const fifteenHundred = Buffer.alloc(1500, 0x61).toString('base64');
  const har = readHar(
    harText([
      // 1,500 bytes of valid UTF-8 that is still an image.
      entry({ content: { size: 1500, mimeType: 'image/png', text: fifteenHundred, encoding: 'base64' } }),
      // Padding: one, two and no padding characters. Base64 of 'a', 'ab' and 'abc'.
      entry({ content: { mimeType: 'image/png', text: 'YQ==', encoding: 'base64' } }),
      entry({ content: { mimeType: 'image/png', text: 'YWI=', encoding: 'base64' } }),
      entry({ content: { mimeType: 'image/png', text: 'YWJj', encoding: 'base64' } }),
      // White space inside the Base64 text is allowed.
      entry({ content: { mimeType: 'image/png', text: 'YWJj\nZGVm\r\n', encoding: 'base64' } }),
      // Not encoded and no declared size: the bytes of the text. A declared size of 0 is used.
      entry({ content: { mimeType: 'image/png', text: 'abc' } }),
      entry({ content: { size: 0, mimeType: 'image/png', text: 'abc' } }),
      entry({ content: { size: -1, mimeType: 'image/png', text: '\u{e9}' } }),
      // The encoding name is case-insensitive.
      entry({ content: { mimeType: 'text/plain', text: 'aGVsbG8=', encoding: 'BASE64' } }),
      // Text that is not Base64: a length that leaves one character over, and the URL-safe alphabet.
      entry({ content: { mimeType: 'text/plain', text: 'abcde', encoding: 'base64' } }),
      entry({ content: { mimeType: 'text/plain', text: 'ab-_', encoding: 'base64' } }),
      entry({ content: { mimeType: 'text/plain', text: 'YWJj=', encoding: 'base64' } }),
      entry({ content: { mimeType: 'text/plain', text: 'Y===', encoding: 'base64' } }),
    ]),
  );
  const note = (index: number) => requestDetail(har, index, { reveal: false, bodies: true }).bodyNote;
  expect(note(1)).toBe('Binary body not shown (1,500 bytes).');
  expect(note(2)).toBe('Binary body not shown (1 byte).');
  expect(note(3)).toBe('Binary body not shown (2 bytes).');
  expect(note(4)).toBe('Binary body not shown (3 bytes).');
  expect(note(5)).toBe('Binary body not shown (6 bytes).');
  expect(note(6)).toBe('Binary body not shown (3 bytes).');
  expect(note(7)).toBe('Binary body not shown (0 bytes).');
  expect(note(8)).toBe('Binary body not shown (2 bytes).');
  expect(requestDetail(har, 9, { reveal: false, bodies: true }).body).toBe('hello');
  const invalid = 'The body is marked Base64 but is not valid Base64, so it is not shown.';
  for (const index of [10, 11, 12, 13]) expect(note(index), String(index)).toBe(invalid);
});

it('a body of exactly 102,400 characters is whole, a longer one is cut, and a revealed cut body is not masked', () => {
  const exact = 'x'.repeat(102400);
  const token = `Bearer ${'B'.repeat(30)}`;
  // The credential is in the part that is shown; the cut comes after it.
  const cutText = `${token}${' '.repeat(102400)}`;
  // The credential starts ten characters before the cut and ends after it, and nothing follows it.
  const straddling = `${' '.repeat(102390)}${token}`;
  const har = readHar(
    harText([
      entry({ content: { size: exact.length, mimeType: 'text/plain', text: exact } }),
      entry({ content: { size: cutText.length, mimeType: 'text/plain', text: cutText } }),
      entry({ content: { size: straddling.length, mimeType: 'text/plain', text: straddling } }),
    ]),
  );
  const whole = requestDetail(har, 1, { reveal: false, bodies: true });
  expect(whole.body).toBe(exact);
  expect(whole.bodyNote).toBeUndefined();

  const note = 'The body is 102,437 characters long. The first 102,400 are shown.';
  const masked = requestDetail(har, 2, { reveal: false, bodies: true });
  expect(masked.body).toBe(`Bear… (37 characters)${' '.repeat(102400 - 37)}`);
  expect(masked.bodyNote).toBe(note);
  const revealed = requestDetail(har, 2, { reveal: true, bodies: true });
  expect(revealed.body).toBe(cutText.slice(0, 102400));
  expect(revealed.bodyNote).toBe(note);

  // A cut that would split a credential moves on to its end; when that is the end of the text, nothing is cut.
  const ends = requestDetail(har, 3, { reveal: false, bodies: true });
  expect(ends.body).toBe(`${' '.repeat(102390)}Bear… (37 characters)`);
  expect(ends.bodyNote).toBeUndefined();
  expect(requestDetail(har, 3, { reveal: true, bodies: true }).body).toBe(straddling);
});

it('a cut never shows part of a JWT, a form value or a quoted value: it moves on to the end of it', () => {
  const jwtBody = `${' '.repeat(102390)}${JWT} done`;
  // The value of access_token starts at 102,390, ten characters before the cut.
  const formBody = `${'a=b&'.repeat(25594)}&access_token=${'C'.repeat(40)}&z=1`;
  // The value of access_token starts at 102,390 here too: 8 characters of opening, the padding, 18 of the name.
  const jsonBody = `{"pad":"${'p'.repeat(102364)}","access_token":"${'D'.repeat(40)}"}`;
  // A quoted value, after an escaped quote, that the cut is ten characters inside.
  const opening = '{"a":"x\\"y","pad":"';
  const escaped = `${opening}${'p'.repeat(102400 - opening.length + 10)}","tail":"${'e'.repeat(60)}"}`;
  // A quoted value that does not end within 4,096 characters of the cut: the cut moves on that far and no further.
  const open = `{"a":"${'x'.repeat(300000)}`;
  const har = readHar(
    harText([
      entry({ content: { size: jwtBody.length, mimeType: 'text/plain', text: jwtBody } }),
      entry({ request: { postData: { mimeType: 'application/x-www-form-urlencoded', text: formBody } } }),
      entry({ content: { size: jsonBody.length, mimeType: 'application/json', text: jsonBody } }),
      entry({ content: { size: escaped.length, mimeType: 'application/json', text: escaped } }),
      entry({ content: { size: open.length, mimeType: 'application/json', text: open } }),
    ]),
  );
  // The JWT starts ten characters before the cut and runs on past it.
  const first = requestDetail(har, 1, { reveal: false, bodies: true });
  expect(first.body).toBe(`${' '.repeat(102390)}eyJ0… (${JWT.length} characters)`);
  // The form value after access_token= runs to the next &.
  const second = requestDetail(har, 2, { reveal: false, bodies: true });
  expect(second.postData!.text!.endsWith('&access_token=CCCC… (40 characters)')).toBe(true);
  expect(second.postData!.text).not.toContain('CCCCC');
  expect(second.postData!.note).toContain('are shown');
  // The quoted value of a JSON member that the cut is inside is shown to its closing quote, masked by its name.
  const third = requestDetail(har, 3, { reveal: false, bodies: true });
  expect(third.body!.endsWith('"access_token":"DDDD… (40 characters)"')).toBe(true);
  expect(third.body!.length).toBeLessThan(102400 + 100);
  // An escaped quote earlier in the text does not change which quotes open and close a value.
  const fourth = requestDetail(har, 4, { reveal: true, bodies: true });
  expect(fourth.body).toBe(`${opening}${'p'.repeat(102400 - opening.length + 10)}"`);
  // An unfinished value is shown 4,096 characters past the cut and no more.
  const fifth = requestDetail(har, 5, { reveal: true, bodies: true });
  expect(fifth.body!.length).toBe(102400 + 4096);
  expect(fifth.bodyNote).toContain('are shown');
});

it('cookie attributes are listed as text in the order of the specification', () => {
  const har = readHar(
    harText([
      entry({
        request: {
          cookies: [
            {
              name: 'a',
              value: 'v',
              path: '/p',
              domain: 'example.com',
              expires: '2009-07-24T19:20:30.123+02:00',
              httpOnly: true,
              secure: true,
            },
            { name: 'b', value: 'v', domain: 'example.com' },
            { name: 'c', value: 'v', expires: '2009-07-24T19:20:30.123+02:00' },
            { name: 'd', value: 'v', secure: true, httpOnly: false },
          ],
        },
      }),
    ]),
  );
  const details = requestDetail(har, 1, { reveal: true, bodies: false }).cookies.map((cookie) => cookie.details);
  expect(details).toEqual([
    'Path=/p; Domain=example.com; Expires=2009-07-24T19:20:30.123+02:00; HttpOnly; Secure',
    'Domain=example.com',
    'Expires=2009-07-24T19:20:30.123+02:00',
    'Secure',
  ]);
});

it('a redirect address is masked, a posted body is shown only with bodies, and addresses are counted when there is no query list', () => {
  const secret = 'abcdefghijklmnop';
  const har = readHar(
    harText([
      entry({
        url: `https://example.com/p?token=${secret}`,
        response: { redirectURL: `https://example.com/cb#access_token=${secret}&state=1` },
        request: { postData: { mimeType: 'text/plain', text: 'posted text' } },
      }),
    ]),
  );
  const hidden = requestDetail(har, 1, { reveal: false, bodies: false });
  expect(hidden.response.redirectURL).toBe('https://example.com/cb#access_token=abcd… (16 characters)&state=1');
  expect(hidden.postData).toEqual({ mimeType: 'text/plain', params: [] });
  // No query list, so the token in the address is counted; the redirect is not part of the count.
  expect(hidden.flags).toBe(1);
  expect(listRequests(har, { ...LIST }).rows[0]!.flags).toBe(1);
  expect(requestDetail(har, 1, { reveal: true, bodies: false }).response.redirectURL).toBe(
    `https://example.com/cb#access_token=${secret}&state=1`,
  );
  const shown = requestDetail(har, 1, { reveal: false, bodies: true });
  expect(shown.postData!.text).toBe('posted text');
  // An address with a parameter that is not sensitive in its fragment is left alone, and so is one with no value.
  const plain = readHar(harText([entry({ url: 'https://example.com/p?flag&a=1#section=2' })]));
  expect(listRequests(plain, { ...LIST }).rows[0]!.url).toBe('https://example.com/p?flag&a=1#section=2');
  expect(listRequests(plain, { ...LIST }).rows[0]!.flags).toBe(0);
});

it('the name and shape rules at their edges: words inside names, spaces, and what is not a JWT or a Bearer value', () => {
  // Names: a word inside a longer name, white space around a name, any letter case.
  expect(isSensitive('param', 'user_passwd', 'x')).toBe(true);
  expect(isSensitive('param', ' token ', 'x')).toBe(true);
  expect(isSensitive('param', ' key ', 'x')).toBe(true);
  expect(isSensitive('param', ' SIG ', 'x')).toBe(true);
  expect(isSensitive('param', 'TOKEN', 'x')).toBe(true);
  expect(isSensitive('param', 'Secret-Value', 'x')).toBe(true);
  // Not a JWT: no eyJ start, four parts, characters outside the URL-safe alphabet, an empty payload, a header too
  // short to be base64url of a JSON object.
  expect(isSensitive('header', 'X-Any', 'abc.def.ghi')).toBe(false);
  expect(isSensitive('header', 'X-Any', 'abcdef.ghijkl.mnopqr')).toBe(false);
  expect(isSensitive('header', 'X-Any', 'eyJabc.def.ghi.jkl')).toBe(false);
  expect(isSensitive('header', 'X-Any', 'eyJabcdef.ghi+x.jkl')).toBe(false);
  expect(isSensitive('header', 'X-Any', 'eyJhbGciOiJIUzI1NiJ9..sig')).toBe(false);
  expect(isSensitive('header', 'X-Any', 'eyJ.e30.sig')).toBe(false);
  // White space around a value does not hide its shape.
  expect(isSensitive('header', 'X-Any', `  ${JWT}  `)).toBe(true);
  expect(isSensitive('header', 'X-Any', '  Bearer abc  ')).toBe(true);
  expect(isSensitive('header', 'X-Any', 'Bearer   abc')).toBe(true);
  expect(isSensitive('header', 'X-Any', 'Bearerabc')).toBe(false);
});

it('masking pairs, addresses and bodies at their edges', () => {
  // Pairs: plus is a space and percent escapes are decoded before the value is masked and counted.
  expect(maskPairs('password=ab+cd+ef+gh')).toEqual({ text: 'password=ab c… (11 characters)', count: 1 });
  expect(maskPairs('password=a%20b%20c%20d%20e')).toEqual({ text: 'password=a b … (9 characters)', count: 1 });
  // A bad percent escape does not stop the masking: the value is taken as written.
  expect(maskPairs('password=%E0%A4%A')).toEqual({ text: 'password=… (8 characters)', count: 1 });
  // A piece with no equals sign has no value; the order and separators are kept; every masked value is counted.
  expect(maskPairs('password&q=1')).toEqual({ text: 'password&q=1', count: 0 });
  expect(maskPairs('passwdx&q=1')).toEqual({ text: 'passwdx&q=1', count: 0 });
  expect(maskPairs('password=abcdefghij&token=klmnopqrst&q=1')).toEqual({
    text: 'password=abcd… (10 characters)&token=klmn… (10 characters)&q=1',
    count: 2,
  });

  // Addresses: user information without a password, with an empty one, and a colon far from the user information.
  expect(maskUrl('https://ann@example.com/x')).toEqual({ url: 'https://ann@example.com/x', userinfo: 0, params: 0 });
  expect(maskUrl('https://ann:@example.com/x')).toEqual({ url: 'https://ann:@example.com/x', userinfo: 0, params: 0 });
  expect(maskUrl('https://example.com/a:b/@user')).toEqual({
    url: 'https://example.com/a:b/@user',
    userinfo: 0,
    params: 0,
  });
  expect(maskUrl('https://ann:pw@example.com/x')).toEqual({
    url: 'https://ann:… (2 characters)@example.com/x',
    userinfo: 1,
    params: 0,
  });
  // Parameters in the query and in the fragment are masked and counted.
  expect(maskUrl('https://x/p?token=abcdefghijklmnop&sig=zzzzzzzzzzzz&q=1')).toEqual({
    url: 'https://x/p?token=abcd… (16 characters)&sig=zzzz… (12 characters)&q=1',
    userinfo: 0,
    params: 2,
  });
  expect(maskUrl('https://x/cb#access_token=abcdefghijklmnop&state=1')).toEqual({
    url: 'https://x/cb#access_token=abcd… (16 characters)&state=1',
    userinfo: 0,
    params: 1,
  });
  expect(maskUrl('https://x/p?q=1#top')).toEqual({ url: 'https://x/p?q=1#top', userinfo: 0, params: 0 });

  // Bodies: only a form body is read as form fields, whatever the letter case and spacing of its type.
  const fields = 'x=1&password=abcdefghij';
  expect(maskBodyText(fields, 'text/plain')).toBe(fields);
  expect(maskBodyText(fields, '')).toBe(fields);
  const maskedFields = 'x=1&password=abcd… (10 characters)';
  expect(maskBodyText(fields, 'Application/X-WWW-Form-Urlencoded')).toBe(maskedFields);
  expect(maskBodyText(fields, '  application/x-www-form-urlencoded  ')).toBe(maskedFields);

  // JSON members: spaces around the colon, an escaped name, an escaped quote in a value, a bad escape in a value.
  const bs = String.fromCharCode(92);
  expect(maskBodyText('{"password" : "abcdefghij"}', '')).toBe('{"password" : "abcd… (10 characters)"}');
  expect(maskBodyText(`{"pass${bs}u0077ord":"abcdefghij"}`, '')).toBe(`{"pass${bs}u0077ord":"abcd… (10 characters)"}`);
  expect(maskBodyText(`{"password":"ab${bs}"cdefgh"}`, '')).toBe(`{"password":"ab${bs}"c… (9 characters)"}`);
  expect(maskBodyText(`{"password":"abc${bs}xdefghij"}`, '')).toBe(`{"password":"abc${bs}${bs}… (12 characters)"}`);
  expect(maskBodyText('{"note":"abcdefghij","n":1}', '')).toBe('{"note":"abcdefghij","n":1}');

  // Credentials inside text: any letter case of the scheme, not inside a longer word, dots and padding included,
  // five-part tokens whole, and not a short or a payload-less look-alike.
  expect(maskBodyText('see bearer abcdefghij end', '')).toBe('see bear… (17 characters) end');
  expect(maskBodyText('mybearer abcdefghij', '')).toBe('mybearer abcdefghij');
  expect(maskBodyText('Bearer abc.def.ghi-jkl end', '')).toBe('Bear… (22 characters) end');
  expect(maskBodyText('Bearer abcdefgh== end', '')).toBe('Bear… (17 characters) end');
  const encrypted = ['eyJhbGciOiJkaXIifQ', 'ekey1234', 'iv123456', 'cipher12', 'tag12345'].join('.');
  expect(maskBodyText(`x ${encrypted} y`, '')).toBe(`x eyJh… (${encrypted.length} characters) y`);
  expect(maskBodyText('eyJab.cd.ef', '')).toBe('eyJab.cd.ef');
  expect(maskBodyText('eyJhbGciOiJIUzI1NiJ9..sig', '')).toBe('eyJhbGciOiJIUzI1NiJ9..sig');
});

it('a cut moves over the whole of a credential: its tilde, its padding, and not a run of letters that is too long to be one', () => {
  // The credential 'BB~' then 'B' x 20 starts at 102,397; the character before the cut (index 102,399) is the tilde.
  const tilde = `${' '.repeat(102390)}Bearer BB~${'B'.repeat(20)} end`;
  // The credential 'BBB' ends at 102,399 and its padding '==' begins at the cut.
  const padded = `${' '.repeat(102390)}Bearer BBB== end`;
  // A run of 200,000 letters after an equals sign is too long to be a credential and is cut where the limit says.
  const letters = `x=${'a'.repeat(200000)}`;
  const har = readHar(
    harText([
      entry({ content: { size: tilde.length, mimeType: 'text/plain', text: tilde } }),
      entry({ content: { size: padded.length, mimeType: 'text/plain', text: padded } }),
      entry({ content: { size: letters.length, mimeType: 'text/plain', text: letters } }),
    ]),
  );
  const open = (index: number) => requestDetail(har, index, { reveal: false, bodies: true });
  expect(open(1).body).toBe(`${' '.repeat(102390)}Bear… (30 characters)`);
  expect(open(1).bodyNote).toContain('are shown');
  expect(open(2).body).toBe(`${' '.repeat(102390)}Bear… (12 characters)`);
  expect(open(2).bodyNote).toContain('are shown');
  expect(open(3).body).toBe(letters.slice(0, 102400));
  expect(open(3).bodyNote).toBe('The body is 200,002 characters long. The first 102,400 are shown.');
});

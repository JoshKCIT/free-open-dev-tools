import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HarViewerError, listRequests, readHar } from '../src/index';

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
 *    also included in the connect field", so it is not added a second time.
 *  - the example request address is http://www.example.com/path/?param=value and the example start time
 *    2009-04-16T12:07:23.596Z; the example content size is 33 and bodySize 850, where "size: Length of the returned
 *    content in bytes" is the size of the content and "bodySize: Size of the received response body in bytes" the
 *    size as received, and -1 means the information is not available.
 *  - "version [string] - Version number of the format. If empty, string 1.1 is assumed by default", and the
 *    specification's own check for a reader that supports HAR since 1.1: a major version other than 1 or a minor
 *    version below 1 is incompatible (so 0.8, 0.9 and 1.0 and 2.x are refused, 1.1, 1.2 and 1.112 are read).
 *
 * Nothing here treats this folder's own output as the expected value.
 */

const SPEC_TIMINGS = { blocked: 0, dns: -1, connect: 15, send: 20, wait: 38, receive: 12, ssl: -1, comment: '' };

interface EntryParts {
  started?: string;
  method?: string;
  url?: string;
  status?: number;
  content?: Record<string, unknown>;
  bodySize?: number;
  timings?: Record<string, unknown>;
  time?: number;
}

/** One entry with the fields the specification lists for it. */
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
    },
    cache: {},
    timings: parts.timings ?? SPEC_TIMINGS,
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

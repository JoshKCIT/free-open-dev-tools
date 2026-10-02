import { expect, it } from 'vitest';
import { listRequests, readHar, requestDetail } from '../src/index';
import { maskBodyText, maskPairs, maskUrl, maskValue } from '../src/sensitive';

/*
 * Masking rules, checked at the edges the review of phase 13 found.
 *
 * The expected values are worked out by hand from the rules the page states (not copied from this package's output):
 * a masked value keeps min(4, floor(length / 4)) characters and its length, and keeps none when the name holds
 * password, passwd, secret, pwd or is pass or passcode; RFC 3986 section 3.2.1 says an application should not render as
 * clear text any data after the first colon of the user information, and the WHATWG URL Standard ends the user
 * information at the last at sign before the first slash, question mark or number sign of the authority.
 */

const LIST = { filter: '', method: '', status: '', sort: 'start', reveal: false, page: 1 } as const;

interface Parts {
  url?: string;
  status?: number;
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
  content?: Record<string, unknown>;
}

function entry(parts: Parts = {}): Record<string, unknown> {
  return {
    startedDateTime: '2009-04-16T12:07:23.596Z',
    time: 85,
    request: {
      method: 'GET',
      url: parts.url ?? 'https://example.com/',
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
      content: parts.content ?? { size: 33, mimeType: 'text/plain' },
      redirectURL: '',
      headersSize: 160,
      bodySize: 33,
      ...parts.response,
    },
    cache: {},
    timings: { send: 1, wait: 2, receive: 3 },
  };
}

function har(entries: unknown[]) {
  return readHar(JSON.stringify({ log: { version: '1.2', creator: { name: 'test', version: '1' }, entries } }));
}

const HUNTER = 'hunter2024';

it('a masked value keeps min(4, floor(length / 4)) characters, and none when the name holds password, passwd or secret', () => {
  // Length 1 to 3 keeps none, 4 to 7 keeps one, 8 to 11 keeps two, 12 to 15 keeps three, 16 and more keep four.
  expect(maskValue('abc')).toBe('… (3 characters)');
  expect(maskValue('abcd')).toBe('a… (4 characters)');
  expect(maskValue('abcdefg')).toBe('a… (7 characters)');
  expect(maskValue('abcdefgh')).toBe('ab… (8 characters)');
  expect(maskValue(HUNTER)).toBe('hu… (10 characters)');
  expect(maskValue('abcdefghijkl')).toBe('abc… (12 characters)');
  expect(maskValue('abcdefghijklmno')).toBe('abc… (15 characters)');
  expect(maskValue('abcdefghijklmnop')).toBe('abcd… (16 characters)');
  expect(maskValue('a'.repeat(100))).toBe(`aaaa… (100 characters)`);
  expect(maskValue('')).toBe('');
  // Characters are counted as code points, so ten faces keep two of them.
  const face = String.fromCodePoint(0x1f600);
  expect(maskValue(face.repeat(10))).toBe(`${face.repeat(2)}… (10 characters)`);

  // A name that holds password, passwd or secret (any case) keeps none, whatever the length.
  for (const name of ['password', 'PASSWORD', 'new_password', 'passwd', 'client_secret', 'Secret', 'pwd', 'pass']) {
    expect(maskValue('abcdefghijklmnopqrstuvwxyz', name), name).toBe('… (26 characters)');
  }
  // Another name keeps what the length allows.
  expect(maskValue('abcdefghijklmnopqrstuvwxyz', 'token')).toBe('abcd… (26 characters)');
  expect(maskValue(HUNTER, 'api_key')).toBe('hu… (10 characters)');
});

it('every masked view applies the same short-value rule: query lists, form pairs, JSON members, cookies, addresses', () => {
  const recording = har([
    entry({
      url: `https://ann:${HUNTER}@example.com/p?password=${HUNTER}&token=${HUNTER}`,
      request: {
        headers: [{ name: 'X-Auth-Token', value: HUNTER }],
        cookies: [{ name: 'session', value: HUNTER }],
        queryString: [
          { name: 'password', value: HUNTER },
          { name: 'token', value: HUNTER },
        ],
        postData: { mimeType: 'application/x-www-form-urlencoded', params: [{ name: 'passwd', value: HUNTER }] },
      },
      content: { size: 1, mimeType: 'application/json', text: `{"password":"${HUNTER}","key":"${HUNTER}"}` },
    }),
  ]);
  const detail = requestDetail(recording, 1, { reveal: false, bodies: true });
  expect(detail.url).toBe(
    'https://ann:… (10 characters)@example.com/p?password=… (10 characters)&token=hu… (10 characters)',
  );
  expect(detail.headers[0]!.value).toBe('hu… (10 characters)');
  expect(detail.cookies[0]!.value).toBe('hu… (10 characters)');
  expect(detail.query.map((q) => q.value)).toEqual(['… (10 characters)', 'hu… (10 characters)']);
  expect(detail.postData!.params[0]!.value).toBe('… (10 characters)');
  expect(detail.body).toBe('{"password":"… (10 characters)","key":"hu… (10 characters)"}');
  expect(listRequests(recording, { ...LIST }).rows[0]!.url).toBe(detail.url);

  expect(maskPairs(`password=${HUNTER}&token=${HUNTER}`).text).toBe(
    'password=… (10 characters)&token=hu… (10 characters)',
  );
  expect(maskUrl(`https://ann:${HUNTER}@example.com/`).url).toBe('https://ann:… (10 characters)@example.com/');
  expect(maskBodyText(`{"client_secret":"${HUNTER}"}`, 'application/json')).toBe(
    '{"client_secret":"… (10 characters)"}',
  );
});

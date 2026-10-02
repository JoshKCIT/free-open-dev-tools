import { expect, it } from 'vitest';
import { listRequests, readHar, requestDetail } from '../src/index';
import { isSensitive, maskBodyText, maskPairs, maskUrl, maskValue } from '../src/sensitive';

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

/** A token-shaped string assembled from pieces, so no file holds a literal that looks like a real credential. */
const PAT = ['ghp', '_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('');

it('the user information of an address ends at the last at sign of its authority, so a password holding one is masked whole', () => {
  expect(maskUrl('https://user:p@ss@host.example/x')).toEqual({
    url: 'https://user:… (4 characters)@host.example/x',
    userinfo: 1,
    params: 0,
  });
  // Several at signs and colons: the password is everything after the first colon.
  expect(maskUrl('https://a:b@c:d@host/')).toEqual({ url: 'https://a:… (5 characters)@host/', userinfo: 1, params: 0 });
  // A percent-encoded at sign is decoded before counting.
  expect(maskUrl('https://ann:p%40ss@host/')).toEqual({
    url: 'https://ann:… (4 characters)@host/',
    userinfo: 1,
    params: 0,
  });
  // An address with no scheme but the two slashes.
  expect(maskUrl('//ann:secret1@host/x').url).toBe('//ann:… (7 characters)@host/x');
  // An at sign after the authority belongs to the path, the query or the fragment, not to the user information.
  for (const url of [
    'https://example.com/a@b:c@d',
    'https://example.com/p?next=a:b@c',
    'https://example.com?x=u:p@y',
    'https://example.com#u:p@y',
    'https://ann:@example.com/x',
    'https://ann@example.com/x',
  ]) {
    expect(maskUrl(url), url).toEqual({ url, userinfo: 0, params: 0 });
  }
});

it('a token used as the user name of an address is masked, with or without a password, and an ordinary name is not', () => {
  expect(maskUrl(`https://${PAT}@github.com/o/r.git`)).toEqual({
    url: 'https://ghp_… (40 characters)@github.com/o/r.git',
    userinfo: 1,
    params: 0,
  });
  expect(maskUrl(`https://${PAT}:x-oauth-basic@github.com/o/r.git`)).toEqual({
    url: 'https://ghp_… (40 characters):… (13 characters)@github.com/o/r.git',
    userinfo: 1,
    params: 0,
  });
  // A long name of letters and digits with no dots is token-shaped; a name with dots, a short name, a name of letters
  // only and an address-like name (a phishing look-alike) are shown as they are.
  const longName = ['k9x2', 'm4q7', 'z1c8', 'v5b3', 'n6w0'].join('');
  expect(maskUrl(`https://${longName}@host/`).userinfo).toBe(1);
  for (const name of ['admin', 'login.example.com.attacker', 'abcdefghijklmnopqrstuvwxyz', 'build-bot']) {
    expect(maskUrl(`https://${name}@host/`), name).toEqual({ url: `https://${name}@host/`, userinfo: 0, params: 0 });
  }
});

it('the list and the detail mask a password holding an at sign and count it once', () => {
  const recording = har([entry({ url: 'https://user:p@ss@host.example/x', request: { queryString: [] } })]);
  const detail = requestDetail(recording, 1, { reveal: false, bodies: false });
  expect(detail.url).toBe('https://user:… (4 characters)@host.example/x');
  expect(detail.flags).toBe(1);
  const row = listRequests(recording, { ...LIST }).rows[0]!;
  expect(row.url).toBe(detail.url);
  expect(row.flags).toBe(1);
  expect(listRequests(recording, { ...LIST, filter: 'ss@host' }).total).toBe(0);
  expect(listRequests(recording, { ...LIST, filter: 'ss@host', reveal: true }).total).toBe(1);
  const named = har([entry({ url: `https://${PAT}@github.com/o/r.git` })]);
  expect(listRequests(named, { ...LIST }).rows[0]).toMatchObject({
    url: 'https://ghp_… (40 characters)@github.com/o/r.git',
    flags: 1,
  });
});

it('a header name follows the same word rule as a parameter name, and the word list covers the usual names of a key, a session, a signature and a credential', () => {
  // Header names that used to be shown in clear.
  for (const name of [
    'X-Access-Token',
    'Api-Key',
    'X-Amz-Security-Token',
    'x-goog-api-key',
    'Ocp-Apim-Subscription-Key',
    'X-Session-Id',
    'X-Amz-Signature',
    'X-Credential',
    'X-Auth',
    'X-Pwd',
  ]) {
    expect(isSensitive('header', name, 'some-value'), name).toBe(true);
  }
  // Parameter names that used to be shown in clear or not recognised.
  for (const name of [
    'x-amz-signature',
    'auth',
    'sessionid',
    'PHPSESSID',
    'pwd',
    'pass',
    'credential',
    'credentials',
    'x-goog-api-key',
    'ocp-apim-subscription-key',
    'apiKey',
    'accessKey',
    'privatekey',
    'session_token',
  ]) {
    expect(isSensitive('param', name, 'some-value'), name).toBe(true);
  }
  // Ordinary names stay readable: a word has to be a whole part of the name, except the long ones that are never
  // part of anything else.
  for (const name of [
    'Host',
    'Accept',
    'Content-Type',
    'Cache-Control',
    'User-Agent',
    'WWW-Authenticate',
    'Content-Length',
    'author',
    'authority',
    'monkey',
    'keyboard',
    'design',
    'passenger',
    'compass',
    'sort',
    'page',
    'q',
  ]) {
    expect(isSensitive('header', name, 'some-value'), `header ${name}`).toBe(false);
    expect(isSensitive('param', name, 'some-value'), `param ${name}`).toBe(false);
  }
});

it('a parameter list is split at a semicolon as well as at an ampersand, and a secret after a semicolon is masked', () => {
  expect(maskPairs('a=1;token=abcdefghijkl')).toEqual({ text: 'a=1;token=abc… (12 characters)', count: 1 });
  expect(maskPairs('a=1;b=2;password=hunter2024&c=3')).toEqual({
    text: 'a=1;b=2;password=… (10 characters)&c=3',
    count: 1,
  });
  // A sensitive name takes everything after its equals sign up to the next ampersand, semicolons included.
  expect(maskPairs('token=abc;def&q=1')).toEqual({ text: 'token=a… (7 characters)&q=1', count: 1 });
  // Nothing to mask: unchanged, order kept.
  expect(maskPairs('a=1;b=2&c=x;y')).toEqual({ text: 'a=1;b=2&c=x;y', count: 0 });
  expect(maskUrl('https://x/p?a=1;token=abcdefghijklmnop')).toEqual({
    url: 'https://x/p?a=1;token=abcd… (16 characters)',
    userinfo: 0,
    params: 1,
  });
});

it('headers named like a token, a key or a signature are masked, flagged and counted in the list and the detail', () => {
  const recording = har([
    entry({
      request: {
        headers: [
          { name: 'X-Access-Token', value: 'abcdefghijklmnop' },
          { name: 'Api-Key', value: 'abcdefghijklmnop' },
          { name: 'Accept', value: 'text/html' },
        ],
        queryString: [{ name: 'x-amz-signature', value: 'abcdefghijklmnop' }],
      },
      response: { headers: [{ name: 'X-Amz-Security-Token', value: 'abcdefghijklmnop' }] },
    }),
  ]);
  const detail = requestDetail(recording, 1, { reveal: false, bodies: false });
  expect(detail.headers.map((h) => [h.value, h.sensitive])).toEqual([
    ['abcd… (16 characters)', true],
    ['abcd… (16 characters)', true],
    ['text/html', false],
  ]);
  expect(detail.query[0]).toMatchObject({ value: 'abcd… (16 characters)', sensitive: true });
  expect(detail.response.headers[0]).toMatchObject({ value: 'abcd… (16 characters)', sensitive: true });
  expect(detail.flags).toBe(4);
  expect(listRequests(recording, { ...LIST }).rows[0]!.flags).toBe(4);
});

import { expect, it, vi } from 'vitest';
import {
  PkceBuilderError,
  buildAuthorizationRequest,
  checkRedirectUri,
  checkVerifier,
  hasOpenidScope,
  percentEncode,
  randomBase64Url,
  readRedirect,
  tokenRequestText,
} from '../src/index';
import { fields, seeded } from './helpers';
import { HOSTILE, MAX_SCALING_RATIO, scalingRatio } from './scaling';

// A marker that stands for a secret a visitor pasted. It is built from letters and hyphens, so it is a legal verifier
// character set and a legal parameter value, and no message or masked value may ever hold all of it.
const MARK = 'zq8-MARKER-4471-zq8';

/** The message of the refusal a call throws, or null when it does not throw. */
async function refusal(call: () => unknown): Promise<PkceBuilderError | null> {
  try {
    await call();
    return null;
  } catch (err) {
    if (err instanceof PkceBuilderError) return err;
    throw err;
  }
}

it('refusals and masked values never repeat a whole pasted value', async () => {
  const errors: Array<PkceBuilderError | null> = [
    // A paste, a verifier, a scope and an address that are too long, each starting with the marker.
    await refusal(() => readRedirect(MARK + 'a'.repeat(65_540), {})),
    await refusal(() => checkVerifier(MARK + 'a'.repeat(16_400))),
    await refusal(() => buildAuthorizationRequest(fields({ scope: MARK + 'a'.repeat(2_100) }))),
    await refusal(() =>
      buildAuthorizationRequest(fields({ authorizeUrl: `https://idp.example/${MARK}${'a'.repeat(16_400)}` })),
    ),
    await refusal(() => buildAuthorizationRequest(fields({ redirectUri: MARK + 'a'.repeat(16_400) }))),
    await refusal(() => buildAuthorizationRequest(fields({ loginHint: MARK + 'a'.repeat(16_400) }))),
    // More than 200 parameters, with the marker in the names.
    await refusal(() => readRedirect('?' + Array.from({ length: 201 }, (_, i) => `${MARK}${i}=1`).join('&'), {})),
    await refusal(() =>
      buildAuthorizationRequest(
        fields({
          authorizeUrl: 'https://idp.example/a?' + Array.from({ length: 200 }, (_, i) => `${MARK}${i}=1`).join('&'),
        }),
      ),
    ),
    // A fragment, a scheme and a space in the endpoint, and an unpaired surrogate in a value, all with the marker.
    await refusal(() => buildAuthorizationRequest(fields({ authorizeUrl: `https://idp.example/${MARK}#${MARK}` }))),
    await refusal(() => buildAuthorizationRequest(fields({ authorizeUrl: `ftp://idp.example/${MARK}` }))),
    await refusal(() => buildAuthorizationRequest(fields({ authorizeUrl: `https://idp.example/${MARK} ${MARK}` }))),
    await refusal(() => buildAuthorizationRequest(fields({ state: `\ud800${MARK}` }))),
    // A verifier that breaks a rule, and a random source that misbehaves.
    await refusal(() => buildAuthorizationRequest(fields({ verifier: `${MARK} ${MARK}` }))),
    await refusal(() => buildAuthorizationRequest(fields({ verifier: '', random: () => new Uint8Array(1) }))),
    await refusal(() => randomBase64Url(MARK.length, () => new Uint8Array(1))),
  ];
  for (const error of errors) {
    expect(error).toBeInstanceOf(PkceBuilderError);
    expect(error?.message).not.toContain(MARK);
    expect(error?.message).not.toContain('—');
  }
  // The findings of a request and of a redirect address never hold the pasted text either.
  const request = await buildAuthorizationRequest(
    fields({
      scope: `openid "${MARK}`,
      redirectUri: `myapp:/${MARK}`,
      authorizeUrl: `http://idp.example/${MARK}?client_id=${MARK}`,
    }),
  );
  expect(request.problems.length).toBeGreaterThan(2);
  for (const problem of request.problems) expect(problem.message).not.toContain(MARK);
  for (const finding of checkRedirectUri(`http://client.example.org/${MARK}#${MARK}`)) {
    expect(finding.message).not.toContain(MARK);
  }

  // A pasted token is shown as its first characters and its length, never whole, in every place the report holds it.
  const token = `${MARK}ABCDEFGH`;
  const identity = `eyJ${MARK}.payload.signature`;
  const report = readRedirect(
    `https://client.example.org/cb#access_token=${token}&id_token=${identity}&refresh_token=${MARK}&state=s`,
    {},
  );
  const everything = JSON.stringify(report);
  expect(everything).not.toContain(token);
  expect(everything).not.toContain(identity);
  expect(everything).not.toContain(MARK);
  expect(report.parameters.filter((parameter) => parameter.masked).map((parameter) => parameter.name)).toEqual([
    'access_token',
    'id_token',
    'refresh_token',
  ]);
  expect(report.tokens[0]?.value).toBe(`${MARK.slice(0, 4)}... (${token.length} characters)`);
  expect(report.notes.every((note) => !note.message.includes(MARK))).toBe(true);
  // A value of one, two, three or four characters is never shown whole.
  for (const short of ['a', 'ab', 'abc', 'abcd']) {
    const masked = readRedirect(`#access_token=${short}`, {}).parameters[0]?.value ?? '';
    expect(masked).not.toBe(short);
    expect(masked).toContain(short.length === 1 ? '(1 character)' : `(${short.length} characters)`);
  }
  // The token request text and the made values hold only what the visitor gave or what was made for them.
  expect(tokenRequestText({ clientId: 'c', redirectUri: '', verifier: null }).body).not.toContain(MARK);
});

it('query keys __proto__, constructor and toString are plain names', async () => {
  const names = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'prototype', '__defineGetter__'];
  const text = '?' + names.map((name, i) => `${name}=${i}`).join('&') + '&__proto__=again&state=s';
  const report = readRedirect(text, { state: 's' });
  // Every name is an entry of an ordered list, in the order written, repeats included.
  expect(report.parameters.map((parameter) => parameter.name)).toEqual([...names, '__proto__', 'state']);
  expect(report.parameters.map((parameter) => parameter.value)).toEqual([
    '0',
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    'again',
    's',
  ]);
  // Only the response parameters are found, and nothing was added to any object.
  expect(report.found.map((item) => item.name)).toEqual(['state']);
  expect(report.error).toBeNull();
  expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  expect(Object.keys(Object.prototype)).toEqual([]);
  // The same names in a fragment and as a bare form body are plain names too.
  expect(readRedirect(`#${names[0]}=x&${names[1]}=y`, {}).parameters.map((parameter) => parameter.name)).toEqual([
    names[0],
    names[1],
  ]);
  expect(readRedirect('__proto__=1&constructor=2', {}).parameters).toHaveLength(2);
  // A query on the endpoint with those names is kept as written, and only a name this page writes is reported as repeated.
  const request = await buildAuthorizationRequest(
    fields({
      authorizeUrl: 'https://idp.example/authorize?__proto__=x&constructor=y&toString=z&client_id=old',
      scope: '__proto__ openid',
    }),
  );
  expect(
    request.url.startsWith(
      'https://idp.example/authorize?__proto__=x&constructor=y&toString=z&client_id=old&response_type=code&',
    ),
  ).toBe(true);
  const repeated = request.problems.filter((problem) => problem.message.includes('already holds'));
  expect(repeated).toHaveLength(1);
  expect(repeated[0]?.message).toContain('client_id');
  expect(hasOpenidScope('__proto__ constructor openid')).toBe(true);
  expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
});

it('a URL over 16,384 characters, a paste over 65,536, a scope over 2,048 or more than 200 parameters are refused before work', async () => {
  // A paste of exactly 65,536 characters is read; one more is refused, naming the part, the size and the limit.
  expect(() => readRedirect('a'.repeat(65_536), {})).not.toThrow();
  const paste = await refusal(() => readRedirect('a'.repeat(65_537), {}));
  expect(paste?.part).toBe('redirect');
  expect(paste?.message).toContain('65,537');
  expect(paste?.message).toContain('65,536');
  // An endpoint, a redirect address and any other field: 16,384 characters at most.
  const endpoint = await refusal(() =>
    buildAuthorizationRequest(fields({ authorizeUrl: 'https://idp.example/' + 'a'.repeat(16_365) })),
  );
  expect(endpoint?.part).toBe('endpoint');
  expect(endpoint?.message).toContain('16,385');
  expect(endpoint?.message).toContain('16,384');
  expect((await refusal(() => buildAuthorizationRequest(fields({ redirectUri: 'a'.repeat(16_385) }))))?.part).toBe(
    'redirect uri',
  );
  expect((await refusal(() => buildAuthorizationRequest(fields({ clientId: 'a'.repeat(16_385) }))))?.part).toBe(
    'length',
  );
  expect((await refusal(() => checkVerifier('a'.repeat(16_385))))?.part).toBe('verifier');
  // A built address that would pass 16,384 characters is refused, even when each field alone is allowed.
  const together = await refusal(() =>
    buildAuthorizationRequest(
      fields({
        authorizeUrl: 'https://idp.example/' + 'a'.repeat(10_000),
        loginHint: 'b'.repeat(4_000),
        acrValues: 'c'.repeat(4_000),
      }),
    ),
  );
  expect(together?.part).toBe('length');
  expect(together?.message).toContain('16,384');
  // A scope of exactly 2,048 characters is built; one more is refused.
  const scope = await buildAuthorizationRequest(fields({ scope: 'a'.repeat(2_048) }));
  expect(scope.url.length).toBeLessThan(16_384);
  const longScope = await refusal(() => buildAuthorizationRequest(fields({ scope: 'a'.repeat(2_049) })));
  expect(longScope?.part).toBe('scope');
  expect(longScope?.message).toContain('2,049');
  expect(longScope?.message).toContain('2,048');
  // 200 parameters are read; 201 are refused. In a request the endpoint's own query counts with the ones written.
  const many = (count: number) => '?' + Array.from({ length: count }, (_, i) => `p${i}=1`).join('&');
  expect(readRedirect(many(200), {}).parameters).toHaveLength(200);
  const tooMany = await refusal(() => readRedirect(many(201), {}));
  expect(tooMany?.part).toBe('redirect');
  expect(tooMany?.message).toContain('200');
  // Empty pieces between ampersands are not parameters and do not count.
  expect(readRedirect('?' + '&'.repeat(10_000) + 'a=1', {}).parameters).toHaveLength(1);
  const queryOnEndpoint = await refusal(() =>
    buildAuthorizationRequest(fields({ authorizeUrl: 'https://idp.example/a' + many(195) })),
  );
  expect(queryOnEndpoint?.part).toBe('endpoint');
  expect(queryOnEndpoint?.message).toContain('200');
});

it('the same input gives the same report every time and nothing is printed', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const first = 'https://client.example.org/cb?code=abc&state=xyz&iss=https%3A%2F%2Fidp.example#a=1&a=2';
  const second = '?error=access_denied&error_description=No+way';
  const a = readRedirect(first, { state: 'xyz', issuer: 'https://idp.example' });
  const b = readRedirect(second, {});
  for (let round = 0; round < 3; round++) {
    expect(readRedirect(first, { state: 'xyz', issuer: 'https://idp.example' })).toStrictEqual(a);
    expect(readRedirect(second, {})).toStrictEqual(b);
    expect(readRedirect(second, {})).toStrictEqual(b);
    expect(readRedirect(first, { state: 'xyz', issuer: 'https://idp.example' })).toStrictEqual(a);
  }
  const one = await buildAuthorizationRequest(fields({ verifier: '', state: '', nonce: '', random: seeded(11) }));
  const two = await buildAuthorizationRequest(fields({ random: seeded(12) }));
  expect(
    await buildAuthorizationRequest(fields({ verifier: '', state: '', nonce: '', random: seeded(11) })),
  ).toStrictEqual(one);
  expect(await buildAuthorizationRequest(fields({ random: seeded(12) }))).toStrictEqual(two);
  expect(checkVerifier('a'.repeat(43))).toStrictEqual(checkVerifier('a'.repeat(43)));
  expect(percentEncode('a b', 'length')).toBe('a%20b');
  expect(log).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

it('every parser stays linear on hostile input', () => {
  const own: ReadonlyArray<(n: number) => string> = [
    (n) => '%'.repeat(n),
    (n) => '%41'.repeat(Math.floor(n / 3)),
    (n) => '&'.repeat(n),
    (n) => '?'.repeat(n),
    (n) => '#'.repeat(n),
    (n) => 'a'.repeat(n) + '=' + 'b+'.repeat(n),
    (n) => '?a=' + '%E2%82%AC'.repeat(Math.floor(n / 9)),
    (n) => 'https://client.example.org/cb?' + 'x'.repeat(n) + '#' + 'y'.repeat(n),
  ];
  const hostile = [...HOSTILE, ...own];
  const size = 4_000;
  const parsers: Array<[string, (input: string) => unknown, number]> = [
    ['readRedirect', (input) => readRedirect(input, { state: input, issuer: input }), size],
    ['checkVerifier', (input) => checkVerifier(input), size],
    ['checkRedirectUri', (input) => checkRedirectUri(input), size],
    ['percentEncode', (input) => percentEncode(input, 'length'), size],
    ['hasOpenidScope', (input) => hasOpenidScope(input), size],
    // The part of a request that runs before the digest: every field is read, encoded and counted. A rejection is caught.
    [
      'buildAuthorizationRequest scope',
      (input) => void buildAuthorizationRequest(fields({ responseType: 'token', scope: input })).catch(() => undefined),
      1_000,
    ],
    [
      'buildAuthorizationRequest query',
      (input) =>
        void buildAuthorizationRequest(
          fields({ responseType: 'token', authorizeUrl: `https://idp.example/a?${input}` }),
        ).catch(() => undefined),
      3_000,
    ],
  ];
  for (const [name, parse, n] of parsers) {
    for (const [index, make] of hostile.entries()) {
      const ratio = scalingRatio(parse, make, n);
      expect(
        ratio,
        `${name} on hostile string ${index} took ${ratio.toFixed(1)} times as long when the input doubled`,
      ).toBeLessThan(MAX_SCALING_RATIO);
    }
  }
});

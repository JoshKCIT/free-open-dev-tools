import { expect, it } from 'vitest';
import {
  PkceBuilderError,
  buildAuthorizationRequest,
  hasOpenidScope,
  percentEncode,
  tokenRequestText,
} from '../src/index';
import { APPENDIX_B_CHALLENGE, APPENDIX_B_VERIFIER, fields, seeded } from './helpers';

// Literals are retyped from RFC 6749 section 4.1.1, RFC 7636 appendix B and OpenID Connect Core 1.0 section 3.1.2.1
// (see fixtures/oidc/NOTICE.md). Node's URL and URLSearchParams are the second opinion for every built address.

const EXTRAS = {
  responseMode: 'query',
  display: 'popup',
  prompt: 'login',
  maxAge: 300,
  uiLocales: 'fr-CA fr en',
  loginHint: 'joé+test@example.org',
  acrValues: 'urn:mace:incommon:iap:silver urn:b',
};

it('a built authorization request gives back every parameter through URL and keeps an existing query', async () => {
  // RFC 6749 section 3.1: an existing query on the endpoint "MUST be retained when adding additional query parameters".
  const request = await buildAuthorizationRequest(
    fields({
      authorizeUrl: 'https://idp.example/authorize?tenant=a',
      redirectUri: 'https://client.example.org/cb?x=1&y=a b',
      state: 'a b+c%d&e=f',
      ...EXTRAS,
    }),
  );
  const parsed = new URL(request.url);
  expect(parsed.origin + parsed.pathname).toBe('https://idp.example/authorize');
  expect(parsed.searchParams.getAll('tenant')).toEqual(['a']);
  // Every parameter is written once, in a fixed order, and its value comes back through URL and URLSearchParams.
  expect([...parsed.searchParams.keys()]).toEqual([
    'tenant',
    'response_type',
    'client_id',
    'redirect_uri',
    'scope',
    'state',
    'nonce',
    'code_challenge',
    'code_challenge_method',
    'response_mode',
    'display',
    'prompt',
    'max_age',
    'ui_locales',
    'login_hint',
    'acr_values',
  ]);
  expect(request.parameters.map((parameter) => parameter.name)).toEqual([
    'response_type',
    'client_id',
    'redirect_uri',
    'scope',
    'state',
    'nonce',
    'code_challenge',
    'code_challenge_method',
    'response_mode',
    'display',
    'prompt',
    'max_age',
    'ui_locales',
    'login_hint',
    'acr_values',
  ]);
  for (const parameter of request.parameters) {
    expect(parsed.searchParams.getAll(parameter.name)).toEqual([parameter.value]);
    // The written form is one percent-encoding of the value, so decoding it once gives the value back.
    expect(decodeURIComponent(parameter.written)).toBe(parameter.value);
  }
  expect(parsed.searchParams.get('state')).toBe('a b+c%d&e=f');
  expect(parsed.searchParams.get('redirect_uri')).toBe('https://client.example.org/cb?x=1&y=a b');
  expect(parsed.searchParams.get('login_hint')).toBe('joé+test@example.org');
  expect(parsed.searchParams.get('max_age')).toBe('300');
  expect(parsed.searchParams.get('code_challenge')).toBe(APPENDIX_B_CHALLENGE);
  expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
  // The endpoint text is kept as typed, the query after it grows with an ampersand, and a trailing ampersand is not doubled.
  expect(request.url.startsWith('https://idp.example/authorize?tenant=a&response_type=code&')).toBe(true);
  const trailing = await buildAuthorizationRequest(fields({ authorizeUrl: 'https://idp.example/authorize?tenant=a&' }));
  expect(trailing.url.startsWith('https://idp.example/authorize?tenant=a&response_type=code&')).toBe(true);
  const bare = await buildAuthorizationRequest(fields({ authorizeUrl: 'https://idp.example/authorize?' }));
  expect(bare.url.startsWith('https://idp.example/authorize?response_type=code&')).toBe(true);
  // RFC 6749 section 4.1.1 example (no scope) and RFC 7636 appendix B give this exact address.
  const rfc = await buildAuthorizationRequest(
    fields({ authorizeUrl: 'https://server.example.com/authorize', scope: '', nonce: '' }),
  );
  expect(rfc.url).toBe(
    'https://server.example.com/authorize?response_type=code&client_id=s6BhdRkqt3&redirect_uri=https%3A%2F%2Fclient.example.org%2Fcb&state=xyz&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256',
  );
  // OpenID Connect Core section 3.1.2.1: the example request's parameters are all in a request for the same fields.
  const oidc = await buildAuthorizationRequest(
    fields({ scope: 'openid profile email', state: 'af0ifjsldkj', nonce: 'abc' }),
  );
  const oidcParams = new URL(oidc.url).searchParams;
  const example = new URLSearchParams(
    'response_type=code&scope=openid%20profile%20email&client_id=s6BhdRkqt3&state=af0ifjsldkj&redirect_uri=https%3A%2F%2Fclient.example.org%2Fcb',
  );
  for (const [name, value] of example) expect(oidcParams.getAll(name)).toEqual([value]);
  // A parameter with no value is not written, and a parameter already on the endpoint is named as a finding.
  const repeated = await buildAuthorizationRequest(
    fields({ authorizeUrl: 'https://idp.example/authorize?client_id=old' }),
  );
  expect(repeated.problems.some((problem) => problem.tone === 'warn' && problem.message.includes('client_id'))).toBe(
    true,
  );
  const none = await buildAuthorizationRequest(fields({ redirectUri: '', scope: '', nonce: '' }));
  expect(none.parameters.map((parameter) => parameter.name)).toEqual([
    'response_type',
    'client_id',
    'state',
    'code_challenge',
    'code_challenge_method',
  ]);
});

it('spaces in a scope are written as percent-encoded spaces, never as plus signs', async () => {
  // RFC 6749 section 3.3 separates scope values with a space; OpenID Connect Core section 3.1.2.1 writes openid%20profile%20email.
  const request = await buildAuthorizationRequest(fields({ scope: 'openid profile email' }));
  expect(request.url).toContain('scope=openid%20profile%20email');
  expect(request.url).not.toContain('+');
  expect(new URL(request.url).searchParams.get('scope')).toBe('openid profile email');
  // A plus sign inside a value is written as %2B, so it can never be read as a space.
  const plus = await buildAuthorizationRequest(fields({ scope: 'a+b c', loginHint: 'x y+z' }));
  expect(plus.url).toContain('scope=a%2Bb%20c');
  expect(plus.url).toContain('login_hint=');
  expect(plus.url).not.toContain('+');
  expect(new URL(plus.url).searchParams.get('scope')).toBe('a+b c');
  // Only the unreserved characters of RFC 3986 section 2.3 are left as they are.
  expect(percentEncode('AZaz09-._~', 'length')).toBe('AZaz09-._~');
  expect(percentEncode("!'()* /?#&=+%", 'length')).toBe('%21%27%28%29%2A%20%2F%3F%23%26%3D%2B%25');
  expect(percentEncode('é\u{1f600}', 'length')).toBe('%C3%A9%F0%9F%98%80');
  // Extra spaces between scope values are written as one, and the page says so.
  const extra = await buildAuthorizationRequest(fields({ scope: '  openid   profile ' }));
  expect(extra.url).toContain('scope=openid%20profile&');
  expect(extra.problems.some((problem) => problem.tone === 'info' && problem.message.includes('scope'))).toBe(true);
  // A character a scope value may not hold (RFC 6749 section 3.3) is named as a finding, never echoed.
  const quoted = await buildAuthorizationRequest(fields({ scope: 'open"id' }));
  const quoteFinding = quoted.problems.find((problem) => problem.message.includes('U+0022'));
  expect(quoteFinding?.tone).toBe('warn');
  expect(quoteFinding?.message).not.toContain('open"id');
});

it('an endpoint with a fragment is refused', async () => {
  // RFC 6749 section 3.1: "The endpoint URI MUST NOT include a fragment component."
  for (const endpoint of [
    'https://idp.example/authorize#x',
    'https://idp.example/authorize?a=b#',
    'https://idp.example/authorize#',
  ]) {
    let thrown: unknown = null;
    try {
      await buildAuthorizationRequest(fields({ authorizeUrl: endpoint }));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(PkceBuilderError);
    expect((thrown as PkceBuilderError).part).toBe('endpoint');
    expect((thrown as PkceBuilderError).message).toContain('fragment');
    expect((thrown as PkceBuilderError).message).not.toContain('idp.example');
  }
  // An endpoint that is not an absolute http or https address, or holds a space or a control character, is refused too.
  for (const endpoint of [
    '',
    'idp.example/authorize',
    'ftp://idp.example/a',
    'https://',
    'https://idp.example/a b',
    'https://idp.example/a\u0007',
  ]) {
    await expect(buildAuthorizationRequest(fields({ authorizeUrl: endpoint }))).rejects.toBeInstanceOf(
      PkceBuilderError,
    );
  }
  // A redirect address with a fragment is not refused: the request is built and the fragment is a finding.
  const withFragment = await buildAuthorizationRequest(fields({ redirectUri: 'https://client.example.org/cb#x' }));
  expect(withFragment.problems.some((problem) => problem.tone === 'warn' && problem.message.includes('fragment'))).toBe(
    true,
  );
});

it('a nonce is made only when the scope holds openid, and response type token adds no challenge and is flagged', async () => {
  expect(hasOpenidScope('openid profile')).toBe(true);
  expect(hasOpenidScope('profile  openid')).toBe(true);
  expect(hasOpenidScope('openid2 profile')).toBe(false);
  expect(hasOpenidScope('')).toBe(false);
  const withOpenid = await buildAuthorizationRequest(fields({ nonce: '', random: seeded(5) }));
  expect(withOpenid.made.map((value) => value.name)).toEqual(['nonce']);
  expect(withOpenid.parameters.some((parameter) => parameter.name === 'nonce')).toBe(true);
  const without = await buildAuthorizationRequest(fields({ scope: 'profile', nonce: 'typed', random: seeded(5) }));
  expect(without.parameters.some((parameter) => parameter.name === 'nonce')).toBe(false);
  expect(without.made).toEqual([]);
  // RFC 9700 section 2.1.2: clients SHOULD NOT use the implicit grant (response type token).
  const implicit = await buildAuthorizationRequest(fields({ responseType: 'token' }));
  expect(implicit.parameters.map((parameter) => parameter.name)).toEqual([
    'response_type',
    'client_id',
    'redirect_uri',
    'scope',
    'state',
    'nonce',
  ]);
  expect(implicit.challenge).toBeNull();
  expect(implicit.verifier).toBeNull();
  expect(implicit.url).toContain('response_type=token');
  const flag = implicit.problems.find((problem) => problem.message.includes('RFC 9700'));
  expect(flag?.tone).toBe('warn');
  // OpenID Connect extras without the openid scope are named as a finding; a missing client_id is too.
  const loose = await buildAuthorizationRequest(fields({ scope: 'profile', prompt: 'login', clientId: '' }));
  expect(loose.problems.some((problem) => problem.message.includes('OpenID Connect'))).toBe(true);
  expect(loose.problems.some((problem) => problem.message.includes('client_id'))).toBe(true);
  expect(loose.parameters.some((parameter) => parameter.name === 'client_id')).toBe(false);
  // OpenID Connect Core section 3.1.2.1 requires redirect_uri; RFC 6749 section 3.1.2 does not.
  const noRedirect = await buildAuthorizationRequest(fields({ redirectUri: '' }));
  expect(noRedirect.problems.some((problem) => problem.message.includes('redirect_uri'))).toBe(true);
  // RFC 6749 section 3.1: the authorization endpoint must require TLS, so an http endpoint is flagged.
  const http = await buildAuthorizationRequest(fields({ authorizeUrl: 'http://idp.example/authorize' }));
  expect(http.problems.some((problem) => problem.tone === 'warn' && problem.message.includes('TLS'))).toBe(true);
});

it('the token request text carries the verifier and a placeholder for the code and never a secret', () => {
  // RFC 6749 section 4.1.3 and RFC 7636 section 4.5: grant_type, code, redirect_uri, client_id and code_verifier.
  const text = tokenRequestText({
    clientId: 's6BhdRkqt3',
    redirectUri: 'https://client.example.org/cb',
    verifier: APPENDIX_B_VERIFIER,
  });
  expect(text.body).toContain('Content-Type: application/x-www-form-urlencoded');
  expect(text.body).toContain(
    'grant_type=authorization_code&code=PASTE_THE_CODE_FROM_THE_REDIRECT&redirect_uri=https%3A%2F%2Fclient.example.org%2Fcb&client_id=s6BhdRkqt3&code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
  );
  expect(text.note).toContain('server');
  expect(text.note).toContain('secret');
  const withoutVerifier = tokenRequestText({ clientId: '', redirectUri: '', verifier: null });
  expect(withoutVerifier.body).toContain('grant_type=authorization_code&code=PASTE_THE_CODE_FROM_THE_REDIRECT');
  expect(withoutVerifier.body).not.toContain('code_verifier');
  expect(withoutVerifier.body).not.toContain('client_id');
});

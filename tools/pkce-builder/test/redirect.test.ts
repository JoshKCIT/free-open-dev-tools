import { expect, it } from 'vitest';
import { OAUTH_ERRORS, OIDC_ERRORS, checkRedirectUri, readRedirect, type RedirectReport } from '../src/index';

// Literals are retyped from RFC 6749 (sections 4.1.2, 4.1.2.1 and appendix B), RFC 8252 (sections 7.1, 7.3 and 8.3),
// RFC 9207 section 2.4 and OpenID Connect Core 1.0 (see fixtures/oidc/NOTICE.md).

const NO_EXPECTATION = {};

function read(text: string, expected: { state?: string; issuer?: string } = NO_EXPECTATION): RedirectReport {
  return readRedirect(text, expected);
}

/** The first value of a found parameter, or undefined. */
function found(report: RedirectReport, name: string): string | undefined {
  return report.found.find((item) => item.name === name)?.value;
}

function tones(report: RedirectReport): string[] {
  return report.notes.map((note) => `${note.tone}: ${note.message}`);
}

it('the RFC 6749 section 4.1.2 and 4.1.2.1 redirect examples read back their code, state and error', () => {
  // RFC 6749 section 4.1.2: Location: https://client.example.com/cb?code=SplxlOBeZQQYbYS6WxSbIA&state=xyz
  const success = read('https://client.example.com/cb?code=SplxlOBeZQQYbYS6WxSbIA&state=xyz', { state: 'xyz' });
  expect(success.form).toBe('address');
  expect(found(success, 'code')).toBe('SplxlOBeZQQYbYS6WxSbIA');
  expect(found(success, 'state')).toBe('xyz');
  expect(success.error).toBeNull();
  expect(success.found.every((item) => item.place === 'query')).toBe(true);
  expect(success.notes.some((note) => note.tone === 'success' && note.message.includes('state'))).toBe(true);

  // RFC 6749 section 4.1.2.1: Location: https://client.example.com/cb?error=access_denied&state=xyz
  const denied = read('https://client.example.com/cb?error=access_denied&state=xyz', { state: 'xyz' });
  expect(found(denied, 'error')).toBe('access_denied');
  expect(found(denied, 'state')).toBe('xyz');
  expect(found(denied, 'code')).toBeUndefined();
  expect(denied.error?.code).toBe('access_denied');
  expect(denied.error?.known).toBe(true);
  expect(denied.error?.sentence).toBe(OAUTH_ERRORS.get('access_denied'));
  expect(denied.notes.some((note) => note.tone === 'warn' && note.message.includes('access_denied'))).toBe(true);

  // The examples are wrapped for display in the RFC: tabs and line breaks inside an address are dropped, and a pasted
  // Location header line is read the same way.
  const wrapped = read('Location: https://client.example.com/cb?code=SplxlOBeZQQYbYS6WxSbIA\n&state=xyz\r\n');
  expect(found(wrapped, 'code')).toBe('SplxlOBeZQQYbYS6WxSbIA');
  expect(found(wrapped, 'state')).toBe('xyz');

  // RFC 6749 section 4.1.2.1: the seven codes each have a plain sentence, and nothing else is in the table.
  expect([...OAUTH_ERRORS.keys()]).toEqual([
    'invalid_request',
    'unauthorized_client',
    'access_denied',
    'unsupported_response_type',
    'invalid_scope',
    'server_error',
    'temporarily_unavailable',
  ]);
  for (const sentence of OAUTH_ERRORS.values()) expect(sentence.length).toBeGreaterThan(20);
  for (const code of OAUTH_ERRORS.keys()) {
    const report = read(`https://client.example.com/cb?error=${code}&state=xyz`);
    expect(report.error?.sentence).toBe(OAUTH_ERRORS.get(code));
  }
  // A code that is not in the table is said to be unknown, and its description and address are shown.
  const unknown = read('?error=teapot&error_description=I%27m%20a%20teapot&error_uri=https%3A%2F%2Fidp.example%2Fe');
  expect(unknown.error?.known).toBe(false);
  expect(found(unknown, 'error_description')).toBe("I'm a teapot");
  expect(found(unknown, 'error_uri')).toBe('https://idp.example/e');
});

it('the OpenID Connect Core examples read back their code, state, error and description', () => {
  // OpenID Connect Core section 3.1.2.5: Location: https://client.example.org/cb?code=SplxlOBeZQQYbYS6WxSbIA&state=af0ifjsldkj
  const success = read('https://client.example.org/cb?code=SplxlOBeZQQYbYS6WxSbIA&state=af0ifjsldkj', {
    state: 'af0ifjsldkj',
  });
  expect(found(success, 'code')).toBe('SplxlOBeZQQYbYS6WxSbIA');
  expect(found(success, 'state')).toBe('af0ifjsldkj');
  // OpenID Connect Core section 3.1.2.6: the error example with a percent-encoded description.
  const error = read(
    'https://client.example.org/cb?error=invalid_request&error_description=Unsupported%20response_type%20value&state=af0ifjsldkj',
  );
  expect(found(error, 'error')).toBe('invalid_request');
  expect(found(error, 'error_description')).toBe('Unsupported response_type value');
  expect(error.error?.sentence).toBe(OAUTH_ERRORS.get('invalid_request'));
  // OpenID Connect Core section 3.1.2.6 adds codes of its own, which are explained too.
  for (const code of [
    'interaction_required',
    'login_required',
    'account_selection_required',
    'consent_required',
    'invalid_request_uri',
    'invalid_request_object',
    'request_not_supported',
    'request_uri_not_supported',
    'registration_not_supported',
  ]) {
    expect(OIDC_ERRORS.has(code)).toBe(true);
    const report = read(`?error=${code}&state=s`);
    expect(report.error?.known).toBe(true);
    expect(report.error?.sentence).toBe(OIDC_ERRORS.get(code));
  }
  // OpenID Connect Core section 3.2.2.5, the implicit flow: the response is in the fragment.
  const implicit = read(
    'https://client.example.org/cb#access_token=SlAV32hkKG&token_type=bearer&expires_in=3600&state=af0ifjsldkj',
  );
  expect(implicit.parameters.map((parameter) => parameter.place)).toEqual([
    'fragment',
    'fragment',
    'fragment',
    'fragment',
  ]);
  expect(found(implicit, 'state')).toBe('af0ifjsldkj');
});

it('a redirect is read from the query and the fragment, with repeated parameters kept in order', () => {
  // Both the query and the fragment are read; the query comes first, then the fragment, each in the order written.
  const both = read('https://client.example.org/cb?a=1&b=2&a=3#c=4&a=5');
  expect(both.readFrom).toEqual(['query', 'fragment']);
  expect(both.parameters.map((parameter) => [parameter.place, parameter.name, parameter.value])).toEqual([
    ['query', 'a', '1'],
    ['query', 'b', '2'],
    ['query', 'a', '3'],
    ['fragment', 'c', '4'],
    ['fragment', 'a', '5'],
  ]);
  // A fragment alone, a query alone, and a form body are each read.
  const fragment = read('#access_token=SlAV32hkKG&token_type=bearer&state=xyz');
  expect(fragment.form).toBe('fragment');
  expect(fragment.parameters.map((parameter) => parameter.name)).toEqual(['access_token', 'token_type', 'state']);
  expect(read('?code=abc&state=xyz').form).toBe('query');
  const body = read('code=abc&state=xyz');
  expect(body.form).toBe('form body');
  expect(body.parameters.map((parameter) => parameter.place)).toEqual(['body', 'body']);
  expect(found(body, 'code')).toBe('abc');
  // A question mark after the fragment starts belongs to the fragment, and empty pieces between ampersands are skipped.
  const odd = read('https://client.example.org/cb#x=1?y=2&&z');
  expect(odd.parameters.map((parameter) => [parameter.name, parameter.value])).toEqual([
    ['x', '1?y=2'],
    ['z', ''],
  ]);
  // A repeated code or state is said to repeat; the first one is the one shown as found.
  const repeated = read('?code=one&code=two&state=a&state=b');
  expect(found(repeated, 'code')).toBe('one');
  expect(repeated.found.find((item) => item.name === 'code')?.count).toBe(2);
  expect(
    tones(repeated).some((line) => line.startsWith('warn') && line.includes('code') && line.includes('more than once')),
  ).toBe(true);
  // Nothing found is said so.
  expect(tones(read('https://client.example.org/cb')).some((line) => line.includes('No code, error or token'))).toBe(
    true,
  );
  expect(read('').parameters).toEqual([]);
});

it('a plus sign is a space and an encoded plus sign stays a plus sign, in the query and the fragment alike', () => {
  // RFC 6749 appendix B: application/x-www-form-urlencoded writes a space as a plus sign.
  const query = read('?a=b+c&d=b%2Bc&e=%E2%82%AC&f=%zz&g=%41%');
  expect(query.parameters.map((parameter) => parameter.value)).toEqual(['b c', 'b+c', '€', '%zz', 'A%']);
  const fragment = read('#a=b+c&d=b%2Bc');
  expect(fragment.parameters.map((parameter) => parameter.value)).toEqual(['b c', 'b+c']);
  // A name is decoded the same way, and a piece with no equals sign is a name with an empty value.
  const names = read('?my+name=1&flag&%61=2');
  expect(names.parameters.map((parameter) => [parameter.name, parameter.value])).toEqual([
    ['my name', '1'],
    ['flag', ''],
    ['a', '2'],
  ]);
});

it('the returned state is compared with the expected one and a missing state is a warning', () => {
  // RFC 6749 section 4.1.2: state is "The exact value received from the client".
  const same = tones(read('?code=abc&state=xyz', { state: 'xyz' }));
  expect(same.some((line) => line.startsWith('success') && line.includes('matches'))).toBe(true);
  const differs = tones(read('?code=abc&state=abc', { state: 'xyz' }));
  expect(differs.some((line) => line.startsWith('warn') && line.includes('does not match'))).toBe(true);
  // A state that differs only in letter case or in a trailing space is a different state.
  expect(tones(read('?code=abc&state=XYZ', { state: 'xyz' })).some((line) => line.includes('does not match'))).toBe(
    true,
  );
  expect(tones(read('?code=abc&state=xyz%20', { state: 'xyz' })).some((line) => line.includes('does not match'))).toBe(
    true,
  );
  // Without an expected state the returned one is shown and the page says nothing was compared.
  const unchecked = tones(read('?code=abc&state=xyz'));
  expect(unchecked.some((line) => line.startsWith('info') && line.includes('not compared'))).toBe(true);
  // RFC 6749 section 4.1.2.1: an error response without a state. A missing state is a warning, with or without an expectation.
  for (const expected of [NO_EXPECTATION, { state: 'xyz' }]) {
    const missing = tones(read('https://client.example.com/cb?error=access_denied', expected));
    expect(missing.some((line) => line.startsWith('warn') && line.includes('No state'))).toBe(true);
  }
});

it('the issuer is compared as a simple string and a missing issuer is a warning when one is expected', () => {
  // RFC 9207 section 2.4: "This comparison MUST use simple string comparison".
  const issuer = 'https://idp.example';
  const same = tones(read(`?code=abc&state=s&iss=${encodeURIComponent(issuer)}`, { issuer }));
  expect(same.some((line) => line.startsWith('success') && line.includes('iss'))).toBe(true);
  const other = tones(read(`?code=abc&state=s&iss=${encodeURIComponent(issuer + '/')}`, { issuer }));
  expect(other.some((line) => line.startsWith('warn') && line.includes('iss') && line.includes('does not match'))).toBe(
    true,
  );
  const absent = tones(read('?code=abc&state=s', { issuer }));
  expect(absent.some((line) => line.startsWith('warn') && line.includes('iss'))).toBe(true);
  // No expected issuer: nothing is said about iss when it is absent.
  expect(tones(read('?code=abc&state=s')).some((line) => /\biss\b/.test(line))).toBe(false);
});

it('tokens are shown only as present with their first characters and their length', () => {
  // OpenID Connect Core section 3.2.2.5 shows access_token=SlAV32hkKG in a fragment (ten characters).
  const report = read(
    'https://client.example.org/cb#access_token=SlAV32hkKG&id_token=eyJ0abcdefghij.payload.sig&refresh_token=abcd&state=s',
  );
  const byName = (name: string) => report.parameters.find((parameter) => parameter.name === name);
  expect(byName('access_token')?.masked).toBe(true);
  expect(byName('access_token')?.value).toBe('SlAV... (10 characters)');
  expect(byName('id_token')?.value).toBe('eyJ0... (26 characters)');
  expect(byName('id_token')?.value).not.toContain('payload');
  // A value of four characters or fewer is never shown whole.
  expect(byName('refresh_token')?.value).toBe('ab... (4 characters)');
  expect(report.tokens.map((token) => token.name)).toEqual(['access_token', 'id_token']);
  expect(report.tokens[0]?.length).toBe(10);
  // The implicit grant puts an access token in the address: RFC 9700 section 2.1.2.
  expect(tones(report).some((line) => line.startsWith('warn') && line.includes('RFC 9700'))).toBe(true);
  // A parameter that is not a token is shown as it is.
  expect(byName('state')?.value).toBe('s');
});

it('the redirect address rules of RFC 6749 section 3.1.2 and RFC 8252 judge private-use, loopback and localhost addresses', () => {
  const messages = (text: string): string[] => checkRedirectUri(text).map((finding) => finding.message);
  // Accepted: https, RFC 8252 section 7.1 (a private-use scheme written from a domain name) and section 7.3 (loopback IP literals).
  expect(messages('https://client.example.org/cb')).toEqual([]);
  expect(messages('com.example.app:/oauth2redirect?code=abc')).toEqual([]);
  expect(messages('http://127.0.0.1:51004/cb?code=abc')).toEqual([]);
  expect(messages('http://127.0.0.1:51004/oauth2redirect/example-provider')).toEqual([]);
  expect(messages('http://[::1]:61023/oauth2redirect/example-provider')).toEqual([]);
  // RFC 8252 section 8.3: localhost is NOT RECOMMENDED.
  const localhost = checkRedirectUri('http://localhost:8080/cb');
  expect(localhost).toHaveLength(1);
  expect(localhost[0]?.tone).toBe('warn');
  expect(localhost[0]?.message).toContain('NOT RECOMMENDED');
  expect(checkRedirectUri('https://localhost/cb').some((finding) => finding.message.includes('NOT RECOMMENDED'))).toBe(
    true,
  );
  // RFC 6749 section 3.1.2: absolute, no fragment. RFC 6749 section 3.1.2.1: TLS.
  expect(messages('/cb').some((message) => message.includes('absolute'))).toBe(true);
  expect(messages('client.example.org/cb').some((message) => message.includes('absolute'))).toBe(true);
  expect(messages('').some((message) => message.includes('absolute'))).toBe(true);
  expect(messages('https://client.example.org/cb#x').some((message) => message.includes('fragment'))).toBe(true);
  expect(messages('http://client.example.org/cb').some((message) => message.includes('TLS'))).toBe(true);
  // RFC 8252 section 7.1: a private-use scheme without a period, such as myapp, is not based on a domain name.
  expect(messages('myapp:/cb').some((message) => message.includes('period'))).toBe(true);
  expect(messages('javascript:alert(1)').some((message) => message.includes('period'))).toBe(true);
  // No finding ever repeats the address.
  for (const text of ['myapp:/secret-path', 'https://client.example.org/secret-path#frag', '/secret-path']) {
    for (const message of messages(text)) expect(message).not.toContain('secret-path');
  }
});

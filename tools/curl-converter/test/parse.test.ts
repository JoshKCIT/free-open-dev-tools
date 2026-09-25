import { it, expect } from 'vitest';
import { parseCurl, SUPPORTED_OPTIONS } from '../src/parse-curl';
import { CurlConverterError } from '../src/model';

it('request, header, data, user and url options fill the request fields the curl manual describes', () => {
  const { request } = parseCurl("curl -X POST 'https://example.invalid/a b' -H \"X-A: 1\" -d 'x=1' -d 'y=2'");
  expect(request.method).toBe('POST');
  expect(request.url).toBe('https://example.invalid/a b');
  expect(request.headers).toContainEqual(['X-A', '1']);
  expect(request.body).toEqual({
    kind: 'form',
    pairs: [
      ['x', '1'],
      ['y', '2'],
    ],
  });

  const withUser = parseCurl('curl -u alice:s3cret https://example.invalid/');
  expect(withUser.request.auth).toEqual({ kind: 'basic', user: 'alice', password: 's3cret' });

  const withUrlFlag = parseCurl('curl --url https://example.invalid/x');
  expect(withUrlFlag.request.url).toBe('https://example.invalid/x');
});

it('data options imply POST, get moves data into the query and head means HEAD as the curl manual states', () => {
  expect(parseCurl('curl -d x=1 https://example.invalid/').request.method).toBe('POST');
  expect(parseCurl('curl https://example.invalid/').request.method).toBe('GET');

  const get = parseCurl('curl -G -d q=1 https://example.invalid/s');
  expect(get.request.method).toBe('GET');
  expect(get.request.url).toBe('https://example.invalid/s?q=1');
  expect(get.request.body).toEqual({ kind: 'none' });

  const head = parseCurl('curl -I https://example.invalid');
  expect(head.request.method).toBe('HEAD');
});

it('repeated data options are joined with an ampersand and data-urlencode encodes as the curl manual describes', () => {
  const joined = parseCurl('curl -d x=1 -d y=2 https://example.invalid/');
  expect(joined.request.body).toEqual({
    kind: 'form',
    pairs: [
      ['x', '1'],
      ['y', '2'],
    ],
  });

  const encoded = parseCurl(`curl --data-urlencode 'name=a value&b' https://example.invalid/`);
  expect(encoded.request.body).toEqual({ kind: 'form', pairs: [['name', 'a%20value%26b']] });

  const bare = parseCurl(`curl --data-urlencode 'a b' https://example.invalid/`);
  expect((bare.request.body as { kind: 'form'; pairs: [string, string][] }).pairs[0]![0]).toBe('a%20b');

  const eqPrefixed = parseCurl(`curl --data-urlencode '=a b' https://example.invalid/`);
  expect((eqPrefixed.request.body as { kind: 'form'; pairs: [string, string][] }).pairs[0]![0]).toBe('a%20b');
});

it('json sets the JSON content type and accept headers as the curl manual describes', () => {
  const { request } = parseCurl(`curl --json '{"a":1}' https://example.invalid/`);
  expect(request.method).toBe('POST');
  expect(request.body).toEqual({ kind: 'json', text: '{"a":1}' });
  expect(request.headers).toContainEqual(['Content-Type', 'application/json']);
  expect(request.headers).toContainEqual(['Accept', 'application/json']);
});

it('form options become multipart text fields and file parts are reported as not readable here', () => {
  const { request, warnings } = parseCurl('curl -F name=alice -F avatar=@photo.png https://example.invalid/');
  expect(request.method).toBe('POST');
  expect(request.body).toEqual({
    kind: 'multipart',
    fields: [
      { name: 'name', value: 'alice', isFile: false },
      { name: 'avatar', value: 'photo.png', isFile: true },
    ],
  });
  expect(warnings.some((w) => w.includes('avatar') && w.includes('not readable here'))).toBe(true);

  const formString = parseCurl("curl --form-string 'note=@not-a-file' https://example.invalid/");
  expect(formString.request.body).toEqual({
    kind: 'multipart',
    fields: [{ name: 'note', value: '@not-a-file', isFile: false }],
  });
});

it('combined short options and attached values such as -sSL and -XPOST are read correctly', () => {
  const { request, ignored, warnings } = parseCurl('curl -sSL -XPUT https://example.invalid/ --compressed --retry 3');
  expect(request.method).toBe('PUT');
  expect(request.followRedirects).toBe(true);
  expect(request.compressed).toBe(true);
  expect(ignored).toEqual(expect.arrayContaining(['-s', '-S']));
  expect(warnings.some((w) => w.includes('--retry'))).toBe(true);

  const attachedHeader = parseCurl('curl -HX-A:1 https://example.invalid/');
  expect(attachedHeader.request.headers).toContainEqual(['X-A', '1']);
});

it('unsupported options are listed in a warning rather than dropped silently', () => {
  const { warnings } = parseCurl('curl --retry 3 https://example.invalid/');
  expect(warnings.some((w) => w.includes('--retry'))).toBe(true);
  expect(SUPPORTED_OPTIONS).toContain('--header');
  expect(SUPPORTED_OPTIONS).toContain('-H');
});

it('a header name that is not an RFC 9110 token or a header value with a line break is refused', () => {
  const badName = parseCurl('curl -H "bad header: 1" https://example.invalid/');
  expect(badName.warnings.some((w) => w.includes('not a valid header name'))).toBe(true);

  expect(() => parseCurl(String.raw`curl -H $'X-A: 1\nX-Evil: 2' https://example.invalid/`)).toThrow(
    CurlConverterError,
  );
});

it('a header value carrying a carriage return or a NUL byte decoded from ANSI-C quoting is refused the same way, via the copied assertSingleLine guard', () => {
  expect(() => parseCurl(String.raw`curl -H $'X-A: 1\r\nX-Evil: 2' https://example.invalid/`)).toThrow(
    CurlConverterError,
  );
  expect(() => parseCurl(String.raw`curl -H $'X-A: 1\x00' https://example.invalid/`)).toThrow(CurlConverterError);
});

it('the first word of the command must be curl', () => {
  expect(() => parseCurl('wget https://example.invalid/')).toThrow(CurlConverterError);
});

it('a bare URL word or --url gives the request URL, and a scheme is assumed with a warning when none is given', () => {
  const { request, warnings } = parseCurl('curl example.invalid/path');
  expect(request.url).toBe('http://example.invalid/path');
  expect(warnings.some((w) => w.includes('http://'))).toBe(true);

  expect(() => parseCurl('curl ftp://example.invalid/')).toThrow(CurlConverterError);
});

it('a user value with no colon warns that curl would prompt for the password', () => {
  const { request, warnings } = parseCurl('curl -u alice https://example.invalid/');
  expect(request.auth).toEqual({ kind: 'basic', user: 'alice', password: '' });
  expect(warnings.some((w) => w.includes('prompt'))).toBe(true);
});

it('an --oauth2-bearer token becomes bearer authentication', () => {
  const { request } = parseCurl('curl --oauth2-bearer tok123 https://example.invalid/');
  expect(request.auth).toEqual({ kind: 'bearer', token: 'tok123' });
});

import { expect, it } from 'vitest';
import {
  checkCors,
  corsUnsafeRequestHeaderNames,
  describeRequest,
  isCorsSafelistedRequestHeader,
  type CorsInput,
} from '../src/index';
import { parseMimeEssence } from '../src/mime';

/*
 * The CORS-safelisted request-header rules, as the Fetch Standard (https://fetch.spec.whatwg.org/ at commit e9460d1,
 * fetch.bs lines 1014 to 1150) writes them. The expected values are worked out by hand from that text:
 *  - a value longer than 128 bytes is unsafe first, whatever the name;
 *  - accept: no CORS-unsafe request-header byte, which is a byte below 0x20 other than 0x09, or one of
 *    " ( ) : < > ? @ [ \ ] { } and 0x7F;
 *  - accept-language and content-language: only 0-9, A-Z, a-z, space, * , - . ; =;
 *  - content-type: no CORS-unsafe byte, parses as a MIME type, and the essence is application/x-www-form-urlencoded,
 *    multipart/form-data or text/plain;
 *  - range: a single range with a start (bytes=0- is safe, bytes=-500 and bytes 0- are not);
 *  - any other name is unsafe;
 *  - when the values of the safelisted headers add up to more than 1,024 bytes, all of them count as unsafe.
 * A value is counted one byte per character, as the fetch API counts a ByteString.
 */

const PAGE = 'http://page.example:8000';

function input(parts: Partial<CorsInput> = {}): CorsInput {
  return {
    pageOrigin: PAGE,
    url: 'http://remote.example:8000/items',
    method: 'GET',
    mode: 'cors',
    credentials: 'same-origin',
    requestHeaders: '',
    preflightStatus: 200,
    preflightHeaders: '',
    responseStatus: 200,
    responseHeaders: 'Access-Control-Allow-Origin: *',
    ...parts,
  };
}

const safe = (name: string, value: string): boolean => isCorsSafelistedRequestHeader(name, value);

it('a request header value of 128 bytes is safelisted and one of 129 bytes is not', () => {
  const padded: [string, (n: number) => string][] = [
    ['accept', (n) => 'a'.repeat(n)],
    ['Accept-Language', (n) => 'a'.repeat(n)],
    ['content-language', (n) => 'a'.repeat(n)],
    ['Content-Type', (n) => 'text/plain;' + 'a'.repeat(n - 11)],
    ['range', (n) => 'bytes=0-' + '9'.repeat(n - 8)],
  ];
  for (const [name, make] of padded) {
    expect(make(128).length, name).toBe(128);
    expect(safe(name, make(1 + 10)), `${name} short`).toBe(true);
    expect(safe(name, make(128)), `${name} at 128`).toBe(true);
    expect(safe(name, make(129)), `${name} at 129`).toBe(false);
    expect(safe(name, make(1_000)), `${name} at 1000`).toBe(false);
  }
  // The same through the whole check: no preflight at 128, a preflight at 129, with the name in the line.
  const at128 = checkCors(input({ requestHeaders: `Accept: ${'a'.repeat(128)}` }));
  expect(at128.plan.preflight.sent).toBe(false);
  expect(at128.verdict).toBe('readable');
  const at129 = checkCors(
    input({
      requestHeaders: `Accept: ${'a'.repeat(129)}`,
      preflightHeaders: 'Access-Control-Allow-Origin: *\nAccess-Control-Allow-Headers: accept',
    }),
  );
  expect(at129.plan.preflight.sent).toBe(true);
  expect(at129.plan.preflight.accessControlRequestHeaders).toBe('accept');
  expect(at129.verdict).toBe('readable');
  // A name that is not in the safelist is unsafe at any length, and the name is compared without regard to letter case.
  expect(safe('x-a', 'a')).toBe(false);
  expect(safe('Authorization', '')).toBe(false);
  expect(safe('ACCEPT', 'text/html')).toBe(true);
  expect(safe('Accept-Encoding', 'gzip')).toBe(false);
});

it('the byte rules of accept, accept-language, content-language, content-type and range follow the standard', () => {
  // accept: every byte below 0x20 except tab, the listed delimiters, and DEL are unsafe; nothing else is.
  const unsafeAccept = new Set<number>([
    ...Array.from({ length: 32 }, (_, i) => i).filter((i) => i !== 9),
    ...'"():<>?@[\\]{}'.split('').map((c) => c.charCodeAt(0)),
    0x7f,
  ]);
  for (let code = 0; code < 128; code++) {
    expect(safe('accept', `a${String.fromCharCode(code)}b`), `accept byte 0x${code.toString(16)}`).toBe(
      !unsafeAccept.has(code),
    );
  }
  // A byte of 0x80 or more is no CORS-unsafe byte.
  expect(safe('accept', 'café')).toBe(true);

  // accept-language and content-language: 0-9 A-Z a-z, space, * , - . ; = and nothing else.
  const allowed = new Set<number>(
    [...'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz *,-.;='].map((c) => c.charCodeAt(0)),
  );
  for (const name of ['accept-language', 'content-language']) {
    for (let code = 0; code < 256; code++) {
      expect(safe(name, `a${String.fromCharCode(code)}b`), `${name} byte 0x${code.toString(16)}`).toBe(
        allowed.has(code),
      );
    }
  }
  expect(safe('accept-language', 'en-US,en;q=0.9')).toBe(true);
  expect(safe('accept-language', 'en_US')).toBe(false);

  // content-type: the essence of the parsed type, and no unsafe byte.
  for (const value of [
    'text/plain',
    'TEXT/PLAIN',
    'text/plain;charset=UTF-8',
    'text/plain; charset=utf-8',
    'text/plain;',
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=x',
    ' text/plain ',
    'text/plain\t',
  ]) {
    expect(safe('content-type', value), value).toBe(true);
  }
  for (const value of [
    'application/json',
    'text/html',
    'text/plain, application/json',
    'text/plain; charset="utf-8"',
    '',
    'text',
    'text/',
    '/plain',
    'text/ plain',
    'te xt/plain',
    'text/plain/extra',
    'image/png',
  ]) {
    expect(safe('content-type', value), value).toBe(false);
  }
  expect(parseMimeEssence('Text/Plain;Charset=x')).toBe('text/plain');
  expect(parseMimeEssence('text/plain, application/json')).toBeNull();
  expect(parseMimeEssence('')).toBeNull();

  // range: a single range with a start; the start may not pass the end, and numbers are compared as numbers.
  for (const value of [
    'bytes=0-',
    'bytes=0-499',
    'bytes=5-',
    'bytes=00-01',
    'bytes=2-02',
    'bytes=9-10',
    'bytes=0-99999999999999999999999',
  ]) {
    expect(safe('range', value), value).toBe(true);
  }
  for (const value of [
    'bytes=-500',
    'bytes 0-',
    'bytes=5-2',
    'bytes=10-9',
    'bytes=',
    'bytes=-',
    'Bytes=0-',
    'bytes=0-1,5-6',
    'bytes=a-',
    'bytes=0',
    'items=0-',
    '',
  ]) {
    expect(safe('range', value), value).toBe(false);
  }
});

it('safelisted headers totalling 1,024 bytes need no preflight and 1,025 bytes force one', () => {
  const header = (name: string, length: number): { name: string; value: string } => ({
    name,
    value: 'a'.repeat(length),
  });
  const names = (headers: { name: string; value: string }[]) => corsUnsafeRequestHeaderNames(headers);

  // Eight values of 128 bytes are 1,024: not greater than 1,024, so nothing is unsafe.
  const eight = Array.from({ length: 8 }, () => header('accept', 128));
  expect(names(eight)).toEqual([]);
  // One byte more and every safelisted header counts as unsafe: the name, once, in lower case.
  expect(names([...eight, header('Accept', 1)])).toEqual(['accept']);
  // The total adds the values of all four safelisted names together.
  const mixed = [
    header('Accept', 128),
    header('Accept-Language', 128),
    header('Content-Language', 128),
    header('accept', 128),
    header('Accept-Language', 128),
    header('content-language', 128),
    header('ACCEPT', 128),
    header('accept-language', 128),
  ];
  expect(names(mixed)).toEqual([]);
  expect(names([...mixed, header('content-language', 1)])).toEqual(['accept', 'accept-language', 'content-language']);
  // Headers that are unsafe on their own are unsafe and do not add to the total.
  expect(names([...eight, header('X-A', 500)])).toEqual(['x-a']);
  expect(names([...eight, header('X-A', 500), header('accept', 1)])).toEqual(['accept', 'x-a']);
  // Names are lower-cased, each once, and sorted by byte.
  expect(names([header('X-b', 1), header('x-A', 1), header('x-B', 1), header('Authorization', 1)])).toEqual([
    'authorization',
    'x-a',
    'x-b',
  ]);
  expect(names([])).toEqual([]);

  // The same through the whole check, with the request headers pasted as lines.
  const lines = (count: number, extra: string[] = []): string =>
    [...Array.from({ length: count }, () => `Accept: ${'a'.repeat(128)}`), ...extra].join('\n');
  const at1024 = checkCors(input({ requestHeaders: lines(8) }));
  expect(at1024.plan.preflight.sent).toBe(false);
  expect(at1024.plan.unsafeNames).toEqual([]);
  const at1025 = checkCors(
    input({
      requestHeaders: lines(8, ['Accept: x']),
      preflightHeaders: 'Access-Control-Allow-Origin: *\nAccess-Control-Allow-Headers: accept',
    }),
  );
  expect(at1025.plan.preflight.sent).toBe(true);
  expect(at1025.plan.preflight.accessControlRequestHeaders).toBe('accept');
  expect(at1025.plan.preflight.reasons.join(' ')).toContain('1,024');
  expect(at1025.verdict).toBe('readable');
  // A dropped header (a forbidden one) is not in the total.
  const dropped = describeRequest(input({ requestHeaders: `${lines(8)}\nCookie: ${'c'.repeat(600)}` }));
  expect(dropped.preflight.sent).toBe(false);
});

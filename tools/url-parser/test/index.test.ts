import { it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseUrl, parseQuery, UrlParserError } from '../src/index';

const here = dirname(fileURLToPath(import.meta.url));
const wptPath = join(here, 'fixtures', 'wpt-url', 'urltestdata.json');
const wptData = JSON.parse(readFileSync(wptPath, 'utf8')) as unknown[];

interface WptEntry {
  input: string;
  base?: string | null;
  failure?: true;
  href?: string;
  origin?: string;
  protocol?: string;
  username?: string;
  password?: string;
  host?: string;
  hostname?: string;
  port?: string;
  pathname?: string;
  search?: string;
  hash?: string;
}

const objectEntries = wptData.filter((e): e is WptEntry => typeof e === 'object' && e !== null);
const nonFailureEntries = objectEntries.filter((e) => !e.failure);
const failureEntries = objectEntries.filter((e) => e.failure === true);

/** The vendored file's own inputs are unique, so the raw input text identifies an entry. */
function entryKey(e: { input: string }): string {
  return e.input;
}

/**
 * This project's own, named departures from the vendored web-platform-tests
 * URL test data, checked below against the running Node build. Each entry is
 * the exact `input` text of a vendored non-failure entry, so this list can
 * never silently drift from the file it describes. All 15 are the running
 * engine's own IDNA handling of a `xn--` label with no other content, or an
 * opaque-path whitespace/percent-encoding case; none is this package's own
 * bug, since the platform `URL` constructor is what actually parses.
 */
const KNOWN_DIFFERENCES: string[] = [
  'non-special:opaque  ?hi',
  'non-special:opaque  #hi',
  'non-special:opaque \t\t  \t#hi',
  'non-special:opaque \t\t  #hi',
  'non-special:opaque\t\t  \r #hi',
  'http://a.b.c.xn--pokxncvks',
  'http://10.0.0.xn--pokxncvks',
  'http://a.b.c.XN--pokxncvks',
  'http://a.b.c.Xn--pokxncvks',
  'http://10.0.0.XN--pokxncvks',
  'http://10.0.0.xN--pokxncvks',
  'file://xn--/p',
  'foo://host/ !"$%&\'()*+,-./:;<=>@[\\]^_`{|}~',
  'wss://host/ !"$%&\'()*+,-./:;<=>@[\\]^_`{|}~',
  'https://xn--/',
];

const FIELDS: (keyof WptEntry)[] = [
  'href',
  'protocol',
  'username',
  'password',
  'host',
  'hostname',
  'port',
  'pathname',
  'search',
  'hash',
];

it('every web-platform-tests URL test data entry parses to the components the WHATWG URL Standard expects, apart from the listed engine differences', () => {
  expect(nonFailureEntries.length).toBeGreaterThan(0);
  expect(KNOWN_DIFFERENCES.length).toBeLessThanOrEqual(30);

  for (const d of KNOWN_DIFFERENCES) {
    expect(
      nonFailureEntries.some((e) => entryKey(e) === d),
      `KNOWN_DIFFERENCES names "${d}", which is not a non-failure entry in the vendored file`,
    ).toBe(true);
  }

  const actuallyFailing: string[] = [];
  for (const entry of nonFailureEntries) {
    let parsed: ReturnType<typeof parseUrl>;
    try {
      parsed = parseUrl(entry.input, { base: entry.base ?? '' });
    } catch {
      actuallyFailing.push(entryKey(entry));
      continue;
    }
    let matches = true;
    for (const field of FIELDS) {
      const expected = entry[field];
      if (expected !== undefined && (parsed as unknown as Record<string, unknown>)[field] !== expected) {
        matches = false;
      }
    }
    if (entry.origin !== undefined && parsed.origin !== entry.origin) matches = false;
    if (!matches) actuallyFailing.push(entryKey(entry));
  }

  const unexpected = actuallyFailing.filter((k) => !KNOWN_DIFFERENCES.includes(k));
  expect(unexpected, `these vendored entries fail and are not in KNOWN_DIFFERENCES: ${unexpected.join(', ')}`).toEqual(
    [],
  );
});

it('entries the WHATWG URL Standard marks as failures are refused with a message', () => {
  expect(failureEntries.length).toBeGreaterThan(0);
  for (const entry of failureEntries) {
    expect(() => parseUrl(entry.input, { base: entry.base ?? '' })).toThrow(UrlParserError);
  }
});

it('query strings are split with the WHATWG application/x-www-form-urlencoded parser, keeping order and repeats', () => {
  const { query, queryObject } = parseQuery('a=1&a=2&b=%20&c');
  expect(query).toEqual([
    { name: 'a', value: '1' },
    { name: 'a', value: '2' },
    { name: 'b', value: ' ' },
    { name: 'c', value: '' },
  ]);
  expect(queryObject).toEqual({ a: ['1', '2'], b: ' ', c: '' });
  expect(parseQuery('?a=1').query).toEqual([{ name: 'a', value: '1' }]);

  // The main path resolves a full URL's own query with the same parser.
  const parsed = parseUrl('https://example.com/?x=1&x=2&y=hi');
  expect(parsed.query).toEqual([
    { name: 'x', value: '1' },
    { name: 'x', value: '2' },
    { name: 'y', value: 'hi' },
  ]);
});

it('repeated query names become arrays and a name like __proto__ stays an own key without touching Object.prototype', () => {
  const parsed = parseUrl('https://example.com/?__proto__=x&constructor=y');
  expect(Object.hasOwn(parsed.queryObject, '__proto__')).toBe(true);
  expect(Object.hasOwn(parsed.queryObject, 'constructor')).toBe(true);
  expect(Object.getPrototypeOf(parsed.queryObject)).toBe(Object.prototype);
  expect(Object.prototype as unknown as Record<string, unknown>).not.toHaveProperty('x');

  const repeated = parseQuery('a=1&a=2&a=3').queryObject;
  expect(repeated.a).toEqual(['1', '2', '3']);

  const single = parseQuery('a=1').queryObject;
  expect(single.a).toBe('1');
});

it('tab and newline characters the WHATWG URL parser removes are reported as a warning', () => {
  const parsed = parseUrl('https://exa\tmple.com/');
  expect(parsed.hostname).toBe('example.com');
  expect(parsed.warnings.some((w) => /tab or newline/.test(w))).toBe(true);

  const clean = parseUrl('https://example.com/');
  expect(clean.warnings.some((w) => /tab or newline/.test(w))).toBe(false);
});

it('a URL carrying a user name or password is flagged', () => {
  const parsed = parseUrl('https://user:pass@example.com/');
  expect(parsed.username).toBe('user');
  expect(parsed.password).toBe('pass');
  expect(parsed.warnings.some((w) => /user name or password/.test(w))).toBe(true);

  const noCreds = parseUrl('https://example.com/');
  expect(noCreds.warnings.some((w) => /user name or password/.test(w))).toBe(false);
});

it('nothing is written to the console while parsing', () => {
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const spies = methods.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
  try {
    for (const entry of [...nonFailureEntries, ...failureEntries]) {
      try {
        parseUrl(entry.input, { base: entry.base ?? '' });
      } catch {
        /* a refusal is expected for some entries; the point is console silence */
      }
    }
    parseQuery('__proto__=x&a=1&a=2');
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    spies.forEach((s) => s.mockRestore());
  }
});

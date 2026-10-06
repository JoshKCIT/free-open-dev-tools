import { Cookie } from 'tough-cookie';
import { parseSetCookie as parseWithCookie } from 'cookie';
import { expect, it } from 'vitest';
import { MAX_AGE_LIMIT_SECONDS, parseSetCookie } from '../src/index';
import { mulberry32 } from './helpers';

/*
 * Second opinions, used by this test only (they are dev dependencies of this folder and never ship): tough-cookie 6.0.2
 * (Cookie.parse) and cookie 1.1.1 (parseSetCookie) read the same 300 generated lines as the package, and the three must
 * agree on the name, the value, the Max-Age, the Domain and the Path. Every difference found by measuring is listed below by
 * name with its cause; a difference that is not listed fails the test, and so does a listed one that no longer happens.
 * Neither library enforces cookie name prefixes while it parses, so prefixes are not compared.
 */

interface Fields {
  name: string | null;
  value: string | null;
  /** Seconds, never above the 400-day limit, 0 for a lifetime that ends at once; null when no Max-Age counts. */
  maxAge: number | null;
  domain: string | null;
  path: string | null;
}

type Library = 'tough-cookie' | 'cookie';
type Field = keyof Fields;

interface KnownDifference {
  /** One corpus line that shows it. */
  line: string;
  library: Library;
  field: Field;
  why: string;
  applies: (line: string) => boolean;
}

/** A line whose name-value pair has no name: no equals sign, or an equals sign first. */
function isNameless(line: string): boolean {
  const semicolon = line.indexOf(';');
  const pair = semicolon < 0 ? line : line.slice(0, semicolon);
  const equals = pair.indexOf('=');
  return equals < 0 || pair.slice(0, equals).trim() === '';
}

/** The Domain values of a line in order, each with one leading dot dropped (section 5.6.3), whatever the letter case of Domain. */
function domainValues(line: string): string[] {
  const values: string[] = [];
  const segments = line.split(';').slice(1);
  for (const segment of segments) {
    const equals = segment.indexOf('=');
    const name = (equals < 0 ? segment : segment.slice(0, equals)).trim().toLowerCase();
    if (name !== 'domain') continue;
    const value = equals < 0 ? '' : segment.slice(equals + 1).trim();
    values.push(value.startsWith('.') ? value.slice(1) : value);
  }
  return values;
}

/** True when the last Domain is empty (after its dot is dropped) and an earlier Domain is not. */
function laterEmptyDomain(line: string): boolean {
  const values = domainValues(line);
  return values.length > 1 && values[values.length - 1] === '' && values.slice(0, -1).some((value) => value !== '');
}

const KNOWN_DIFFERENCES: KnownDifference[] = [
  {
    line: '=v; Path=/',
    library: 'tough-cookie',
    field: 'name',
    why: 'tough-cookie 6.0.2 returns no cookie at all for a line with no name (no equals sign, or one at the start), where the draft stores a cookie with an empty name and the text as its value (section 5.6 step 3).',
    applies: isNameless,
  },
  {
    line: 'a=b; Domain=sub.example.com; Domain=.',
    library: 'tough-cookie',
    field: 'domain',
    why: 'tough-cookie 6.0.2 skips a Domain that is empty once its dot is dropped and keeps the earlier Domain, where the draft keeps every Domain attribute and uses the last one (section 5.6.3 and 5.7 step 7), so the empty one makes the cookie host-only.',
    applies: laterEmptyDomain,
  },
];

function clampSeconds(seconds: number): number {
  if (seconds <= 0) return 0;
  return Math.min(seconds, MAX_AGE_LIMIT_SECONDS);
}

function normaliseDomain(domain: string | null | undefined): string | null {
  if (domain === null || domain === undefined) return null;
  const stripped = domain.startsWith('.') ? domain.slice(1) : domain;
  return stripped === '' ? null : stripped.toLowerCase();
}

function normalisePath(path: string | null | undefined): string | null {
  return typeof path === 'string' && path.startsWith('/') ? path : null;
}

function packageFields(line: string): Fields | null {
  const parsed = parseSetCookie(line);
  if (parsed.ignored) return null;
  return {
    name: parsed.name,
    value: parsed.value,
    maxAge: parsed.maxAge === null ? null : parsed.maxAge.immediate ? 0 : parsed.maxAge.seconds,
    domain: normaliseDomain(parsed.domain),
    path: normalisePath(parsed.path),
  };
}

function toughFields(line: string): Fields | null {
  const cookie = Cookie.parse(line);
  if (cookie === undefined) return null;
  const maxAge = cookie.maxAge;
  return {
    name: cookie.key,
    value: cookie.value,
    maxAge: typeof maxAge === 'number' ? clampSeconds(maxAge) : null,
    domain: normaliseDomain(cookie.domain),
    path: normalisePath(cookie.path),
  };
}

function cookieFields(line: string): Fields {
  const parsed = parseWithCookie(line);
  return {
    name: parsed.name,
    value: parsed.value,
    maxAge: typeof parsed.maxAge === 'number' ? clampSeconds(parsed.maxAge) : null,
    domain: normaliseDomain(parsed.domain),
    path: normalisePath(parsed.path),
  };
}

/** 300 lines from a seeded generator: names, values, Max-Age forms, Domain forms in several cases, Path forms. */
function corpus(): string[] {
  const random = mulberry32(0x5e7c001);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const names = ['sid', 'a', 'Session', 'x-y', '__Host-t', 'token', 'lang', 'n1', ''];
  const values = ['v', 'abc', 'a=b', '"q"', '', '1', 'x y', '31d4d96e407aad42'];
  const maxAges = [
    '3600',
    '0',
    '-1',
    '-5',
    '+5',
    '1e3',
    '',
    '007',
    '99999999999999999999',
    'abc',
    '12 ',
    '1,2',
    '34560000',
    '34560001',
  ];
  const domains = ['example.com', '.Example.COM', 'EXAMPLE.com', '', '.', 'sub.example.com', '.a.b.c'];
  const paths = ['/', '/a/b', 'x', '', '/a b', '/A/b/'];
  const extras = ['Secure', 'HttpOnly', 'SameSite=Lax', 'SameSite=None', 'foo=bar', 'Partitioned'];
  const lines: string[] = [];
  while (lines.length < 300) {
    const name = pick(names);
    const value = pick(values);
    const pair = name === '' && random() < 0.5 ? value : `${name}=${value}`;
    const parts = [pair];
    if (random() < 0.6) parts.push(`${pick(['Max-Age', 'max-age', 'MAX-AGE'])}=${pick(maxAges)}`);
    if (random() < 0.5) parts.push(`${pick(['Domain', 'domain'])}=${pick(domains)}`);
    if (random() < 0.5) parts.push(`${pick(['Path', 'path'])}=${pick(paths)}`);
    if (random() < 0.15) parts.push(`Max-Age=${pick(maxAges)}`);
    if (random() < 0.15) parts.push(`Domain=${pick(domains)}`);
    if (random() < 0.15) parts.push(`Path=${pick(paths)}`);
    if (random() < 0.4) parts.push(pick(extras));
    for (let i = parts.length - 1; i > 1; i--) {
      const j = 1 + Math.floor(random() * i);
      const swap = parts[i] as string;
      parts[i] = parts[j] as string;
      parts[j] = swap;
    }
    lines.push(parts.join('; '));
  }
  return lines;
}

it('tough-cookie and cookie agree on name, value, Max-Age, Domain and Path except the listed differences', () => {
  const lines = corpus();
  expect(lines).toHaveLength(300);
  expect(new Set(lines).size).toBeGreaterThan(250);
  const seen = new Set<KnownDifference>();
  const unexplained: string[] = [];
  const fieldsOf: Field[] = ['name', 'value', 'maxAge', 'domain', 'path'];
  for (const line of lines) {
    const ours = packageFields(line);
    expect(ours, line).not.toBeNull();
    const others: Array<[Library, Fields | null]> = [
      ['tough-cookie', toughFields(line)],
      ['cookie', cookieFields(line)],
    ];
    for (const [library, theirs] of others) {
      for (const field of fieldsOf) {
        const mine = ours?.[field] ?? null;
        const other = theirs === null ? null : (theirs[field] ?? null);
        if (theirs === null) {
          // The library returned no cookie at all: that is a difference of the name.
          if (field !== 'name') continue;
        } else if (mine === other) continue;
        const known = KNOWN_DIFFERENCES.find(
          (entry) => entry.library === library && entry.field === field && entry.applies(line),
        );
        if (known === undefined)
          unexplained.push(
            `${library} ${field}: ${JSON.stringify(line)} (package ${JSON.stringify(mine)}, library ${JSON.stringify(other)})`,
          );
        else seen.add(known);
      }
    }
  }
  expect(unexplained).toEqual([]);
  // A listed difference must still happen (a stale entry would hide a fix), and its example line must show it.
  for (const entry of KNOWN_DIFFERENCES) {
    expect(seen.has(entry), `${entry.library} ${entry.field}`).toBe(true);
    expect(entry.applies(entry.line)).toBe(true);
    expect(entry.why.length).toBeGreaterThan(40);
  }
  // The measured difference: a nameless cookie that tough-cookie drops and the package and cookie keep.
  expect(Cookie.parse('=v')).toBeUndefined();
  expect(parseWithCookie('=v')).toMatchObject({ name: '', value: 'v' });
  expect(packageFields('=v')).toMatchObject({ name: '', value: 'v' });
  expect(Cookie.parse('abc')).toBeUndefined();
  expect(packageFields('abc')).toMatchObject({ name: '', value: 'abc' });
  // Neither library enforces cookie name prefixes while it parses: both hand back a __Host- cookie with a Domain.
  const prefixed = '__Host-SID=12345; Secure; Domain=site.example; Path=/';
  expect(Cookie.parse(prefixed)?.key).toBe('__Host-SID');
  expect(parseWithCookie(prefixed).name).toBe('__Host-SID');
});

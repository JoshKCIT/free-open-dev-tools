import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it, expect, vi } from 'vitest';
import { buildRobotsTxt, checkPath, parseRobotsTxt } from '../src/index';
import { normalisePath, patternMatches } from '../src/match';

const here = dirname(fileURLToPath(import.meta.url));
const rfc9309Text = readFileSync(join(here, 'fixtures', 'rfc9309', 'rfc9309.txt'), 'utf8');
const stripWs = (s: string) => s.replace(/\s+/g, '');
const rfc9309Stripped = stripWs(rfc9309Text);

/** Fails loudly, at transcription time, rather than letting a mistyped quote pass silently. */
function assertQuotedInRfc(fragment: string): void {
  expect(rfc9309Stripped.includes(stripWs(fragment))).toBe(true);
}

it('the RFC 9309 section 5 examples give the verdicts the RFC states', () => {
  // Transcribed from RFC 9309 section 5.1 ("Simple Example"), quoted verbatim below the RFC's own indentation.
  const simple = [
    'User-Agent: *',
    'Disallow: *.gif$',
    'Disallow: /example/',
    'Allow: /publications/',
    '',
    'User-Agent: foobot',
    'Disallow:/',
    'Allow:/example/page.html',
    'Allow:/example/allowed.gif',
    '',
    'User-Agent: barbot',
    'User-Agent: bazbot',
    'Disallow: /example/page.html',
    '',
    'User-Agent: quxbot',
  ].join('\n');
  assertQuotedInRfc('User-Agent: *');
  assertQuotedInRfc('Disallow: *.gif$');
  assertQuotedInRfc('Disallow: /example/');
  assertQuotedInRfc('Allow: /publications/');
  assertQuotedInRfc('User-Agent: foobot');
  assertQuotedInRfc('Disallow:/');
  assertQuotedInRfc('Allow:/example/page.html');
  assertQuotedInRfc('Allow:/example/allowed.gif');
  assertQuotedInRfc('User-Agent: barbot');
  assertQuotedInRfc('User-Agent: bazbot');
  assertQuotedInRfc('Disallow: /example/page.html');
  assertQuotedInRfc('User-Agent: quxbot');

  const parsed = parseRobotsTxt(simple);

  // "The crawler only has access to two URL path prefixes on the site --
  // /example/page.html and /example/allowed.gif."
  expect(checkPath(parsed, 'foobot', '/example/page.html').allowed).toBe(true);
  expect(checkPath(parsed, 'foobot', '/example/allowed.gif').allowed).toBe(true);
  expect(checkPath(parsed, 'foobot', '/other.html').allowed).toBe(false);

  // "The crawlers are not allowed to access the URLs with the
  // /example/page.html path prefix but otherwise have unrestricted access."
  expect(checkPath(parsed, 'barbot', '/example/page.html').allowed).toBe(false);
  expect(checkPath(parsed, 'barbot', '/other.html').allowed).toBe(true);
  expect(checkPath(parsed, 'bazbot', '/example/page.html').allowed).toBe(false);
  expect(checkPath(parsed, 'bazbot', '/other.html').allowed).toBe(true);

  // "quxbot: An empty group at the end of the file. The crawler has
  // unrestricted access to the URLs on the site."
  expect(checkPath(parsed, 'quxbot', '/anything').allowed).toBe(true);

  // The "*" group: allows /publications/, restricts /example/ and *.gif.
  expect(checkPath(parsed, 'unknownbot', '/publications/x').allowed).toBe(true);
  expect(checkPath(parsed, 'unknownbot', '/example/x').allowed).toBe(false);
  expect(checkPath(parsed, 'unknownbot', '/photo.gif').allowed).toBe(false);
});

it('the longest match wins and an equal-length allow beats disallow as RFC 9309 section 2.2.2 requires', () => {
  // RFC 9309 section 5.2, "Longest Match", transcribed verbatim.
  const longest = ['User-Agent: foobot', 'Allow: /example/page/', 'Disallow: /example/page/disallowed.gif'].join('\n');
  assertQuotedInRfc('User-Agent: foobot');
  assertQuotedInRfc('Allow: /example/page/');
  assertQuotedInRfc('Disallow: /example/page/disallowed.gif');
  assertQuotedInRfc('If an "allow" rule and a "disallow" rule are equivalent, then the "allow" rule SHOULD be used.');

  const parsed = parseRobotsTxt(longest);
  const result = checkPath(parsed, 'foobot', '/example/page/disallowed.gif');
  expect(result.allowed).toBe(false);
  expect(result.line).toBe(3);
  expect(checkPath(parsed, 'foobot', '/example/page/anything-else').allowed).toBe(true);

  // Equal-length allow and disallow: allow wins.
  const tie = parseRobotsTxt(['User-Agent: *', 'Allow: /a', 'Disallow: /a'].join('\n'));
  expect(checkPath(tie, 'anybot', '/a').allowed).toBe(true);
});

it('star and dollar special characters match as the RFC 9309 section 2.2.3 examples show', () => {
  assertQuotedInRfc('allow: /this/*/exactly');
  assertQuotedInRfc('allow: /this/path/exactly$');
  assertQuotedInRfc('Designates 0 or');
  assertQuotedInRfc('Designates the');

  // "*" designates 0 or more instances of any character, including the
  // otherwise-required forward slash (section 5.1's own gif example proves
  // this: "*.gif$" matches any path ending in .gif regardless of depth).
  expect(patternMatches('/this/*/exactly', '/this/path/exactly')).toBe(true);
  expect(patternMatches('/this/*/exactly', '/this/a/b/exactly')).toBe(true);
  expect(patternMatches('/this/*/exactly', '/this/exactly')).toBe(false);

  // "$" designates the end of the match pattern.
  expect(patternMatches('/this/path/exactly$', '/this/path/exactly')).toBe(true);
  expect(patternMatches('/this/path/exactly$', '/this/path/exactly2')).toBe(false);
  // Without "$" the pattern only has to match a prefix of the path.
  expect(patternMatches('/this/path/exactly', '/this/path/exactly2')).toBe(true);

  expect(patternMatches('*.gif$', '/example/photo.gif')).toBe(true);
  expect(patternMatches('*.gif$', '/example/photo.gif.html')).toBe(false);
});

it('percent-encoded and unencoded paths compare as RFC 9309 section 2.2.2 figure 4 shows', () => {
  assertQuotedInRfc('/foo/bar?baz=quz');
  assertQuotedInRfc('https://foo.bar');
  assertQuotedInRfc('https%3A%2F%2Ffoo.bar');
  assertQuotedInRfc('/foo/bar/%E3%83%84');
  assertQuotedInRfc('/foo/bar/%62%61%7A');
  assertQuotedInRfc('/foo/bar/baz');

  expect(normalisePath('/foo/bar?baz=quz')).toBe('/foo/bar?baz=quz');
  expect(normalisePath('/foo/bar?baz=https://foo.bar')).toBe('/foo/bar?baz=https%3A%2F%2Ffoo.bar');
  expect(normalisePath('/foo/bar/' + String.fromCharCode(0x30c4))).toBe('/foo/bar/%E3%83%84');
  expect(normalisePath('/foo/bar/%E3%83%84')).toBe('/foo/bar/%E3%83%84');
  expect(normalisePath('/foo/bar/%62%61%7A')).toBe('/foo/bar/baz');
});

it('groups are chosen by case-insensitive product token, duplicate groups are merged and the star group is the fallback', () => {
  // RFC 9309 section 2.2.1, Figure 2: two groups matching the same product
  // token exactly are merged into one.
  assertQuotedInRfc('user-agent: ExampleBot');
  assertQuotedInRfc('disallow: /foo');
  assertQuotedInRfc('disallow: /bar');
  assertQuotedInRfc('disallow: /baz');
  const merged = parseRobotsTxt(
    ['user-agent: ExampleBot', 'disallow: /foo', '', 'user-agent: ExampleBot', 'disallow: /baz'].join('\n'),
  );
  expect(checkPath(merged, 'ExampleBot', '/foo').allowed).toBe(false);
  expect(checkPath(merged, 'ExampleBot', '/baz').allowed).toBe(false);
  expect(checkPath(merged, 'ExampleBot', '/other').allowed).toBe(true);

  // Case-insensitive matching.
  expect(checkPath(merged, 'examplebot', '/foo').allowed).toBe(false);
  expect(checkPath(merged, 'EXAMPLEBOT', '/foo').allowed).toBe(false);

  // Figure 3: no matching group other than "*".
  assertQuotedInRfc('user-agent: BazBot');
  const starFallback = parseRobotsTxt(
    ['user-agent: *', 'disallow: /foo', 'disallow: /bar', '', 'user-agent: BazBot', 'disallow: /baz'].join('\n'),
  );
  expect(checkPath(starFallback, 'ExampleBot', '/foo').allowed).toBe(false);
  expect(checkPath(starFallback, 'ExampleBot', '/baz').allowed).toBe(true);
  expect(checkPath(starFallback, 'BazBot', '/baz').allowed).toBe(false);

  // No matching group and no "*" group at all: no rules apply.
  const noFallback = parseRobotsTxt(['user-agent: BazBot', 'disallow: /baz'].join('\n'));
  expect(checkPath(noFallback, 'ExampleBot', '/baz').allowed).toBe(true);
});

it('the robots.txt path itself is always allowed', () => {
  const disallowsEverything = parseRobotsTxt(['User-Agent: *', 'Disallow: /'].join('\n'));
  expect(checkPath(disallowsEverything, 'anybot', '/robots.txt').allowed).toBe(true);
  expect(checkPath(disallowsEverything, 'anybot', 'https://example.invalid/robots.txt').allowed).toBe(true);

  const empty = parseRobotsTxt('');
  expect(checkPath(empty, 'anybot', '/robots.txt').allowed).toBe(true);
});

it('a built file parses back to the same groups, rules and sitemap lines', () => {
  const input = {
    groups: [
      { agents: ['*'], rules: [{ type: 'disallow' as const, pattern: '/private/' }] },
      {
        agents: ['ExampleBot', 'OtherBot'],
        rules: [
          { type: 'allow' as const, pattern: '/public/' },
          { type: 'disallow' as const, pattern: '/public/secret' },
        ],
      },
    ],
    sitemaps: ['https://example.invalid/sitemap.xml', 'https://example.invalid/sitemap2.xml'],
  };
  const { text } = buildRobotsTxt(input);
  const parsed = parseRobotsTxt(text);

  expect(
    parsed.groups.map((g) => ({ agents: g.agents, rules: g.rules.map((r) => ({ type: r.type, pattern: r.pattern })) })),
  ).toEqual(input.groups.map((g) => ({ agents: g.agents, rules: g.rules })));
  expect(parsed.sitemaps.map((s) => s.url)).toEqual(input.sitemaps);
});

it('a rule before any User-agent line, an invalid product token or a line break inside a value is reported with its line', () => {
  const beforeAgent = parseRobotsTxt(['Disallow: /x', 'User-agent: *'].join('\n'));
  expect(beforeAgent.problems.some((p) => p.line === 1 && /before any User-agent line/.test(p.message))).toBe(true);

  const badToken = parseRobotsTxt(['User-agent: In@valid', 'Disallow: /x'].join('\n'));
  expect(badToken.problems.some((p) => p.line === 1 && /product token/.test(p.message))).toBe(true);

  expect(() => buildRobotsTxt({ groups: [{ agents: ['a\nb'], rules: [] }], sitemaps: [] })).toThrow(/User-agent/);
});

it('a Sitemap line takes an absolute URL as the sitemaps.org protocol describes', () => {
  const { text } = buildRobotsTxt({ groups: [], sitemaps: ['https://example.invalid/sitemap.xml'] });
  expect(text).toContain('Sitemap: https://example.invalid/sitemap.xml');

  expect(() => buildRobotsTxt({ groups: [], sitemaps: ['/relative.xml'] })).toThrow(/absolute http or https URL/);
  expect(() => buildRobotsTxt({ groups: [], sitemaps: ['not a url'] })).toThrow(/absolute http or https URL/);

  const parsed = parseRobotsTxt('Sitemap: https://example.invalid/sitemap.xml');
  expect(parsed.sitemaps).toEqual([{ url: 'https://example.invalid/sitemap.xml', line: 1 }]);
});

it('nothing is written to the console while parsing or matching', () => {
  const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    const hostile = [
      'User-agent: *',
      'Disallow: /' + '%zz'.repeat(50),
      'Allow: ' + '*'.repeat(200),
      'Sitemap: not a url',
      '',
      'garbage line with no colon',
      'User-agent:',
    ].join('\n');
    const parsed = parseRobotsTxt(hostile);
    checkPath(parsed, 'anybot', '/' + '%zz'.repeat(50));
    checkPath(parsed, 'anybot', 'https://example.invalid/a?b=c');
    try {
      buildRobotsTxt({ groups: [{ agents: ['bad\nagent'], rules: [] }], sitemaps: [] });
    } catch {
      // expected
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

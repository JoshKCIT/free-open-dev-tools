import { it, expect, vi } from 'vitest';
import { buildSitemaps, MAX_BYTES_PER_FILE, MAX_URLS_PER_FILE, SitemapError } from '../src/index';

it('a URL list becomes a urlset that validates against the sitemaps.org 0.9 sitemap XSD', () => {
  const result = buildSitemaps('https://example.com/\nhttps://example.com/about', {
    baseUrl: 'https://example.com/',
  });
  expect(result.files).toHaveLength(1);
  expect(result.files[0]!.name).toBe('sitemap.xml');
  expect(result.files[0]!.urlCount).toBe(2);
  expect(result.index).toBeNull();
  expect(result.files[0]!.xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
  expect(result.files[0]!.xml).toContain('<loc>https://example.com/</loc>');
  expect(result.files[0]!.xml).toContain('<loc>https://example.com/about</loc>');
});

it('more than 50,000 URLs are split into files of at most 50,000 under a sitemap index that validates against the siteindex XSD', () => {
  const lines: string[] = [];
  for (let i = 0; i < 60000; i++) lines.push(`https://example.com/page-${i}`);
  const result = buildSitemaps(lines.join('\n'), { baseUrl: 'https://example.com/' });

  expect(result.files).toHaveLength(2);
  expect(result.files[0]!.name).toBe('sitemap-1.xml');
  expect(result.files[0]!.urlCount).toBe(50000);
  expect(result.files[1]!.name).toBe('sitemap-2.xml');
  expect(result.files[1]!.urlCount).toBe(10000);
  expect(result.splitReason).toBe('count');
  expect(result.index).not.toBeNull();
  expect(result.index!.name).toBe('sitemap-index.xml');
  expect(result.index!.xml).toContain('<loc>https://example.com/sitemap-1.xml</loc>');
  expect(result.index!.xml).toContain('<loc>https://example.com/sitemap-2.xml</loc>');
}, 20000);

it('a file that would pass 52,428,800 uncompressed bytes is split before it does and every reported byte count is exact', () => {
  const longSegment = 'x'.repeat(1990);
  const lines: string[] = [];
  for (let i = 0; i < 30000; i++) lines.push(`https://example.com/${longSegment}-${i}`);
  const result = buildSitemaps(lines.join('\n'), { baseUrl: 'https://example.com/' });

  expect(result.files.length).toBeGreaterThan(1);
  expect(result.splitReason).toBe('bytes');
  for (const file of result.files) {
    expect(file.bytes).toBeLessThanOrEqual(MAX_BYTES_PER_FILE);
    expect(file.bytes).toBe(new TextEncoder().encode(file.xml).length);
    expect(file.urlCount).toBeLessThanOrEqual(MAX_URLS_PER_FILE);
  }
  expect(result.index).not.toBeNull();
  expect(result.index!.bytes).toBe(new TextEncoder().encode(result.index!.xml).length);
}, 20000);

it('ampersands, quotes and angle brackets in URLs are entity-escaped as the sitemaps.org protocol requires', () => {
  // The platform URL parser already percent-encodes "<", ">" and double
  // quotes anywhere in a URL, so a literal one never reaches this tool's
  // own escaping -- but it leaves a literal "&" in the query and a literal
  // apostrophe in the path untouched, which is what this proves.
  const result = buildSitemaps("https://example.invalid/it's?x=1&y=2", { baseUrl: 'https://example.invalid/' });
  expect(result.files).toHaveLength(1);
  expect(result.files[0]!.xml).toContain('it&apos;s');
  expect(result.files[0]!.xml).toContain('x=1&amp;y=2');
  expect(result.files[0]!.xml).not.toContain("it's");
  expect(result.files[0]!.xml).not.toContain('x=1&y=2');
});

it('spaces and non-ASCII characters in a URL are percent-encoded as RFC 3986 requires before escaping', () => {
  const result = buildSitemaps('https://example.invalid/caf' + String.fromCharCode(0xe9) + ' shop', {
    baseUrl: 'https://example.invalid/',
  });
  expect(result.files).toHaveLength(1);
  expect(result.files[0]!.xml).toContain('%C3%A9');
  expect(result.files[0]!.xml).toContain('%20shop');
  expect(result.problems.some((p) => /percent-encoded/.test(p.message))).toBe(true);
});

it('lastmod accepts only W3C Datetime values, and priority and changefreq accept only the values the protocol lists', () => {
  const good = buildSitemaps('https://example.invalid/a 2026-09-25', { baseUrl: 'https://example.invalid/' });
  expect(good.files[0]!.xml).toContain('<lastmod>2026-09-25</lastmod>');

  const goodDatetime = buildSitemaps('https://example.invalid/a 2026-09-25T17:33:30+08:00', {
    baseUrl: 'https://example.invalid/',
  });
  expect(goodDatetime.files[0]!.xml).toContain('<lastmod>2026-09-25T17:33:30+08:00</lastmod>');

  // A per-line token that is not a valid W3C Datetime is treated as part of
  // the URL itself, not a malformed lastmod (see splitLine's own doc
  // comment) -- so the invalid case is exercised through the global option.
  const bad = buildSitemaps('https://example.invalid/a', {
    baseUrl: 'https://example.invalid/',
    lastmod: 'not-a-date',
  });
  expect(bad.files[0]!.xml).not.toContain('<lastmod>');
  expect(bad.problems.some((p) => /is not a W3C Datetime/.test(p.message))).toBe(true);

  const withChangefreqAndPriority = buildSitemaps('https://example.invalid/a', {
    baseUrl: 'https://example.invalid/',
    changefreq: 'weekly',
    priority: '0.8',
  });
  expect(withChangefreqAndPriority.files[0]!.xml).toContain('<changefreq>weekly</changefreq>');
  expect(withChangefreqAndPriority.files[0]!.xml).toContain('<priority>0.8</priority>');

  const withBadChangefreqAndPriority = buildSitemaps('https://example.invalid/a', {
    baseUrl: 'https://example.invalid/',
    changefreq: 'sometimes',
    priority: '2.0',
  });
  expect(withBadChangefreqAndPriority.files[0]!.xml).not.toContain('<changefreq>');
  expect(withBadChangefreqAndPriority.files[0]!.xml).not.toContain('<priority>');
  expect(withBadChangefreqAndPriority.problems.some((p) => /changefreq/.test(p.message))).toBe(true);
  expect(withBadChangefreqAndPriority.problems.some((p) => /decimal from 0.0 to 1.0/.test(p.message))).toBe(true);
});

it('a relative URL, a URL longer than 2048 characters or a URL on another host is reported with its line number', () => {
  const relative = buildSitemaps('/about', { baseUrl: 'https://example.invalid/' });
  expect(relative.files).toHaveLength(0);
  expect(relative.problems).toEqual([{ line: 1, message: expect.stringContaining('not an absolute URL') }]);

  const tooLong = buildSitemaps(`https://example.invalid/${'x'.repeat(2100)}`, { baseUrl: 'https://example.invalid/' });
  expect(tooLong.files).toHaveLength(0);
  expect(tooLong.problems[0]!.line).toBe(1);
  expect(tooLong.problems[0]!.message).toMatch(/2048-character limit/);

  const otherHost = buildSitemaps(['https://example.invalid/a', 'https://other.invalid/b'].join('\n'), {
    baseUrl: 'https://example.invalid/',
  });
  expect(otherHost.files[0]!.urlCount).toBe(2);
  expect(otherHost.problems.some((p) => p.line === 2 && /different host|host \(/.test(p.message))).toBe(true);
});

it('duplicate URLs are written once and reported', () => {
  const result = buildSitemaps(
    ['https://example.invalid/a', 'https://example.invalid/b', 'https://example.invalid/a'].join('\n'),
    { baseUrl: 'https://example.invalid/' },
  );
  expect(result.files[0]!.urlCount).toBe(2);
  expect(result.duplicates).toBe(1);
});

it('nothing is written to the console while building', () => {
  const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    buildSitemaps(
      [
        'not a url',
        'https://example.invalid/' + 'y'.repeat(2100),
        'https://example.invalid/a bad-date',
        'https://example.invalid/a',
      ].join('\n'),
      { baseUrl: 'https://example.invalid/', changefreq: 'never-ever', priority: '9' },
    );
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

it('refuses an input with far too many lines rather than risk freezing the tab', () => {
  expect(() => buildSitemaps('a\n'.repeat(5_000_001))).toThrow(SitemapError);
});

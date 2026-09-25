/**
 * Every `it` here is a required top-level title, matched by exact fullName
 * in this plan's own verify script -- none may be nested inside a
 * `describe()`, which would prefix the name and break that match (the
 * lesson 06-01/06-02's own SUMMARYs already record for this codebase).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it, expect, vi } from 'vitest';
import { checkLanguageTag } from '../src/bcp47';
import { buildHreflang, HreflangError } from '../src/index';

const RFC5646 = readFileSync(join(__dirname, 'fixtures', 'rfc5646', 'rfc5646.txt'), 'utf8');
const RFC5646_NO_WHITESPACE = RFC5646.replace(/\s+/g, '');

function assertInVendoredRfc(example: string): void {
  const stripped = example.replace(/\s+/g, '');
  expect(RFC5646_NO_WHITESPACE, `"${example}" is not present in the vendored RFC 5646 text`).toContain(stripped);
}

const VALID_APPENDIX_A = [
  'de',
  'zh-Hant',
  'zh-cmn-Hans-CN',
  'sr-Latn-RS',
  'de-CH-1901',
  'sl-nedis',
  'hy-Latn-IT-arevela',
  'x-whatever',
];

const INVALID_APPENDIX_A = ['de-419-DE', 'a-DE', 'ar-a-aaa-b-bbb-a-ccc'];

it('language tags are judged against the RFC 5646 Appendix A examples of valid and invalid tags', () => {
  for (const tag of VALID_APPENDIX_A) {
    assertInVendoredRfc(tag);
    const result = checkLanguageTag(tag);
    expect(result.wellFormed, `${tag} should be well-formed`).toBe(true);
    expect(result.valid, `${tag} should be valid`).toBe(true);
  }
  for (const tag of INVALID_APPENDIX_A) {
    assertInVendoredRfc(tag);
    const result = checkLanguageTag(tag);
    expect(result.valid, `${tag} should not be valid`).toBe(false);
  }
  // A real extension example (RFC 5646 section 2.2.6), demonstrating this
  // tool accepts -u-/-t- extension syntax without validating its contents.
  const extension = checkLanguageTag('de-DE-u-co-phonebk');
  expect(extension.wellFormed).toBe(true);
  expect(extension.valid).toBe(true);
});

it('common mistakes such as en_US, en-UK and jp are reported as not valid', () => {
  const underscore = checkLanguageTag('en_US');
  expect(underscore.wellFormed).toBe(false);
  expect(underscore.suggestion).toBe('en-US');

  const ukRegion = checkLanguageTag('en-UK');
  expect(ukRegion.wellFormed).toBe(true);
  expect(ukRegion.valid).toBe(false);

  const jp = checkLanguageTag('jp');
  expect(jp.wellFormed).toBe(true);
  expect(jp.valid).toBe(false);

  const iw = checkLanguageTag('iw');
  expect(iw.valid).toBe(true);
  expect(iw.warnings.some((w) => w.includes('he'))).toBe(true);
});

it('each page in a cluster lists every alternate including itself so the annotations are reciprocal', () => {
  const result = buildHreflang('en https://example.invalid/en/\nde https://example.invalid/de/');
  expect(result.problems).toEqual([]);
  expect(result.entries).toEqual([
    { tag: 'en', href: 'https://example.invalid/en/' },
    { tag: 'de', href: 'https://example.invalid/de/' },
  ]);
  // The SAME block, used identically on every page in the cluster, lists
  // every alternate including the page's own entry.
  expect(result.html).toContain('hreflang="en"');
  expect(result.html).toContain('hreflang="de"');
  const urlBlocks = result.sitemapXml.split('<url>').slice(1);
  expect(urlBlocks).toHaveLength(2);
  for (const block of urlBlocks) {
    expect(block).toContain('hreflang="en"');
    expect(block).toContain('hreflang="de"');
  }
});

it('the same cluster is written as HTML link elements, an RFC 8288 Link header and sitemap xhtml links', () => {
  const result = buildHreflang('en https://example.invalid/en/\nde https://example.invalid/de/');

  expect(result.html).toBe(
    '<link rel="alternate" hreflang="en" href="https://example.invalid/en/" />\n' +
      '<link rel="alternate" hreflang="de" href="https://example.invalid/de/" />',
  );

  expect(result.linkHeader).toBe(
    '<https://example.invalid/en/>; rel="alternate"; hreflang="en", <https://example.invalid/de/>; rel="alternate"; hreflang="de"',
  );

  expect(result.sitemapXml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
  expect(result.sitemapXml).toContain('<loc>https://example.invalid/en/</loc>');
  expect(result.sitemapXml).toContain('<loc>https://example.invalid/de/</loc>');

  // A quote inside a URL is entity/attribute-escaped, never left literal.
  const hostile = buildHreflang("en https://example.invalid/a'b\n");
  expect(hostile.html).not.toContain('href="https://example.invalid/a\'b"');
  expect(hostile.html).toContain('&#39;');
});

it('x-default is accepted as the fallback and a repeated language tag is refused', () => {
  const withDefault = buildHreflang('en https://example.invalid/en/\nde https://example.invalid/de/', {
    xDefault: 'https://example.invalid/',
  });
  expect(withDefault.problems).toEqual([]);
  expect(withDefault.entries).toContainEqual({ tag: 'x-default', href: 'https://example.invalid/' });
  expect(withDefault.html).toContain('hreflang="x-default"');

  const repeated = buildHreflang('en https://example.invalid/en/\nEN https://example.invalid/en2/');
  expect(repeated.problems).toHaveLength(1);
  expect(repeated.problems[0]!.line).toBe(2);
  expect(repeated.entries).toHaveLength(1);

  const sameUrl = buildHreflang('en https://example.invalid/same\nde https://example.invalid/same');
  expect(sameUrl.problems).toEqual([]);
  expect(sameUrl.warnings.some((w) => w.includes('same'))).toBe(true);
  expect(sameUrl.entries).toHaveLength(2);

  const many = Array.from({ length: 1001 }, (_, i) => `en https://example.invalid/${i}`).join('\n');
  expect(() => buildHreflang(many)).toThrow(HreflangError);
});

it('nothing is written to the console while checking or building', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    checkLanguageTag('zh-Hant');
    checkLanguageTag('en_US');
    checkLanguageTag('not a tag');
    buildHreflang('en https://example.invalid/en/\nde https://example.invalid/de/', {
      xDefault: 'https://example.invalid/',
    });
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
  }
});

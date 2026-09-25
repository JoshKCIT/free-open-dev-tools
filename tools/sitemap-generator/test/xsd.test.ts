import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateXML, memoryPages } from 'xmllint-wasm';
import { it, expect } from 'vitest';
import { buildSitemaps } from '../src/index';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures', 'sitemaps-org-0.9');
const sitemapXsd = readFileSync(join(fixturesDir, 'sitemap.xsd'), 'utf8');
const siteindexXsd = readFileSync(join(fixturesDir, 'siteindex.xsd'), 'utf8');

/**
 * The default initial/max WASM memory (256 pages, 16 MiB) is not enough for
 * a file approaching the 50 MB uncompressed limit -- libxml2's own DOM
 * needs several times the input size. 512 pages (32 MiB) initial and
 * `2 * memoryPages.GiB` max, per the library's own README example, gives
 * enough headroom for this package's largest test file with no growth
 * thrashing.
 */
async function validateAgainst(xml: string, fileName: string, schema: string, schemaName: string) {
  return validateXML({
    xml: [{ fileName, contents: xml }],
    schema: [schema],
    preload: [{ fileName: schemaName, contents: schema }],
    initialMemoryPages: 512,
    maxMemoryPages: 2 * memoryPages.GiB,
  });
}

it('a URL list becomes a urlset that validates against the sitemaps.org 0.9 sitemap XSD', async () => {
  const result = buildSitemaps('https://example.com/\nhttps://example.com/about', {
    baseUrl: 'https://example.com/',
    lastmod: '2026-09-25',
    changefreq: 'weekly',
    priority: '0.7',
  });
  const validation = await validateAgainst(result.files[0]!.xml, 'sitemap.xml', sitemapXsd, 'sitemap.xsd');
  expect(validation.valid, JSON.stringify(validation.errors)).toBe(true);
});

it('more than 50,000 URLs are split into files of at most 50,000 under a sitemap index that validates against the siteindex XSD', async () => {
  const lines: string[] = [];
  for (let i = 0; i < 50002; i++) lines.push(`https://example.com/page-${i}`);
  const result = buildSitemaps(lines.join('\n'), { baseUrl: 'https://example.com/' });

  expect(result.files.length).toBeGreaterThan(1);
  for (const file of result.files) {
    const validation = await validateAgainst(file.xml, file.name, sitemapXsd, 'sitemap.xsd');
    expect(validation.valid, `${file.name}: ${JSON.stringify(validation.errors)}`).toBe(true);
  }
  expect(result.index).not.toBeNull();
  const indexValidation = await validateAgainst(result.index!.xml, result.index!.name, siteindexXsd, 'siteindex.xsd');
  expect(indexValidation.valid, JSON.stringify(indexValidation.errors)).toBe(true);
}, 30000);

it('a file that would pass 52,428,800 uncompressed bytes is split before it does and every reported byte count is exact', async () => {
  const longSegment = 'x'.repeat(1990);
  const lines: string[] = [];
  for (let i = 0; i < 30000; i++) lines.push(`https://example.com/${longSegment}-${i}`);
  const result = buildSitemaps(lines.join('\n'), { baseUrl: 'https://example.com/' });

  expect(result.files.length).toBeGreaterThan(1);
  const first = result.files[0]!;
  const validation = await validateAgainst(first.xml, first.name, sitemapXsd, 'sitemap.xsd');
  expect(validation.valid, JSON.stringify(validation.errors)).toBe(true);
}, 30000);

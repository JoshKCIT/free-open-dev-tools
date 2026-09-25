import meta from './meta.json';

export { meta };

/** sitemaps.org protocol: a sitemap file must not exceed 50,000 URLs. */
export const MAX_URLS_PER_FILE = 50000;
/** sitemaps.org FAQ: a sitemap file must not exceed 50 MB (52,428,800 bytes) uncompressed. */
export const MAX_BYTES_PER_FILE = 52428800;

const MAX_INPUT_LINES = 5_000_000;
const MIN_URL_LENGTH = 12;
const MAX_URL_LENGTH = 2048;

const NAMESPACE = 'http://www.sitemaps.org/schemas/sitemap/0.9';
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n';
const URLSET_FOOTER = '</urlset>\n';

const CHANGE_FREQUENCIES = ['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'];

export class SitemapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SitemapError';
  }
}

export interface SitemapFile {
  name: string;
  xml: string;
  urlCount: number;
  bytes: number;
}

export interface SitemapIndexFile {
  name: string;
  xml: string;
  bytes: number;
}

export interface SitemapProblem {
  line: number;
  message: string;
}

export interface BuildSitemapsOptions {
  baseUrl?: string;
  lastmod?: string;
  changefreq?: string;
  priority?: string;
  maxUrls?: number;
  maxBytes?: number;
}

export interface BuildSitemapsResult {
  files: SitemapFile[];
  index: SitemapIndexFile | null;
  splitReason: 'none' | 'count' | 'bytes';
  problems: SitemapProblem[];
  duplicates: number;
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return max;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** Every text value written into the XML is entity-escaped per the sitemaps.org protocol; "&" first so later replacements never re-escape it. */
function escapeXmlText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '&') out += '&amp;';
    else if (ch === '<') out += '&lt;';
    else if (ch === '>') out += '&gt;';
    else if (ch === '"') out += '&quot;';
    else if (ch === "'") out += '&apos;';
    else out += ch;
  }
  return out;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * The W3C Datetime formats the sitemaps.org XSD accepts for lastmod: a
 * plain date, or a full date and time with a zone (the two formats
 * xsd:date and xsd:dateTime cover). A bare year or year-month, which the
 * W3C note also lists, is not one of the XSD's two member types, so it is
 * not accepted here either.
 */
function isValidW3cDatetime(value: string): boolean {
  const datePattern = /^\d{4}-\d{2}-\d{2}(Z|[+-]\d{2}:\d{2})?$/;
  const dateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
  if (!datePattern.test(value) && !dateTimePattern.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

function isValidPriority(value: string): boolean {
  if (!/^\d+(\.\d+)?$/.test(value)) return false;
  const n = Number(value);
  return !Number.isNaN(n) && n >= 0 && n <= 1;
}

interface LineFields {
  urlText: string;
  lastmodOverride: string | null;
}

/**
 * Splits a line into its URL and an optional per-line lastmod override.
 * The text after the first run of whitespace is only treated as the
 * lastmod override when it is actually a valid W3C Datetime; otherwise the
 * whole line is kept as one URL, since an unencoded space pasted inside a
 * URL is far more likely than a stray second token.
 */
function splitLine(line: string): LineFields {
  const trimmed = line.trim();
  const idx = trimmed.search(/\s/);
  if (idx === -1) return { urlText: trimmed, lastmodOverride: null };
  const rest = trimmed.slice(idx).trim();
  if (rest !== '' && isValidW3cDatetime(rest)) {
    return { urlText: trimmed.slice(0, idx), lastmodOverride: rest };
  }
  return { urlText: trimmed, lastmodOverride: null };
}

interface BuiltEntry {
  xml: string;
  href: string;
  host: string;
}

/**
 * Builds one entry's `<url>` XML, in XSD element order (loc, lastmod,
 * changefreq, priority), or returns null when the URL itself cannot be
 * written to a sitemap at all. Pushes a problem for every issue, fatal or
 * not.
 */
function buildEntry(
  urlText: string,
  lineNumber: number,
  lastmodOverride: string | null,
  options: BuildSitemapsOptions,
  firstHost: string | null,
  problems: SitemapProblem[],
): BuiltEntry | null {
  let parsed: URL;
  try {
    parsed = new URL(urlText);
  } catch {
    problems.push({
      line: lineNumber,
      message: `Line ${lineNumber}: "${urlText}" is not an absolute URL, so it was skipped.`,
    });
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    problems.push({
      line: lineNumber,
      message: `Line ${lineNumber}: only http and https URLs can go in a sitemap; "${urlText}" was skipped.`,
    });
    return null;
  }

  const href = parsed.href;
  if (href.length > MAX_URL_LENGTH) {
    problems.push({
      line: lineNumber,
      message: `Line ${lineNumber}: this URL is ${href.length} characters, over the sitemaps.org protocol's ${MAX_URL_LENGTH}-character limit, so it was skipped.`,
    });
    return null;
  }
  if (href.length < MIN_URL_LENGTH) {
    problems.push({
      line: lineNumber,
      message: `Line ${lineNumber}: this URL is shorter than the sitemaps.org protocol's ${MIN_URL_LENGTH}-character minimum, so it was skipped.`,
    });
    return null;
  }
  if (href !== urlText) {
    problems.push({
      line: lineNumber,
      message: `Line ${lineNumber}: this URL was percent-encoded to match what a browser would actually request.`,
    });
  }
  if (firstHost !== null && parsed.host !== firstHost) {
    problems.push({
      line: lineNumber,
      message: `Line ${lineNumber}: this URL's host (${parsed.host}) differs from the sitemap's first URL host (${firstHost}); the sitemaps.org protocol says a sitemap should list only one host.`,
    });
  }

  const lastmodValue = lastmodOverride ?? options.lastmod ?? null;
  let lastmod: string | null = null;
  if (lastmodValue !== null && lastmodValue !== '') {
    if (isValidW3cDatetime(lastmodValue)) lastmod = lastmodValue;
    else {
      problems.push({
        line: lineNumber,
        message: `Line ${lineNumber}: "${lastmodValue}" is not a W3C Datetime, so lastmod was left out for this URL.`,
      });
    }
  }

  let changefreq: string | null = null;
  const changefreqValue = options.changefreq ?? null;
  if (changefreqValue !== null && changefreqValue !== '') {
    if (CHANGE_FREQUENCIES.includes(changefreqValue)) changefreq = changefreqValue;
    else {
      problems.push({
        line: lineNumber,
        message: `Line ${lineNumber}: "${changefreqValue}" is not one of the sitemaps.org protocol's seven changefreq values, so it was left out.`,
      });
    }
  }

  let priority: string | null = null;
  const priorityValue = options.priority ?? null;
  if (priorityValue !== null && priorityValue !== '') {
    if (isValidPriority(priorityValue)) priority = priorityValue;
    else {
      problems.push({
        line: lineNumber,
        message: `Line ${lineNumber}: "${priorityValue}" is not a decimal from 0.0 to 1.0, so priority was left out.`,
      });
    }
  }

  let xml = '  <url>\n';
  xml += `    <loc>${escapeXmlText(href)}</loc>\n`;
  if (lastmod !== null) xml += `    <lastmod>${escapeXmlText(lastmod)}</lastmod>\n`;
  if (changefreq !== null) xml += `    <changefreq>${escapeXmlText(changefreq)}</changefreq>\n`;
  if (priority !== null) xml += `    <priority>${escapeXmlText(priority)}</priority>\n`;
  xml += '  </url>\n';

  return { xml, href, host: parsed.host };
}

function urlsetHeader(): string {
  return `${XML_HEADER}<urlset xmlns="${NAMESPACE}">\n`;
}

/**
 * Turns a list of URLs (one per line, optionally followed by whitespace
 * then a per-line lastmod override) into sitemaps.org 0.9 XML, splitting
 * greedily into more than one file, under a sitemap index, the moment
 * either MAX_URLS_PER_FILE or the exact UTF-8 byte size of the finished
 * file text would pass `maxBytes` -- whichever limit is hit first for a
 * given URL list.
 */
export function buildSitemaps(text: string, options: BuildSitemapsOptions = {}): BuildSitemapsResult {
  const rawLines = text.split(/\r\n|\r|\n/);
  if (rawLines.length > MAX_INPUT_LINES) {
    throw new SitemapError(
      `This list has more than ${MAX_INPUT_LINES.toLocaleString('en-US')} lines, so it was refused rather than risk freezing the tab.`,
    );
  }

  const maxUrls = clamp(options.maxUrls ?? MAX_URLS_PER_FILE, 1, MAX_URLS_PER_FILE);
  const maxBytes = clamp(options.maxBytes ?? MAX_BYTES_PER_FILE, 1, MAX_BYTES_PER_FILE);

  const problems: SitemapProblem[] = [];
  const seenHrefs = new Set<string>();
  let duplicates = 0;
  let firstHost: string | null = null;
  let firstHref: string | null = null;

  const headerBytes = byteLength(urlsetHeader());
  const footerBytes = byteLength(URLSET_FOOTER);

  const files: SitemapFile[] = [];
  let splitReason: 'none' | 'count' | 'bytes' = 'none';

  let currentEntries: string[] = [];
  let currentBytes = headerBytes + footerBytes;
  let currentCount = 0;

  function finaliseCurrentFile(): void {
    if (currentCount === 0) return;
    const name = `sitemap-${files.length + 1}.xml`;
    const xml = `${urlsetHeader()}${currentEntries.join('')}${URLSET_FOOTER}`;
    files.push({ name, xml, urlCount: currentCount, bytes: currentBytes });
    currentEntries = [];
    currentBytes = headerBytes + footerBytes;
    currentCount = 0;
  }

  for (let i = 0; i < rawLines.length; i++) {
    const lineNumber = i + 1;
    const { urlText, lastmodOverride } = splitLine(rawLines[i]!);
    if (urlText === '') continue;

    const built = buildEntry(urlText, lineNumber, lastmodOverride, options, firstHost, problems);
    if (built === null) continue;
    if (firstHost === null) firstHost = built.host;
    if (firstHref === null) firstHref = built.href;

    if (seenHrefs.has(built.href)) {
      duplicates++;
      continue;
    }
    seenHrefs.add(built.href);

    const entryBytes = byteLength(built.xml);

    if (currentCount > 0 && currentCount + 1 > maxUrls) {
      if (splitReason === 'none') splitReason = 'count';
      finaliseCurrentFile();
    } else if (currentCount > 0 && currentBytes + entryBytes > maxBytes) {
      if (splitReason === 'none') splitReason = 'bytes';
      finaliseCurrentFile();
    }

    currentEntries.push(built.xml);
    currentBytes += entryBytes;
    currentCount++;
  }

  finaliseCurrentFile();

  if (files.length === 0) {
    return { files, index: null, splitReason: 'none', problems, duplicates };
  }
  if (files.length === 1) {
    files[0]!.name = 'sitemap.xml';
    return { files, index: null, splitReason: 'none', problems, duplicates };
  }

  let baseUrl = options.baseUrl;
  if (!baseUrl) {
    const origin = firstHref !== null ? new URL(firstHref).origin : '';
    baseUrl = `${origin}/`;
    problems.push({
      line: 0,
      message: `No base URL was given, so the sitemap index uses "${baseUrl}", the first URL's own origin.`,
    });
  }
  if (!baseUrl.endsWith('/')) baseUrl += '/';

  const indexEntries = files
    .map((f) => `  <sitemap>\n    <loc>${escapeXmlText(baseUrl + f.name)}</loc>\n  </sitemap>\n`)
    .join('');
  const indexXml = `${XML_HEADER}<sitemapindex xmlns="${NAMESPACE}">\n${indexEntries}</sitemapindex>\n`;
  const indexBytes = byteLength(indexXml);

  if (files.length > maxUrls) {
    throw new SitemapError(
      `Splitting produced ${files.length} sitemap files, more than the sitemap index's own ${maxUrls}-entry limit, so it was refused.`,
    );
  }
  if (indexBytes > maxBytes) {
    throw new SitemapError('The sitemap index itself would pass the uncompressed byte limit, so it was refused.');
  }

  return {
    files,
    index: { name: 'sitemap-index.xml', xml: indexXml, bytes: indexBytes },
    splitReason,
    problems,
    duplicates,
  };
}

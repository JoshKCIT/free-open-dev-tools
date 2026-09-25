import meta from './meta.json';
import { checkLanguageTag, REGISTRY_FILE_DATE } from './bcp47';

export { meta, REGISTRY_FILE_DATE };

export class HreflangError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HreflangError';
  }
}

const MAX_LINES = 1000;

export interface HreflangEntry {
  tag: string;
  href: string;
}

export interface HreflangProblem {
  /** 1-based line number, or 0 for a whole-run problem (for example a bad x-default URL). */
  line: number;
  message: string;
}

export interface BuildHreflangOptions {
  xDefault?: string;
}

export interface BuildHreflangResult {
  entries: HreflangEntry[];
  html: string;
  linkHeader: string;
  sitemapXml: string;
  problems: HreflangProblem[];
  warnings: string[];
}

// The four tag shapes the fetched Google Search Central page demonstrates:
// bare language ("de"), language-REGION ("en-US"), language-Script
// ("zh-Hant") and language-Script-REGION ("zh-Hans-US"), each read off the
// canonical (section 2.1.1 case-formatted) form of the tag.
const GOOGLE_DOCUMENTED_FORM = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$/;

function isAbsoluteHttpUrl(text: string): URL | null {
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface ParsedLine {
  line: number;
  tag: string;
  urlText: string;
}

function splitLines(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  const rawLines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i]!;
    if (raw.trim().length === 0) continue;
    const match = raw.match(/^(\S+)\s+(.+)$/);
    if (!match) {
      out.push({ line: i + 1, tag: raw.trim(), urlText: '' });
      continue;
    }
    out.push({ line: i + 1, tag: match[1]!, urlText: match[2]!.trim() });
  }
  return out;
}

/**
 * Builds one reciprocal cluster of hreflang annotations from lines of
 * `tag URL` pairs, written the same identical way on every page in the
 * cluster -- so every page lists every alternate, including itself, which
 * is what makes the annotations reciprocal by construction (Google Search
 * Central's own "missing return links" mistake cannot occur).
 */
export function buildHreflang(text: string, options: BuildHreflangOptions = {}): BuildHreflangResult {
  const lines = splitLines(text);
  if (lines.length > MAX_LINES) {
    throw new HreflangError(
      `This input has more than ${MAX_LINES} lines, so it was refused rather than risk freezing the tab.`,
    );
  }

  const problems: HreflangProblem[] = [];
  const warnings: string[] = [];
  const entries: HreflangEntry[] = [];
  const seenTags = new Map<string, number>(); // lowercased tag -> first line seen
  const seenUrls = new Map<string, string>(); // normalised href -> first tag seen

  for (const { line, tag, urlText } of lines) {
    if (urlText.length === 0) {
      problems.push({
        line,
        message: `"${tag}" has no URL after it. Each line needs a language tag, whitespace, then a URL.`,
      });
      continue;
    }

    const check = checkLanguageTag(tag);
    if (!check.wellFormed || !check.valid) {
      const detail = check.problems[0] ?? 'That is not a valid BCP 47 language tag.';
      problems.push({ line, message: detail });
      continue;
    }
    if (!GOOGLE_DOCUMENTED_FORM.test(check.canonical)) {
      warnings.push(
        `"${tag}" is a valid BCP 47 tag, but it is not one of the forms Google Search Central's own localized-versions page demonstrates (language, language-REGION, language-Script or language-Script-REGION).`,
      );
    }

    const url = isAbsoluteHttpUrl(urlText);
    if (!url) {
      problems.push({ line, message: `"${urlText}" is not an absolute http: or https: URL.` });
      continue;
    }

    const lowerTag = tag.toLowerCase();
    if (seenTags.has(lowerTag)) {
      problems.push({ line, message: `The language tag "${tag}" is already used on line ${seenTags.get(lowerTag)}.` });
      continue;
    }
    seenTags.set(lowerTag, line);

    const existingTagForUrl = seenUrls.get(url.href);
    if (existingTagForUrl && existingTagForUrl !== lowerTag) {
      warnings.push(`The URL "${url.href}" is listed under both "${existingTagForUrl}" and "${tag}".`);
    } else if (!existingTagForUrl) {
      seenUrls.set(url.href, lowerTag);
    }

    entries.push({ tag, href: url.href });
  }

  if (options.xDefault && options.xDefault.trim().length > 0) {
    const xDefaultText = options.xDefault.trim();
    const url = isAbsoluteHttpUrl(xDefaultText);
    if (!url) {
      problems.push({
        line: 0,
        message: `The x-default URL "${xDefaultText}" is not an absolute http: or https: URL.`,
      });
    } else if (seenTags.has('x-default')) {
      problems.push({ line: 0, message: 'x-default is already used by a line in the input above.' });
    } else {
      entries.push({ tag: 'x-default', href: url.href });
    }
  }

  const html = entries
    .map((e) => `<link rel="alternate" hreflang="${escapeHtmlAttr(e.tag)}" href="${escapeHtmlAttr(e.href)}" />`)
    .join('\n');

  const linkHeader = entries.map((e) => `<${e.href}>; rel="alternate"; hreflang="${e.tag}"`).join(', ');

  const sitemapXml = buildSitemapXml(entries);

  return { entries, html, linkHeader, sitemapXml, problems, warnings };
}

function buildSitemapXml(entries: HreflangEntry[]): string {
  const urlBlocks = entries.map((page) => {
    const links = entries
      .map(
        (alt) =>
          `    <xhtml:link\n               rel="alternate"\n               hreflang="${escapeXml(alt.tag)}"\n               href="${escapeXml(alt.href)}"/>`,
      )
      .join('\n');
    return `  <url>\n    <loc>${escapeXml(page.href)}</loc>\n${links}\n  </url>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    '  xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urlBlocks,
    '</urlset>',
  ].join('\n');
}

export { checkLanguageTag };

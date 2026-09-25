import meta from './meta.json';
import { sanitiseMarkup, describeRemoved, type RemovedSummary } from './sanitise';
import { previewMarkup, type MetaTagsFields, type TwitterCard } from './preview';
import type { WindowLike } from 'dompurify';

export { meta, describeRemoved };
export type { RemovedSummary, MetaTagsFields, TwitterCard };

export class MetaTagsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetaTagsError';
  }
}

export interface MetaTag {
  /** What kind of value this line carries: an ordinary text node, an href, or a meta name/property attribute. */
  attribute: 'text' | 'href' | 'name' | 'property';
  key: string;
  content: string;
}

export interface BuildMetaTagsResult {
  html: string;
  tags: MetaTag[];
  warnings: string[];
}

// X Cards markup reference (fetched from an archived snapshot, recorded in
// the SUMMARY, since the live page no longer serves its property table
// server-rendered): "Description of content (maximum 200 characters)",
// "Title of content (max 70 characters)", and for twitter:image:alt,
// "Maximum 420 characters."
const TWITTER_TITLE_MAX = 70;
const TWITTER_DESCRIPTION_MAX = 200;
const TWITTER_IMAGE_ALT_MAX = 420;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function checkUrlField(value: string, label: string, warnings: string[]): void {
  if (!value) return;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      warnings.push(`"${label}" is not an http or https URL, so it was kept as typed but may not resolve.`);
    }
  } catch {
    warnings.push(
      `"${label}" is a relative or otherwise unparseable URL, so it was kept as typed but may not resolve.`,
    );
  }
}

function checkHandleField(value: string, label: string, warnings: string[]): void {
  if (!value) return;
  if (!/^@\w{1,15}$/.test(value)) {
    warnings.push(
      `"${label}" should look like an @handle (an @ sign followed by up to 15 letters, digits or underscores).`,
    );
  }
}

/**
 * Writes SEO, Open Graph and Twitter Card meta tags from typed fields (pure,
 * no DOM). Emits, one per line: `<title>`, `meta name="description"`,
 * `link rel="canonical"`, `meta name="robots"`, the `og:` properties, then
 * the `twitter:` names, each in ogp.me's own example form ending ` />`.
 * Every attribute value and the title text are HTML-escaped, and whitespace
 * runs -- including line breaks -- collapse to one space first.
 */
export function buildMetaTags(fields: MetaTagsFields = {}): BuildMetaTagsResult {
  if (
    fields.twitterCard !== undefined &&
    fields.twitterCard !== 'summary' &&
    fields.twitterCard !== 'summary_large_image'
  ) {
    throw new MetaTagsError('twitterCard must be "summary" or "summary_large_image".');
  }

  const warnings: string[] = [];
  const tags: MetaTag[] = [];
  const lines: string[] = [];

  const title = collapseWhitespace(fields.title ?? '');
  const description = collapseWhitespace(fields.description ?? '');
  const canonical = collapseWhitespace(fields.canonical ?? '');
  const robots = collapseWhitespace(fields.robots ?? '');
  const ogType = collapseWhitespace(fields.ogType ?? '') || 'website';
  const siteName = collapseWhitespace(fields.siteName ?? '');
  const locale = collapseWhitespace(fields.locale ?? '');
  const imageUrl = collapseWhitespace(fields.imageUrl ?? '');
  const imageAlt = collapseWhitespace(fields.imageAlt ?? '');
  const twitterCard: TwitterCard = fields.twitterCard === 'summary' ? 'summary' : 'summary_large_image';
  const twitterSite = collapseWhitespace(fields.twitterSite ?? '');
  const twitterCreator = collapseWhitespace(fields.twitterCreator ?? '');

  checkUrlField(canonical, 'canonical', warnings);
  checkUrlField(imageUrl, 'imageUrl', warnings);
  checkHandleField(twitterSite, 'twitterSite', warnings);
  checkHandleField(twitterCreator, 'twitterCreator', warnings);

  if (title.length > TWITTER_TITLE_MAX) {
    warnings.push(
      `The title is ${title.length} characters. The X Cards markup reference lists ${TWITTER_TITLE_MAX} as twitter:title's maximum.`,
    );
  }
  if (description.length > TWITTER_DESCRIPTION_MAX) {
    warnings.push(
      `The description is ${description.length} characters. The X Cards markup reference lists ${TWITTER_DESCRIPTION_MAX} as twitter:description's maximum.`,
    );
  }
  if (imageAlt.length > TWITTER_IMAGE_ALT_MAX) {
    warnings.push(
      `The image description is ${imageAlt.length} characters. The X Cards markup reference lists ${TWITTER_IMAGE_ALT_MAX} as twitter:image:alt's maximum.`,
    );
  }

  function pushName(attribute: 'name' | 'property', key: string, content: string): void {
    tags.push({ attribute, key, content });
    lines.push(`<meta ${attribute}="${key}" content="${escapeHtmlAttr(content)}" />`);
  }

  if (title) {
    tags.push({ attribute: 'text', key: 'title', content: title });
    lines.push(`<title>${escapeHtmlText(title)}</title>`);
  }
  if (description) pushName('name', 'description', description);
  if (canonical) {
    tags.push({ attribute: 'href', key: 'canonical', content: canonical });
    lines.push(`<link rel="canonical" href="${escapeHtmlAttr(canonical)}" />`);
  }
  if (robots) pushName('name', 'robots', robots);

  // Open Graph protocol (ogp.me): og:title, og:type, og:url and og:image are
  // the four required properties; the rest are optional metadata.
  if (title) pushName('property', 'og:title', title);
  pushName('property', 'og:type', ogType);
  if (canonical) pushName('property', 'og:url', canonical);
  if (imageUrl) pushName('property', 'og:image', imageUrl);
  if (imageAlt) pushName('property', 'og:image:alt', imageAlt);
  if (description) pushName('property', 'og:description', description);
  if (siteName) pushName('property', 'og:site_name', siteName);
  if (locale) pushName('property', 'og:locale', locale);

  // X Cards markup reference property order: twitter:card, twitter:site,
  // twitter:creator, twitter:title, twitter:description, twitter:image,
  // twitter:image:alt.
  pushName('name', 'twitter:card', twitterCard);
  if (twitterSite) pushName('name', 'twitter:site', twitterSite);
  if (twitterCreator) pushName('name', 'twitter:creator', twitterCreator);
  if (title) pushName('name', 'twitter:title', title);
  if (description) pushName('name', 'twitter:description', description);
  if (imageUrl) pushName('name', 'twitter:image', imageUrl);
  if (imageAlt) pushName('name', 'twitter:image:alt', imageAlt);

  return { html: lines.join('\n'), tags, warnings };
}

/**
 * Builds the mock social preview from `fields` only, then sanitises it with
 * the canonical, byte-identical `sanitiseMarkup('html')` before returning it
 * (D-92): the preview markup this module builds carries no `src`, `href`,
 * `srcset` or `poster` attribute by construction, and the sanitiser removes
 * anything else that should not be there.
 */
export function buildSocialPreview(fields: MetaTagsFields, win: WindowLike): { html: string; removed: RemovedSummary } {
  const markup = previewMarkup(fields);
  const { markup: html, removed } = sanitiseMarkup(markup, win, 'html');
  return { html, removed };
}

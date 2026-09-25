/**
 * Builds mock Open Graph and X card previews from escaped text only, so the
 * unsanitised markup this module returns is already inert before it ever
 * reaches the canonical sanitiser (D-92). No `img`, no `a`, and no `src`,
 * `href`, `srcset` or `poster` attribute is ever written; every `style`
 * attribute holds a fixed set of harmless declarations with no `url(`
 * inside it. Never reads a DOM global: everything here is string building.
 */
export type TwitterCard = 'summary' | 'summary_large_image';

export interface MetaTagsFields {
  title?: string;
  description?: string;
  canonical?: string;
  robots?: string;
  ogType?: string;
  siteName?: string;
  locale?: string;
  imageUrl?: string;
  imageAlt?: string;
  twitterCard?: TwitterCard;
  twitterSite?: string;
  twitterCreator?: string;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Reads the domain to show as text, from `canonical` only. Returns '' when it does not parse. */
function domainFromCanonical(canonical: string): string {
  if (!canonical) return '';
  try {
    return new URL(canonical).hostname;
  } catch {
    return '';
  }
}

/** The image area: a grey placeholder block whose text names the image URL, or says there is none. Never an img, never a src. */
function imageAreaMarkup(imageUrl: string): string {
  const text = imageUrl ? `Image not loaded: ${escapeHtmlAttr(imageUrl)}` : 'No image';
  return `<div class="preview-image" style="background:#e5e7eb;color:#374151;padding:24px;text-align:center;font-size:12px">${text}</div>`;
}

/**
 * Builds two mock cards (an Open Graph style card, then an X card in the
 * chosen layout) from `fields`, as plain `div`/`p`/`span` markup with inline
 * `style` attributes only. Passed through the canonical sanitiser by
 * `buildSocialPreview` before being shown to a visitor.
 */
export function previewMarkup(fields: MetaTagsFields): string {
  const title = collapseWhitespace(fields.title ?? '');
  const description = collapseWhitespace(fields.description ?? '');
  const canonical = collapseWhitespace(fields.canonical ?? '');
  const imageUrl = collapseWhitespace(fields.imageUrl ?? '');
  const domain = domainFromCanonical(canonical);
  const isLarge = fields.twitterCard !== 'summary';

  const ogCard = `<div class="preview-card og-card" style="border:1px solid #d1d5db;border-radius:8px;overflow:hidden;max-width:500px;font-family:sans-serif">${imageAreaMarkup(
    imageUrl,
  )}<div style="padding:12px"><div style="font-size:11px;color:#6b7280">${escapeHtmlAttr(
    domain,
  )}</div><div style="font-weight:600;font-size:15px">${escapeHtmlAttr(
    title,
  )}</div><div style="font-size:13px;color:#4b5563">${escapeHtmlAttr(description)}</div></div></div>`;

  const xCard = `<div class="preview-card x-card${
    isLarge ? ' x-card-large' : ' x-card-summary'
  }" style="border:1px solid #d1d5db;border-radius:14px;overflow:hidden;max-width:500px;font-family:sans-serif;display:flex;${
    isLarge ? 'flex-direction:column' : 'flex-direction:row'
  }">${imageAreaMarkup(imageUrl)}<div style="padding:12px"><div style="font-weight:600;font-size:15px">${escapeHtmlAttr(
    title,
  )}</div><div style="font-size:13px;color:#4b5563">${escapeHtmlAttr(
    description,
  )}</div><div style="font-size:11px;color:#6b7280">${escapeHtmlAttr(domain)}</div></div></div>`;

  return `<div class="social-preview">${ogCard}${xCard}</div>`;
}

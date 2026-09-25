import { it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import type { WindowLike } from 'dompurify';
import { buildSocialPreview } from '../src/index';
import { previewMarkup } from '../src/preview';
import { findActiveContent } from './active-content';
import { loadXssVectors } from './xss-vectors';

function makeWindow(): WindowLike {
  return new JSDOM('', { url: 'https://example.invalid/' }).window as unknown as WindowLike;
}

/**
 * Parses `html` as an element tree and checks no element anywhere in it
 * carries a `src`, `href`, `srcset` or `poster` attribute. A raw string scan
 * for these names would false-positive on escaped hostile text that
 * legitimately contains the word "src=" as inert text content.
 */
function hasNoLoadingAttribute(html: string, win: WindowLike): boolean {
  const doc = new win.DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');
  const forbidden = ['src', 'href', 'srcset', 'poster'];
  const walk = (el: Element): boolean => {
    for (const name of forbidden) {
      if (el.hasAttribute(name)) return false;
    }
    for (const child of Array.from(el.children)) {
      if (!walk(child)) return false;
    }
    return true;
  };
  return doc.body ? walk(doc.body) : true;
}

it('the preview is built from the typed fields only and carries no src or href attribute', () => {
  const win = makeWindow();
  const markup = previewMarkup({
    title: 'A title',
    description: 'A description',
    canonical: 'https://example.invalid/page',
    imageUrl: 'https://example.invalid/card.png',
  });
  expect(hasNoLoadingAttribute(markup, win)).toBe(true);
  expect(markup).not.toContain('<img');
  expect(markup).not.toContain('<a ');
});

it('the image URL is shown in the preview as text and never as an image', () => {
  const markup = previewMarkup({ imageUrl: 'https://example.invalid/card.png' });
  expect(markup).toContain('Image not loaded: https://example.invalid/card.png');
  expect(markup).not.toContain('<img');

  const noImage = previewMarkup({});
  expect(noImage).toContain('No image');
});

// 9 fields x 107 vendored OWASP payloads, each building and sanitising a
// fresh DOMPurify instance: comfortably under a second per iteration, but
// the total exceeds vitest's 5s default test timeout, so this test gets a
// longer one (third argument to `it`).
it('OWASP XSS Filter Evasion Cheat Sheet payloads typed into every field leave no active content in the preview', () => {
  const win = makeWindow();
  const vectors = loadXssVectors();
  expect(vectors.length).toBeGreaterThan(0);

  const fieldNames = [
    'title',
    'description',
    'canonical',
    'imageUrl',
    'imageAlt',
    'siteName',
    'locale',
    'twitterSite',
    'twitterCreator',
  ] as const;

  for (const vector of vectors) {
    for (const field of fieldNames) {
      const { html } = buildSocialPreview({ [field]: vector.payload }, win);
      const violations = findActiveContent(html, win, 'html');
      expect(violations, `field ${field}, payload from "${vector.source}": ${vector.payload}`).toEqual([]);
      expect(
        hasNoLoadingAttribute(html, win),
        `field ${field}, payload from "${vector.source}": ${vector.payload}`,
      ).toBe(true);
    }
  }
}, 60_000);

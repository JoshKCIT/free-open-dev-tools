import { it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import type { WindowLike } from 'dompurify';
import { buildMetaTags, buildSocialPreview, MetaTagsError } from '../src/index';

function makeWindow(): WindowLike {
  return new JSDOM('', { url: 'https://example.invalid/' }).window as unknown as WindowLike;
}

it('Open Graph tags follow the ogp.me basic and optional metadata', () => {
  // ogp.me, "Basic Metadata": the four required properties are og:title,
  // og:type, og:url and og:image, shown there as:
  // <meta property="og:title" content="The Rock" />
  const result = buildMetaTags({
    title: 'The Rock',
    canonical: 'https://www.imdb.com/title/tt0117500/',
    imageUrl: 'https://ia.media-imdb.com/images/rock.jpg',
  });
  expect(result.html).toContain('<meta property="og:title" content="The Rock" />');
  expect(result.html).toContain('<meta property="og:type" content="website" />');
  expect(result.html).toContain('<meta property="og:url" content="https://www.imdb.com/title/tt0117500/" />');
  expect(result.html).toContain('<meta property="og:image" content="https://ia.media-imdb.com/images/rock.jpg" />');

  // "Optional Metadata": og:description and og:site_name are among the
  // properties named there as optional.
  const withOptional = buildMetaTags({ title: 'The Rock', description: 'A story.', siteName: 'IMDb', locale: 'en_GB' });
  expect(withOptional.html).toContain('<meta property="og:description" content="A story." />');
  expect(withOptional.html).toContain('<meta property="og:site_name" content="IMDb" />');
  expect(withOptional.html).toContain('<meta property="og:locale" content="en_GB" />');
});

it('Twitter card tags follow the X cards markup reference including its title and description length limits', () => {
  const result = buildMetaTags({
    title: 'A title',
    description: 'A description.',
    twitterCard: 'summary_large_image',
    twitterSite: '@example',
    twitterCreator: '@author',
  });
  expect(result.html).toContain('<meta name="twitter:card" content="summary_large_image" />');
  expect(result.html).toContain('<meta name="twitter:site" content="@example" />');
  expect(result.html).toContain('<meta name="twitter:creator" content="@author" />');
  expect(result.html).toContain('<meta name="twitter:title" content="A title" />');
  expect(result.html).toContain('<meta name="twitter:description" content="A description." />');

  // X Cards markup reference: "Title of content (max 70 characters)" and
  // "Description of content (maximum 200 characters)".
  const longTitle = buildMetaTags({ title: 'x'.repeat(71) });
  expect(longTitle.warnings.some((w) => w.includes('70'))).toBe(true);

  const okTitle = buildMetaTags({ title: 'x'.repeat(70) });
  expect(okTitle.warnings.some((w) => /title/i.test(w) && w.includes('70'))).toBe(false);

  const longDescription = buildMetaTags({ description: 'x'.repeat(201), twitterCard: 'summary_large_image' });
  expect(longDescription.warnings.some((w) => w.includes('200'))).toBe(true);

  const longImageAlt = buildMetaTags({ imageAlt: 'x'.repeat(421) });
  expect(longImageAlt.warnings.some((w) => w.includes('420'))).toBe(true);

  expect(() => buildMetaTags({ twitterCard: 'oops' as never })).toThrow(MetaTagsError);
});

it('every typed value is HTML-escaped in the generated tags so a quote or angle bracket cannot end an attribute', () => {
  const hostile = '"><img src=x onerror=alert(1)>';
  const result = buildMetaTags({ title: hostile, description: hostile });
  expect(result.html).not.toContain('<img');
  expect(result.html).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
  // The escaped form is text only, never an attribute-ending quote followed
  // by a raw tag.
  expect(result.html).not.toMatch(/content="[^"]*"[^>]*>[^<]*<img/);
});

it('a relative or non-http URL in a URL field is reported', () => {
  const relative = buildMetaTags({ canonical: '/relative/path' });
  expect(relative.warnings.some((w) => w.includes('canonical'))).toBe(true);

  const nonHttp = buildMetaTags({ imageUrl: 'javascript:alert(1)' });
  expect(nonHttp.warnings.some((w) => w.includes('imageUrl'))).toBe(true);

  const ok = buildMetaTags({ canonical: 'https://example.invalid/page', imageUrl: 'https://example.invalid/card.png' });
  expect(ok.warnings.some((w) => w.includes('canonical') || w.includes('imageUrl'))).toBe(false);
});

it('nothing is written to the console while building tags or the preview', () => {
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => undefined),
  );
  try {
    const fields = {
      title: '"><img src=x onerror=alert(1)>',
      description: '<script>alert(1)</script>',
      canonical: 'not a url',
      imageUrl: 'https://example.invalid/card.png',
      twitterSite: 'not-a-handle',
    };
    buildMetaTags(fields);
    buildSocialPreview(fields, makeWindow());
    try {
      buildMetaTags({ twitterCard: 'bad' as never });
    } catch {
      // expected
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

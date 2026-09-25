import { it, expect, vi } from 'vitest';
import { buildCampaignUrl, UTM_PARAMETERS, UtmBuilderError } from '../src/index';

// Google Analytics, "Collect campaign data with custom URLs"
// (https://support.google.com/analytics/answer/10917952?hl=en), fetched
// 2026-09-25. The page lists the parameters, in this order, under "Add utm
// parameters to URL": utm_id, utm_source, utm_medium, utm_campaign,
// utm_source_platform, utm_term, utm_content, utm_creative_format,
// utm_marketing_tactic. It then says: "When you add parameters to a URL, you
// should always use utm_source, utm_medium, and utm_campaign." -- the three
// parameters this test asserts UTM_PARAMETERS marks required.
const GA_DOCUMENTED_ORDER = [
  'utm_id',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_source_platform',
  'utm_term',
  'utm_content',
  'utm_creative_format',
  'utm_marketing_tactic',
];
const GA_REQUIRED = new Set(['utm_source', 'utm_medium', 'utm_campaign']);

it('campaign parameters go before the fragment and every existing query pair keeps its exact bytes', () => {
  const result = buildCampaignUrl('https://example.invalid/p?a=b%20c&x=%2F#top', { utm_source: 'news letter' });
  expect(result.url).toBe('https://example.invalid/p?a=b%20c&x=%2F&utm_source=news%20letter#top');
});

it('values are encoded with the WHATWG URL component percent-encode set so spaces and ampersands cannot split a parameter', () => {
  const result = buildCampaignUrl('https://example.invalid/', {
    utm_source: 'a&b=c#d+e',
    utm_medium: 'x y',
    utm_campaign: 'spring & summer',
  });
  const reparsed = new URL(result.url);
  expect(reparsed.searchParams.get('utm_source')).toBe('a&b=c#d+e');
  expect(reparsed.searchParams.get('utm_medium')).toBe('x y');
  expect(reparsed.searchParams.get('utm_campaign')).toBe('spring & summer');
  // Splitting the raw query text on '&' must produce exactly three pairs: an
  // encoded '&' inside a value must never be read as a pair separator.
  const rawQuery = result.url.split('?')[1] ?? '';
  expect(rawQuery.split('&').length).toBe(3);
});

it('an existing campaign parameter is replaced rather than duplicated and the replacement is reported', () => {
  const result = buildCampaignUrl('https://example.invalid/?utm_source=old', { utm_source: 'new' });
  const matches = result.url.match(/utm_source=/g) ?? [];
  expect(matches.length).toBe(1);
  expect(result.url).toContain('utm_source=new');
  expect(result.replaced).toEqual(['utm_source']);
  expect(result.added).toEqual([]);
});

it('the parameter names and their order match the Google Analytics campaign URL documentation', () => {
  expect(UTM_PARAMETERS.map((p) => p.name)).toEqual(GA_DOCUMENTED_ORDER);
  for (const { name, required } of UTM_PARAMETERS) {
    expect(required).toBe(GA_REQUIRED.has(name));
  }
});

it('the built URL reparses with the WHATWG URL parser to exactly the values entered', () => {
  const values: Record<string, string> = {
    utm_id: 'camp-1',
    utm_source: 'google',
    utm_medium: 'cpc',
    utm_campaign: 'spring_sale',
    utm_source_platform: 'Search Ads 360',
    utm_term: 'running shoes',
    utm_content: 'logolink',
    utm_creative_format: 'display',
    utm_marketing_tactic: 'remarketing',
  };
  const result = buildCampaignUrl('https://example.invalid/landing', values);
  const reparsed = new URL(result.url);
  for (const [name, value] of Object.entries(values)) {
    expect(reparsed.searchParams.get(name)).toBe(value);
  }
});

it('a URL the WHATWG URL parser refuses, or one that is not http or https, is refused with a message', () => {
  expect(() => buildCampaignUrl('not a url', { utm_source: 'x' })).toThrow(UtmBuilderError);
  expect(() => buildCampaignUrl('ftp://example.invalid/', { utm_source: 'x' })).toThrow(UtmBuilderError);
});

it('mixed-case values are flagged and can be lower-cased on request', () => {
  const flagged = buildCampaignUrl('https://example.invalid/', { utm_medium: 'Email' });
  expect(flagged.warnings.some((w) => w.includes('utm_medium'))).toBe(true);
  expect(new URL(flagged.url).searchParams.get('utm_medium')).toBe('Email');

  const lowercased = buildCampaignUrl('https://example.invalid/', { utm_medium: 'Email' }, { lowercase: true });
  expect(lowercased.warnings.some((w) => w.includes('utm_medium'))).toBe(true);
  expect(new URL(lowercased.url).searchParams.get('utm_medium')).toBe('email');
});

it('nothing is written to the console while building', () => {
  const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    buildCampaignUrl('https://example.invalid/p?a=1&utm_source=old#frag', {
      utm_source: 'News',
      utm_medium: 'email',
      utm_campaign: 'spring sale',
    });
    try {
      buildCampaignUrl('not a url', {});
    } catch {
      // expected
    }
    try {
      buildCampaignUrl('ftp://example.invalid/', {});
    } catch {
      // expected
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

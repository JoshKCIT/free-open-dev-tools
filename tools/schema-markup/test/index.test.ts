/**
 * Every `it` here is a required top-level title, matched by exact fullName
 * in this plan's own verify script -- none may be nested inside a
 * `describe()`.
 */
import { it, expect, vi } from 'vitest';
import { buildJsonLd, CONTENT_TYPES, SchemaMarkupError } from '../src/index';
import { TYPES } from '../src/schema-org-subset';

it('each of the twelve content types is built only from properties schema.org defines for that type or a parent type', () => {
  expect(CONTENT_TYPES).toHaveLength(12);
  for (const type of CONTENT_TYPES) {
    const result = buildJsonLd(type, 'name: Example');
    expect(result.problems, `${type} should accept "name" with no problems`).toEqual([]);
    expect(result.object['@type']).toBe(type);
    expect(result.object.name).toBe('Example');

    const record = TYPES.get(type);
    expect(record, `${type} must be in the bundled subset`).toBeDefined();
    for (const key of Object.keys(result.object)) {
      if (key === '@context' || key === '@type') continue;
      expect(record!.properties, `${type}'s own key "${key}" should be one of its applicable properties`).toContain(
        key,
      );
    }
  }
});

it('a property schema.org does not define for the type is refused with its line number', () => {
  const result = buildJsonLd('Article', 'name: A piece\nflavour: sweet');
  expect(result.problems).toContainEqual({
    line: 2,
    message: '"flavour" is not a property schema.org defines for Article or a parent type.',
  });
  expect(result.object).not.toHaveProperty('flavour');
  expect(result.object.name).toBe('A piece');
});

it('nested objects take a type from the property range and an explicit type line overrides it', () => {
  const offer = buildJsonLd('Product', 'name: Widget\noffers.price: 19.99\noffers.priceCurrency: USD');
  expect(offer.problems).toEqual([]);
  expect(offer.object.offers).toEqual({ '@type': 'Offer', price: '19.99', priceCurrency: 'USD' });

  const faq = buildJsonLd('FAQPage', 'mainEntity.1.name: What?\nmainEntity.1.acceptedAnswer.text: This.');
  expect(faq.problems).toEqual([]);
  expect(faq.object.mainEntity).toEqual([
    { '@type': 'Question', name: 'What?', acceptedAnswer: { '@type': 'Answer', text: 'This.' } },
  ]);

  // author's default is Person; an explicit @type line overrides it to
  // Organization, which is also in author's own range (Organization | Person).
  const overridden = buildJsonLd('Article', 'name: A piece\nauthor.@type: Organization\nauthor.name: Example Corp');
  expect(overridden.problems).toEqual([]);
  expect(overridden.object.author).toEqual({ '@type': 'Organization', name: 'Example Corp' });

  // An explicit type outside the property's range (or a subtype of it) is refused.
  const badOverride = buildJsonLd('Article', 'name: A piece\nauthor.@type: Product\nauthor.name: Not a person');
  expect(badOverride.problems.length).toBeGreaterThan(0);
  expect(badOverride.problems[0]!.message).toMatch(/not in this property's range/);
});

it('a value containing a closing script tag cannot end the script element early', () => {
  const result = buildJsonLd('Article', 'name: </script><script>alert(1)</script>');
  expect(result.json).toContain('</script><script>alert(1)</script>');
  expect(result.scriptTag).not.toContain('</script><script>alert(1)</script>');
  expect(result.scriptTag).toContain('\\u003C/script\\u003E\\u003Cscript\\u003Ealert(1)\\u003C/script\\u003E');
  expect(result.scriptTag.startsWith('<script type="application/ld+json">')).toBe(true);
  expect(result.scriptTag.endsWith('</script>')).toBe(true);
});

it('URL, Date and DateTime values are checked against the formats schema.org names', () => {
  const badDate = buildJsonLd('Article', 'name: A piece\ndatePublished: yesterday');
  expect(badDate.problems).toContainEqual({
    line: 2,
    message: '"datePublished" must be an ISO 8601 date or date-time (its range is Date/DateTime only).',
  });

  const goodDate = buildJsonLd('Article', 'name: A piece\ndatePublished: 2024-01-01');
  expect(goodDate.problems).toEqual([]);
  expect(goodDate.object.datePublished).toBe('2024-01-01');

  const goodDateTime = buildJsonLd('Article', 'name: A piece\ndatePublished: 2024-01-01T12:00:00Z');
  expect(goodDateTime.problems).toEqual([]);

  const badUrl = buildJsonLd('Article', 'name: A piece\nurl: not-a-url');
  expect(badUrl.problems).toContainEqual({
    line: 2,
    message: '"url" must be an absolute URL (its range is URL only).',
  });

  const goodUrl = buildJsonLd('Article', 'name: A piece\nurl: https://example.invalid/a');
  expect(goodUrl.problems).toEqual([]);
});

it('nothing is written to the console while building', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    buildJsonLd('Article', 'name: A piece\nflavour: sweet\ndatePublished: yesterday');
    buildJsonLd('Product', 'name: Widget\noffers.price: 19.99\noffers.priceCurrency: USD');
    expect(() => buildJsonLd('NotAType', 'name: x')).toThrow(SchemaMarkupError);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
  }
});

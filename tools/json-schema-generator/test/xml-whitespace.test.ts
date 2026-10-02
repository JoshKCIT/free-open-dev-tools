import { it, expect } from 'vitest';
import { generateSchema } from '../src/index';

// Extensible Markup Language (XML) 1.0, Fifth Edition, section 2.7: the content of a CDATA section is literal text,
// white space included, so a date with a space on each side is not an RFC 3339 full-date.
// JSON Schema 2020-12 validation, section 7.3.1 (format "date": RFC 3339 full-date).

function dateProperty(xml: string): Record<string, unknown> {
  const schema = JSON.parse(generateSchema(xml, { inputFormat: 'xml' }).output) as {
    properties: { r: { properties: { d: Record<string, unknown> } } };
  };
  return schema.properties.r.properties.d;
}

it('an XML date is detected as a date, and the same text in a CDATA section with spaces around it is plain text', () => {
  expect(dateProperty('<r><d>2020-01-01</d></r>')).toEqual({ type: 'string', format: 'date' });
  expect(dateProperty('<r><d>\n  2020-01-01\n</d></r>')).toEqual({ type: 'string', format: 'date' });
  expect(dateProperty('<r><d><![CDATA[ 2020-01-01 ]]></d></r>')).toEqual({ type: 'string' });
});

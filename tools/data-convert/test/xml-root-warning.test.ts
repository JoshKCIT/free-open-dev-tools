import { it, expect } from 'vitest';
import { writeXmlValue } from '../src/xml-write';

// XML 1.0 section 2.1: a document has exactly one root element, and an attribute or the text of an element is not an
// element. A value whose only key is an attribute (@_x) or the text key (#text) has no root element to write, so it is
// wrapped, and the warning has to say why (it used to say "more than one top-level key" for a single key).

it('a single top-level attribute or text key is wrapped with a warning that names that key, not "more than one"', () => {
  const attribute = writeXmlValue({ '@_x': 1 });
  expect(attribute.xml).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<root x="1"/>');
  expect(attribute.warnings).toEqual([
    'The only top-level key is an attribute or the text of an element, which cannot be a root element, so it was wrapped in a root element.',
  ]);
  const text = writeXmlValue({ '#text': 'hi' });
  expect(text.xml).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<root>hi</root>');
  expect(text.warnings.join(' ')).toContain('only top-level key');
  expect(text.warnings.join(' ')).not.toContain('more than one');
});

it('two keys, and no key, keep their own warnings', () => {
  expect(writeXmlValue({ a: 1, b: 2 }).warnings).toEqual([
    'The input had more than one top-level key, so it was wrapped in a root element.',
  ]);
  expect(writeXmlValue({}).warnings).toEqual(['The input had no top-level key, so it was wrapped in a root element.']);
  expect(writeXmlValue({ '@_x': 1, b: 2 }).warnings.join(' ')).toContain('more than one');
});

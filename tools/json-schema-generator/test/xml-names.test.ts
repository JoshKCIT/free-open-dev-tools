import { it, expect } from 'vitest';
import { generateSchema } from '../src/index';

// Extensible Markup Language (XML) 1.0, Fifth Edition, section 2.3: constructor, prototype and toString are ordinary
// element names, so an XML sample that uses them gives properties with those names, as the same JSON sample does.

it('XML elements named constructor, prototype and toString become ordinary properties, like the same JSON keys', () => {
  const fromXml = generateSchema('<a><constructor>x</constructor><prototype>y</prototype><toString>z</toString></a>', {
    inputFormat: 'xml',
  });
  const fromJson = generateSchema('{"a":{"constructor":"x","prototype":"y","toString":"z"}}', {});
  expect(fromXml.output).toBe(fromJson.output);
  const schema = JSON.parse(fromXml.output) as { properties: { a: { properties: Record<string, unknown> } } };
  expect(Object.keys(schema.properties.a.properties)).toEqual(['constructor', 'prototype', 'toString']);
});

import { it, expect } from 'vitest';
import { jsonToCode } from '../src/index';

// Extensible Markup Language (XML) 1.0, Fifth Edition, section 2.3: constructor, prototype and toString are ordinary
// element names, so an XML sample that uses them gives fields with those names, as the same JSON sample does.

it('XML elements named constructor, prototype and toString become ordinary fields, like the same JSON keys', () => {
  const fromXml = jsonToCode('<a><constructor>x</constructor><prototype>y</prototype><toString>z</toString></a>', {
    language: 'typescript',
    inputFormat: 'xml',
  });
  const fromJson = jsonToCode('{"a":{"constructor":"x","prototype":"y","toString":"z"}}', { language: 'typescript' });
  expect(fromXml.output).toBe(fromJson.output);
  expect(fromXml.output).toContain('constructor: string;');
  expect(fromXml.output).toContain('toString: string;');
});

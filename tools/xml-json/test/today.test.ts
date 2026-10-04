import { it, expect } from 'vitest';
import { xmlToJson, jsonToXml, XmlJsonError } from '../src/index';

// These tests pin what the converter does TODAY with the XML declaration, processing instructions, comments and CDATA
// sections. They were written from the converter's measured output and describe it; nothing here is a wish. Where the
// behaviour departs from XML 1.0 (Fifth Edition, https://www.w3.org/TR/xml/), the rule it departs from is named, so a
// later change to any of this is made on purpose and not by accident.

/** The converted JSON text as an object. */
function jsonOf(xml: string): unknown {
  return JSON.parse(xmlToJson(xml).output);
}

it('the XML declaration and processing instructions are kept as keys, as today', () => {
  // XML 1.0 section 2.6: a processing instruction is not part of the document's character data and MUST be passed
  // through to the application, and the XML declaration (section 2.8) is not an element at all. This converter makes
  // each of them a JSON key whose name starts with a question mark, followed by the instruction's target.
  expect(jsonOf('<?xml version="1.0" encoding="UTF-8"?><a>x</a>')).toEqual({
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    a: 'x',
  });
  // The text of the output keeps that order, with the declaration first.
  expect(xmlToJson('<?xml version="1.0" encoding="UTF-8"?><a>x</a>').output).toBe(
    '{\n  "?xml": {\n    "@_version": "1.0",\n    "@_encoding": "UTF-8"\n  },\n  "a": "x"\n}',
  );

  // A stylesheet instruction after the declaration is a second key named after its target; its pseudo-attributes are
  // read as attributes, so they carry the chosen attribute prefix.
  expect(jsonOf('<?xml version="1.0"?><?xml-stylesheet href="s.css"?><a>x</a>')).toEqual({
    '?xml': { '@_version': '1.0' },
    '?xml-stylesheet': { '@_href': 's.css' },
    a: 'x',
  });
  // The attribute prefix chosen by the visitor is used for them as for any attribute.
  expect(JSON.parse(xmlToJson('<?xml version="1.0"?><a>x</a>', { attributePrefix: '$' }).output)).toEqual({
    '?xml': { $version: '1.0' },
    a: 'x',
  });

  // A processing instruction with data outside the root element is a key with an empty value: the data is dropped.
  expect(jsonOf('<?pi data?><a>x</a>')).toEqual({ '?pi': '', a: 'x' });
  // Inside an element the key stays next to the text, with an empty value, and the data is dropped there too.
  expect(jsonOf('<a><?pi data?>x</a>')).toEqual({ a: { '?pi': '', '#text': 'x' } });
});

it('comments are dropped and entities inside CDATA are decoded, as today', () => {
  // XML 1.0 section 2.5: a comment is not part of the document's character data and a processor MAY, but need not, let
  // the application retrieve it. This converter does not: a comment leaves no trace in the output.
  expect(jsonOf('<a><!-- hidden -->x</a>')).toEqual({ a: 'x' });
  expect(jsonOf('<!-- before --><a>x</a><!-- after -->')).toEqual({ a: 'x' });
  expect(xmlToJson('<a><!-- hidden -->x</a>').output).not.toContain('hidden');

  // XML 1.0 section 2.7: inside a CDATA section only the closing string is markup, so a left angle bracket and an
  // ampersand stay literal and "&amp;" would stay six characters. This converter turns a CDATA section into plain text
  // and then decodes the entities in it, exactly as it does for ordinary text, so "&amp;" becomes "&".
  expect(jsonOf('<a><![CDATA[1 &amp; 2 <b>]]></a>')).toEqual({ a: '1 & 2 <b>' });
  // A character reference inside CDATA is decoded as well.
  expect(jsonOf('<a><![CDATA[&#65;&lt;]]></a>')).toEqual({ a: 'A<' });
  // Ordinary text gives the same answer for the same entity, so a CDATA section and ordinary text are not told apart.
  expect(jsonOf('<a>1 &amp; 2</a>')).toEqual({ a: '1 & 2' });
  expect(jsonOf('<a><![CDATA[1 &amp; 2]]></a>')).toEqual(jsonOf('<a>1 &amp; 2</a>'));
});

it('JSON to XML refuses the key the XML declaration became, as today', () => {
  // XML 1.0 section 2.3, the Name production: a question mark cannot be part of an element name, so the key the
  // declaration became cannot be written back as an element and the conversion refuses it, with the path of the key.
  const declaration = '{"?xml":{"@_version":"1.0"},"a":"x"}';
  let caught: unknown;
  try {
    jsonToXml(declaration);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(XmlJsonError);
  expect((caught as XmlJsonError).message).toBe('"?xml" is not a valid XML 1.0 element name.');
  expect((caught as XmlJsonError).path).toBe('/root/?xml');

  // The key a processing instruction became is refused the same way, wherever it is.
  expect(() => jsonToXml('{"a":{"?pi":"","#text":"x"}}')).toThrowError('"?pi" is not a valid XML 1.0 element name.');

  // So the output of converting a document with a declaration to JSON cannot be converted straight back to XML.
  expect(() => jsonToXml(xmlToJson('<?xml version="1.0"?><a>x</a>').output)).toThrowError(XmlJsonError);

  // What the converter writes itself is a declaration, by default, and the visitor can switch it off.
  expect(jsonToXml('{"a":"x"}').output).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<a>x</a>\n');
  expect(jsonToXml('{"a":"x"}', { declaration: false }).output).toBe('<a>x</a>\n');
});

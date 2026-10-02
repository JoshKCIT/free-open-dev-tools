import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { convertData, DataConvertError } from '../src/index';
import { readXmlValue, XmlValueError } from '../src/xml-read';

// Extensible Markup Language (XML) 1.0, Fifth Edition: https://www.w3.org/TR/xml/
//   section 2.4 (character data and the five predefined entities), 2.7 (CDATA sections, content is literal),
//   section 4.6 and 4.1 (character references) and the well-formedness rules (every start tag has a matching end tag).
// The attribute, text and repetition rules are the ones the site's XML and JSON page states: attributes become keys
// with the prefix @_, element text sits under #text beside attributes or children, repeated siblings become an array,
// every value stays a string. The literals below were checked against fast-xml-parser 5.11.1 run as a second opinion.

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  expect(console.log).not.toHaveBeenCalled();
  expect(console.warn).not.toHaveBeenCalled();
  expect(console.error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

it('XML in follows the live attribute and text rules: @_ attributes, #text beside them, repeated siblings as arrays', () => {
  // Text beside an attribute: the text key first, the attribute last.
  expect(JSON.stringify(readXmlValue('<book id="1">Moby</book>', {}).value)).toBe(
    '{"book":{"#text":"Moby","@_id":"1"}}',
  );
  // Repeated sibling elements become an array of strings.
  expect(JSON.stringify(readXmlValue('<a><b>1</b><b>2</b></a>', {}).value)).toBe('{"a":{"b":["1","2"]}}');
  // A text-only element is just a string and an empty element is the empty string; values stay strings.
  expect(JSON.stringify(readXmlValue('<a><n>007</n><e/></a>', {}).value)).toBe('{"a":{"n":"007","e":""}}');
  // Namespace prefixes stay in the names.
  expect(JSON.stringify(readXmlValue('<ns:a xmlns:ns="urn:x" ns:k="v">t</ns:a>', {}).value)).toBe(
    '{"ns:a":{"#text":"t","@_xmlns:ns":"urn:x","@_ns:k":"v"}}',
  );
  // The five predefined entities and character references decode once; CDATA content is literal (XML 1.0 section 2.7).
  expect(JSON.stringify(readXmlValue('<a t="&lt;1&gt;">x &amp; y &#65;&#x42;</a>', {}).value)).toBe(
    '{"a":{"#text":"x & y AB","@_t":"<1>"}}',
  );
  expect(JSON.stringify(readXmlValue('<a><![CDATA[<b>&amp;</b>]]></a>', {}).value)).toBe('{"a":"<b>&amp;</b>"}');
  // Only when asked do numbers and booleans become typed.
  expect(JSON.stringify(readXmlValue('<a><n>7</n><t>true</t></a>', { parseValues: true }).value)).toBe(
    '{"a":{"n":7,"t":true}}',
  );
  // Comments, processing instructions and the declaration are dropped, and the warnings say so.
  const dropped = readXmlValue('<?xml version="1.0"?><?go now?><!-- note --><a>1</a>', {});
  expect(JSON.stringify(dropped.value)).toBe('{"a":"1"}');
  const text = dropped.warnings.join(' ').toLowerCase();
  expect(text).toContain('comment');
  expect(text).toContain('processing instruction');
  expect(text).toContain('declaration');
  // Text mixed with elements is gathered under the text key, and a warning says its place was not kept.
  const mixed = readXmlValue('<a>one<b>1</b>two</a>', {});
  expect(mixed.warnings.join(' ')).toContain('mixes text with child elements');
  // The converter reads XML through the same rules: JSON out, two-space indent by default.
  expect(convertData('<book id="1">Moby</book>', { from: 'xml', to: 'json' }).output).toBe(
    '{\n  "book": {\n    "#text": "Moby",\n    "@_id": "1"\n  }\n}',
  );
  // The old defaults are untouched: JSON in, YAML out, indent 2.
  expect(convertData('{"name":"Ada","tags":["a","b"]}', { from: 'json', to: 'yaml' }).output).toBe(
    'name: Ada\ntags:\n  - a\n  - b\n',
  );
});

it('the attribute prefix and text key can be changed', () => {
  expect(
    JSON.stringify(readXmlValue('<book id="1">Moby</book>', { attributePrefix: '@', textKey: '_text' }).value),
  ).toBe('{"book":{"_text":"Moby","@id":"1"}}');
  const viaConverter = convertData('<book id="1">Moby</book>', {
    from: 'xml',
    to: 'json',
    attributePrefix: '@',
    textKey: '_text',
  });
  expect(JSON.parse(viaConverter.output)).toEqual({ book: { _text: 'Moby', '@id': '1' } });
  // An empty prefix is allowed: the attribute is then a key of its own.
  expect(JSON.stringify(readXmlValue('<a k="v"><b>1</b></a>', { attributePrefix: '' }).value)).toBe(
    '{"a":{"b":"1","k":"v"}}',
  );
});

it('a DOCTYPE is refused before parsing and malformed XML names its line and column', () => {
  const withDoctype = '<?xml version="1.0"?>\n<!DOCTYPE a [<!ENTITY x "y">]>\n<a>&x;</a>';
  try {
    readXmlValue(withDoctype, {});
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(XmlValueError);
    const e = err as XmlValueError;
    expect(e.message).toBe('Documents with a DOCTYPE are refused: this page never reads DTDs or entity declarations.');
    // The DOCTYPE starts at the first character of line 2.
    expect(e.line).toBe(2);
    expect(e.column).toBe(1);
  }
  // Any letter case is refused too.
  expect(() => readXmlValue('<!doctype a><a/>', {})).toThrowError(XmlValueError);

  // XML 1.0 well-formedness: the end tag on line 2 closes a, but b is still open. The end tag starts at column 6.
  try {
    readXmlValue('<a>\n  <b></a>', {});
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(XmlValueError);
    const e = err as XmlValueError;
    expect(e.line).toBe(2);
    expect(e.column).toBe(6);
  }

  // Through the converter the same refusals arrive as the converter's own error, with the same position.
  try {
    convertData('<a>\n  <b></a>', { from: 'xml', to: 'json' });
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(DataConvertError);
    const e = err as DataConvertError;
    expect(e.line).toBe(2);
    expect(e.column).toBe(6);
  }
  expect(() => convertData(withDoctype, { from: 'xml', to: 'json' })).toThrowError(DataConvertError);
  // An element or document that never closes is refused too, and a document with two roots is not well formed.
  expect(() => readXmlValue('<a><b>', {})).toThrowError(XmlValueError);
  expect(() => readXmlValue('<a/><b/>', {})).toThrowError(XmlValueError);
  expect(() => readXmlValue('just text', {})).toThrowError(XmlValueError);
});

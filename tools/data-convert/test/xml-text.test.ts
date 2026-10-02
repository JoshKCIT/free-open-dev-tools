import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readXmlValue } from '../src/xml-read';

// Extensible Markup Language (XML) 1.0, Fifth Edition: https://www.w3.org/TR/xml/
//   section 2.4 (character data), section 2.7 (a CDATA section's content is literal, white space included),
//   section 2.10 (white space handling) and section 3.3.3 (an attribute value is not trimmed).
// The rules under test are the ones the reader states at the top of xml-read.ts: an element's text is gathered
// across its child elements and trimmed once at its two ends; whitespace-only text is dropped; CDATA and attribute
// values are never trimmed; an element named like an Object.prototype member is an ordinary key.

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

function read(xml: string, parseValues = false): string {
  return JSON.stringify(readXmlValue(xml, { parseValues }).value);
}

it('words around a child element keep the space between them instead of fusing', () => {
  expect(read('<p>Hello <b>big</b> world</p>')).toBe('{"p":{"b":"big","#text":"Hello  world"}}');
  expect(read('<p>one <i>two</i></p>')).toBe('{"p":{"i":"two","#text":"one"}}');
  expect(read('<p>a<b/>b</p>')).toBe('{"p":{"b":"","#text":"ab"}}');
});

it('white space between child elements is dropped and white space at the two ends of text is trimmed once', () => {
  const spaced = readXmlValue('<a>\n  <b>1</b>\n  <b>2</b>\n</a>', {});
  expect(JSON.stringify(spaced.value)).toBe('{"a":{"b":["1","2"]}}');
  expect(spaced.warnings).toEqual([]);
  expect(read('<a x="1">  hi  </a>')).toBe('{"a":{"#text":"hi","@_x":"1"}}');
  expect(read('<a> </a>')).toBe('{"a":""}');
  expect(read('<a>\n\t</a>')).toBe('{"a":""}');
  expect(read('<a x="1"> \n </a>')).toBe('{"a":{"@_x":"1"}}');
  expect(read('<a>  two  words  </a>')).toBe('{"a":"two  words"}');
});

it('a CDATA section keeps its white space and an attribute value is not trimmed', () => {
  expect(read('<a><![CDATA[ <b> ]]></a>')).toBe('{"a":" <b> "}');
  expect(read('<a><![CDATA[   ]]></a>')).toBe('{"a":"   "}');
  expect(read('<a><![CDATA[\nx\n]]></a>')).toBe('{"a":"\\nx\\n"}');
  expect(read('<a>  <![CDATA[ x ]]>  </a>')).toBe('{"a":" x "}');
  // Line breaks in a CDATA section are normalised to a line feed (XML 1.0 section 2.11).
  expect(read('<a><![CDATA[a\r\nb\rc]]></a>')).toBe('{"a":"a\\nb\\nc"}');
  expect(read('<a x=" 1 ">y</a>')).toBe('{"a":{"#text":"y","@_x":" 1 "}}');
});

it('with numbers and booleans read, text around a value is trimmed and the value is still typed', () => {
  expect(read('<a><n> 12 </n><t>\n true\n</t><s> x </s></a>', true)).toBe('{"a":{"n":12,"t":true,"s":"x"}}');
  expect(read('<a><n>\n  <b>7</b>\n</n></a>', true)).toBe('{"a":{"n":{"b":7}}}');
  expect(read('<a x=" 5 ">y</a>', true)).toBe('{"a":{"#text":"y","@_x":5}}');
});

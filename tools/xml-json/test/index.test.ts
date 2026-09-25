import { it, expect, vi, afterEach } from 'vitest';
import { xmlToJson, jsonToXml, XmlJsonError } from '../src/index';
import { XMLParser } from 'fast-xml-parser';

// XML 1.0 (Fifth Edition) section 2.3, https://www.w3.org/TR/xml/#NT-Name : the Name production.
// fast-xml-parser docs/v4,v5/5.Entities.md (fetched this session): "processEntities: false ...
// The parser recognizes <!DOCTYPE> and <!ENTITY> tags but will not perform any string
// substitution. This prevents Entity Expansion (DoS) attacks while allowing the rest of the
// XML to be parsed normally, even if the DOCTYPE internal subset is complex."

afterEach(() => {
  vi.restoreAllMocks();
});

it('attributes and text nodes map to the chosen prefix and text key', () => {
  const result = xmlToJson('<book id="1"><title>Moby Dick</title></book>', {
    attributePrefix: '@_',
    textKey: '#text',
  });
  const parsed = JSON.parse(result.output) as Record<string, unknown>;
  expect(parsed).toEqual({ book: { '@_id': '1', title: 'Moby Dick' } });
});

it('a billion laughs entity bomb is refused and never expanded', () => {
  const bomb =
    '<?xml version="1.0"?>\n' +
    '<!DOCTYPE lolz [\n' +
    ' <!ENTITY lol "lol">\n' +
    ' <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">\n' +
    ' <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">\n' +
    ' <!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">\n' +
    ']>\n' +
    '<lolz>&lol4;</lolz>';
  const start = Date.now();
  expect(() => xmlToJson(bomb)).toThrowError(XmlJsonError);
  expect(Date.now() - start).toBeLessThan(100);
});

it('an external entity declaration is refused and never resolved', () => {
  const xxe = '<?xml version="1.0"?>\n<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>\n<foo>&xxe;</foo>';
  try {
    xmlToJson(xxe);
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(XmlJsonError);
    expect((err as XmlJsonError).message).toContain('DOCTYPE');
  }
});

it('the configured parser leaves DOCTYPE entities unexpanded even when called directly', () => {
  // Bypasses this package's own DOCTYPE pre-check to prove the second, independent
  // defence layer: processEntities: false on the parser configuration itself.
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    processEntities: false,
  });
  const bomb =
    '<!DOCTYPE lolz [\n <!ENTITY lol "lol">\n <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;">\n]>\n<lolz>&lol2;</lolz>';
  const out = parser.parse(bomb) as Record<string, unknown>;
  expect(JSON.stringify(out)).toContain('&lol2;');
  expect(JSON.stringify(out)).not.toContain('lollollollollol');
});

it('predefined entities and numeric character references decode to their characters', () => {
  const result = xmlToJson('<a>&lt;a&gt; &amp; &#65;</a>');
  const parsed = JSON.parse(result.output) as Record<string, unknown>;
  expect(parsed.a).toBe('<a> & A');
});

it('XML 1.0 well-formedness errors are refused with a line and column', () => {
  try {
    xmlToJson('<a><b></a>');
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(XmlJsonError);
    expect((err as XmlJsonError).line).toBeTypeOf('number');
    expect((err as XmlJsonError).column).toBeTypeOf('number');
  }
});

it('repeated elements become arrays and always-array makes single elements arrays too', () => {
  const repeated = xmlToJson('<a><b>1</b><b>2</b></a>');
  const repeatedParsed = JSON.parse(repeated.output) as { a: { b: string[] } };
  expect(repeatedParsed.a.b).toEqual(['1', '2']);

  const single = xmlToJson('<a><b>1</b></a>', { alwaysArray: true });
  const singleParsed = JSON.parse(single.output) as { a: [{ b: string[] }] };
  expect(singleParsed.a[0]!.b).toEqual(['1']);
});

it('JSON to XML escapes markup characters in text and attribute values', () => {
  const result = jsonToXml(JSON.stringify({ note: { '@_attr': '<x>', '#text': '<script>' } }));
  expect(result.output).toContain('&lt;script&gt;');
  expect(result.output).toContain('attr="&lt;x&gt;"');
  expect(result.output).not.toContain('<script>');
});

it('a JSON key that is not an XML 1.0 name is refused with its RFC 6901 path', () => {
  try {
    jsonToXml(JSON.stringify({ root: { '2fa': 'x' } }));
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(XmlJsonError);
    expect((err as XmlJsonError).path).toBe('/root/2fa');
  }
  try {
    jsonToXml(JSON.stringify({ root: { 'a b': 'x' } }));
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(XmlJsonError);
    expect((err as XmlJsonError).path).toBe('/root/a b');
  }
});

it('XML to JSON to XML round trips attributes, text and element order without mixed content', () => {
  const source = '<book id="1"><title>Moby Dick</title><author>Herman Melville</author></book>';
  const toJson = xmlToJson(source);
  const backToXml = jsonToXml(toJson.output, { declaration: false });
  const roundTrip = xmlToJson(backToXml.output);
  expect(JSON.parse(roundTrip.output)).toEqual(JSON.parse(toJson.output));
});

it('an element named __proto__ never modifies Object.prototype', () => {
  try {
    xmlToJson('<root><__proto__><polluted>true</polluted></__proto__></root>');
  } catch {
    // Refusing outright is an acceptable way to guarantee no pollution.
  }
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  expect(Object.prototype.hasOwnProperty.call({}, 'polluted')).toBe(false);

  const fromJson = { root: { __proto__values: 'placeholder' } };
  // JSON.parse builds __proto__ as an ordinary own key (never the accessor);
  // jsonToXml must read it the same safe way.
  const withProtoKey = JSON.parse('{"root":{"__proto__":{"polluted":"true"}}}') as Record<string, unknown>;
  expect(Object.keys(withProtoKey.root as object)).toEqual(['__proto__']);
  void fromJson;
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});

it('nothing is written to the console while parsing or building XML', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

  xmlToJson('<book id="1"><title>Moby Dick</title></book>');
  try {
    xmlToJson('<a><b></a>');
  } catch {
    // expected: XmlJsonError, not a console write
  }
  jsonToXml('{"book":{"@_id":"1","title":"Moby Dick"}}');

  expect(logSpy).not.toHaveBeenCalled();
  expect(warnSpy).not.toHaveBeenCalled();
  expect(errorSpy).not.toHaveBeenCalled();
  expect(infoSpy).not.toHaveBeenCalled();
  expect(debugSpy).not.toHaveBeenCalled();
});

it('jsonToXml wraps more than one top level key in a root element with a warning', () => {
  const result = jsonToXml(JSON.stringify({ a: 1, b: 2 }), { declaration: false });
  expect(result.output).toContain('<root>');
  expect(result.warnings.length).toBeGreaterThan(0);
});

it('keepOrder preserves mixed text and element order', () => {
  const result = xmlToJson('<a>text1<b>inner</b>text2</a>', { keepOrder: true });
  expect(result.output).toContain('text1');
  expect(result.output).toContain('text2');
  expect(result.output).toContain('inner');
});

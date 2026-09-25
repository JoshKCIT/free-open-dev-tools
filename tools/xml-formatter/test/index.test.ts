import { it, expect, vi } from 'vitest';
import { formatXml, XmlFormatterError } from '../src/index';

// XML 1.0 (Fifth Edition), https://www.w3.org/TR/xml/
// Section 3.1 (Start-Tags, End-Tags, and Empty-Element Tags):
//   "The Name in an element's end-tag MUST match the element type in the start-tag." (WFC: Element Type Match)
// Section 4.1 (Character and Entity References):
//   "the Name given in the entity reference MUST match that in an entity declaration" (WFC: Entity Declared)
//   -- with no DOCTYPE, only the five predefined entities (section 4.6) and numeric character
//   references are ever "declared".
// Section 2.10 (White Space Handling):
//   "the attribute is named xml:space ... the value 'default' ... the value 'preserve' indicates
//   that applications' default white-space processing modes are inhibited"
// Section 2.8 (Prolog and Document Type Declaration) defines the document type declaration this
// tool refuses to read.

it('XML 1.0 well-formedness errors are reported with line and column', () => {
  expect(() => formatXml('<a></b>')).toThrowError(XmlFormatterError);
  try {
    formatXml('<a></b>');
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(XmlFormatterError);
    const e = err as XmlFormatterError;
    expect(e.line).toBe(1);
    expect(typeof e.column).toBe('number');
  }
});

it('any DOCTYPE is refused before parsing so external entities are never resolved and entity bombs never expand', () => {
  const externalEntity = '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>';
  expect(() => formatXml(externalEntity)).toThrowError(XmlFormatterError);
  try {
    formatXml(externalEntity);
  } catch (err) {
    expect((err as XmlFormatterError).line).toBe(1);
  }

  const billionLaughs =
    '<!DOCTYPE lolz [' +
    '<!ENTITY lol "lol">' +
    '<!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">' +
    '<!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">' +
    ']>' +
    '<lolz>&lol2;</lolz>';
  expect(() => formatXml(billionLaughs)).toThrowError(XmlFormatterError);

  // Case-insensitive, and not only at the very start of the document.
  expect(() => formatXml('<?xml version="1.0"?>\n<!doctype a>\n<a/>')).toThrowError(XmlFormatterError);
});

it('an undeclared entity reference is refused with its position', () => {
  expect(() => formatXml('<a>&nbsp;</a>')).toThrowError(XmlFormatterError);
  try {
    formatXml('<a>&nbsp;</a>');
    expect.unreachable();
  } catch (err) {
    const e = err as XmlFormatterError;
    expect(e.line).toBe(1);
    expect(typeof e.column).toBe('number');
  }

  // The five predefined entities and numeric character references are fine.
  expect(() => formatXml('<a>&amp;&lt;&gt;&apos;&quot;&#65;&#x41;</a>')).not.toThrow();

  // An undeclared entity inside an attribute value is refused too.
  expect(() => formatXml('<a x="&bad;"/>')).toThrowError(XmlFormatterError);
});

it('formatting changes only whitespace between markup and never the text, attributes or CDATA', () => {
  const corpus = [
    "<a><b>1</b><c x='2'/></a>",
    '<root xmlns="urn:x"><child a="1" b=\'2\'>text</child></root>',
    '<a><!-- a comment --><b/></a>',
    '<a><![CDATA[<not><parsed/></not>]]></a>',
    '<a>  <b/>  <c/>  </a>',
    '<a\n  x="1"\n  y="2"\n/>',
  ];
  for (const doc of corpus) {
    const formatted = formatXml(doc, { mode: 'format' }).output;
    const minifiedOriginal = formatXml(doc, { mode: 'minify' }).output;
    const minifiedFormatted = formatXml(formatted, { mode: 'minify' }).output;
    expect(minifiedFormatted).toBe(minifiedOriginal);
    // The formatted output is itself well-formed and round-trips.
    expect(() => formatXml(formatted, { mode: 'check' })).not.toThrow();
  }

  // 200 seeded random documents, deterministic across runs.
  // mulberry32: a small, fast, deterministic 32-bit PRNG (public-domain algorithm), same
  // register this project already uses elsewhere for reproducible seeded generators.
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const rand = mulberry32(20260925);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]!;

  const NAMES = ['a', 'b', 'c', 'child', 'item'];
  const WS = ['', ' ', '  ', '\n', '\n  ', '\t'];

  function genElement(depth: number): string {
    const name = pick(NAMES);
    let attrs = '';
    const attrCount = Math.floor(rand() * 3);
    for (let i = 0; i < attrCount; i++) {
      const quote = rand() < 0.5 ? '"' : "'";
      attrs += ` attr${i}=${quote}v${Math.floor(rand() * 100)}${quote}`;
    }
    const preserve = rand() < 0.1;
    if (preserve) attrs += ' xml:space="preserve"';

    if (depth <= 0 || rand() < 0.2) {
      return rand() < 0.5 ? `<${name}${attrs}/>` : `<${name}${attrs}></${name}>`;
    }

    const kind = rand();
    if (kind < 0.5) {
      // element-only content, with random whitespace runs between children
      const childCount = 1 + Math.floor(rand() * 3);
      let inner = '';
      for (let i = 0; i < childCount; i++) {
        inner += pick(WS) + genElement(depth - 1);
      }
      inner += pick(WS);
      return `<${name}${attrs}>${inner}</${name}>`;
    }
    if (kind < 0.8 || preserve) {
      // mixed content: text interleaved with elements
      return `<${name}${attrs}>text ${genElement(depth - 1)} more text</${name}>`;
    }
    // text-only content
    return `<${name}${attrs}>just text ${Math.floor(rand() * 1000)}</${name}>`;
  }

  for (let i = 0; i < 200; i++) {
    const doc = genElement(3);
    const formatted = formatXml(doc, { mode: 'format' }).output;
    const minifiedOriginal = formatXml(doc, { mode: 'minify' }).output;
    const minifiedFormatted = formatXml(formatted, { mode: 'minify' }).output;
    expect(minifiedFormatted).toBe(minifiedOriginal);
  }
});

it('xml:space preserve and mixed content keep their whitespace exactly', () => {
  const preserveDoc = '<a xml:space="preserve">  x  </a>';
  expect(formatXml(preserveDoc, { mode: 'format' }).output).toBe(preserveDoc);
  expect(formatXml(preserveDoc, { mode: 'minify' }).output).toBe(preserveDoc);
  expect(formatXml(preserveDoc, { mode: 'check' }).output).toBe(preserveDoc);

  const mixedDoc = '<p>Hello <b>big</b> world</p>';
  expect(formatXml(mixedDoc, { mode: 'format' }).output).toBe(mixedDoc);
  expect(formatXml(mixedDoc, { mode: 'minify' }).output).toBe(mixedDoc);

  // xml:space="preserve" is inherited by descendants that do not override it.
  const inherited = '<a xml:space="preserve"><b>  y  </b></a>';
  const formatted = formatXml(inherited, { mode: 'format' }).output;
  expect(formatted).toContain('  y  ');

  // A descendant can set xml:space="default" to turn preservation back off for itself.
  const overridden = '<a xml:space="preserve"><b xml:space="default"><c/> <d/></b></a>';
  expect(() => formatXml(overridden, { mode: 'format' })).not.toThrow();
});

it('minify removes whitespace between elements and comments when asked, and nothing else', () => {
  const doc = '<a>\n  <b/>\n  <!-- keep me --> \n  <c x="1"/>\n</a>';
  const kept = formatXml(doc, { mode: 'minify', removeComments: false }).output;
  expect(kept).toBe('<a><b/><!-- keep me --><c x="1"/></a>');

  const stripped = formatXml(doc, { mode: 'minify', removeComments: true }).output;
  expect(stripped).toBe('<a><b/><c x="1"/></a>');

  // Attribute values are never touched by minify.
  const attrs = '<a x=" spaced value " y=\'  another  \'/>';
  expect(formatXml(attrs, { mode: 'minify' }).output).toBe(attrs);
});

it('nothing is written to the console while validating or formatting', () => {
  const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => undefined),
  );
  try {
    formatXml('<a><b>1</b><c x="2"/></a>', { mode: 'format' });
    formatXml('<a>  x  </a>', { mode: 'minify' });
    try {
      formatXml('<a></b>');
    } catch {
      // expected
    }
    try {
      formatXml('<!DOCTYPE a><a/>');
    } catch {
      // expected
    }
    try {
      formatXml('<a>&nbsp;</a>');
    } catch {
      // expected
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

it('formats an element-only document with indentation, keeping text-only and attribute-bearing children on one line', () => {
  const doc = "<a><b>1</b><c x='2'/></a>";
  const result = formatXml(doc, { mode: 'format', indent: 2 });
  expect(result.output).toBe("<a>\n  <b>1</b>\n  <c x='2'/>\n</a>");
  expect(result.elements).toBe(3);
  expect(result.attributes).toBe(1);
  expect(result.maxDepth).toBe(2);
});

it('check mode returns the input unchanged with its counts', () => {
  const doc = '<a><b/><b/></a>';
  const result = formatXml(doc, { mode: 'check' });
  expect(result.output).toBe(doc);
  expect(result.elements).toBe(3);
  expect(result.maxDepth).toBe(2);
});

import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import * as libxml2 from 'libxml2-wasm';
import {
  c14nWithEngine,
  canonicalizeXml,
  checkC14nInput,
  compareXml,
  MAX_C14N_BYTES,
  meta as toolMeta,
  XmlFormatterError,
} from '../src/index';
import { DOCTYPE_REFUSAL_MESSAGE } from '../src/xml-doctype';
import {
  C14N_31_COMMENTED,
  C14N_31_INPUT,
  C14N_31_PLAIN,
  C14N_32_INPUT,
  C14N_32_OUTPUT,
  C14N_33_INPUT,
  C14N_34_INPUT,
  C14N_34_OUTPUT,
  C14N_35_INPUT,
  C14N_36_INPUT,
  C14N_36_PRINTED,
  EXC_EXCLUSIVE_RESULT,
  EXC_INCLUSIVE_RESULT,
  EXC_INPUT,
} from './fixtures/w3c-c14n/golden';

const here = dirname(fileURLToPath(import.meta.url));

// Canonical XML Version 1.0, W3C Recommendation 15 March 2001, https://www.w3.org/TR/2001/REC-xml-c14n-20010315
// Section 2.3 (start tags: attributes in lexicographic order, values in double quotes) and section 3.3 (an empty
// element becomes a start and end tag pair).
it('Canonical XML sorts attributes, uses double quotes and writes empty elements as start and end tags', () => {
  const input = `<doc  b='2'   a="1"   >\n  <e   />\n  <f x = 'one'   w="two"   ></f>\n</doc>`;
  const expected = `<doc a="1" b="2">\n  <e></e>\n  <f w="two" x="one"></f>\n</doc>`;
  expect(canonicalizeXml(libxml2, input, { mode: '1.0', withComments: false })).toBe(expected);
});

// Section 3.2 (Whitespace in Document Content): "In this example, the input document and canonical form are
// identical." Every space and line break inside the document element is kept.
it('Canonical XML 1.0 section 3.2 whitespace in document content gives the printed output', () => {
  const printed = [
    '<doc>',
    '   <clean>   </clean>',
    '   <dirty>   A   B   </dirty>',
    '   <mixed>',
    '      A',
    '      <clean>   </clean>',
    '      B',
    '      <dirty>   A   B   </dirty>',
    '      C',
    '   </mixed>',
    '</doc>',
  ].join('\n');
  expect(canonicalizeXml(libxml2, printed, { mode: '1.0', withComments: false })).toBe(printed);
});

it('meta keeps fast-xml-parser, pins libxml2-wasm and declares the libxml2 notice', () => {
  expect(toolMeta.dependencies).toMatchObject({ 'fast-xml-parser': '5.11.1', 'libxml2-wasm': '0.7.2' });
  const bundled = (toolMeta as { bundledData?: { name: string; noticeFile: string }[] }).bundledData ?? [];
  const notice = bundled.find((entry) => entry.name === 'libxml2');
  expect(notice).toBeDefined();
  const file = join(here, '..', notice?.noticeFile ?? 'missing');
  expect(existsSync(file)).toBe(true);
  expect(readFileSync(file, 'utf8')).toContain('libxml2');
  // The notice is the licence file the installed package ships.
  const packageNotice = join(here, '..', 'node_modules', 'libxml2-wasm', 'LICENSE.libxml2');
  expect(readFileSync(file, 'utf8')).toBe(readFileSync(packageNotice, 'utf8'));
});

// The W3C examples that carry a DOCTYPE (3.1, 3.3, 3.4, 3.5) go through the inner function the public path wraps
// after its DOCTYPE refusal, because the page refuses every DOCTYPE; the others go through the public function.
// Each example the recommendation prints is either asserted below or named here with its reason.
const EXPECTED_EXCEPTIONS: Record<string, string> = {
  '3.3': 'its default attribute comes from an ATTLIST in a DOCTYPE, which this tool never reads, so it is never added',
  '3.5': 'its external entity world.txt is never loaded, so the printed Hello, world! cannot be produced',
};
const ASSERTED_EXAMPLES = ['3.1', '3.2', '3.4', '3.6'];

it('W3C Canonical XML 1.0 examples 3.1, 3.2 and 3.4 give their printed output and 3.6 matches as bytes', () => {
  const plain = { mode: '1.0', withComments: false } as const;
  const commented = { mode: '1.0', withComments: true } as const;

  // 3.1: the XML declaration and the DOCTYPE are lost, whitespace outside the document element becomes single line
  // breaks, and comments go only from the uncommented form.
  expect(c14nWithEngine(libxml2, C14N_31_INPUT, plain)).toBe(C14N_31_PLAIN);
  expect(c14nWithEngine(libxml2, C14N_31_INPUT, commented)).toBe(C14N_31_COMMENTED);

  // 3.2: the public path (no DOCTYPE); the printed output is the input.
  expect(canonicalizeXml(libxml2, C14N_32_INPUT, plain)).toBe(C14N_32_OUTPUT);
  expect(C14N_32_OUTPUT).toBe(C14N_32_INPUT);

  // 3.4: character references are replaced, attribute values are normalized and written with double quotes, and a
  // CDATA section becomes escaped text.
  expect(c14nWithEngine(libxml2, C14N_34_INPUT, plain)).toBe(C14N_34_OUTPUT);

  // 3.6: the recommendation prints the two bytes of the copyright sign as the text #xC2#xA9 and its note says the
  // content is the octets C2 and A9, so the output is compared as UTF-8 bytes.
  expect(C14N_36_PRINTED).toBe('<doc>#xC2#xA9</doc>');
  const bytes = new TextEncoder().encode(canonicalizeXml(libxml2, C14N_36_INPUT, plain));
  const encoder = new TextEncoder();
  const expectedBytes = [...encoder.encode('<doc>'), 0xc2, 0xa9, ...encoder.encode('</doc>')];
  expect([...bytes]).toEqual(expectedBytes);

  // Nothing is left out unnamed: the examples in golden.ts are the asserted ones plus the named exceptions.
  expect([...ASSERTED_EXAMPLES, ...Object.keys(EXPECTED_EXCEPTIONS)].sort()).toEqual([
    '3.1',
    '3.2',
    '3.3',
    '3.4',
    '3.5',
    '3.6',
  ]);
  expect(Object.values(EXPECTED_EXCEPTIONS).every((reason) => reason.length > 20)).toBe(true);
  // The two left-out inputs are quoted for the record and still contain their DOCTYPE, which the page refuses.
  expect(C14N_33_INPUT).toContain('<!DOCTYPE');
  expect(C14N_35_INPUT).toContain('<!ENTITY ent2 SYSTEM "world.txt">');
  expect(() => canonicalizeXml(libxml2, C14N_35_INPUT, plain)).toThrow(DOCTYPE_REFUSAL_MESSAGE);
});

// Exclusive XML Canonicalization Version 1.0, W3C Recommendation 18 July 2002,
// https://www.w3.org/TR/2002/REC-xml-exc-c14n-20020718/ . The worked example whose document and printed results the
// tests use is in section 2.2 (General Problems with re-Enveloping); see test/fixtures/w3c-c14n/UPSTREAM.md.
it('Exclusive Canonical XML section 2.1 gives the printed inclusive and exclusive subtree results', () => {
  const elem2 = "//*[local-name()='elem2']";
  // Canonical XML of the subtree carries every namespace of its context (n0 and n3 as well as n1) and the xml:lang.
  expect(c14nWithEngine(libxml2, EXC_INPUT, { mode: '1.0', withComments: false }, elem2)).toBe(EXC_INCLUSIVE_RESULT);
  // Exclusive Canonical XML carries only the namespaces the subtree visibly uses, so n3 sits on n3:stuff.
  expect(c14nWithEngine(libxml2, EXC_INPUT, { mode: 'exclusive', withComments: false }, elem2)).toBe(
    EXC_EXCLUSIVE_RESULT,
  );
});

it('documents differing only in attribute order, quoting and empty-element form are equivalent', () => {
  // The demonstration of the recommendation's own rules: attribute order (2.3), quote style (3.4), empty-element
  // form (3.3) and whitespace inside tags (3.3) are normalized.
  const a = `<a  y="2" x="1"><b/>\n</a>`;
  const b = `<a x='1'   y='2' ><b></b>\n</a>`;
  expect(compareXml(libxml2, a, b, { mode: '1.0' })).toEqual({ equivalent: true });
  expect(compareXml(libxml2, a, b, { mode: 'exclusive' })).toEqual({ equivalent: true });
  expect(compareXml(libxml2, a, b, { mode: '1.1' })).toEqual({ equivalent: true });
  // Comments are left out of a comparison, and character references are spelled the same way.
  expect(compareXml(libxml2, '<a><!-- note -->&#65;&#x42;</a>', '<a>AB</a>', { mode: '1.0' }).equivalent).toBe(true);
  // The same document is equivalent to itself, and two empty-ish documents are too.
  expect(compareXml(libxml2, a, a, { mode: '1.0' }).equivalent).toBe(true);
  expect(compareXml(libxml2, '<r/>', '<r></r>', { mode: '1.0' }).equivalent).toBe(true);
});

it('a real difference reports the first differing offset in both canonical forms', () => {
  const different = compareXml(libxml2, '<a><b>1</b></a>', '<a><b>2</b></a>', { mode: '1.0' });
  expect(different.equivalent).toBe(false);
  expect(different.first).toEqual({ a: '<a><b>1</b></a>', b: '<a><b>2</b></a>', offset: 6 });

  // Whitespace between elements is not normalized (the recommendation keeps all of it), so it is a difference.
  const spaced = compareXml(libxml2, '<a><b/></a>', '<a>\n<b/></a>', { mode: '1.0' });
  expect(spaced.equivalent).toBe(false);
  expect(spaced.first).toEqual({ a: '<a><b></b></a>', b: '<a>\n<b></b></a>', offset: 3 });

  // The namespace prefix is not normalized: the same name in the same namespace under another prefix differs.
  const prefixed = compareXml(libxml2, '<p:a xmlns:p="urn:x"/>', '<q:a xmlns:q="urn:x"/>', { mode: '1.0' });
  expect(prefixed.equivalent).toBe(false);
  expect(prefixed.first?.offset).toBe(1);

  // One form can simply end first.
  const shorter = compareXml(libxml2, '<a>x</a>', '<a>xy</a>', { mode: '1.0' });
  expect(shorter.first).toEqual({ a: '<a>x</a>', b: '<a>xy</a>', offset: 4 });
});

it('a DOCTYPE in either compared document is refused with the existing message', () => {
  const withDoctype = '<!DOCTYPE a [<!ENTITY e "x">]><a>&e;</a>';
  const clean = '<a/>';
  try {
    compareXml(libxml2, withDoctype, clean, { mode: '1.0' });
    expect.unreachable('the first document has a DOCTYPE');
  } catch (err) {
    expect(err).toBeInstanceOf(XmlFormatterError);
    const refused = err as XmlFormatterError;
    expect(refused.message).toBe(DOCTYPE_REFUSAL_MESSAGE);
    expect(refused.part).toBe('first');
    expect({ line: refused.line, column: refused.column }).toEqual({ line: 1, column: 1 });
  }
  try {
    compareXml(libxml2, clean, '<?xml version="1.0"?>\n<!doctype a><a/>', { mode: '1.0' });
    expect.unreachable('the second document has a DOCTYPE');
  } catch (err) {
    expect(err).toBeInstanceOf(XmlFormatterError);
    const refused = err as XmlFormatterError;
    expect(refused.message).toBe(DOCTYPE_REFUSAL_MESSAGE);
    expect(refused.part).toBe('second');
    expect({ line: refused.line, column: refused.column }).toEqual({ line: 2, column: 1 });
  }
  expect(() => canonicalizeXml(libxml2, withDoctype, { mode: '1.0', withComments: false })).toThrow(
    DOCTYPE_REFUSAL_MESSAGE,
  );
});

// Second opinion (U4): Python 3.14.3 with lxml 6.1.1 (libxml2 2.11.9), `etree.tostring(etree.parse(...),
// method='c14n', exclusive=..., with_comments=...)`. lxml binds libxml2 too, so this checks the engine's build of
// libxml2 2.15.1 against another build and another binding; it is not the specification, which the tests above use.
it('Canonical XML agrees with Python lxml on whitespace in tags, namespaces, comments and references', () => {
  const cases: { input: string; expected: Record<string, string> }[] = [
    {
      input: '<doc  b=\'2\'   a="1"   >\n  <e   />\n  <f x = \'one\'   w="two"   ></f>\n</doc>',
      expected: {
        '1.0': '<doc a="1" b="2">\n  <e></e>\n  <f w="two" x="one"></f>\n</doc>',
        exclusive: '<doc a="1" b="2">\n  <e></e>\n  <f w="two" x="one"></f>\n</doc>',
      },
    },
    {
      input: '<a:r xmlns:a="urn:a" xmlns:b="urn:b" xmlns:x="urn:x" x:p="1"><b:c b:q=\'2\' a:q="1"/></a:r>',
      expected: {
        '1.0': '<a:r xmlns:a="urn:a" xmlns:b="urn:b" xmlns:x="urn:x" x:p="1"><b:c a:q="1" b:q="2"></b:c></a:r>',
        exclusive: '<a:r xmlns:a="urn:a" xmlns:x="urn:x" x:p="1"><b:c xmlns:b="urn:b" a:q="1" b:q="2"></b:c></a:r>',
      },
    },
    {
      input: '<?xml version="1.0"?><!-- top --><r>t<!--in--><![CDATA[a<b]]>&amp;&#x41;&gt;"\'</r><!-- after -->',
      expected: {
        '1.0': '<r>ta&lt;b&amp;A&gt;"\'</r>',
        '1.0+comments': '<!-- top -->\n<r>t<!--in-->a&lt;b&amp;A&gt;"\'</r>\n<!-- after -->',
        exclusive: '<r>ta&lt;b&amp;A&gt;"\'</r>',
        'exclusive+comments': '<!-- top -->\n<r>t<!--in-->a&lt;b&amp;A&gt;"\'</r>\n<!-- after -->',
      },
    },
  ];
  for (const { input, expected } of cases) {
    for (const [key, canonical] of Object.entries(expected)) {
      const mode = key.startsWith('exclusive') ? 'exclusive' : '1.0';
      expect(canonicalizeXml(libxml2, input, { mode, withComments: key.endsWith('+comments') })).toBe(canonical);
    }
  }
});

it('the encoding an XML declaration names is ignored, because pasted text is already text', () => {
  const input = '<?xml version="1.0" encoding="ISO-8859-1"?><doc>café 中</doc>';
  expect(canonicalizeXml(libxml2, input, { mode: '1.0', withComments: false })).toBe('<doc>café 中</doc>');
});

it('a document that is not well formed is refused with libxml2 words and its position, naming which one', () => {
  expect(() => canonicalizeXml(libxml2, '<a><b></a>', { mode: '1.0', withComments: false })).toThrow(
    /Opening and ending tag mismatch/,
  );
  try {
    compareXml(libxml2, '<a/>', '<a>\n<b></a>', { mode: '1.0' });
    expect.unreachable('the second document is not well formed');
  } catch (err) {
    const refused = err as XmlFormatterError;
    expect(refused).toBeInstanceOf(XmlFormatterError);
    expect(refused.part).toBe('second');
    expect(refused.line).toBe(2);
    expect(refused.message).toMatch(/Opening and ending tag mismatch/);
  }
  // Empty text is refused too, so a caller that skips the page's blank check still gets a plain error and no crash.
  expect(() => canonicalizeXml(libxml2, '', { mode: '1.0', withComments: false })).toThrow(XmlFormatterError);
});

it('nothing a document names is loaded: an external entity to a local address is never requested', async () => {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? '');
    response.end('loaded');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    // The DOCTYPE is refused on the public path, so the inner function is called to prove the parse options hold even
    // if a DOCTYPE ever got through: the entity and the external DTD are named and neither is read.
    const text = `<!DOCTYPE a SYSTEM "http://127.0.0.1:${port}/a.dtd" [<!ENTITY e SYSTEM "http://127.0.0.1:${port}/e.txt">]><a>&e;</a>`;
    let output = '';
    try {
      output = c14nWithEngine(libxml2, text, { mode: '1.0', withComments: false });
    } catch (err) {
      // Either result is acceptable; what matters is that nothing was requested and nothing was loaded.
      expect(err).toBeInstanceOf(XmlFormatterError);
    }
    expect(output).not.toContain('loaded');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(requests).toEqual([]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('a document over 10 MiB is refused before parsing and exactly 10 MiB is accepted', () => {
  // Many small elements, as a real document has, then spaces to the exact size: libxml2 itself refuses one text node
  // of ten million bytes or more (checked below), and that limit is separate from this tool's.
  const wrap = (bytes: number) => {
    const open = '<a>';
    const close = '</a>';
    const unit = '<b>xxxxxxxxxx</b>\n';
    const body = bytes - open.length - close.length;
    const whole = Math.floor(body / unit.length);
    return open + unit.repeat(whole) + ' '.repeat(body - whole * unit.length) + close;
  };
  expect(() => checkC14nInput(wrap(MAX_C14N_BYTES))).not.toThrow();
  const over = wrap(MAX_C14N_BYTES + 1);
  expect(() => canonicalizeXml(libxml2, over, { mode: '1.0', withComments: false })).toThrow(/10 MiB/);
  try {
    compareXml(libxml2, '<a/>', over, { mode: '1.0' });
    expect.unreachable('the second document is over the limit');
  } catch (err) {
    expect((err as XmlFormatterError).part).toBe('second');
  }
  // The limit counts UTF-8 bytes, not characters: three-byte characters reach it at a third of the length.
  const wide = '<a>' + '中'.repeat(Math.ceil(MAX_C14N_BYTES / 3)) + '</a>';
  expect(() => checkC14nInput(wide)).toThrow(/10 MiB/);
  // The largest accepted document is canonicalized, not just checked.
  const accepted = wrap(MAX_C14N_BYTES);
  expect(new TextEncoder().encode(accepted).length).toBe(MAX_C14N_BYTES);
  const canonical = canonicalizeXml(libxml2, accepted, { mode: '1.0', withComments: false });
  // The document is already canonical, so the output is the input, character for character.
  expect(canonical).toBe(accepted);
  // libxml2's own limit on one text node (ten million bytes) still applies and is reported in its words.
  expect(() =>
    canonicalizeXml(libxml2, '<a>' + 'x'.repeat(MAX_C14N_BYTES - 7) + '</a>', { mode: '1.0', withComments: false }),
  ).toThrow(/Text node too long/);
}, 60_000);

// Canonical XML 1.0 section 1.2 (Document Processing Model): a relative URI in a namespace declaration is deprecated
// and the engine refuses it. libxml2 2.15.1 reads a name with a one-letter scheme (x:y) or no scheme as relative and
// then gives only "Failed to canonicalize XML document", so the tool says what it means (run on 2026-10-02 for each
// of u:x, x:y, a:b and x; urn:x, uu:x and http://x/ are accepted).
it('a namespace name libxml2 reads as a relative address is refused with a plain sentence', () => {
  for (const name of ['x:y', 'a:b', 'x']) {
    const input = `<p:a xmlns:p="${name}"/>`;
    expect(() => canonicalizeXml(libxml2, input, { mode: '1.0', withComments: false })).toThrow(
      /namespace name that libxml2 reads as a relative address/,
    );
  }
  for (const name of ['urn:x', 'uu:x', 'http://x/']) {
    expect(canonicalizeXml(libxml2, `<p:a xmlns:p="${name}"/>`, { mode: '1.0', withComments: false })).toBe(
      `<p:a xmlns:p="${name}"></p:a>`,
    );
  }
});

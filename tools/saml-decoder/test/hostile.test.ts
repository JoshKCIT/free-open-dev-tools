// Hostile input is built in test code and never stored as a large file. Expected outcomes are the limits of this package
// (2 MiB of XML, 50,000 tags, 64 levels, 200 attributes, 3 MiB of paste), the rule that a DOCTYPE or an entity declaration is
// never read, and the rule that every scan reads its input a bounded number of times: the shared helper times each function
// at n and 2n and fails a ratio over 6. No absolute time is asserted.
import { deflateRawSync } from 'node:zlib';
import { expect, it } from 'vitest';
import {
  DOCTYPE_REFUSAL_MESSAGE,
  MAX_ATTRIBUTES_PER_ELEMENT,
  MAX_DEPTH,
  MAX_PASTE_CHARACTERS,
  MAX_TAGS,
  MAX_XML_BYTES,
  decodeBase64,
  decodeSaml,
  findDoctype,
  findEntityDeclaration,
  parseDateTime,
  prescan,
  readInput,
} from '../src/index';
import { ENTITY_REFUSAL_MESSAGE } from '../src/xml-entity';
import { HOSTILE, MAX_SCALING_RATIO, scalingRatio } from './scaling';
import {
  NOW_LOGOUT as NOW,
  base64Of,
  pairsOf,
  postForm,
  redirectUrl,
  redirectValue,
  refusal,
  responseXml,
  utf16be,
  utf16le,
} from './helpers';

/** A redirect address whose message is these exact bytes, compressed. */
function redirectOfBytes(bytes: Buffer): string {
  return `https://sp.example.test/acs?SAMLRequest=${encodeURIComponent(deflateRawSync(bytes).toString('base64'))}`;
}

function median(values: number[]): number {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
}

/** The median time of five calls, in milliseconds. */
function timeOf(run: () => void): number {
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  return median(samples);
}

it('a DOCTYPE or an entity declaration is refused before parsing, in UTF-8 and in UTF-16', () => {
  const evil = '<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>';
  const lower = '<!doctype a [<!entity x "y">]><a/>';
  const entityOnly = '<a/><!ENTITY x "y">';
  const inUtf8 = (text: string): string[] => [
    text,
    `<?xml version="1.0"?>\n${text}`,
    `<!-- c -->${text}`,
    postForm(base64Of(text)),
    redirectUrl(text),
    base64Of(text),
    redirectOfBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')])),
  ];
  const inUtf16 = (text: string): string[] => {
    const encoders = [utf16le(text, true), utf16le(text, false), utf16be(text, true), utf16be(text, false)];
    const out: string[] = [];
    for (const bytes of encoders) {
      out.push(bytes.toString('base64'));
      out.push(postForm(bytes.toString('base64')));
      out.push(redirectOfBytes(bytes));
    }
    return out;
  };
  for (const text of [evil, lower]) {
    for (const input of [...inUtf8(text), ...inUtf16(text)]) {
      const refused = refusal(input);
      expect(refused.message, input.slice(0, 60)).toBe(DOCTYPE_REFUSAL_MESSAGE);
      expect(refused.message).not.toContain('ENTITY');
      expect(refused.line).toBeGreaterThanOrEqual(1);
    }
  }
  // A declaration with no DOCTYPE is refused with its own sentence, in both encodings.
  for (const input of [...inUtf8(entityOnly), ...inUtf16(entityOnly)]) {
    const refused = refusal(input);
    expect(refused.message, input.slice(0, 60)).toBe(ENTITY_REFUSAL_MESSAGE);
    expect(refused.message).not.toContain('ENTITY');
  }
  // The same bytes without a DOCTYPE read fine in every encoding, so it is the DOCTYPE that is refused and not the encoding.
  const clean = '<a ID="u1"/>';
  const encodings = [
    ['UTF-8', Buffer.from(clean, 'utf8')],
    ['UTF-16LE', utf16le(clean, true)],
    ['UTF-16LE', utf16le(clean, false)],
    ['UTF-16BE', utf16be(clean, true)],
    ['UTF-16BE', utf16be(clean, false)],
  ] as const;
  for (const [name, bytes] of encodings) {
    const report = decodeSaml(bytes.toString('base64'), { now: NOW });
    expect(report.xml).toBe(clean);
    expect(report.steps.join(' ')).toContain(name);
  }
  // The finders themselves, with their positions.
  expect(findDoctype('<a/>\n  <!DocType x>')).toEqual({ line: 2, column: 3 });
  expect(findEntityDeclaration('<a/>\n<!Entity x "y">')).toEqual({ line: 2, column: 1 });
  expect(findDoctype('<a/>')).toBeNull();
  expect(findEntityDeclaration('<a/>')).toBeNull();
});

it('a deflate bomb is refused at 2 MiB', () => {
  const MiB = 1024 * 1024;
  const message = (bytes: number): string => `<a>${'a'.repeat(bytes - 7)}</a>`;
  // The limit is exact: a message of 2 MiB is read and one byte more is refused, however it arrived.
  const exact = message(MAX_XML_BYTES);
  expect(exact).toHaveLength(MAX_XML_BYTES);
  expect(decodeSaml(redirectUrl(exact), { now: NOW }).xml).toHaveLength(MAX_XML_BYTES);
  const over = `${exact}x`.replace('</a>x', 'x</a>');
  expect(over).toHaveLength(MAX_XML_BYTES + 1);
  for (const input of [redirectUrl(over), postForm(base64Of(over)), base64Of(over), over]) {
    const refused = refusal(input);
    expect(refused.message).toContain('2 MiB');
    expect(refused.part).toBe('message');
  }
  // A bomb: 40 MiB of one letter compresses to about 40 KiB and is refused, with the same sentence.
  const bomb = redirectUrl(message(40 * MiB));
  expect(bomb.length).toBeLessThan(100_000);
  expect(refusal(bomb).message).toContain('2 MiB');
  // Words never promise what was inside, and the sentence is the same for every size of bomb.
  const sizes = [3 * MiB, 40 * MiB].map((n) => refusal(redirectUrl(message(n))).message);
  expect(new Set(sizes).size).toBe(1);

  // The refusal costs what reading 2 MiB costs, not what the bomb claims: a bomb six times bigger is refused in about the
  // same time (a ratio, never a number of milliseconds), and refusing is no slower than reading a clean message of the
  // same inflated size.
  const small = redirectUrl(message(10 * MiB));
  const large = redirectUrl(message(60 * MiB));
  const run = (text: string) => () => {
    try {
      decodeSaml(text, { now: NOW });
    } catch {
      // The refusal is the answer.
    }
  };
  const smallMs = timeOf(run(small));
  const largeMs = timeOf(run(large));
  expect(largeMs / Math.max(smallMs, 0.05)).toBeLessThan(MAX_SCALING_RATIO);
  const clean = redirectUrl(message(MAX_XML_BYTES - 1000));
  const cleanMs = timeOf(run(clean));
  expect(largeMs / Math.max(cleanMs, 0.05)).toBeLessThan(MAX_SCALING_RATIO);
}, 120_000);

it('nesting over 64 levels and more than 50,000 tags are refused before parsing', () => {
  const nested = (n: number): string => '<a>'.repeat(n) + '</a>'.repeat(n);
  // 64 levels are read; the 65th is refused, with its place, and by the pre-scan: the sentence is the pre-scan's own and
  // not the XML reader's.
  expect(decodeSaml(nested(MAX_DEPTH), { now: NOW }).formatted.lines).toBe(MAX_DEPTH * 2 - 1);
  const deep = refusal(nested(MAX_DEPTH + 1));
  expect(deep.message).toContain('nested more than 64 levels');
  expect(deep.message).toMatch(/line 1, column \d+/);
  expect(deep.line).toBe(1);
  // 600,000 levels with no closing tag at all are refused the same way, without the reader ever seeing them, at the 65th tag.
  const huge = refusal('<a>'.repeat(600_000));
  expect(huge.message).toContain('nested more than 64 levels');
  expect(huge.column).toBe(MAX_DEPTH * 3 + 1);
  // 700,000 of them are 2.1 million bytes, over the size limit, so the size is refused first; still before any parsing.
  expect(refusal('<a>'.repeat(700_000)).message).toContain('2 MiB');
  // Tags: a root and 49,999 empty children are 50,000 tags and are read; one more is refused.
  const wide = (children: number): string => `<r>${'<i/>'.repeat(children)}</r>`;
  expect(decodeSaml(wide(MAX_TAGS - 1), { now: NOW }).formatted.lines).toBe(MAX_TAGS + 1);
  const many = refusal(wide(MAX_TAGS));
  expect(many.message).toContain('more than 50,000 tags');
  expect(many.message).toMatch(/line 1, column \d+/);
  expect(refusal(wide(60_000)).message).toContain('more than 50,000 tags');
  // Start tags count as well as empty tags, and closing tags, comments and text do not.
  expect(prescan('<a><b/><c></c></a>')).toEqual({ tags: 3, depth: 2 });
  expect(prescan('<a><!-- <b><b><b> --><![CDATA[<b><b>]]><?x <b> ?>text</a>')).toEqual({ tags: 1, depth: 1 });
  expect(prescan('<a x=">" y=\'>\'/>')).toEqual({ tags: 1, depth: 0 });
  // Attributes: 200 are read on one element, 201 are refused.
  const attrs = (n: number): string => `<a ${Array.from({ length: n }, (_, i) => `k${i}="1"`).join(' ')}/>`;
  expect(decodeSaml(attrs(MAX_ATTRIBUTES_PER_ELEMENT), { now: NOW }).xml).toContain('k199');
  expect(refusal(attrs(MAX_ATTRIBUTES_PER_ELEMENT + 1)).message).toContain('more than 200 attributes');
  // Anything left open is refused with its place and no pasted text.
  for (const [text, kind] of [
    ['<a', 'tag'],
    ['<a><b x="1"', 'tag'],
    ['<a><!-- x', 'comment'],
    ['<a><![CDATA[ x', 'CDATA section'],
    ['<a><?pi x', 'processing instruction'],
    ['<a></a', 'closing tag'],
    ['<a><!x', 'declaration'],
  ] as const) {
    const refused = refusal(text);
    expect(refused.message, text).toContain(`${kind} that starts at line 1`);
    expect(refused.message).toContain('never closed');
  }
});

it('a paste over 3 MiB, invalid text and unusual encodings are refused before the XML is read', () => {
  const tooMuch = refusal('a'.repeat(MAX_PASTE_CHARACTERS + 1));
  expect(tooMuch.message).toContain('3,145,728');
  expect(tooMuch.message).toContain('3 MiB');
  // Exactly at the limit the paste is not refused for its size: it is read, and refused for what it is.
  expect(refusal('a'.repeat(MAX_PASTE_CHARACTERS)).message).not.toContain('3 MiB');
  // Raw XML over 2 MiB, counted in bytes (a three byte character counts three).
  const wide = `<a>${'€'.repeat(Math.floor(MAX_XML_BYTES / 3))}</a>`;
  expect(refusal(wide).message).toContain('2 MiB');
  // Bytes that are not text, and UTF-32.
  expect(refusal(base64Of('<a>') + 'x').part).toBe('message');
  const invalid = Buffer.from([0x3c, 0x61, 0x3e, 0xc3, 0x28, 0x3c, 0x2f, 0x61, 0x3e]);
  expect(refusal(invalid.toString('base64')).message).toContain('not valid UTF-8 or UTF-16');
  expect(refusal(Buffer.from([0x3c, 0, 0, 0, 0x61, 0, 0, 0]).toString('base64')).message).toContain('UTF-32');
  expect(refusal(Buffer.from([0, 0, 0xfe, 0xff, 0, 0, 0, 0x3c]).toString('base64')).message).toContain('UTF-32');
  // An odd number of bytes in UTF-16 and an unpaired surrogate.
  expect(refusal(Buffer.from([0xff, 0xfe, 0x3c]).toString('base64')).message).toContain('not valid UTF-8 or UTF-16');
  expect(refusal(Buffer.from([0xff, 0xfe, 0x00, 0xd8, 0x3c, 0x00]).toString('base64')).message).toContain(
    'not valid UTF-8 or UTF-16',
  );
  // Empty input and input with nothing but white space.
  expect(refusal('').message).toContain('no message');
  expect(refusal(' \n\t ').message).toContain('no message');
  // Base64 that cannot be right, and a message that is not DEFLATE data.
  expect(refusal('QUJDR').message).toContain('no Base64 data can have');
  expect(refusal('QU=JD').message).toContain('equals sign in the middle');
  expect(refusal(Buffer.from('this is not deflate data').toString('base64')).message).toContain('not valid DEFLATE');
  // A truncated stream.
  const full = deflateRawSync(Buffer.from(`<a>${'x'.repeat(5000)}</a>`));
  const cut = full.subarray(0, full.length - 6).toString('base64');
  expect(refusal(`https://sp.example.test/acs?SAMLRequest=${encodeURIComponent(cut)}`).message).toContain(
    'not valid DEFLATE',
  );
});

it('names such as __proto__, constructor and toString are plain names', () => {
  // Parameter names, element names, attribute names, attribute values and IDs that are also object keys are data.
  const url = `https://sp.example.test/acs?__proto__=1&constructor=2&toString=3&hasOwnProperty=4&SAMLRequest=${redirectValue(responseXml())}&RelayState=__proto__`;
  const report = decodeSaml(url, { now: NOW });
  expect(report.transport?.relayState).toBe('__proto__');
  expect(pairsOf(report).get('Message')).toBe('SAML 2.0 Response');
  const odd = decodeSaml(
    '<__proto__ constructor="1" toString="2" ID="valueOf"><constructor/><toString>x</toString></__proto__>',
    {
      now: NOW,
    },
  );
  expect(pairsOf(odd).get('Root element')).toBe('__proto__');
  expect(odd.formatted.text).toContain('<constructor/>');
  const named = (name: string): string =>
    responseXml({
      assertion: `<saml:Assertion ID="${name}" Version="2.0" IssueInstant="2004-12-05T09:22:05Z"><saml:Issuer>i</saml:Issuer><saml:AttributeStatement><saml:Attribute Name="${name}" FriendlyName="${name}"><saml:AttributeValue>${name}</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion>`,
    });
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    const attributed = decodeSaml(named(name), { now: NOW });
    expect(attributed.summary.attributes[0]).toMatchObject({ name, friendlyName: name, value: name });
    expect(pairsOf(attributed).get('Assertion ID')).toBe(name);
  }
  expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
});

it('every parser stays linear on hostile input', () => {
  const decode = (text: string): unknown => decodeSaml(text, { now: NOW });
  const subjects: [string, (input: string) => unknown][] = [
    ['readInput', readInput],
    ['decodeBase64', decodeBase64],
    ['prescan', prescan],
    ['findDoctype', findDoctype],
    ['findEntityDeclaration', findEntityDeclaration],
    ['parseDateTime', parseDateTime],
    ['decodeSaml', decode],
  ];
  const own: ((n: number) => string)[] = [
    (n) => '<'.repeat(n),
    (n) => '<a '.repeat(Math.floor(n / 3)),
    (n) => '<a x="'.repeat(Math.floor(n / 6)),
    (n) => '<!--'.repeat(Math.floor(n / 4)),
    (n) => '<![CDATA['.repeat(Math.floor(n / 9)),
    (n) => '<input '.repeat(Math.floor(n / 7)),
    (n) => '<input name="SAMLResponse" value="'.repeat(Math.floor(n / 34)),
    (n) => '&'.repeat(n),
    (n) => '&#x'.repeat(Math.floor(n / 3)),
    (n) => '%'.repeat(n),
    (n) => '%2'.repeat(Math.floor(n / 2)),
    (n) => '?SAMLRequest='.repeat(Math.floor(n / 13)),
    (n) => 'SAMLRequest=a&'.repeat(Math.floor(n / 14)),
    (n) => 'SAMLRequest=' + '&RelayState=a'.repeat(Math.floor(n / 13)),
    (n) => '=&'.repeat(Math.floor(n / 2)),
    (n) => 'AAAA'.repeat(Math.floor(n / 4)),
    (n) => 'AAAA\n'.repeat(Math.floor(n / 5)),
    (n) => 'A'.repeat(n - 1) + '=',
    (n) => '2004-12-05T09:17:05' + '.'.repeat(n),
    (n) => '2004-12-05T09:17:05.' + '1'.repeat(n) + 'Z',
    (n) => '\n'.repeat(n) + '<!DOCTYPE',
    (n) => '<!DOCTYPE'.repeat(Math.floor(n / 9)),
    (n) => '<!ENTITY'.repeat(Math.floor(n / 8)),
    // Closed comments and processing instructions before the first tag are each skipped once, before a form is read.
    (n) => '<!-- -->'.repeat(Math.floor(n / 8)) + '<input name="SAMLResponse" value="',
    (n) => '<?x?>'.repeat(Math.floor(n / 5)) + '<form><!-- <input -->'.repeat(Math.floor(n / 20)),
    // Every element writes the same value as ID, Id and id, and one Signature points at it: the ID index stays linear.
    (n) =>
      `<r>${'<a ID="x" Id="x" id="x"/>'.repeat(Math.floor(n / 25))}<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignedInfo><ds:Reference URI="#x"/></ds:SignedInfo></ds:Signature></r>`,
  ];
  const failures: string[] = [];
  for (const [name, fn] of subjects) {
    for (const make of [...HOSTILE, ...own]) {
      const ratio = scalingRatio(fn, make, 20_000);
      if (!(ratio <= MAX_SCALING_RATIO))
        failures.push(`${name} on ${JSON.stringify(make(12).slice(0, 12))}: ratio ${ratio.toFixed(1)}`);
    }
  }
  expect(failures).toEqual([]);
}, 300_000);

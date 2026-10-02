import { expect, it } from 'vitest';
import { escapeLiteral, LANGUAGES, StringEscapeError, unescapeLiteral, XML_LANGUAGES } from '../src/index';
import { escapeXml, unescapeXml } from '../src/xml';

// XML 1.0 (Fifth Edition), https://www.w3.org/TR/xml/
// 2.2 Characters, 2.4 Character Data and Markup, 2.11 End-of-Line Handling, 3.3.3 Attribute-Value Normalization and
// 4.6 Predefined Entities. Positions count UTF-16 code units from the start of the input, as every other language of
// this package does.

function refusal(run: () => unknown): StringEscapeError {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(StringEscapeError);
    return err as StringEscapeError;
  }
  throw new Error('expected a refusal');
}

it('XML element content escapes ampersand, less-than and greater-than so the CDATA end sequence never appears', () => {
  // Section 2.4: & and < must be written as references; > is written as one too, so ]]> cannot occur.
  expect(escapeXml('a & b < c > d', { context: 'xml-text' }).value).toBe('a &amp; b &lt; c &gt; d');
  expect(escapeXml(']]>', { context: 'xml-text' }).value).toBe(']]&gt;');
  expect(escapeXml('x]]>y]]>z', { context: 'xml-text' }).value).not.toContain(']]>');
  // Quotes, tabs and line breaks are ordinary content characters and stay as written.
  expect(escapeXml('say "hi"\tit\'s\nok', { context: 'xml-text' }).value).toBe('say "hi"\tit\'s\nok');
  // Already-escaped text is escaped again: the escaper never guesses what is meant.
  expect(escapeXml('&amp; already', { context: 'xml-text' }).value).toBe('&amp;amp; already');
  // The result is the same through the package's two entry points.
  expect(escapeLiteral('a < b', { language: 'xml-text' }).value).toBe('a &lt; b');
});

it('XML attribute values escape the chosen quote and write tab, line feed and carriage return as references', () => {
  // Section 3.3.3: a raw tab, line feed or carriage return in an attribute value is read back as a space, so each is
  // written as a character reference. Section 4.6: the chosen quote is written as &quot; or &apos;.
  const double = { context: 'xml-attribute', wrap: false } as const;
  expect(escapeXml('a\tb\nc\rd', double).value).toBe('a&#9;b&#10;c&#13;d');
  expect(escapeXml('say "hi" it\'s', { ...double, quote: '"' }).value).toBe("say &quot;hi&quot; it's");
  expect(escapeXml('say "hi" it\'s', { ...double, quote: "'" }).value).toBe('say "hi" it&apos;s');
  expect(escapeXml('a & b < c > d', double).value).toBe('a &amp; b &lt; c &gt; d');
  expect(escapeLiteral('x"y', { language: 'xml-attribute', quote: '"' }).value).toBe('"x&quot;y"');
  // The quote chosen on the page reaches the writer: a single-quoted value escapes the apostrophe, not the double quote.
  expect(escapeLiteral('x\'y"z', { language: 'xml-attribute', quote: "'" }).value).toBe("'x&apos;y\"z'");
  expect(escapeLiteral('x\'y"z', { language: 'xml-attribute', quote: "'", wrap: false }).value).toBe('x&apos;y"z');
});

it('characters XML 1.0 does not allow are refused with their position, even as references', () => {
  // Section 2.2 production Char: a control character other than tab, line feed and carriage return, U+FFFE, U+FFFF
  // and an unpaired surrogate are not characters, so no reference can name them either.
  for (const context of ['xml-text', 'xml-attribute'] as const) {
    expect(refusal(() => escapeXml('ab\u0001c', { context })).position).toBe(2);
    expect(refusal(() => escapeXml('a\u0000', { context })).position).toBe(1);
    expect(refusal(() => escapeXml('\u000b', { context })).position).toBe(0);
    expect(refusal(() => escapeXml('x￾', { context })).position).toBe(1);
    expect(refusal(() => escapeXml('xy￿', { context })).position).toBe(2);
    expect(refusal(() => escapeXml('a\ud800b', { context })).position).toBe(1);
    expect(refusal(() => escapeXml('a\udc00', { context })).position).toBe(1);
  }
  // A complete astral character before the problem counts as two units, as it does everywhere else in the package.
  expect(refusal(() => escapeXml('\u{1F600}\u0001', { context: 'xml-text' })).position).toBe(2);
  expect(refusal(() => escapeXml('\u0001', { context: 'xml-text' })).message).toContain('U+0001');
  // The three allowed controls and the characters either side of every excluded range are written.
  expect(escapeXml('\t\n\r', { context: 'xml-text' }).value).toBe('\t\n\r');
  expect(escapeXml('\u007f\u0080\u009f퟿�', { context: 'xml-text' }).value).toBe('\u007f\u0080\u009f퟿�');
  // On the way back in, a reference to a forbidden character, an out-of-range one, and a raw one are all refused.
  for (const reference of ['&#1;', '&#x1;', '&#0;', '&#xFFFE;', '&#xffff;', '&#xD800;', '&#55296;', '&#xDFFF;']) {
    const err = refusal(() => unescapeXml('ab' + reference, { context: 'xml-text' }));
    expect(err.position, reference).toBe(2);
    expect(err.message).toContain('does not allow');
  }
  const outOfRange = refusal(() => unescapeXml('&#x110000;', { context: 'xml-text' }));
  expect(outOfRange.position).toBe(0);
  expect(outOfRange.message).toContain('beyond U+10FFFF');
  expect(refusal(() => unescapeXml('ab\u0001', { context: 'xml-text' })).position).toBe(2);
  expect(refusal(() => unescapeXml('a\ud800', { context: 'xml-text' })).position).toBe(1);
});

it('unescape reads the five predefined entities and numeric references and refuses any other entity with its position', () => {
  // Section 4.6: amp, lt, gt, quot and apos are the only entities that need no declaration; section 4.1: a decimal
  // or hexadecimal character reference names a character by its code point. Python lxml 6.1.1 (libxml2 2.11.9)
  // reads `&amp;&lt;&gt;&quot;&apos;` as `&<>"'` and `&#65;&#x42;&#x1F600;&#9;&#10;&#13;` as `AB`, the emoji, tab,
  // line feed and carriage return, in both element content and an attribute value.
  const text = { context: 'xml-text' } as const;
  expect(unescapeXml('&amp;&lt;&gt;&quot;&apos;', text).value).toBe('&<>"\'');
  expect(unescapeXml('&#65;&#x42;&#x1F600;&#9;&#10;&#13;', text).value).toBe('AB\u{1F600}\t\n\r');
  expect(unescapeXml('&#0065;&#x0042;', text).value).toBe('AB');
  expect(unescapeLiteral('"&amp;&#x41;"', { language: 'xml-attribute', wrap: true }).value).toBe('&A');

  // Any other entity is refused at its ampersand, naming itself: no DTD is read to declare it.
  const nbsp = refusal(() => unescapeXml('ab&nbsp;c', text));
  expect(nbsp.position).toBe(2);
  expect(nbsp.message).toContain('&nbsp;');
  expect(refusal(() => unescapeXml('&AMP;', text)).position).toBe(0);
  expect(refusal(() => unescapeXml('&#X41;', text)).position).toBe(0);
  expect(refusal(() => unescapeXml('&#;', text)).position).toBe(0);
  expect(refusal(() => unescapeXml('&#x;', text)).position).toBe(0);
  expect(refusal(() => unescapeXml('&;', text)).position).toBe(0);
  // A bare ampersand, a raw less-than and, inside a quoted value, the closing quote are refused where they are.
  expect(refusal(() => unescapeXml('a & b', text)).position).toBe(2);
  expect(refusal(() => unescapeXml('abc&', text)).position).toBe(3);
  expect(refusal(() => unescapeXml('ab<c', text)).position).toBe(2);
  const quoted = refusal(() => unescapeXml('"a"b"', { context: 'xml-attribute', wrap: true }));
  expect(quoted.position).toBe(2);
  expect(quoted.message).toContain('&quot;');
  expect(refusal(() => unescapeXml("'a'b'", { context: 'xml-attribute', wrap: true })).message).toContain('&apos;');
  // The positions of a wrapped value count the opening quote.
  expect(refusal(() => unescapeXml('"ab&nbsp;"', { context: 'xml-attribute', wrap: true })).position).toBe(3);

  // Raw whitespace is read the way an XML reader reads it (section 2.11 and 3.3.3; lxml agrees): in content a carriage
  // return or a carriage return and line feed is one line feed, and in an attribute value each is a space.
  expect(unescapeXml('x\r\ny\rz\tw', text).value).toBe('x\ny\nz\tw');
  expect(unescapeXml('x\ny\tz\r\nw\rv', { context: 'xml-attribute', wrap: false }).value).toBe('x y z w v');
  // Written as references they are kept.
  expect(unescapeXml('x&#10;y&#9;z&#13;w', { context: 'xml-attribute', wrap: false }).value).toBe('x\ny\tz\rw');
});

it('a sample from every Unicode plane round-trips and a character beyond the BMP becomes one reference', () => {
  // One character from each of the seventeen planes that XML allows (plane 15 and 16 are private use, still allowed),
  // plus the edges of the Basic Multilingual Plane.
  const samples: string[] = ['A', 'é', '߿', 'ࠀ', '퟿', '', '�'];
  for (let plane = 1; plane <= 16; plane++) samples.push(String.fromCodePoint(plane * 0x10000 + 0x41));
  samples.push(String.fromCodePoint(0x10ffff));
  const text = samples.join('');
  for (const context of ['xml-text', 'xml-attribute'] as const) {
    for (const escapeNonAscii of [false, true]) {
      for (const quote of ['"', "'"] as const) {
        const escaped = escapeLiteral(text, { language: context, quote, escapeNonAscii, wrap: true });
        const back = unescapeLiteral(escaped.value, { language: context, quote, wrap: true });
        expect(back.value, `${context} ${escapeNonAscii} ${quote}`).toBe(text);
      }
    }
  }
  // With every non-ASCII character written as a reference, a character beyond the BMP is exactly one reference of its
  // own code point and never two surrogate references.
  const emoji = escapeXml('\u{1F600}', { context: 'xml-text', escapeNonAscii: true }).value;
  expect(emoji).toBe('&#x1F600;');
  expect(emoji).not.toMatch(/D83D|DE00/i);
  expect(escapeXml('é\u{10FFFF}', { context: 'xml-text', escapeNonAscii: true }).value).toBe('&#xE9;&#x10FFFF;');
  // Without the option the characters stay as written, and an ASCII-only text is never changed by it.
  expect(escapeXml('é\u{1F600}', { context: 'xml-text' }).value).toBe('é\u{1F600}');
  expect(escapeXml('plain', { context: 'xml-text', escapeNonAscii: true }).value).toBe('plain');
  // A reference to a character beyond the BMP reads back as one character, two UTF-16 units.
  expect(unescapeXml('&#128512;', { context: 'xml-text' }).value).toBe('\u{1F600}');
  expect(unescapeXml('&#x1F600;', { context: 'xml-text' }).value.length).toBe(2);
});

it('wrap adds the chosen quote around an attribute value and empty input gives empty output', () => {
  const attribute = { context: 'xml-attribute' } as const;
  expect(escapeXml('v', { ...attribute, wrap: true }).value).toBe('"v"');
  expect(escapeXml('v', { ...attribute, wrap: true, quote: "'" }).value).toBe("'v'");
  // Wrap is on unless it is turned off.
  expect(escapeXml('v', attribute).value).toBe('"v"');
  expect(escapeXml('v', { ...attribute, wrap: false }).value).toBe('v');
  // Element content has no quotes, whatever wrap says.
  expect(escapeXml('v', { context: 'xml-text', wrap: true }).value).toBe('v');
  // Empty input: empty output for both contexts, and an empty attribute value with wrap is the two quotes.
  expect(escapeXml('', { context: 'xml-text' }).value).toBe('');
  expect(escapeXml('', { ...attribute, wrap: false }).value).toBe('');
  expect(escapeXml('', { ...attribute, wrap: true }).value).toBe('""');
  expect(escapeXml('', { ...attribute, wrap: true, quote: "'" }).value).toBe("''");
  expect(unescapeXml('', { context: 'xml-text' }).value).toBe('');
  expect(unescapeXml('', { ...attribute, wrap: false }).value).toBe('');
  expect(unescapeXml('', { ...attribute, wrap: true }).value).toBe('');
  expect(unescapeXml('""', { ...attribute, wrap: true }).value).toBe('');
  expect(unescapeXml("''", { ...attribute, wrap: true }).value).toBe('');
  // A wrapped value must start and end with the same quote, and the refusal says where to look.
  const missing = refusal(() => unescapeXml('abc', { ...attribute, wrap: true }));
  expect(missing.position).toBe(0);
  expect(missing.message).toContain('surrounding quotes');
  expect(refusal(() => unescapeXml('"abc\'', { ...attribute, wrap: true })).position).toBe(0);
  expect(refusal(() => unescapeXml('"', { ...attribute, wrap: true })).position).toBe(0);
  // Unwrapped, an attribute value is read as written.
  expect(unescapeXml('a&quot;b', { ...attribute, wrap: false }).value).toBe('a"b');
  // A raw carriage return in element content is warned about, since a reader turns it into a line feed.
  expect(escapeXml('a\rb', { context: 'xml-text' }).warnings).toEqual([
    { message: expect.stringContaining('carriage return'), position: 1 },
  ]);
  expect(escapeXml('a\rb', attribute).warnings).toEqual([]);
});

// Second opinion (U4): Python 3.14.3 `xml.sax.saxutils.escape(s)` and `quoteattr(s)`, output pasted as literals. Their
// rules agree with the ones here where an attribute value has no double quote, or has both kinds (quoteattr then
// writes &quot;); for a value with only a double quote it switches to single quotes, which is a different choice and
// is not compared.
it('escaped text agrees with Python xml.sax.saxutils escape and quoteattr where their rules agree', () => {
  const escapeCases: [string, string][] = [
    ['a & b < c > d', 'a &amp; b &lt; c &gt; d'],
    [']]>', ']]&gt;'],
    ['plain', 'plain'],
    ['tab\there', 'tab\there'],
    ['line\nbreak', 'line\nbreak'],
    ["'sq'", "'sq'"],
    ['both "d" and \'s\'', 'both "d" and \'s\''],
    ['', ''],
    ['é 中 \u{1F600}', 'é 中 \u{1F600}'],
    ['&amp; already', '&amp;amp; already'],
  ];
  for (const [input, expected] of escapeCases) {
    expect(escapeXml(input, { context: 'xml-text' }).value, JSON.stringify(input)).toBe(expected);
  }
  const quoteattrCases: [string, string][] = [
    ['a & b < c > d', '"a &amp; b &lt; c &gt; d"'],
    [']]>', '"]]&gt;"'],
    ['plain', '"plain"'],
    ['tab\there', '"tab&#9;here"'],
    ['line\nbreak', '"line&#10;break"'],
    ['cr\rhere', '"cr&#13;here"'],
    ["'sq'", '"\'sq\'"'],
    ['both "d" and \'s\'', '"both &quot;d&quot; and \'s\'"'],
    ['', '""'],
    ['é 中 \u{1F600}', '"é 中 \u{1F600}"'],
    ['&amp; already', '"&amp;amp; already"'],
  ];
  for (const [input, expected] of quoteattrCases) {
    expect(escapeXml(input, { context: 'xml-attribute', wrap: true, quote: '"' }).value, JSON.stringify(input)).toBe(
      expected,
    );
  }
});

it('LANGUAGES is unchanged and XML_LANGUAGES lists the two XML contexts', () => {
  expect(LANGUAGES.map((l) => l.id)).toEqual([
    'javascript',
    'java',
    'csharp',
    'python',
    'go',
    'sql',
    'csv',
    'shell',
    'regex',
  ]);
  expect(XML_LANGUAGES).toEqual([
    { id: 'xml-text', label: 'XML element content' },
    { id: 'xml-attribute', label: 'XML attribute value' },
  ]);
  // The two lists never overlap, so a page that shows both lists shows each context once.
  const ids = [...LANGUAGES, ...XML_LANGUAGES].map((l) => l.id);
  expect(new Set(ids).size).toBe(ids.length);
});

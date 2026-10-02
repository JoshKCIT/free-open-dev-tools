import { expect, it } from 'vitest';
import { buildTreeHtml, XmlFormatterError } from '../src/index';
import { DOCTYPE_REFUSAL_MESSAGE } from '../src/xml-doctype';

/**
 * What the tree writes beyond the document's own characters: a fixed set of tags and one style block. Removing them
 * leaves only the document's text, which must hold no markup character at all, because every one is escaped.
 */
function textOnly(html: string): string {
  return html
    .replace(/<style>[^<]*<\/style>/, '')
    .replace(/<details( open)?><summary>/g, '')
    .replace(/<\/summary>/g, '')
    .replace(/<\/details>/g, '')
    .replace(/<div class="(?:t|c|l)">/g, '')
    .replace(/<\/div>/g, '');
}

// XML 1.0 (Fifth Edition), https://www.w3.org/TR/xml/ section 2.4 (character data and markup: the characters &, <
// and > must be written as references) and section 4.6 (the five predefined entities, which are what the tree writes).
// HTML: `details` with `summary` is a disclosure widget that opens and closes without script.
it('the tree escapes text, opens the first two levels and stops at 2000 elements with a note', () => {
  // Every text, attribute value, comment and CDATA section of a hostile document is shown as text.
  const hostile =
    '<a href="&lt;script&gt;alert(1)&lt;/script&gt;" t=\'"q"\'>' +
    '<b>&lt;script&gt;alert(1)&lt;/script&gt; &amp; <![CDATA[<img src=x onerror=alert(1)>]]></b>' +
    "<!-- <i>c</i> --><?pi <u>x</u>?><c d='it&apos;s'/></a>";
  const shown = buildTreeHtml(hostile, { maxElements: 2000, openLevels: 2 });
  expect(shown.truncated).toBe(false);
  expect(shown.elements).toBe(3);
  expect(shown.html).not.toMatch(/<script|<img|<i>|<u>|onerror=alert\(1\)>/);
  expect(shown.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(shown.html).toContain('&lt;!-- &lt;i&gt;c&lt;/i&gt; --&gt;');
  expect(shown.html).toContain('&lt;?pi &lt;u&gt;x&lt;/u&gt;?&gt;');
  // The document's own references are shown as written, so an ampersand is escaped too: a document that says
  // `&amp;lt;` is shown as the five characters `&amp;lt;` and never turns into a `<` in the frame.
  const reference = buildTreeHtml('<a>x &amp;lt; y</a>', { maxElements: 2000, openLevels: 2 });
  expect(reference.html).toContain('<div class="t">x &amp;amp;lt; y</div>');
  // After the fixed tags are taken away no angle bracket is left, so nothing the document held can act as markup.
  expect(textOnly(shown.html)).not.toMatch(/[<>]/);
  // A quote is written as a reference too, so an attribute of the frame can never be closed from the text.
  expect(textOnly(shown.html)).not.toContain('"');
  // Nothing in the tree needs a script or loads anything.
  expect(shown.html).not.toMatch(/<script|<link|<iframe|<img|<a\s/i);

  // The first two levels start open: the root and its children; deeper elements with content start closed.
  const levels = buildTreeHtml('<a><b><c><d>x</d></c></b></a>', { maxElements: 2000, openLevels: 2 });
  expect(levels.html.match(/<details open>/g)).toHaveLength(2);
  expect(levels.html.match(/<details>/g)).toHaveLength(2);
  expect(levels.html).toContain('<details open><summary>&lt;a&gt;</summary><details open><summary>&lt;b&gt;</summary>');
  expect(levels.html).toContain('<details><summary>&lt;c&gt;</summary><details><summary>&lt;d&gt;</summary>');
  // An element with no content is one line, and whitespace between elements is left out.
  const leaf = buildTreeHtml('<a>\n  <b x="1"/>\n  <c></c>\n</a>', { maxElements: 2000, openLevels: 2 });
  expect(leaf.html).toContain('<div class="l">&lt;b x=&quot;1&quot;/&gt;</div>');
  expect(leaf.html).toContain('<div class="l">&lt;c&gt;&lt;/c&gt;</div>');
  expect(leaf.html).not.toContain('<div class="t">');

  // Past the cap the view stops, says so through `truncated`, and still counts the whole document.
  const big = '<r>' + '<i/>'.repeat(2500) + '</r>';
  const capped = buildTreeHtml(big, { maxElements: 2000, openLevels: 2 });
  expect(capped.truncated).toBe(true);
  expect(capped.elements).toBe(2000);
  expect(capped.totalElements).toBe(2501);
  expect(capped.html.match(/<div class="l">&lt;i\/&gt;<\/div>/g)).toHaveLength(1999);
  // Exactly at the cap is not truncated.
  const exact = buildTreeHtml('<r>' + '<i/>'.repeat(1999) + '</r>', { maxElements: 2000, openLevels: 2 });
  expect(exact.truncated).toBe(false);
  expect(exact.elements).toBe(2000);

  // The tree reads the document the way format does, so a DOCTYPE, a broken document and an undeclared entity are
  // refused with the same words and positions.
  expect(() => buildTreeHtml('<!DOCTYPE a><a/>', { maxElements: 2000, openLevels: 2 })).toThrow(
    DOCTYPE_REFUSAL_MESSAGE,
  );
  expect(() => buildTreeHtml('<a><b></a>', { maxElements: 2000, openLevels: 2 })).toThrow(XmlFormatterError);
  expect(() => buildTreeHtml('<a>&nope;</a>', { maxElements: 2000, openLevels: 2 })).toThrow(/predefined entities/);
});

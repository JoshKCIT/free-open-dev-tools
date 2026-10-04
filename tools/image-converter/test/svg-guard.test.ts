import { it, expect } from 'vitest';
import { scanSvg, looksLikeSvg, MAX_USE_ELEMENTS, SvgGuardError } from '../src/svg-guard';

/**
 * Top-level `it(...)` calls only. The hostile list is written here from the
 * stated rules (anything that names another file, address, script or page).
 * The marker inside each payload must never come back in a message.
 */

const MARK = 'FODT-MARKER-7QX';
const BS = String.fromCharCode(92);
const NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';
const OPEN = `<svg ${NS} width="40" height="40">`;
const wrap = (inner: string): string => `${OPEN}${inner}</svg>`;

interface Hostile {
  name: string;
  svg: string;
  /** What the message must call it. */
  construct: string;
  /** The text whose first occurrence starts the refused construct. */
  at: string;
}

const SCRIPT = 'a script element';
const FOREIGN = 'a foreignObject element';
const LOADS = 'a value that loads another file';
const STYLE = 'a style element that loads another file';
const LINK = 'a link to something outside this SVG';

const HOSTILE: Hostile[] = [
  {
    name: 'doctype',
    svg: `<!DOCTYPE svg SYSTEM "http://example.invalid/${MARK}.dtd">${OPEN}</svg>`,
    construct: 'a DOCTYPE declaration',
    at: '<!DOCTYPE',
  },
  {
    name: 'doctype lower case',
    svg: `<!doctype svg>${OPEN}</svg>`,
    construct: 'a DOCTYPE declaration',
    at: '<!doctype',
  },
  { name: 'entity', svg: wrap(`<!ENTITY x "${MARK}">`), construct: 'an ENTITY declaration', at: '<!ENTITY' },
  { name: 'other declaration', svg: wrap(`<!ELEMENT x ANY>`), construct: 'a markup declaration', at: '<!ELEMENT' },
  {
    name: 'xml-stylesheet',
    svg: `<?xml version="1.0"?><?xml-stylesheet href="http://example.invalid/${MARK}.css"?>${OPEN}</svg>`,
    construct: 'an xml-stylesheet instruction',
    at: '<?xml-stylesheet',
  },
  { name: 'other instruction', svg: wrap(`<?php ${MARK} ?>`), construct: 'a processing instruction', at: '<?php' },
  { name: 'script', svg: wrap(`<script>${MARK}</script>`), construct: SCRIPT, at: '<script' },
  { name: 'script upper case', svg: wrap(`<SCRIPT>${MARK}</SCRIPT>`), construct: SCRIPT, at: '<SCRIPT' },
  { name: 'script with a prefix', svg: wrap(`<svg:script>${MARK}</svg:script>`), construct: SCRIPT, at: '<svg:script' },
  {
    name: 'foreignObject',
    svg: wrap(`<foreignObject width="4" height="4"><div>${MARK}</div></foreignObject>`),
    construct: FOREIGN,
    at: '<foreignObject',
  },
  {
    name: 'iframe',
    svg: wrap(`<iframe src="http://example.invalid/${MARK}"/>`),
    construct: 'an iframe element',
    at: '<iframe',
  },
  {
    name: 'embed',
    svg: wrap(`<embed src="http://example.invalid/${MARK}"/>`),
    construct: 'an embed element',
    at: '<embed',
  },
  {
    name: 'object',
    svg: wrap(`<object data="http://example.invalid/${MARK}"/>`),
    construct: 'an object element',
    at: '<object',
  },
  {
    name: 'link element',
    svg: wrap(`<link rel="stylesheet" href="http://example.invalid/${MARK}.css"/>`),
    construct: 'a link element',
    at: '<link',
  },
  {
    name: 'style import',
    svg: wrap(`<style>@import url(http://example.invalid/${MARK}.css);</style>`),
    construct: STYLE,
    at: '<style',
  },
  {
    name: 'style import with a string',
    svg: wrap(`<style>@import "${MARK}.css";</style>`),
    construct: STYLE,
    at: '<style',
  },
  {
    name: 'style url',
    svg: wrap(`<style>rect{fill:url(http://example.invalid/${MARK})}</style>`),
    construct: STYLE,
    at: '<style',
  },
  {
    name: 'style font',
    svg: wrap(`<style>@font-face{font-family:x;src:url(http://example.invalid/${MARK}.woff)}</style>`),
    construct: STYLE,
    at: '<style',
  },
  {
    name: 'style in a CDATA section',
    svg: wrap(`<style><![CDATA[@import "${MARK}";]]></style>`),
    construct: STYLE,
    at: '<style',
  },
  {
    name: 'style split across a CDATA section',
    svg: wrap(`<style>@imp<![CDATA[ort "${MARK}";]]></style>`),
    construct: STYLE,
    at: '<style',
  },
  {
    name: 'style with an escaped letter',
    svg: wrap(`<style>rect{fill:u${BS}72l(http://example.invalid/${MARK})}</style>`),
    construct: STYLE,
    at: '<style',
  },
  {
    name: 'style with an image set',
    svg: wrap(`<style>rect{fill:image-set("${MARK}" 1x)}</style>`),
    construct: STYLE,
    at: '<style',
  },
  {
    name: 'onload',
    svg: wrap(`<rect width="4" height="4" onload="${MARK}"/>`),
    construct: 'an event handler attribute',
    at: 'onload',
  },
  {
    name: 'onclick upper case',
    svg: wrap(`<rect width="4" height="4" ONCLICK="${MARK}"/>`),
    construct: 'an event handler attribute',
    at: 'ONCLICK',
  },
  {
    name: 'image href',
    svg: wrap(`<image href="http://example.invalid/${MARK}.svg" width="4" height="4"/>`),
    construct: LINK,
    at: 'href',
  },
  {
    name: 'image xlink href',
    svg: wrap(`<image xlink:href="http://example.invalid/${MARK}.svg" width="4" height="4"/>`),
    construct: LINK,
    at: 'xlink:href',
  },
  {
    name: 'image href with data',
    svg: wrap(`<image href="data:image/png;base64,${MARK}" width="4" height="4"/>`),
    construct: LINK,
    at: 'href',
  },
  {
    name: 'image href relative',
    svg: wrap(`<image href="${MARK}.png" width="4" height="4"/>`),
    construct: LINK,
    at: 'href',
  },
  {
    name: 'use with another file',
    svg: wrap(`<use href="http://example.invalid/${MARK}.svg#a"/>`),
    construct: LINK,
    at: 'href',
  },
  {
    name: 'anchor',
    svg: wrap(`<a href="http://example.invalid/${MARK}"><rect width="4" height="4"/></a>`),
    construct: LINK,
    at: 'href',
  },
  {
    name: 'anchor with a script address',
    svg: wrap(`<a href="javascript:${MARK}"><rect width="4" height="4"/></a>`),
    construct: LINK,
    at: 'href',
  },
  {
    name: 'feImage',
    svg: wrap(`<filter id="f"><feImage href="http://example.invalid/${MARK}"/></filter>`),
    construct: LINK,
    at: 'href',
  },
  {
    name: 'animated link',
    svg: wrap(`<a id="a" href="#x"><set attributeName="href" to="#x"/></a>`),
    construct: 'an animated link address',
    at: 'attributeName',
  },
  {
    name: 'mask with an address',
    svg: wrap(`<rect width="4" height="4" mask="url(http://example.invalid/${MARK}.svg#m)"/>`),
    construct: LOADS,
    at: 'mask=',
  },
  {
    name: 'paint with a quoted address',
    svg: wrap(`<rect fill="url( 'http://example.invalid/${MARK}' )"/>`),
    construct: LOADS,
    at: 'fill=',
  },
  {
    name: 'paint with a relative address',
    svg: wrap(`<rect fill="url(${MARK}.svg)"/>`),
    construct: LOADS,
    at: 'fill=',
  },
  {
    name: 'paint with upper case',
    svg: wrap(`<rect fill="URL(http://example.invalid/${MARK})"/>`),
    construct: LOADS,
    at: 'fill=',
  },
  {
    name: 'style attribute',
    svg: wrap(`<rect style="fill:url(http://example.invalid/${MARK})"/>`),
    construct: LOADS,
    at: 'style=',
  },
  {
    name: 'style attribute image set',
    svg: wrap(`<rect style="fill:image-set('${MARK}' 1x)"/>`),
    construct: LOADS,
    at: 'style=',
  },
  {
    name: 'character reference hides the word',
    svg: wrap(`<rect fill="u&#114;l(http://example.invalid/${MARK})"/>`),
    construct: LOADS,
    at: 'fill=',
  },
  {
    name: 'hex reference hides the word',
    svg: wrap(`<rect fill="&#x75;rl(http://example.invalid/${MARK})"/>`),
    construct: LOADS,
    at: 'fill=',
  },
  {
    name: 'escape hides the word',
    svg: wrap(`<rect style="fill:u${BS}72l(http://example.invalid/${MARK})"/>`),
    construct: LOADS,
    at: 'style=',
  },
  {
    name: 'unfinished tag',
    svg: `${OPEN}<rect width="4" ${MARK}`,
    construct: 'markup that is not finished',
    at: '<rect',
  },
  { name: 'unfinished comment', svg: wrap(`<!-- ${MARK}`), construct: 'markup that is not finished', at: '<!--' },
  {
    name: 'unquoted value',
    svg: wrap(`<rect width=4 height="4"/>`),
    construct: 'markup this page cannot read',
    at: 'width=4',
  },
];

it('the SVG scan refuses each hostile construction with its name and position and none of its text', () => {
  expect(HOSTILE.length).toBeGreaterThanOrEqual(18);
  for (const h of HOSTILE) {
    let caught: unknown;
    try {
      scanSvg(h.svg);
    } catch (err) {
      caught = err;
    }
    expect(caught, h.name).toBeInstanceOf(SvgGuardError);
    const err = caught as SvgGuardError;
    const expectedAt = h.svg.indexOf(h.at) + 1;
    expect(expectedAt, h.name + ' (test data)').toBeGreaterThan(0);
    expect(err.construct, h.name).toBe(h.construct);
    expect(err.position, h.name).toBe(expectedAt);
    expect(err.message, h.name).toBe(
      `This SVG uses ${h.construct} at character ${expectedAt}, which this page does not load. Remove it and try again.`,
    );
    expect(err.message, h.name).not.toContain(MARK);
    expect(err.message, h.name).not.toContain('example.invalid');
    expect(err.name).toBe('SvgGuardError');
  }
});

it('the SVG scan accepts shapes, gradients, internal references, comments and a plain style element', () => {
  const ok: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>\n<!-- made by hand: <script>x</script> onload="y" -->\n${OPEN}` +
      '<defs>' +
      '<linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient>' +
      '<radialGradient id="r"><stop offset="0" stop-color="white"/></radialGradient>' +
      '<clipPath id="c"><rect width="10" height="10"/></clipPath>' +
      '<filter id="f"><feGaussianBlur stdDeviation="1"/></filter>' +
      '<marker id="m" markerWidth="4" markerHeight="4"><path d="M0 0L4 2L0 4z"/></marker>' +
      '<g id="a"><circle cx="5" cy="5" r="3"/></g>' +
      '</defs>' +
      '<rect width="40" height="40" fill="url(#g)"/>' +
      '<rect width="10" height="10" fill="url( &#39;#r&#39; )" style="stroke:url(#g);fill-opacity:.5"/>' +
      '<rect width="10" height="10" fill=\'url("#g")\' clip-path="url(#c)" filter="url(#f)"/>' +
      '<path d="M0 0L10 10" marker-end="url(#m)"/>' +
      '<use href="#a"/><use xlink:href="#a" x="3"/>' +
      '<a href="#top"><text x="2" y="9">a &amp; b &#169; href onload url(http://not-an-attribute)</text></a>' +
      '<title>Plain</title><desc>script and link and object are only words here</desc>' +
      '<scripted/><style>.a{fill:red}\n.b{stroke:#00f;stroke-width:2}</style>' +
      '<style><![CDATA[ rect > circle { fill: url(#g); } ]]></style>' +
      '<rect\n\tid="s"\n\twidth=\'4\' data-note="a &gt; b &quot;q&quot;"\n/>' +
      '<rect width="1" height="1" />' +
      '</svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
    `<svg:svg xmlns:svg="http://www.w3.org/2000/svg" width="3" height="3"><svg:rect width="3" height="3"/></svg:svg>`,
  ];
  for (const svg of ok) {
    expect(() => scanSvg(svg)).not.toThrow();
  }
});

it('the SVG scan accepts a filter and a few use references, and refuses reuse that holds reuse and more than 1000 use elements', () => {
  expect(MAX_USE_ELEMENTS).toBe(1000);
  const refusal = (svg: string): SvgGuardError => {
    try {
      scanSvg(svg);
    } catch (err) {
      expect(err).toBeInstanceOf(SvgGuardError);
      return err as SvgGuardError;
    }
    throw new Error('the scan accepted it');
  };
  const NESTED = 'a use element that reuses another reuse';

  // A normal SVG with a blur filter, a gradient and a few uses of plain shapes and a symbol is accepted.
  const normal = wrap(
    '<defs><filter id="f"><feGaussianBlur stdDeviation="2"/><feTurbulence baseFrequency="0.05" numOctaves="3"/></filter>' +
      '<rect id="r" width="4" height="4" fill="#f00"/><symbol id="s"><circle r="2"/></symbol>' +
      '<g id="grp"><rect width="2" height="2"/><circle r="1"/></g></defs>' +
      '<use href="#r" x="1" y="1" filter="url(#f)"/><use href="#r" x="9"/><use xlink:href="#s"/><use href="#grp"/>' +
      '<use href="#not-in-this-file"/>',
  );
  expect(() => scanSvg(normal)).not.toThrow();

  // A reuse of an element that itself holds a reuse is refused at the reusing element, wherever the definition is.
  const holder = '<g id="a"><use href="#b"/></g>';
  for (const svg of [
    wrap(`${holder}<use href="#a"/>`),
    wrap(`<use href="#a"/>${holder}`),
    wrap(`<defs><symbol id="a"><g><g><use xlink:href="#b"/></g></g></symbol></defs><use href="#a"/>`),
    // A reuse of a reuse is a chain too, and an element that holds a reuse of itself is the loop of them all.
    wrap('<use id="a" href="#b"/><use href="#a"/>'),
    wrap('<g id="a"><use href="#a"/></g>'),
    // A tag that is never closed still counts.
    `${OPEN}<g id="a"><use href="#b"/><use href="#a"/>`,
  ]) {
    const err = refusal(svg);
    expect(err.construct, svg).toBe(NESTED);
    // The position is that of the reusing element that points at the holder (the last use of the reference).
    expect(svg.slice(err.position - 1, err.position + 4), svg).toBe('<use ');
    expect(err.message, svg).toBe(
      `This SVG has a use element at character ${err.position} that reuses an element holding another use element, which this page does not draw. Reuse plain shapes and groups instead.`,
    );
  }
  // The position of the reusing element, exactly.
  const where = wrap(`${holder}<rect width="1" height="1"/><use href="#a"/>`);
  expect(refusal(where).position).toBe(where.lastIndexOf('<use href="#a"/>') + 1);

  // Two uses of the same plain group, and a holder that nothing reuses, are fine.
  expect(() =>
    scanSvg(wrap('<g id="a"><rect width="1" height="1"/></g><use href="#a"/><use href="#a"/>')),
  ).not.toThrow();
  expect(() => scanSvg(wrap(`${holder}<use href="#other"/>`))).not.toThrow();

  // 1000 use elements are accepted; the 1001st is refused at its own position, whatever they point at.
  const uses = (n: number): string => '<rect id="r" width="1" height="1"/>' + '<use href="#r"/>'.repeat(n);
  expect(() => scanSvg(wrap(uses(1000)))).not.toThrow();
  const many = wrap(uses(1001));
  const tooMany = refusal(many);
  expect(tooMany.construct).toBe('more than 1,000 use elements');
  expect(tooMany.position).toBe(many.lastIndexOf('<use href="#r"/>') + 1);
  expect(tooMany.message).toBe(
    `This SVG has more than 1,000 use elements (the 1,001st is at character ${tooMany.position}), which this page does not draw. Remove some and try again.`,
  );
  // Uses written with a prefix, in any case, and uses that point nowhere still count.
  expect(refusal(wrap('<svg:use/>'.repeat(1001))).construct).toBe('more than 1,000 use elements');
  expect(refusal(wrap('<USE/>'.repeat(1001))).construct).toBe('more than 1,000 use elements');
  // The earlier refusals still come first: a script after 1001 uses is found only if it comes before the count is passed.
  expect(refusal(wrap('<script/>' + uses(1001))).construct).toBe(SCRIPT);
  // Nothing of the file's text is in either message.
  expect(refusal(wrap(`<g id="${MARK}"><use href="#${MARK}"/></g><use href="#${MARK}"/>`)).message).not.toContain(MARK);
});

it('the SVG scan runs in linear time on 1 MiB of hostile markup', () => {
  const MiB = 1024 * 1024;
  const fill = (unit: string): string => unit.repeat(Math.ceil(MiB / unit.length));
  const inputs: { name: string; text: string }[] = [
    { name: 'many elements', text: wrap(fill('<g id="a"/>')) },
    { name: 'many nested opens', text: wrap(fill('<g>')) },
    { name: 'a long style of safe references', text: wrap(`<style>${fill('a{fill:url(#a)}')}</style>`) },
    { name: 'many character references in one value', text: wrap(`<g d="${fill('&#65;')}"/>`) },
    { name: 'many ampersands with no end', text: wrap(`<g d="${fill('&')}"/>`) },
    { name: 'many hash and ampersand pairs with no end', text: wrap(`<style>${fill('&#')}</style>`) },
    { name: 'a long comment', text: wrap(`<!--${fill('-x')}-->`) },
    { name: 'a long CDATA section', text: wrap(`<style><![CDATA[${fill(']a')}]]></style>`) },
    { name: 'many CDATA pieces in one style', text: wrap(`<style>${fill('<![CDATA[a]]>')}</style>`) },
    { name: 'white space before a refusal', text: wrap(`${fill('   \n')}<script/>`) },
    { name: 'many unfinished starts', text: fill('<!--') },
    { name: 'many open angle brackets', text: fill('<<<<') },
    { name: 'many brackets and quotes in values', text: wrap(`<g a='${fill('<>"')}'/>`) },
    { name: 'many parentheses', text: wrap(`<style>${fill('url(#a(')}</style>`) },
    { name: 'many backslashes', text: wrap(`<g d="${fill(BS)}"/>`) },
    { name: 'many words that start like a hostile one', text: wrap(fill('<scrip/>')) },
    { name: 'many nested groups with ids and one reuse', text: wrap(`${fill('<g id="a">')}<use href="#a"/>`) },
    { name: 'many reuses of one id', text: wrap(`<g id="a"/>${fill('<use href="#a"/>')}`) },
    { name: 'many nested groups closed in a row', text: wrap(`${fill('<g id="a">')}${fill('</g>')}`) },
  ];
  for (const { name, text } of inputs) {
    expect(text.length, name).toBeGreaterThanOrEqual(MiB);
    const started = performance.now();
    try {
      scanSvg(text);
    } catch (err) {
      expect(err, name).toBeInstanceOf(SvgGuardError);
    }
    const elapsed = performance.now() - started;
    expect(elapsed, `${name} took ${elapsed} ms`).toBeLessThan(3000);
  }
}, 60_000);

it('an SVG is recognised only from text that starts like an SVG', () => {
  const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
  const yes: Uint8Array[] = [
    enc('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    enc('<svg/>'),
    enc('<svg>'),
    enc('\n\t \r<svg xmlns="http://www.w3.org/2000/svg"/>'),
    Uint8Array.from([0xef, 0xbb, 0xbf, ...enc('  \n<svg width="1"/>')]),
    enc('<?xml version="1.0" encoding="UTF-8"?><svg/>'),
    enc('<?xml version="1.0"?>\n<svg/>'),
    enc('<!-- generator note -->\n<svg/>'),
    enc('<svg><text>café 中文</text></svg>'),
    // A document that declares a type definition still looks like an SVG; the scan then refuses it by name.
    enc('<?xml version="1.0"?><!DOCTYPE svg><svg/>'),
  ];
  for (const bytes of yes) expect(looksLikeSvg(bytes), new TextDecoder().decode(bytes)).toBe(true);

  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
  const no: Uint8Array[] = [
    new Uint8Array(0),
    png,
    enc('plain text, not an image'),
    enc('hello <svg/>'),
    enc('<html><body><svg/></body></html>'),
    enc('<svgx/>'),
    enc('<svg-like/>'),
    enc('<?xmlfoo?><svg/>'),
    enc('<!DOCTYPE svg><svg/>'),
    enc('<!-- unfinished <svg/>'),
    enc('{"svg": "<svg/>"}'),
    // Not valid UTF-8 anywhere in the file.
    Uint8Array.from([...enc('<svg>'), 0xc3, 0x28, ...enc('</svg>')]),
    Uint8Array.from([0xff, 0xfe, 0x3c, 0x00, 0x73, 0x00]),
  ];
  for (const bytes of no) expect(looksLikeSvg(bytes)).toBe(false);
});

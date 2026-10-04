import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import {
  ALLOWED_ELEMENTS,
  MAX_SVG_BYTES,
  MermaidError,
  prescanDiagram,
  scanConstructs,
  scrubSvg,
  svgSize,
  withPixelSize,
} from '../src/index';
import { RECORDED_ATTACK_OUTPUTS, RECORDED_OUTPUTS } from './fixtures/recorded-outputs';

let consoleSpies: MockInstance[] = [];

beforeEach(() => {
  consoleSpies = [
    vi.spyOn(console, 'log').mockImplementation(() => undefined),
    vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    vi.spyOn(console, 'error').mockImplementation(() => undefined),
    vi.spyOn(console, 'info').mockImplementation(() => undefined),
    vi.spyOn(console, 'debug').mockImplementation(() => undefined),
  ];
});

afterEach(() => {
  for (const spy of consoleSpies) {
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }
});

const SVG_NS = 'http://www.w3.org/2000/svg';
const BS = String.fromCharCode(92);

/** An SVG document around the given inner markup. */
const wrap = (inner: string): string => `<svg xmlns="${SVG_NS}">${inner}</svg>`;

/** The sentence the scrub gives when it refuses something, for a construct name. */
const refusal = (construct: string): string =>
  `The rendered diagram contained something this page does not allow (${construct}), so it was not shown.`;

/** The error the scrub throws for a document, failing the test when it accepts it. */
function refusalOf(svg: string): MermaidError {
  try {
    scrubSvg(svg);
  } catch (err) {
    expect(err).toBeInstanceOf(MermaidError);
    return err as MermaidError;
  }
  throw new Error('the scrub was expected to refuse this document');
}

it('the scrub accepts every recorded Mermaid output and keeps its title and description', () => {
  const names = Object.keys(RECORDED_OUTPUTS);
  expect(names).toHaveLength(22);
  const seen = new Set<string>();
  for (const [name, svg] of Object.entries(RECORDED_OUTPUTS)) {
    const result = scrubSvg(svg);
    expect(result.svg, name).toBe(svg);
    // Every drawing states a size, which the PNG needs (a Gantt chart takes its width from the frame it is drawn in).
    const size = svgSize(svg);
    expect(size.width, name).toBeGreaterThan(0);
    expect(size.height, name).toBeGreaterThan(0);
    for (const match of svg.matchAll(/<([A-Za-z][A-Za-z0-9:_.-]*)/g)) seen.add(match[1] ?? '');
  }
  // Every element the 22 drawings use is on the list.
  for (const element of seen) expect(ALLOWED_ELEMENTS.has(element), element).toBe(true);

  const flowchart = scrubSvg(RECORDED_OUTPUTS.flowchart ?? '');
  expect(flowchart.title).toBe('Order flow');
  expect(flowchart.description).toBe('How an order moves from the start to the end');
  expect(flowchart.type).toBe('flowchart');
  const pie = scrubSvg(RECORDED_OUTPUTS.pie ?? '');
  expect(pie.title).toBe('Pet share');
  expect(pie.description).toBe('Dogs and cats compared');
  expect(pie.type).toBe('pie');
  const sequence = scrubSvg(RECORDED_OUTPUTS.sequence ?? '');
  expect(sequence.title).toBeUndefined();
  expect(sequence.description).toBeUndefined();
  expect(sequence.type).toBe('sequence');

  // Titles are read as text, cleaned for display, and only the root's own children count.
  const override = String.fromCodePoint(0x202e);
  const constructed = scrubSvg(
    wrap(`<title id="t">  A &amp; B&#x41;${override}\n  C</title><desc>D</desc><g><title>nested</title></g>`),
  );
  expect(constructed.title).toBe(`A & BA${BS}u{202E} C`);
  expect(constructed.description).toBe('D');
  expect(scrubSvg(wrap('<g><title>nested</title></g>')).title).toBeUndefined();
  expect(scrubSvg(wrap('<title>   </title>')).title).toBeUndefined();
  expect(scrubSvg(wrap(`<title>${'x'.repeat(500)}</title>`)).title).toHaveLength(300);

  // Plain text that looks like an address is text, not an address, and the allowed constructs pass.
  const accepted = [
    wrap('<text>see https://example.com/a?b=1 and //host/path</text>'),
    wrap('<title>https://example.com/</title>'),
    wrap('<path d="M0 0 L10 10" fill="url(#a)" marker-end="url(' + "'#m'" + ')"/>'),
    wrap('<style>#a .b{fill:url(#g);filter:url( ' + "'#f'" + ' )}@keyframes k{from{opacity:0}}</style>'),
    wrap('<path href="#target"/><path xlink:href="&#35;also"/>'),
    wrap('<g style="fill:#fff;stroke:#000;max-width: 10px"/>'),
    wrap('<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><b>a</b><br/><i>b</i></div></foreignObject>'),
    `<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink"/>`,
    `  ${wrap('')}\n`,
    wrap('<text>&lt;a&gt; &#x1F600; &#8364; &apos;q&quot;</text>'),
  ];
  for (const svg of accepted) expect(() => scrubSvg(svg), svg).not.toThrow();
});

it('the scrub refuses scripts, event attributes, outside links, outside url references, imports and foreign markup', () => {
  const marker = 'MARKER-WORD-7Q2';
  const cases: Array<[string, string, string]> = [
    ['a script element', wrap('<script>x()</script>'), 'a script'],
    ['an empty script element', wrap('<script/>'), 'a script'],
    ['a link element', wrap('<a href="http://example.com/">t</a>'), 'an element outside the allowed list'],
    ['an image element', wrap('<image href="http://127.0.0.1:9/x.png"/>'), 'an element outside the allowed list'],
    ['a use element', wrap('<use href="#a"/>'), 'an element outside the allowed list'],
    ['an iframe', wrap('<iframe src="x"/>'), 'an element outside the allowed list'],
    ['a prefixed element', wrap('<svg:g/>'), 'an element outside the allowed list'],
    ['an element in the wrong case', wrap('<foreignobject/>'), 'an element outside the allowed list'],
    ['a click handler', wrap('<g onclick="x()"/>'), 'an event attribute'],
    ['a load handler in capitals', wrap('<g ONLOAD="x()"/>'), 'an event attribute'],
    ['an error handler in single quotes', wrap("<g onerror='x()'/>"), 'an event attribute'],
    ['an outside href', wrap('<path href="https://example.com/y"/>'), 'a link that leaves the diagram'],
    ['a script href', wrap('<path xlink:href="javascript:alert(1)"/>'), 'a link that leaves the diagram'],
    ['a relative href', wrap('<path href="x.svg#a"/>'), 'a link that leaves the diagram'],
    ['an href that starts with a space', wrap('<path href=" #a"/>'), 'a link that leaves the diagram'],
    ['an address in an attribute', wrap('<g data-x="http://example.com/"/>'), 'an address in an attribute'],
    ['a protocol relative address', wrap('<g data-x="//example.com/x"/>'), 'an address in an attribute'],
    ['an address in capitals', wrap('<g data-x="HTTPS://EXAMPLE.COM"/>'), 'an address in an attribute'],
    ['a data address', wrap('<g data-x="data:text/html,x"/>'), 'an address in an attribute'],
    ['a script scheme hidden by a tab', wrap('<g data-x="jav&#x09;ascript:alert(1)"/>'), 'an address in an attribute'],
    [
      'a script scheme hidden by a line feed',
      wrap('<g data-x="java&#10;script:alert(1)"/>'),
      'an address in an attribute',
    ],
    [
      'a url reference to an address',
      wrap('<path fill="url(http://example.com/a.svg#b)"/>'),
      'an address in an attribute',
    ],
    [
      'a url reference that is not a fragment',
      wrap('<path fill="url(foo.png)"/>'),
      'a style rule that loads something',
    ],
    ['a foreign namespace', wrap('').replace(SVG_NS, 'http://example.com/ns'), 'an address in an attribute'],
    ['a foreign prefixed namespace', wrap('<g xmlns:x="http://example.com/ns"/>'), 'an address in an attribute'],
    ['an import', wrap('<style>@import url(x.css);</style>'), 'a style rule that loads something'],
    ['an import by string', wrap('<style>@import "x.css";</style>'), 'a style rule that loads something'],
    ['an expression', wrap('<style>a{b:expression(x)}</style>'), 'a style rule that loads something'],
    ['a url that is not a fragment', wrap('<style>a{b:url(foo.png)}</style>'), 'a style rule that loads something'],
    [
      'a quoted url address',
      wrap('<style>a{b:url( "https://example.com/a.png" )}</style>'),
      'a style rule that loads something',
    ],
    ['a script scheme in a style', wrap('<style>a{b:javascript:x}</style>'), 'a style rule that loads something'],
    ['an image set', wrap('<style>a{b:image-set("a.png" 1x)}</style>'), 'a style rule that loads something'],
    ['a css escape', wrap(`<style>a{b:${BS}75rl(x)}</style>`), 'a style rule that loads something'],
    [
      'a character reference that spells url',
      wrap('<style>a{b:&#117;rl(x)}</style>'),
      'a style rule that loads something',
    ],
    [
      'a character reference that spells import',
      wrap("<style>@&#105;mport 'x';</style>"),
      'a style rule that loads something',
    ],
    [
      'a style attribute with a url address',
      wrap('<g style="fill:url(http://example.com/a.svg#a)"/>'),
      'a style rule that loads something',
    ],
    [
      'a style attribute with a protocol relative url',
      wrap('<g style="background:url(//example.com/x)"/>'),
      'a style rule that loads something',
    ],
    ['a document type', `<!DOCTYPE svg PUBLIC "x" "y">${wrap('')}`, 'a document type declaration'],
    ['a document type in lower case', `<!doctype svg>${wrap('')}`, 'a document type declaration'],
    ['an entity declaration', wrap('<!ENTITY x "y">'), 'an entity declaration'],
    ['an xml declaration', `<?xml version="1.0"?>${wrap('')}`, 'a processing instruction'],
    ['a stylesheet instruction', `<?xml-stylesheet href="x.css"?>${wrap('')}`, 'a processing instruction'],
    ['a comment', wrap('<!-- c -->'), 'a comment'],
    ['a cdata section', wrap('<style><![CDATA[a{}]]></style>'), 'a CDATA section'],
    ['markup that is not closed', '<svg xmlns="' + SVG_NS + '"><g></svg>', 'markup that is not well formed'],
    ['a closing tag with nothing open', wrap('</g>'), 'markup that is not well formed'],
    ['two roots', `${wrap('')}${wrap('')}`, 'markup that is not well formed'],
    ['text before the root', `x${wrap('')}`, 'markup that is not well formed'],
    ['text after the root', `${wrap('')}x`, 'markup that is not well formed'],
    ['a root that is not svg', '<g/>', 'markup that is not well formed'],
    ['an empty document', '', 'markup that is not well formed'],
    ['an unquoted attribute', '<svg a=b/>', 'markup that is not well formed'],
    ['an unfinished tag', '<svg', 'markup that is not well formed'],
    ['no space between attributes', '<svg a="1"b="2"/>', 'markup that is not well formed'],
    ['an attribute without a value', '<svg a/>', 'markup that is not well formed'],
    ['a less than sign in an attribute', '<svg a="<"/>', 'markup that is not well formed'],
    ['an html entity xml does not define', wrap('<text>a&nbsp;b</text>'), 'markup that is not well formed'],
    ['an unfinished entity', wrap('<text>a &amp b</text>'), 'markup that is not well formed'],
    ['a number that is not a character', wrap('<text>&#0;</text>'), 'markup that is not well formed'],
    ['a closing cdata marker in text', wrap('<text>a]]>b</text>'), 'markup that is not well formed'],
    [
      'a control character in text',
      wrap(`<text>a${String.fromCodePoint(7)}b</text>`),
      'markup that is not well formed',
    ],
    [
      'a control character in an attribute',
      wrap(`<g a="${String.fromCodePoint(1)}"/>`),
      'markup that is not well formed',
    ],
    [
      'half a surrogate pair in text',
      wrap(`<text>a${String.fromCharCode(0xd800)}b</text>`),
      'markup that is not well formed',
    ],
    ['a reference to a control character', wrap('<text>&#7;</text>'), 'markup that is not well formed'],
    ['nesting that is too deep', wrap('<g>'.repeat(300) + '</g>'.repeat(300)), 'nesting that is too deep'],
  ];
  for (const [what, svg, construct] of cases) {
    const err = refusalOf(svg);
    expect(err.message, what).toBe(refusal(construct));
    expect(err.line, what).toBeUndefined();
  }

  // Nothing the markup holds is repeated in a message.
  const echoes = [
    wrap(`<${marker}/>`),
    wrap(`<g ${marker}="1" onclick="${marker}"/>`),
    wrap(`<g data-x="http://${marker}/"/>`),
    wrap(`<path href="${marker}"/>`),
    wrap(`<style>@import ${marker};</style>`),
    wrap(`<g xmlns:${marker}="http://${marker}/"/>`),
    `<?${marker}?>${wrap('')}`,
    `<!DOCTYPE ${marker}>${wrap('')}`,
  ];
  for (const svg of echoes) expect(refusalOf(svg).message, svg).not.toContain(marker);

  // Each of the four hostile outputs recorded without the frame's policy is refused.
  const hostile = Object.entries(RECORDED_ATTACK_OUTPUTS);
  expect(hostile).toHaveLength(4);
  const constructs = new Map<string, string>();
  for (const [name, svg] of hostile) {
    const message = refusalOf(svg).message;
    expect(message, name).toMatch(/this page does not allow/);
    constructs.set(name, message);
  }
  expect(constructs.get('theme-css-with-url')).toBe(refusal('a style rule that loads something'));
  expect(constructs.get('font-family-with-url')).toBe(refusal('a style rule that loads something'));
  expect(constructs.get('link-element-with-outside-address')).toBe(refusal('an element outside the allowed list'));
  expect(constructs.get('image-element-with-outside-address')).toBe(refusal('an element outside the allowed list'));
  for (const [name, svg] of hostile) {
    expect(svg, name).toContain('127.0.0.1:9');
  }

  // A real drawing with one hostile change is refused, so a refusal is not an accident of the test's own markup.
  const drawing = RECORDED_OUTPUTS.flowchart ?? '';
  const mutations: Array<[string, string]> = [
    ['a script after the root tag', drawing.replace('>', '><script>x()</script>')],
    ['a handler on the root', drawing.replace('<svg ', '<svg onclick="x()" ')],
    ['a foreign namespace', drawing.replace(SVG_NS, 'http://example.com/ns')],
    ['an outside link inside', drawing.replace('</svg>', '<a href="http://127.0.0.1:9/">x</a></svg>')],
    ['an import in the style', drawing.replace('<style>', '<style>@import url(http://127.0.0.1:9/x.css);')],
    ['a url that leaves the diagram', drawing.replace('url(#', 'url(http://127.0.0.1:9/a.svg#')],
    ['a drawing cut short', drawing.slice(0, drawing.length - 10)],
  ];
  for (const [what, svg] of mutations) {
    expect(svg, what).not.toBe(drawing);
    expect(() => scrubSvg(svg), what).toThrow(MermaidError);
  }

  // Size limits: exactly 5 MiB of UTF-8 passes, one byte more does not, and bytes are counted rather than characters.
  const head = `<svg xmlns="${SVG_NS}"><text>`;
  const tail = '</text></svg>';
  const filler = MAX_SVG_BYTES - head.length - tail.length;
  expect(() => scrubSvg(head + 'a'.repeat(filler) + tail)).not.toThrow();
  expect(refusalOf(head + 'a'.repeat(filler + 1) + tail).message).toBe(refusal('more than 5 MiB of markup'));
  expect(refusalOf(head + '€'.repeat(Math.ceil(MAX_SVG_BYTES / 3) + 1) + tail).message).toBe(
    refusal('more than 5 MiB of markup'),
  );
  // The deepest nesting that is allowed passes: the root and 255 groups.
  expect(() => scrubSvg(wrap('<g>'.repeat(255) + '</g>'.repeat(255)))).not.toThrow();
});

it('the scrub and the pre-scan run in linear time on 1 MiB of hostile markup', () => {
  const mebibyte = 1024 * 1024;
  const repeatTo = (unit: string): string => unit.repeat(Math.ceil(mebibyte / unit.length));

  const valid = wrap(
    repeatTo('<g data-a="&amp;&amp;&amp; http data" fill="url(#a)" style="a:url(#b)">x &amp; y</g>') +
      `<style>${repeatTo('a{b:url(#c);d:e}')}</style>`,
  );
  const refusedLast = wrap(`${repeatTo('<g data-a="&amp;url(#a)">x &amp; y</g>')}<script/>`);
  const longValue = wrap(`<g data-a="${repeatTo('ahttp:ajavascript:adata:awss:')} https:"/>`);
  const urls = wrap(`<g fill="${repeatTo('url( #a )')}"/>`);
  const longText = wrap(`<text>${repeatTo('&#x41;&lt;')}</text>`);

  const start = performance.now();
  scrubSvg(valid);
  const validMs = performance.now() - start;
  const refusedStart = performance.now();
  let refused = '';
  try {
    scrubSvg(refusedLast);
  } catch (err) {
    refused = (err as Error).message;
  }
  const refusedMs = performance.now() - refusedStart;
  const valueStart = performance.now();
  let valueRefusal = '';
  try {
    scrubSvg(longValue);
  } catch (err) {
    valueRefusal = (err as Error).message;
  }
  const valueMs = performance.now() - valueStart;
  const urlStart = performance.now();
  scrubSvg(urls);
  const urlMs = performance.now() - urlStart;
  const textStart = performance.now();
  scrubSvg(longText);
  const textMs = performance.now() - textStart;

  // The pre-scan: many lines, one very long line of statements, and a text far over the size limit.
  const manyLines = repeatTo('A@{ x: "imgs" } --> B; click\n');
  const oneLine = `flowchart LR\n${repeatTo('a;')}`;
  const overLimit = repeatTo('flowchart LR\n  A@{ img: "x" }\n');
  const scanStart = performance.now();
  let scanError = '';
  try {
    scanConstructs(manyLines);
  } catch (err) {
    scanError = (err as Error).message;
  }
  const scanMs = performance.now() - scanStart;
  const lineStart = performance.now();
  scanConstructs(oneLine);
  const lineMs = performance.now() - lineStart;
  const limitStart = performance.now();
  let limitError = '';
  try {
    prescanDiagram(overLimit);
  } catch (err) {
    limitError = (err as Error).message;
  }
  const limitMs = performance.now() - limitStart;
  const noImageStart = performance.now();
  scanConstructs(repeatTo('A@{ label: "x" } --> B\n'));
  const noImageMs = performance.now() - noImageStart;

  expect(validMs).toBeLessThan(5000);
  expect(refusedMs).toBeLessThan(5000);
  expect(valueMs).toBeLessThan(5000);
  expect(urlMs).toBeLessThan(5000);
  expect(textMs).toBeLessThan(5000);
  expect(scanMs).toBeLessThan(5000);
  expect(lineMs).toBeLessThan(5000);
  expect(limitMs).toBeLessThan(5000);
  expect(noImageMs).toBeLessThan(5000);
  expect(refused).toBe(refusal('a script'));
  expect(valueRefusal).toBe(refusal('an address in an attribute'));
  // The lines name `imgs`, which is not the key `img`, and a `click` with no target is not a click line, so the whole
  // megabyte is read without a refusal.
  expect(scanError).toBe('');
  expect(limitError).toContain('characters. The limit is 20,000');
}, 60_000);

it('a drawing is given a fixed pixel size without losing its viewBox, role or style that is not a size', () => {
  const root = (attributes: string): string => `<svg ${attributes}><g/></svg>`;
  const mermaidLike = root(
    `id="d" width="100%" xmlns="${SVG_NS}" style="max-width: 233px; background-color: white;" viewBox="0 0 233 318" role="graphics-document document"`,
  );
  const sized = withPixelSize(mermaidLike, 466, 636);
  expect(sized).toBe(
    `<svg id="d" xmlns="${SVG_NS}" style="background-color: white" viewBox="0 0 233 318" role="graphics-document document" width="466" height="636"><g/></svg>`,
  );
  expect(() => scrubSvg(sized)).not.toThrow();
  expect(withPixelSize(root(`xmlns="${SVG_NS}" width="120" height="60"`), 240, 120)).toBe(
    `<svg xmlns="${SVG_NS}" viewBox="0 0 120 60" width="240" height="120"><g/></svg>`,
  );
  expect(withPixelSize(root(`xmlns="${SVG_NS}" viewBox="0 0 1 1" a='x"y'`), 2, 2)).toBe(
    `<svg xmlns="${SVG_NS}" viewBox="0 0 1 1" a="x&quot;y" width="2" height="2"><g/></svg>`,
  );
  // The rest of the document is carried over untouched, whatever the drawing holds.
  const drawing = RECORDED_OUTPUTS.flowchart ?? '';
  const result = withPixelSize(drawing, 467, 638);
  expect(result).toContain(' width="467" height="638">');
  expect(result.slice(0, result.indexOf('>'))).not.toContain('max-width');
  expect(result.slice(result.indexOf('>') + 1)).toBe(drawing.slice(drawing.indexOf('>') + 1));
  for (const bad of [0, -1, 1.5, Number.NaN, 100_001]) {
    expect(() => withPixelSize(drawing, bad, 10), String(bad)).toThrow('The diagram size is not valid.');
    expect(() => withPixelSize(drawing, 10, bad), String(bad)).toThrow('The diagram size is not valid.');
  }
  expect(() => withPixelSize('<g/>', 10, 10)).toThrow(MermaidError);
  expect(() => withPixelSize(wrap('<script/>'), 10, 10)).toThrow(MermaidError);
  expect(svgSize(drawing)).toEqual({ width: 233.09375, height: 318.6640625 });
  expect(svgSize(`<svg xmlns="${SVG_NS}" viewBox="0,0,30,20"/>`)).toEqual({ width: 30, height: 20 });
  expect(svgSize(`<svg xmlns="${SVG_NS}" viewBox="0 0 0 20" width="5" height="6"/>`)).toEqual({ width: 5, height: 6 });
});

it('a style element inside a style element is refused as malformed, so no style text goes unchecked', () => {
  const address = 'http://127.0.0.1:9/x.css';
  const cases: Array<[string, string]> = [
    ['an import after the inner element closes', wrap(`<style><style></style>@import url(${address});</style>`)],
    ['an import before the inner element opens', wrap(`<style>@import url(${address});<style></style></style>`)],
    ['an import inside the inner element', wrap(`<style><style>@import url(${address});</style></style>`)],
    ['three levels', wrap(`<style><style><style></style></style>@import url(${address});</style>`)],
    ['an empty inner element', wrap('<style><style></style></style>')],
    ['an inner element with an attribute', wrap('<style><style type="text/css"></style></style>')],
  ];
  for (const [what, svg] of cases) {
    expect(refusalOf(svg).message, what).toBe(refusal('markup that is not well formed'));
  }
  // Style elements one after the other, and a style element that closes itself, are not nested and stay allowed.
  expect(() => scrubSvg(wrap('<style>a{b:c}</style><style>d{e:f}</style>'))).not.toThrow();
  expect(() => scrubSvg(wrap('<style/><style>a{b:c}</style>'))).not.toThrow();
  // A style element inside a group is still checked as before.
  expect(refusalOf(wrap(`<g><style>@import url(${address});</style></g>`)).message).toBe(
    refusal('a style rule that loads something'),
  );
});

it('the style functions src and image are refused with the other loaders, so a style cannot name a file with them', () => {
  const loads = refusal('a style rule that loads something');
  const cases: Array<[string, string]> = [
    ['src in style text', wrap('<style>a{b:src("x.png")}</style>')],
    ['image in style text', wrap('<style>a{b:image("x.png")}</style>')],
    ['image in capitals', wrap('<style>a{b:IMAGE("x.png")}</style>')],
    ['src in a style attribute', wrap('<g style="background:src(\'x.png\')"/>')],
    ['image in a style attribute', wrap('<g style="background:image(\'x.png\')"/>')],
    ['src in a presentation attribute', wrap('<path fill="src(x)"/>')],
  ];
  for (const [what, svg] of cases) expect(refusalOf(svg).message, what).toBe(loads);
  // The words alone, outside a function call, are ordinary text.
  expect(() => scrubSvg(wrap('<text>src and image</text>'))).not.toThrow();
  expect(() => scrubSvg(wrap('<style>a{b:c}</style>'))).not.toThrow();
});

it('an href written with a prefix bound to the xlink namespace under another name is refused as a link', () => {
  const xlink = 'http://www.w3.org/1999/xlink';
  const leaves = refusal('a link that leaves the diagram');
  const cases: Array<[string, string]> = [
    ['a file with a fragment', wrap(`<g xmlns:ns="${xlink}" ns:href="x.svg#a"/>`)],
    ['a fragment of this document', wrap(`<g xmlns:ns="${xlink}" ns:href="#a"/>`)],
    ['declared on an ancestor', wrap(`<g xmlns:ns="${xlink}"><path ns:href="#a"/></g>`)],
    ['declared after other attributes', wrap(`<g id="a" ns:href="#a" xmlns:ns="${xlink}"/>`)],
    ['declared on the root', `<svg xmlns="${SVG_NS}" xmlns:q="${xlink}"><g><path q:href="y"/></g></svg>`],
    ['declared with a character reference', wrap(`<g xmlns:ns="http://www.w3.org/1999/xlin&#107;" ns:href="#a"/>`)],
  ];
  for (const [what, svg] of cases) expect(refusalOf(svg).message, what).toBe(leaves);
  // The usual prefix still works for a fragment, and a prefix bound to some other namespace is not an xlink link.
  expect(() => scrubSvg(wrap(`<g xmlns:xlink="${xlink}"><path xlink:href="#a"/></g>`))).not.toThrow();
  expect(() => scrubSvg(wrap(`<g xmlns:ns="${SVG_NS}" ns:href="#a"/>`))).not.toThrow();
  // A prefix declared in one place does not make an unrelated attribute of the same name elsewhere a link when it is not bound there.
  expect(() => scrubSvg(wrap(`<g xmlns:ns="${SVG_NS}"><path ns:href="#a"/></g>`))).not.toThrow();
});

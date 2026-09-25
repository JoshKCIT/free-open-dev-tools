// This file's own vitest environment, not the folder's shared node default
// (vitest.config.ts is generated and must stay identical across every tool
// folder, so an override belongs on the one file that needs it): the browser
// bundle `src/index.ts` imports feature-detects `XMLHttpRequest` at its own
// module top level, which only a browser-like environment provides.
// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as parse5 from 'parse5';
import { formatHtml } from '../src/index';
import { NEVER_RUN_MARKUP, assertNeverRan } from './never-evaluates';

let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  for (const spy of consoleSpies) spy.mockRestore();
});

/**
 * A canonical form of an HTML fragment via parse5 (the HTML Living
 * Standard's own parsing rules): element names and sorted attributes are
 * kept exactly; text is compared with runs of whitespace collapsed to one
 * space and whitespace-only text between elements ignored, EXCEPT inside
 * `pre`/`textarea`, where text is kept byte for byte (parse5 itself already
 * implements the spec's "ignore one leading LF right after the start tag"
 * rule, so this needs no special case of its own).
 */
function canonical(html: string): string {
  const frag = parse5.parseFragment(html);
  const out: string[] = [];
  function walk(node: parse5.DefaultTreeAdapterMap['childNode'], insidePre: boolean): void {
    if ('value' in node) {
      // A TextNode (or CommentNode, which also has `value`); only text carries content.
      if (node.nodeName !== '#text') return;
      const text = node.value;
      if (insidePre) {
        out.push(`T:${text}`);
        return;
      }
      const collapsed = text.replace(/\s+/g, ' ').trim();
      if (collapsed) out.push(`T:${collapsed}`);
      return;
    }
    if (!('tagName' in node)) return;
    const attrs = node.attrs
      .map((a) => `${a.name}=${a.value}`)
      .sort()
      .join(',');
    out.push(`E:${node.tagName}[${attrs}]`);
    const nextInsidePre = insidePre || node.tagName === 'pre' || node.tagName === 'textarea';
    for (const child of node.childNodes) walk(child, nextInsidePre);
    out.push(`/E:${node.tagName}`);
  }
  for (const child of frag.childNodes) walk(child, false);
  return out.join('|');
}

it('the Prettier HTML whitespace sensitivity documentation example gives the documented css output', async () => {
  // https://prettier.io/blog/2018/11/07/1.15.0.html#whitespace-sensitive-formatting
  const input =
    '<span class="dolorum atque aspernatur">Est molestiae sunt facilis qui rem.</span>\n' +
    '<div class="voluptatem architecto at">Architecto rerum architecto incidunt sint.</div>';
  const result = await formatHtml(input, { mode: 'beautify', whitespace: 'css' });
  expect(result.output).toBe(
    '<span class="dolorum atque aspernatur"\n' +
      '  >Est molestiae sunt facilis qui rem.</span\n' +
      '>\n' +
      '<div class="voluptatem architecto at">\n' +
      '  Architecto rerum architecto incidunt sint.\n' +
      '</div>\n',
  );
});

it('HTML Living Standard parsing of the beautified document gives the same elements, attributes and text', async () => {
  const input =
    '<div class="a b" data-x="1">\n' +
    '<p>Hello <b>world</b>!</p>\n' +
    '<!-- comment -->\n' +
    '<ul>\n<li>One</li>\n<li>Two</li>\n</ul>\n' +
    '</div>';
  const result = await formatHtml(input, { mode: 'beautify' });
  expect(canonical(result.output)).toBe(canonical(input));
});

it('minified HTML parses to the same elements, attributes and text', async () => {
  const input =
    '<div class="a b" data-x="1">\n' +
    '  <p>Hello <b>world</b>!</p>\n' +
    '  <!-- comment -->\n' +
    '  <ul>\n    <li>One</li>\n    <li>Two</li>\n  </ul>\n' +
    '</div>';
  const result = await formatHtml(input, { mode: 'minify' });
  expect(canonical(result.output)).toBe(canonical(input));
  expect(result.outputBytes).toBeLessThan(result.inputBytes);
});

it('pre blocks and inline whitespace keep their meaning in both modes', async () => {
  const input = '<div><pre>line1\n  line2  </pre><span>a</span> <span>b</span></div>';

  const beautified = await formatHtml(input, { mode: 'beautify' });
  expect(canonical(beautified.output)).toBe(canonical(input));

  const minified = await formatHtml(input, { mode: 'minify' });
  expect(canonical(minified.output)).toBe(canonical(input));
  // The single space between the two inline <span> elements is significant
  // (it renders as a visible gap) and must survive minifying literally.
  expect(minified.output).toContain('</span> <span>');
});

it('embedded style is minified by csso and an import inside it is kept as text and never loaded', async () => {
  const input =
    '<html><head><style>@import url(https://example.invalid/a.css);\n.a { color: #ff0000; }</style></head><body></body></html>';
  const result = await formatHtml(input, { mode: 'minify' });
  expect(result.output).toContain('@import url(https://example.invalid/a.css)');
  // csso's own colour-keyword compression proves csso ran, not a no-op passthrough.
  expect(result.output).toContain('.a{color:red}');
});

it('beautifying and minifying HTML never run the pasted code', async () => {
  await assertNeverRan(() => formatHtml(NEVER_RUN_MARKUP, { mode: 'beautify' }));
  await assertNeverRan(() => formatHtml(NEVER_RUN_MARKUP, { mode: 'minify' }));
});

it('nothing is written to the console while formatting or minifying', async () => {
  await formatHtml('<div><p>hi</p></div>', { mode: 'beautify' });
  await formatHtml('<div><p>hi</p></div>', { mode: 'minify' });
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
});

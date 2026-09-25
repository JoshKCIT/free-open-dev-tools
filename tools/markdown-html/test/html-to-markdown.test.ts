import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { htmlToMarkdown } from '../src/html-to-markdown';
import { renderCommonMark } from '../src/index';

let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  for (const spy of consoleSpies) spy.mockRestore();
});

it('HTML converts to Markdown with ATX headings, fenced code and dash bullets', () => {
  const { markdown } = htmlToMarkdown(
    '<h2>Title</h2><p><em>a</em> <strong>b</strong></p>' +
      '<pre><code class="language-js">const x = 1;</code></pre>' +
      '<ul><li>one</li><li>two</li></ul>',
  );
  expect(markdown).toContain('## Title');
  expect(markdown).toContain('_a_ **b**');
  expect(markdown).toContain('```js');
  expect(markdown).toContain('const x = 1;');
  expect(markdown).toMatch(/^-\s+one$/m);
  expect(markdown).toMatch(/^-\s+two$/m);
});

it('GFM tables, strikethrough and task list items convert back to their Markdown forms', () => {
  const table = htmlToMarkdown(
    '<table><thead><tr><th>foo</th><th>bar</th></tr></thead><tbody><tr><td>baz</td><td>bim</td></tr></tbody></table>',
  );
  expect(table.markdown).toContain('| foo | bar |');
  expect(table.markdown).toContain('| --- | --- |');
  expect(table.markdown).toContain('| baz | bim |');

  const strike = htmlToMarkdown('<p><del>x</del></p>');
  expect(strike.markdown).toContain('~~x~~');

  const tasks = htmlToMarkdown(
    '<ul><li><input type="checkbox"> todo</li><li><input type="checkbox" checked> done</li></ul>',
  );
  expect(tasks.markdown).toMatch(/^-\s+\[ \]\s+todo$/m);
  expect(tasks.markdown).toMatch(/^-\s+\[x\]\s+done$/m);
});

it('Markdown to HTML to Markdown to HTML gives the same HTML for the round trip corpus', () => {
  const corpus = [
    '# Heading One',
    '',
    'Some _emphasis_ and **strong** text, and `inline code`.',
    '',
    '- item one',
    '- item two',
    '',
    '> a quote',
    '',
    '```js',
    'const x = 1;',
    '```',
    '',
    '[a link](https://example.com)',
    '',
    '~~strikethrough~~',
    '',
    '- [ ] todo',
    '- [x] done',
    '',
    '| foo | bar |',
    '| --- | --- |',
    '| baz | bim |',
    '',
  ].join('\n');

  const firstHtml = renderCommonMark(corpus);
  const { markdown: roundTripped } = htmlToMarkdown(firstHtml);
  const secondHtml = renderCommonMark(roundTripped);

  expect(normalizeForCompare(secondHtml)).toBe(normalizeForCompare(firstHtml));
});

it('script and style content never reaches the Markdown and dangerous link targets become plain text', () => {
  const { markdown } = htmlToMarkdown(
    '<script>alert(1)</script><style>a{color:red}</style><p>text</p><a href="javascript:alert(1)">y</a>',
  );
  expect(markdown).not.toContain('alert(1)');
  expect(markdown).not.toContain('color:red');
  expect(markdown).toContain('text');
  expect(markdown.toLowerCase()).not.toContain('javascript:');
  expect(markdown).toContain('y');
  expect(markdown).not.toMatch(/\[y\]/);
});

it('tables with merged cells are kept as HTML inside the Markdown', () => {
  const { markdown, warnings } = htmlToMarkdown(
    '<table><tr><th colspan="2">wide</th></tr><tr><td>a</td><td>b</td></tr></table>',
  );
  expect(markdown).toContain('<table');
  expect(markdown).toContain('colspan="2"');
  expect(warnings.some((w) => w.includes('merged cell'))).toBe(true);
});

it('nothing is written to the console while converting HTML', () => {
  htmlToMarkdown('<h1>Hi</h1><table><tr><th colspan="2">x</th></tr></table><a href="ftp://x">y</a>');
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
});

function normalizeForCompare(html: string): string {
  return html.replace(/\s+/g, ' ').trim();
}

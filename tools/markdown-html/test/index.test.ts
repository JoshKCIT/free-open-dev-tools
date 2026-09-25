import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { WindowLike } from 'dompurify';
import { renderCommonMark, markdownToSafeHtml, MarkdownHtmlError } from '../src/index';
import { readSpecExamples, type SpecExample } from './spec-examples';
import { findActiveContent } from './active-content';
import { loadXssVectors, EXPECTED_VECTOR_COUNT } from './xss-vectors';

const HERE = dirname(fileURLToPath(import.meta.url));

function makeWindow(): WindowLike {
  return new JSDOM('', { url: 'https://example.invalid/' }).window as unknown as WindowLike;
}

let win: WindowLike;
let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  win = makeWindow();
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  for (const spy of consoleSpies) spy.mockRestore();
});

// --- Normalisation for spec comparisons ---------------------------------
//
// Ported in spirit (not line for line) from commonmark-spec's own
// test/normalize.py: insignificant output differences (whitespace runs,
// whitespace touching a block-level tag, self-closing tag spelling,
// attribute order and case) are ignored so the conformance tests compare
// meaning, not formatting. Built on a real DOM parse (the caller's own
// jsdom window), never a hand-rolled HTML tokenizer, so entity decoding and
// tag structure come from a real parser rather than being re-derived here.
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function normalizeHtml(html: string, doc: Document): string {
  const container = doc.createElement('div');
  container.innerHTML = html;
  let out = '';
  let preDepth = 0;

  function walk(node: ChildNode): void {
    if (node.nodeType === 3) {
      let text = node.textContent ?? '';
      if (preDepth === 0) text = text.replace(/\s+/g, ' ');
      out += text;
      return;
    }
    if (node.nodeType === 8) {
      out += `<!--${node.textContent ?? ''}-->`;
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === 'pre') preDepth++;
    out += `<${tag}`;
    const attrs = Array.from(el.attributes)
      .map((a) => [a.name.toLowerCase(), a.value] as [string, string])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const [k, v] of attrs) out += ` ${k}="${escapeAttr(v)}"`;
    out += '>';
    if (!VOID_TAGS.has(tag)) {
      for (const child of Array.from(el.childNodes)) walk(child);
      out += `</${tag}>`;
    }
    if (tag === 'pre') preDepth--;
  }

  for (const child of Array.from(container.childNodes)) walk(child);
  // Whitespace touching a block-level tag is insignificant; collapsing
  // whitespace runs between any two tags approximates commonmark-spec's own
  // per-block trimming closely enough for a meaning-not-formatting compare.
  return out.replace(/>\s+</g, '><').trim();
}

// --- CommonMark 0.31.2 conformance ---------------------------------------

const cmSpecText = readFileSync(join(HERE, 'fixtures', 'commonmark-spec', 'spec.txt'), 'utf8');
const cmExamples = readSpecExamples(cmSpecText);

/**
 * Examples where micromark + micromark-extension-gfm's documented output
 * differs from the CommonMark 0.31.2 reference implementation's own
 * expected HTML, after normalising away whitespace-only formatting
 * differences. Each entry names the example number and why, per this
 * project's own rule (a wrapped library's behaviour is proven by test, not
 * assumed): the failing set below is asserted to equal this list exactly,
 * so a NEW divergence -- not just these -- fails the test.
 */
const CM_KNOWN_DIFFERENCES: { example: number; reason: string }[] = [
  {
    example: 172,
    reason:
      "GFM's own tagfilter extension (always on: this tool renders CommonMark+GFM, never bare CommonMark) escapes the closing tag of a raw <style> HTML block for security, which the pure CommonMark reference rendering does not do.",
  },
  {
    example: 500,
    reason:
      "[link](foo\\)\\:) -- micromark's allowDangerousProtocol: false drops the href to empty because the text before the colon does not match its safe-protocol allow-list, even though it is not really a URI scheme at all (a deliberately conservative security default, not a parsing bug).",
  },
  {
    example: 598,
    reason:
      'Angle-bracket autolink with an uncommon scheme (<a+b+c:d>): CommonMark itself allows any scheme matching its ABNF, but allowDangerousProtocol: false restricts links to a fixed safe list, so the href is dropped to empty while the visible text is kept.',
  },
  {
    example: 599,
    reason: 'Same cause as example 598, for <made-up-scheme://foo,bar>.',
  },
  {
    example: 601,
    reason: 'Same cause as example 598, for <localhost:5001/foo>.',
  },
  {
    example: 602,
    reason:
      "GFM's autolink-literal extension (always on) recognises the URL substring inside <https://foo.bar/baz bim>, which is not a valid CommonMark angle-bracket autolink (it contains whitespace); pure CommonMark leaves the whole line as plain text.",
  },
  {
    example: 608,
    reason: 'Same cause as example 602, for < https://foo.bar >.',
  },
  {
    example: 611,
    reason:
      "GFM's autolink-literal extension (always on) turns the bare URL https://example.com into a link; CommonMark's own autolink syntax requires angle brackets, so the pure reference rendering leaves it as plain text.",
  },
  {
    example: 612,
    reason:
      "GFM's extended email autolink extension (always on) turns the bare address foo@bar.example.com into a mailto: link; pure CommonMark leaves it as plain text.",
  },
];

it('CommonMark 0.31.2 spec examples render to the expected HTML', () => {
  expect(cmExamples.length, 'the extractor found no examples at all').toBe(652);

  const doc = win.document as unknown as Document;
  const failing: number[] = [];
  const details: string[] = [];
  for (const example of cmExamples) {
    const actual = normalizeHtml(renderCommonMark(example.markdown), doc);
    const expected = normalizeHtml(example.html, doc);
    if (actual !== expected) {
      failing.push(example.number);
      details.push(`#${example.number} (${example.section}): expected ${expected} got ${actual}`);
    }
  }

  const knownNumbers = CM_KNOWN_DIFFERENCES.map((d) => d.example).sort((a, b) => a - b);
  failing.sort((a, b) => a - b);
  expect(failing, details.join('\n')).toEqual(knownNumbers);
});

// --- GFM 0.29 extension conformance --------------------------------------

const gfmSpecText = readFileSync(join(HERE, 'fixtures', 'gfm-spec', 'spec.txt'), 'utf8');
const gfmExamples = readSpecExamples(gfmSpecText);
const GFM_EXTENSION_TAGS = new Set(['table', 'strikethrough', 'autolink', 'tagfilter']);
const TASK_LIST_SECTION = 'Task list items (extension)';

function isGfmExtensionExample(example: SpecExample): boolean {
  if (example.extension && GFM_EXTENSION_TAGS.has(example.extension)) return true;
  return example.section === TASK_LIST_SECTION;
}

/** Examples in the selected set that upstream itself marks `disabled` (its own test runner skips them too). */
const GFM_DISABLED_EXAMPLES = gfmExamples.filter((e) => isGfmExtensionExample(e) && e.extension === 'disabled');

const GFM_KNOWN_DIFFERENCES: { example: number; reason: string }[] = [
  {
    example: 628,
    reason:
      "micromark-extension-gfm-autolink-literal only recognises www., http:// and https:// URL autolinks plus email autolinks (its own README); it does not extend to an ftp:// scheme the way github.com's own cmark-gfm reference implementation does, so 'ftp://foo.bar.baz' stays plain text here instead of becoming a link.",
  },
];

it('GFM spec table, strikethrough, autolink, task list and tagfilter extension examples render to the expected HTML', () => {
  const selected = gfmExamples.filter(isGfmExtensionExample);
  // 8 table + 2 strikethrough + 11 autolink + 1 tagfilter + 2 disabled task-list examples (UPSTREAM.md).
  expect(selected.length, 'the extractor did not find the expected extension example set').toBe(24);
  expect(GFM_DISABLED_EXAMPLES.length, 'upstream itself disables exactly the two task-list examples').toBe(2);

  const doc = win.document as unknown as Document;
  const failing: number[] = [];
  const details: string[] = [];
  for (const example of selected) {
    if (example.extension === 'disabled') continue; // Skipped by upstream's own rule; counted above.
    const actual = normalizeHtml(renderCommonMark(example.markdown), doc);
    const expected = normalizeHtml(example.html, doc);
    if (actual !== expected) {
      failing.push(example.number);
      details.push(`#${example.number} (${example.section}): expected ${expected} got ${actual}`);
    }
  }

  const knownNumbers = GFM_KNOWN_DIFFERENCES.map((d) => d.example).sort((a, b) => a - b);
  failing.sort((a, b) => a - b);
  expect(failing, details.join('\n')).toEqual(knownNumbers);
});

it('GFM spec example 198 (the first table example) renders to its documented table HTML', () => {
  const example = gfmExamples.find((e) => e.number === 198);
  expect(example?.extension).toBe('table');
  expect(example?.markdown).toBe('| foo | bar |\n| --- | --- |\n| baz | bim |\n');
  const html = renderCommonMark(example?.markdown ?? '');
  expect(html).toContain('<th>foo</th>');
  expect(html).toContain('<td>baz</td>');
});

// --- Sanitising and safety ------------------------------------------------

it('rendered HTML for every OWASP XSS Filter Evasion Cheat Sheet payload embedded in Markdown has no active content', () => {
  const vectors = loadXssVectors();
  expect(vectors.length).toBe(EXPECTED_VECTOR_COUNT);

  const failures: string[] = [];
  for (const vector of vectors) {
    const { html } = markdownToSafeHtml(vector.payload, win);
    const violations = findActiveContent(html, win, 'html');
    if (violations.length > 0) {
      failures.push(`[${vector.source}] ${vector.payload.slice(0, 80)} -> ${violations.join('; ')}`);
    }
  }
  expect(failures, failures.join('\n')).toEqual([]);
});

it('an img with an onerror handler and a javascript: link leave no handler and no javascript URL', () => {
  const markdown = '![x](x "y")\n\n<img src=x onerror=alert(1)>\n\n[a](javascript:alert(1))';
  const { html } = markdownToSafeHtml(markdown, win);
  expect(html).not.toContain('onerror');
  expect(html.toLowerCase()).not.toContain('javascript:');
});

it('images and other resources that load from an address are removed and data images are kept', () => {
  const remote = markdownToSafeHtml('![t](https://example.invalid/t.png)', win);
  expect(remote.html).toContain('<img');
  expect(remote.html).toContain('alt="t"');
  expect(remote.html).not.toContain('example.invalid');
  expect(remote.removed.externalReferences).toBeGreaterThanOrEqual(1);

  // A small inline data image written as raw HTML in the Markdown source
  // (still supported: allowDangerousHtml passes raw HTML on to the
  // sanitiser rather than escaping it) survives the sanitiser's own rule 3.
  // Markdown image SYNTAX with a data: target is refused one layer earlier,
  // by micromark's own allowDangerousProtocol: false (its images allow-list
  // is http/https only, never data:) -- defense in depth, not a bug; see
  // CM_KNOWN_DIFFERENCES for the conformance-test examples this affects.
  const dataImage = markdownToSafeHtml('<img src="data:image/png;base64,AAAA" alt="t">', win);
  expect(dataImage.html).toContain('data:image/png;base64,AAAA');
});

it('a document with more than 20000 emphasis markers is refused rather than risking a freeze', () => {
  const pathological = '*a* '.repeat(6000); // 12000 '*' characters: under the limit, must still work.
  expect(() => renderCommonMark(pathological)).not.toThrow();

  const overLimit = '*a* '.repeat(11000); // 22000 '*' characters: over the limit.
  expect(() => renderCommonMark(overLimit)).toThrow(MarkdownHtmlError);
  expect(() => renderCommonMark(overLimit)).toThrow(/refused rather than risk freezing the tab/);
});

// --- Table of contents ------------------------------------------------

it('the table of contents links every heading to a unique GitHub-style id', () => {
  const markdown = '# Intro\n\ntext\n\n# Intro\n\nmore text\n\n## Sub Heading';
  const { html, headings } = markdownToSafeHtml(markdown, win, { toc: true, tocDepth: 3 });

  expect(headings.map((h) => h.id)).toEqual(['intro', 'intro-1', 'sub-heading']);
  expect(html).toContain('id="intro"');
  expect(html).toContain('id="intro-1"');
  expect(html).toContain('<nav');
  expect(html).toContain('href="#intro"');
  expect(html).toContain('href="#intro-1"');
  expect(html).toContain('href="#sub-heading"');
});

it('the table of contents only links headings at or above the chosen depth', () => {
  const markdown = '# One\n\n## Two\n\n### Three\n\n#### Four';
  const { html } = markdownToSafeHtml(markdown, win, { toc: true, tocDepth: 2 });
  expect(html).toContain('href="#one"');
  expect(html).toContain('href="#two"');
  expect(html).not.toContain('href="#three"');
  expect(html).not.toContain('href="#four"');
});

it('no table of contents is built when toc is not requested', () => {
  const { html } = markdownToSafeHtml('# Hi', win);
  expect(html).not.toContain('<nav');
});

// --- Console silence --------------------------------------------------

it('nothing is written to the console while rendering', () => {
  markdownToSafeHtml('# Hi\n\n*there* <script>alert(1)</script>', win, { toc: true });
  renderCommonMark('| a | b |\n| - | - |\n| 1 | 2 |');
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
});

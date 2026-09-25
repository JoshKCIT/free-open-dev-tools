/**
 * Tests for Markdown and HTML into BBCode, and round trips across all three
 * formats. The seeded generator is a small hand-written 32-bit generator
 * (mulberry32), the same pattern `text-lines`'s own shuffle test uses in
 * this project, so a failing seed is always reproducible.
 */
import { it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import type { WindowLike } from 'dompurify';
import { convertMarkup } from '../src/index';
import { element, text, type BbNode, type BbTag } from '../src/tree';
import { emitBbcode } from '../src/emit-bbcode';
import { emitMarkdown } from '../src/emit-markdown';
import { loadXssVectors, EXPECTED_VECTOR_COUNT } from './xss-vectors';

function makeWindow(): WindowLike {
  return new JSDOM('', { url: 'https://example.invalid/' }).window as unknown as WindowLike;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'];

function randomWord(rand: () => number): string {
  return WORDS[Math.floor(rand() * WORDS.length)]!;
}

// A tiny transparent 1x1 PNG, the one data-image form the canonical
// sanitiser keeps -- an https image target would legitimately lose its src
// when converted through HTML (D-72, external references removed), which
// is correct sanitiser behaviour but would make round-tripping THROUGH the
// html leg inherently lossy; this generator avoids that unrelated failure
// mode so the round-trip tests measure this tool's own tag-tree fidelity.
const DATA_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

/**
 * Builds a small random tree over `allowedTags`, depth-bounded, for a
 * round-trip test. Guarantees a plain-text node between two sibling
 * elements, and never lets a tag directly nest another instance of itself
 * (`avoidTag`) -- both are genuine markup ambiguities (`**a****b**`-style
 * adjacent markers, or nested `<a>` links no HTML5 parser round-trips
 * consistently), not bugs in the tags this project actually supports.
 */
function randomInlineTree(rand: () => number, depth: number, allowedTags: BbTag[], avoidTag?: BbTag): BbNode[] {
  const count = 1 + Math.floor(rand() * 2);
  const out: BbNode[] = [];
  let lastWasElement = false;
  for (let i = 0; i < count; i++) {
    const makeText = depth <= 0 || rand() < 0.4;
    if (makeText) {
      out.push(text(`${randomWord(rand)} `));
      lastWasElement = false;
      continue;
    }
    if (lastWasElement) out.push(text(' '));
    const pool = avoidTag ? allowedTags.filter((t) => t !== avoidTag) : allowedTags;
    if (pool.length === 0) {
      out.push(text(randomWord(rand)));
      lastWasElement = false;
      continue;
    }
    const tag = pool[Math.floor(rand() * pool.length)]!;
    switch (tag) {
      case 'b':
      case 'i':
      case 'u':
      case 's':
        out.push(element(tag, randomInlineTree(rand, depth - 1, allowedTags, tag)));
        break;
      case 'url':
        out.push(
          element('url', randomInlineTree(rand, depth - 1, allowedTags, 'url'), {
            href: `https://example.com/${randomWord(rand)}`,
          }),
        );
        break;
      case 'img':
        out.push(element('img', [], { src: DATA_IMAGE }));
        break;
      case 'color':
        out.push(
          element('color', randomInlineTree(rand, depth - 1, allowedTags, 'color'), {
            value: rand() < 0.5 ? 'red' : '#00ff00',
          }),
        );
        break;
      case 'size':
        out.push(
          element('size', randomInlineTree(rand, depth - 1, allowedTags, 'size'), {
            value: rand() < 0.5 ? '3' : '150%',
          }),
        );
        break;
      default:
        out.push(text(randomWord(rand)));
    }
    lastWasElement = true;
  }
  return out;
}

/** Occasionally wraps inline content in a quote, list or code block, for coverage beyond pure inline nesting. */
function randomDocument(rand: () => number, allowedTags: BbTag[]): BbNode[] {
  const inline = randomInlineTree(rand, 2, allowedTags);
  const wrap = rand();
  if (wrap < 0.2) return [element('quote', inline)];
  if (wrap < 0.4) {
    return [
      element('list', [element('item', [text(randomWord(rand))]), element('item', inline)], {
        style: rand() < 0.5 ? 'unordered' : '1',
      }),
    ];
  }
  if (wrap < 0.5) return [element('code', [text(`${randomWord(rand)}();`)])];
  return inline;
}

it('CommonMark emphasis, links, images, lists, quotes and code convert to the matching BBCode tags', () => {
  // "*a* **b** [c](https://example.com) ![d](https://example.com/d.png)" becomes
  // "[i]a[/i] [b]b[/b] [url=https://example.com]c[/url] [img]https://example.com/d.png[/img]"
  const inline = convertMarkup('*a* **b** [c](https://example.com) ![d](https://example.com/d.png)', {
    from: 'markdown',
    to: 'bbcode',
  }).output;
  expect(inline).toBe('[i]a[/i] [b]b[/b] [url=https://example.com]c[/url] [img]https://example.com/d.png[/img]');

  const quote = convertMarkup('> quoted text', { from: 'markdown', to: 'bbcode' }).output;
  expect(quote).toBe('[quote]quoted text[/quote]');

  const list = convertMarkup('- one\n- two', { from: 'markdown', to: 'bbcode' }).output;
  expect(list).toBe('[list][*]one[*]two[/list]');
  expect(convertMarkup(list, { from: 'bbcode', to: 'bbcode' }).output).toBe(list);

  const ordered = convertMarkup('1. first\n2. second', { from: 'markdown', to: 'bbcode' }).output;
  expect(ordered).toBe('[list=1][*]first[*]second[/list]');

  const code = convertMarkup('```js\nvar x = 1;\n```', { from: 'markdown', to: 'bbcode' }).output;
  expect(code).toBe('[code=js]var x = 1;[/code]');
});

it('HTML elements convert to BBCode and script, style and unknown elements are dropped with a warning', () => {
  // "<p style=\"text-align:center\"><font color=\"#f00\">x</font></p>" becomes "[center][color=#f00]x[/color][/center]"
  const centered = convertMarkup('<p style="text-align:center"><font color="#f00">x</font></p>', {
    from: 'html',
    to: 'bbcode',
  });
  expect(centered.output).toBe('[center][color=#f00]x[/color][/center]');

  // "<a href=\"javascript:alert(1)\">y</a>" becomes "y"
  const link = convertMarkup('<a href="javascript:alert(1)">y</a>', { from: 'html', to: 'bbcode' });
  expect(link.output).toBe('y');

  // "<script>" and "<style>" content disappears with a warning
  const dropped = convertMarkup('<script>evil()</script><style>body{color:red}</style>kept text', {
    from: 'html',
    to: 'bbcode',
  });
  expect(dropped.output).toBe('kept text');
  expect(dropped.warnings.some((w) => w.toLowerCase().includes('script'))).toBe(true);

  // an unrecognised element keeps its children and is named in a warning
  const unknown = convertMarkup('<marquee>moving text</marquee>', { from: 'html', to: 'bbcode' });
  expect(unknown.output).toBe('moving text');
  expect(unknown.warnings.some((w) => w.includes('marquee'))).toBe(true);
});

it('BBCode to HTML to BBCode keeps the same tag tree for the supported tag set', () => {
  const win = makeWindow();
  const allowedTags: BbTag[] = ['b', 'i', 'u', 's', 'url', 'img', 'color', 'size'];
  const failures: string[] = [];

  for (let seed = 0; seed < 200; seed++) {
    const rand = mulberry32(seed);
    const doc = randomDocument(rand, allowedTags);
    const bbcode1 = emitBbcode(doc);

    const html1 = convertMarkup(bbcode1, { from: 'bbcode', to: 'html' }, win).output;
    const bbcode2 = convertMarkup(html1, { from: 'html', to: 'bbcode' }).output;
    const html2 = convertMarkup(bbcode2, { from: 'bbcode', to: 'html' }, win).output;

    if (html2 !== html1) {
      failures.push(`seed ${seed}: ${bbcode1} -> ${html1} -> ${bbcode2} -> ${html2}`);
    }
  }

  expect(failures.slice(0, 5), `${failures.length} of 200 seeds failed`).toEqual([]);
});

it('Markdown to BBCode to Markdown keeps the same content for the supported subset', () => {
  const allowedTags: BbTag[] = ['b', 'i', 's', 'url', 'img'];
  const failures: string[] = [];

  for (let seed = 0; seed < 200; seed++) {
    const rand = mulberry32(seed);
    const doc = randomDocument(rand, allowedTags);
    const markdown1 = emitMarkdown(doc).markdown;

    const bbcode1 = convertMarkup(markdown1, { from: 'markdown', to: 'bbcode' }).output;
    const markdown2 = convertMarkup(bbcode1, { from: 'bbcode', to: 'markdown' }).output;
    const bbcode2 = convertMarkup(markdown2, { from: 'markdown', to: 'bbcode' }).output;

    if (bbcode2 !== bbcode1) {
      failures.push(`seed ${seed}: ${markdown1} -> ${bbcode1} -> ${markdown2} -> ${bbcode2}`);
    }
  }

  expect(failures.slice(0, 5), `${failures.length} of 200 seeds failed`).toEqual([]);
});

it('hostile HTML input never produces a javascript URL in BBCode or Markdown', () => {
  const vectors = loadXssVectors();
  expect(vectors.length).toBe(EXPECTED_VECTOR_COUNT);

  // Checks the actual link/image-target syntax of each output format, not
  // any occurrence of the substring "javascript:" -- a payload can legally
  // carry that text as inert, escaped prose (e.g. a <style> block's own
  // text, dropped as content but still reachable as a fenced/plain string
  // elsewhere), which is safe precisely because it is never read back as a
  // URL by any BBCode, Markdown or HTML parser.
  const dangerousBbcode = /\[url=\s*javascript:|\[img\]\s*javascript:/i;
  const dangerousMarkdown = /]\(\s*javascript:/i;
  const failures: string[] = [];
  for (const vector of vectors) {
    const toBbcode = convertMarkup(vector.payload, { from: 'html', to: 'bbcode' }).output;
    const toMarkdown = convertMarkup(vector.payload, { from: 'html', to: 'markdown' }).output;
    if (dangerousBbcode.test(toBbcode)) failures.push(`[${vector.source}] bbcode: ${toBbcode.slice(0, 80)}`);
    if (dangerousMarkdown.test(toMarkdown)) failures.push(`[${vector.source}] markdown: ${toMarkdown.slice(0, 80)}`);
  }
  expect(failures, failures.join('\n')).toEqual([]);
});

it('Markdown and HTML features BBCode cannot express are named in a warning', () => {
  const heading = convertMarkup('# Title', { from: 'markdown', to: 'bbcode' });
  expect(heading.warnings.some((w) => w.toLowerCase().includes('heading'))).toBe(true);

  const table = convertMarkup('| a | b |\n| - | - |\n| 1 | 2 |', { from: 'markdown', to: 'bbcode' });
  expect(table.warnings.some((w) => w.toLowerCase().includes('table'))).toBe(true);

  const footnote = convertMarkup('note[^1]\n\n[^1]: text', { from: 'markdown', to: 'bbcode' });
  expect(footnote.warnings.some((w) => w.toLowerCase().includes('footnote'))).toBe(true);

  const htmlHeading = convertMarkup('<h2>Title</h2>', { from: 'html', to: 'bbcode' });
  expect(htmlHeading.warnings.some((w) => w.toLowerCase().includes('heading'))).toBe(true);
});

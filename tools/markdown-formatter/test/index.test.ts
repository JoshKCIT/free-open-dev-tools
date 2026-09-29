import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { formatMarkdown, MarkdownFormatterError } from '../src/index';

let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  for (const spy of consoleSpies) spy.mockRestore();
});

/** The independent second opinion: a mature CommonMark/GFM implementation, used as a differential check, never as the definition. */
function toHtml(markdown: string): string {
  return micromark(markdown, {
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
    allowDangerousHtml: true,
    allowDangerousProtocol: false,
  });
}

/** Collapses whitespace runs to one space outside <pre> blocks, so an "always"/"never" wrap -- which only moves where a soft line break falls -- can be compared for meaning rather than byte layout. */
function normalizeOutsidePre(html: string): string {
  const parts = html.split(/(<pre[\s\S]*?<\/pre>)/);
  return parts
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/\s+/g, ' ')))
    .join('')
    .trim();
}

/** A corpus grounded in CommonMark 0.31.2 and GFM 0.29-gfm, cited by section. */
const CORPUS: { label: string; source: string }[] = [
  {
    label: 'GFM 4.10 table with every alignment',
    source: '| a | bbbb | c |\n|:-|:-:|-:|\n| 1 | 2 | 333333 |\n',
  },
  {
    label: 'CommonMark 5.2/5.3 nested bullet and ordered lists, loose and tight, different start numbers',
    source: '- a\n  - b\n  - c\n\n- d\n\n3. x\n4. y\n\n1) p\n2) q\n',
  },
  {
    label: '6.2 emphasis and strong emphasis, including intraword *',
    source: 'foo*bar*baz **strong** and *em*\n',
  },
  {
    label: '6.1 code spans with backticks inside',
    source: '``foo ` bar``\n',
  },
  {
    label: '4.2/4.3 ATX and setext headings',
    source: '# ATX one\n\nSetext one\n==========\n\n## ATX two\n\nSetext two\n----------\n',
  },
  {
    label: '4.6 HTML blocks',
    source: '<div>\n  <p>raw</p>\n</div>\n\nAfter.\n',
  },
  {
    label: '4.5/4.4 fenced and indented code',
    source: '```js\nconst a = 1;\n```\n\n    indented code\n',
  },
  {
    label: '5.1 block quotes',
    source: '> quoted\n> more\n',
  },
  {
    label: '6.3/6.4/6.5/GFM 6.9 links, images and autolinks',
    source: '[text](http://example.com "t") ![alt](http://example.com/i.png) <http://example.com> www.example.com\n',
  },
  {
    label: '6.7 hard line breaks',
    source: 'line one  \nline two\n',
  },
  {
    label: '4.1 thematic breaks',
    source: 'a\n\n---\n\nb\n',
  },
  {
    label: 'GFM 6.5/5.3 strikethrough and task list items',
    source: '~~gone~~\n\n- [ ] todo\n- [x] done\n',
  },
  {
    label: '2.4 backslash escapes',
    source: '\\*not emphasis\\*\n',
  },
];

describe('formatMarkdown: HTML equality oracle, prose wrap preserve', () => {
  for (const { label, source } of CORPUS) {
    it(`${label}: micromark+GFM HTML is byte-identical before and after formatting`, async () => {
      const result = await formatMarkdown(source, { parser: 'markdown', proseWrap: 'preserve' });
      expect(toHtml(result.output)).toBe(toHtml(source));
    });
  }
});

describe('formatMarkdown: HTML equality oracle, prose wrap always/never', () => {
  const proseSource =
    'This is a reasonably long sentence that should wrap onto more than one line at a narrow print width, followed by a second sentence.\n';

  for (const proseWrap of ['always', 'never'] as const) {
    for (const printWidth of [40, 80]) {
      it(`proseWrap ${proseWrap}, printWidth ${printWidth}: HTML is identical after whitespace normalisation`, async () => {
        const result = await formatMarkdown(proseSource, { parser: 'markdown', proseWrap, printWidth });
        expect(normalizeOutsidePre(toHtml(result.output))).toBe(normalizeOutsidePre(toHtml(proseSource)));
      });
    }
  }

  it('CJK text: preserve keeps rendered HTML identical, but always/never join across the line break (measured, documented in ambiguities)', async () => {
    const cjk = '中文中文\n中文 English\n';
    const preserved = await formatMarkdown(cjk, { parser: 'markdown', proseWrap: 'preserve' });
    expect(toHtml(preserved.output)).toBe(toHtml(cjk));

    const always = await formatMarkdown(cjk, { parser: 'markdown', proseWrap: 'always' });
    expect(always.output).toBe('中文中文中文 English\n');
    const never = await formatMarkdown(cjk, { parser: 'markdown', proseWrap: 'never' });
    expect(never.output).toBe('中文中文中文 English\n');
  });
});

describe('formatMarkdown: table alignment (measured)', () => {
  it('the measured table input gives exactly the measured aligned output', async () => {
    const result = await formatMarkdown('| a | bbbb | c |\n|:-|:-:|-:|\n| 1 | 2 | 333333 |\n');
    expect(result.output).toBe('| a   | bbbb |      c |\n| :-- | :--: | -----: |\n| 1   |  2   | 333333 |\n');
  });
});

describe('formatMarkdown: normalisation facts (measured, asserted literally)', () => {
  it('*a*  __b__ becomes _a_ **b**', async () => {
    expect((await formatMarkdown('*a*  __b__')).output).toBe('_a_ **b**\n');
  });

  it('* x becomes - x', async () => {
    expect((await formatMarkdown('* x')).output).toBe('- x\n');
  });

  it('##   Title   ## becomes ## Title', async () => {
    expect((await formatMarkdown('##   Title   ##')).output).toBe('## Title\n');
  });

  it('setext headings stay setext', async () => {
    const result = await formatMarkdown('Setext\n======\n\nTitle two\n---------\n');
    expect(result.output).toContain('Setext\n======');
    expect(result.output).toContain('Title two\n---------');
  });

  it('CRLF input gives LF output', async () => {
    const result = await formatMarkdown('a\r\nb\r\n');
    expect(result.output).toBe('a\nb\n');
    expect(result.output).not.toContain('\r');
  });
});

describe('formatMarkdown: code and front matter left byte-for-byte', () => {
  it('a js fence with irregular spacing is unchanged', async () => {
    const result = await formatMarkdown('```js\nconst   a=1\n```\n');
    expect(result.output).toContain('const   a=1');
  });

  it('YAML front matter is unchanged', async () => {
    const result = await formatMarkdown('---\ntitle:   x\n---\n\nbody\n');
    expect(result.output).toContain('title:   x');
  });
});

describe('formatMarkdown: MDX (parser mdx)', () => {
  it('import, export, JSX and {expressions} are unchanged', async () => {
    const source = 'import Foo from "./foo"\n\nexport const x = 1\n\n<Foo   a="1" />\n\n{1 + 1}\n';
    const result = await formatMarkdown(source, { parser: 'mdx' });
    expect(result.output).toBe(source);
  });

  it('malformed JSX is passed through, not refused', async () => {
    const source = '<X a=\n\nsome text\n';
    const result = await formatMarkdown(source, { parser: 'mdx' });
    expect(result.output).toBe(source);
  });
});

describe('formatMarkdown: idempotence', () => {
  for (const { label, source } of CORPUS) {
    for (const parser of ['markdown', 'mdx'] as const) {
      for (const proseWrap of ['preserve', 'always', 'never'] as const) {
        it(`${label} (${parser}, proseWrap ${proseWrap}): formatting the output again gives the same text`, async () => {
          const first = await formatMarkdown(source, { parser, proseWrap });
          const second = await formatMarkdown(first.output, { parser, proseWrap });
          expect(second.output).toBe(first.output);
        });
      }
    }
  }
});

describe('formatMarkdown: errors', () => {
  it('5,000 nested > block quotes throw the too-deeply-nested error, never a raw RangeError', async () => {
    const source = '> '.repeat(5000) + 'a';
    try {
      await formatMarkdown(source);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(MarkdownFormatterError);
      expect(err).not.toBeInstanceOf(RangeError);
      expect((err as MarkdownFormatterError).message).toBe('This document is nested too deeply to format.');
    }
  });

  it('printWidth outside 20-200 or non-integer throws the PD-3 error', async () => {
    const message = 'Print width must be a whole number from 20 to 200.';
    await expect(formatMarkdown('a', { printWidth: 19 })).rejects.toThrow(message);
    await expect(formatMarkdown('a', { printWidth: 201 })).rejects.toThrow(message);
    await expect(formatMarkdown('a', { printWidth: 80.5 })).rejects.toThrow(message);
  });

  it('empty input returns empty output without throwing', async () => {
    const result = await formatMarkdown('');
    expect(result).toEqual({ output: '', inputBytes: 0, outputBytes: 0 });
  });

  it('an unknown parser or prose wrap value is refused', async () => {
    await expect(formatMarkdown('a', { parser: 'bogus' as never })).rejects.toThrow(MarkdownFormatterError);
    await expect(formatMarkdown('a', { proseWrap: 'bogus' as never })).rejects.toThrow(MarkdownFormatterError);
  });
});

it('nothing is written to the console while formatting', async () => {
  await formatMarkdown('# Title\n\n* a\n* b\n', { parser: 'markdown' });
  await formatMarkdown('import Foo from "./foo"\n\n<Foo />\n', { parser: 'mdx' });
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
});

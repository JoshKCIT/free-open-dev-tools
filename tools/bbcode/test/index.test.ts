/**
 * Tests for BBCode to sanitised HTML and to Markdown. Reference examples
 * come from phpBB's own community BBCode guide
 * (`https://www.phpbb.com/community/help/bbcode`, fetched via the Wayback
 * Machine 2026-09-25 after phpbb.com itself returned 403 to a direct
 * fetch), quoted in each test's own comment -- no standards body defines
 * BBCode.
 */
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import type { WindowLike } from 'dompurify';
import { convertMarkup, BbcodeError } from '../src/index';
import { findActiveContent } from './active-content';
import { loadXssVectors, EXPECTED_VECTOR_COUNT } from './xss-vectors';

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

it('the phpBB BBCode guide examples convert to the expected HTML', () => {
  // "To make a piece of text bold enclose it in [b][/b], e.g. [b]Hello[/b] will become Hello"
  expect(convertMarkup('[b]Hello[/b]', { from: 'bbcode', to: 'html' }, win).output).toBe('<strong>Hello</strong>');
  // "For underlining use [u][/u], for example: [u]Good Morning[/u] becomes Good Morning"
  expect(convertMarkup('[u]Good Morning[/u]', { from: 'bbcode', to: 'html' }, win).output).toBe('<u>Good Morning</u>');
  // "To italicise text use [i][/i], e.g. This is [i]Great![/i]"
  expect(convertMarkup('This is [i]Great![/i]', { from: 'bbcode', to: 'html' }, win).output).toBe(
    'This is <em>Great!</em>',
  );
  // "to create red text you could use: [color=red]Hello![/color] or [color=#FF0000]Hello![/color]"
  expect(convertMarkup('[color=red]Hello![/color]', { from: 'bbcode', to: 'html' }, win).output).toBe(
    '<span style="color:red">Hello!</span>',
  );
  expect(convertMarkup('[color=#FF0000]Hello![/color]', { from: 'bbcode', to: 'html' }, win).output).toBe(
    '<span style="color:#ff0000">Hello!</span>',
  );
  // "[size=200]HUGE![/size] will be HUGE!" -- phpBB's own recommended format is percent
  expect(convertMarkup('[size=200]HUGE![/size]', { from: 'bbcode', to: 'html' }, win).output).toBe(
    '<span style="font-size:200%">HUGE!</span>',
  );
  // quoting with a reference: [quote="Mr. Blobby"]The text Mr. Blobby wrote would go here[/quote]
  const quoted = convertMarkup('[quote="Mr. Blobby"]hi there[/quote]', { from: 'bbcode', to: 'html' }, win).output;
  expect(quoted).toContain('<blockquote>');
  expect(quoted).toContain('Mr. Blobby wrote:');
  expect(quoted).toContain('hi there');
  // outputting code: [code]echo "This is some code";[/code]
  const code = convertMarkup('[code]echo "This is some code";[/code]', { from: 'bbcode', to: 'html' }, win).output;
  expect(code).toContain('<pre><code>');
  expect(code).toContain('echo');
  // an unordered list: [list][*]Red[*]Blue[*]Yellow[/list]
  const list = convertMarkup('[list][*]Red[*]Blue[*]Yellow[/list]', { from: 'bbcode', to: 'html' }, win).output;
  expect(list).toBe('<ul><li>Red</li><li>Blue</li><li>Yellow</li></ul>');
  // a numbered list: [list=1][*]Go to the shops[*]Buy a new computer[/list]
  const numbered = convertMarkup(
    '[list=1][*]Go to the shops[*]Buy a new computer[/list]',
    {
      from: 'bbcode',
      to: 'html',
    },
    win,
  ).output;
  expect(numbered).toBe('<ol><li>Go to the shops</li><li>Buy a new computer</li></ol>');
  // an alphabetical list: [list=a][*]The first possible answer[/list]
  const alpha = convertMarkup(
    '[list=a][*]The first possible answer[/list]',
    { from: 'bbcode', to: 'html' },
    win,
  ).output;
  expect(alpha).toBe('<ol type="a"><li>The first possible answer</li></ol>');
  // a link: [url=https://www.phpbb.com/]Visit phpBB![/url]
  const link = convertMarkup(
    '[url=https://www.phpbb.com/]Visit phpBB![/url]',
    { from: 'bbcode', to: 'html' },
    win,
  ).output;
  expect(link).toBe('<a href="https://www.phpbb.com/">Visit phpBB!</a>');
  // an image: [img]https://www.phpbb.com/theme/images/logos/blue/160x52.png[/img] -- the
  // canonical sanitiser removes any image src pointing at another address (D-72), the same
  // "images from other addresses are removed" rule proven again, with a live source, below.
  const img = convertMarkup(
    '[img]https://www.phpbb.com/theme/images/logos/blue/160x52.png[/img]',
    {
      from: 'bbcode',
      to: 'html',
    },
    win,
  ).output;
  expect(img).toBe('<img alt="">');
});

it('OWASP XSS Filter Evasion Cheat Sheet payloads inside BBCode leave no active content in the HTML', () => {
  const vectors = loadXssVectors();
  expect(vectors.length).toBe(EXPECTED_VECTOR_COUNT);

  const failures: string[] = [];
  for (const vector of vectors) {
    // Plain BBCode text: no [ ] syntax of its own, so a raw HTML/JS payload
    // is never read as a tag -- it is escaped like any other plain text.
    const { output } = convertMarkup(`[b]${vector.payload}[/b]`, { from: 'bbcode', to: 'html' }, win);
    const violations = findActiveContent(output, win, 'html');
    if (violations.length > 0) {
      failures.push(`[${vector.source}] ${vector.payload.slice(0, 80)} -> ${violations.join('; ')}`);
    }
  }
  expect(failures, failures.join('\n')).toEqual([]);
});

it('url, img and color values that are not safe are dropped with a warning', () => {
  // "[url=javascript:alert(1)]x[/url] becomes the text x with a warning"
  const link = convertMarkup('[url=javascript:alert(1)]x[/url]', { from: 'bbcode', to: 'html' }, win);
  expect(link.output).toBe('x');
  expect(link.warnings.some((w) => w.includes('url'))).toBe(true);

  // an unsafe img target is dropped entirely
  const img = convertMarkup('[img]javascript:alert(1)[/img]', { from: 'bbcode', to: 'html' }, win);
  expect(img.output).toBe('');
  expect(img.warnings.some((w) => w.includes('img'))).toBe(true);

  // "[color=red;background:url(x)]a[/color] drops the colour with a warning"
  const color = convertMarkup('[color=red;background:url(x)]a[/color]', { from: 'bbcode', to: 'html' }, win);
  expect(color.output).toBe('a');
  expect(color.warnings.some((w) => w.includes('color'))).toBe(true);
});

it('images from other addresses are removed from the HTML and ordinary links are kept', () => {
  const result = convertMarkup(
    '[img]https://example.invalid/a.png[/img][url=https://example.com]link text[/url]',
    { from: 'bbcode', to: 'html' },
    win,
  );
  expect(result.output).not.toContain('example.invalid');
  expect(result.output).toContain('href="https://example.com"');
  expect(result.output).toContain('link text');
  expect(result.removed.externalReferences).toBeGreaterThanOrEqual(1);
});

it('unknown and unclosed tags stay as literal text', () => {
  // "[foo]x[/foo]" uses a tag name outside the supported set.
  const unknown = convertMarkup('[foo]x[/foo]', { from: 'bbcode', to: 'html' }, win);
  expect(unknown.output).toContain('[foo]');
  expect(unknown.output).toContain('[/foo]');
  expect(unknown.output).toContain('x');
  expect(unknown.output).not.toContain('<foo');

  // "[b][u]This is wrong[/b][/u]" from the guide's own example of an
  // incorrectly nested and therefore never-properly-closed tag pairing --
  // a genuinely unclosed [b] on its own is simpler and unambiguous to assert.
  const unclosed = convertMarkup('hello [b]bold', { from: 'bbcode', to: 'html' }, win);
  expect(unclosed.output).toContain('[b]');
  expect(unclosed.output).not.toContain('<strong>');
});

it('BBCode converts to CommonMark Markdown with punctuation escaped so it reads back the same', () => {
  expect(convertMarkup('[b]bold[/b]', { from: 'bbcode', to: 'markdown' }).output).toBe('**bold**');

  const result = convertMarkup('[b]a.b (c)! d-e[/b]', { from: 'bbcode', to: 'markdown' });
  expect(result.output).toBe('**a\\.b \\(c\\)\\! d\\-e**');
  // Stripping CommonMark's own backslash escapes reproduces the exact
  // original text -- CommonMark 0.31.2 section 2.4 defines a backslash
  // before ASCII punctuation as that literal character, nothing else.
  const unescaped = result.output.replace(/\\([!-/:-@[-`{-~])/g, '$1');
  expect(unescaped).toBe('**a.b (c)! d-e**');
});

it('nothing is written to the console while converting BBCode', () => {
  convertMarkup('[b]<script>alert(1)</script>[/b]', { from: 'bbcode', to: 'html' }, win);
  convertMarkup('[url=javascript:alert(1)]x[/url]', { from: 'bbcode', to: 'html' }, win);
  convertMarkup('[unclosed]hi', { from: 'bbcode', to: 'markdown' });
  convertMarkup('[b]hi[/b]', { from: 'bbcode', to: 'bbcode' });
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
});

it('converting to html without a window throws', () => {
  expect(() => convertMarkup('[b]hi[/b]', { from: 'bbcode', to: 'html' })).toThrow(BbcodeError);
});

it('converting to bbcode canonicalises the input', () => {
  const result = convertMarkup('[B]bold[/B]', { from: 'bbcode', to: 'bbcode' });
  expect(result.output).toBe('[b]bold[/b]');
});

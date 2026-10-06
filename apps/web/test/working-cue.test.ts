import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import OutputView, { StaleOutputContext } from '../src/components/OutputView';
import { cueSentence, formatLimitSeconds, startSentence } from '../src/components/WorkingCue';
import type { OutputBlock } from '../src/lib/tool-ui';

// The single ellipsis character the Run label already uses, built at run time.
const E = String.fromCodePoint(0x2026);

describe('formatLimitSeconds', () => {
  it('gives 1.5 for 1500', () => {
    expect(formatLimitSeconds(1500)).toBe('1.5');
  });

  it('gives 10 for 10000 and 20 for 20000, with no decimal part', () => {
    expect(formatLimitSeconds(10_000)).toBe('10');
    expect(formatLimitSeconds(20_000)).toBe('20');
  });

  it('never rounds up: 2549 gives 2.5 and 1999 gives 1.9', () => {
    expect(formatLimitSeconds(2549)).toBe('2.5');
    expect(formatLimitSeconds(1999)).toBe('1.9');
  });

  it('keeps one decimal at most and whole numbers whole', () => {
    expect(formatLimitSeconds(5000)).toBe('5');
    expect(formatLimitSeconds(30_100)).toBe('30.1');
    expect(formatLimitSeconds(100)).toBe('0.1');
  });
});

describe('cueSentence', () => {
  it('names the limit of a total limit page', () => {
    expect(cueSentence(4_999, { ms: 10_000 })).toBe(`Working${E} 4 s (stops at 10 s)`);
  });

  it('floors the elapsed time so it never exceeds the true time', () => {
    expect(cueSentence(1_999, { ms: 10_000 })).toBe(`Working${E} 1 s (stops at 10 s)`);
    expect(cueSentence(2_000, { ms: 10_000 })).toBe(`Working${E} 2 s (stops at 10 s)`);
  });

  it('says a quiet limit stops after the time with no progress', () => {
    expect(cueSentence(4_000, { ms: 20_000, kind: 'quiet' })).toBe(
      `Working${E} 4 s (stops after 20 s with no progress)`,
    );
  });

  it('shows the elapsed time alone when the page has no limit', () => {
    expect(cueSentence(4_000, undefined)).toBe(`Working${E} 4 s`);
  });

  it('never claims a stop once the total limit is passed, and says the limit counts only the background step', () => {
    expect(cueSentence(11_000, { ms: 10_000 })).toBe(
      `Working${E} 11 s (the 10 s limit counts only the background step)`,
    );
    expect(cueSentence(11_000, { ms: 10_000 })).not.toMatch(/stopping|stops/);
    expect(cueSentence(10_000, { ms: 10_000 })).toBe(`Working${E} 10 s (stops at 10 s)`);
  });

  it('never says past the limit for a quiet limit, which restarts with every sign of progress', () => {
    expect(cueSentence(45_000, { ms: 20_000, kind: 'quiet' })).toBe(
      `Working${E} 45 s (stops after 20 s with no progress)`,
    );
  });

  it('uses the single ellipsis character and ASCII digits only', () => {
    const text = cueSentence(1_234_567, { ms: 10_000 });
    expect(text).toContain(E);
    expect(text).not.toContain('...');
    // Every character is plain ASCII except the one ellipsis, so no thousands separator or other digit form is used.
    expect(text.split(E).join('')).toMatch(/^[\x20-\x7e]+$/);
    expect(text).toContain('1234 s');
  });
});

describe('startSentence', () => {
  it('states the limit in seconds for a total limit', () => {
    expect(startSentence({ ms: 10_000 })).toBe('Working. This stops by itself after 10 seconds.');
    expect(startSentence({ ms: 1500, kind: 'total' })).toBe('Working. This stops by itself after 1.5 seconds.');
  });

  it('states the quiet form for a quiet limit', () => {
    expect(startSentence({ ms: 20_000, kind: 'quiet' })).toBe(
      'Working. This stops by itself after 20 seconds with no progress.',
    );
  });

  it('is the bare word when the page has no limit', () => {
    expect(startSentence(undefined)).toBe('Working.');
  });
});

/** Draws one block the way the runner does, inside the stale context or outside it. */
function draw(block: OutputBlock, stale: boolean): string {
  return renderToStaticMarkup(
    createElement(StaleOutputContext.Provider, { value: stale }, createElement(OutputView, { block })),
  );
}

/** The opening tag of every Copy, Copy HTML, Copy as TSV, Download and swatch button of the markup (not Expand all). */
function buttonTags(html: string): string[] {
  const buttons = html.match(/<button[^>]*>.*?<\/button>/g) ?? [];
  return buttons.filter((b) => /Copy|Download/.test(b)).map((b) => b.slice(0, b.indexOf('>') + 1));
}

describe('stale output context', () => {
  const blocks: [string, OutputBlock][] = [
    ['code with a download', { kind: 'code', value: 'x', download: 'out.txt' }],
    ['key value', { kind: 'keyvalue', pairs: [['a', 'b']] }],
    ['table', { kind: 'table', table: { headers: ['h'], rows: [['c']] } }],
    ['list', { kind: 'list', items: ['one'] }],
    ['swatches', { kind: 'swatches', colors: [{ css: '#fff', label: '#ffffff' }] }],
    ['sandboxed html with Copy HTML', { kind: 'sandboxed-html', html: '<p>x</p>' }],
    ['tree with copy and download', { kind: 'tree', nodes: [{ label: 'a' }], download: 'tree.txt' }],
    ['files', { kind: 'files', files: [{ name: 'a.txt', mime: 'text/plain', content: 'x' }] }],
    ['diff', { kind: 'diff', lines: [{ type: 'add', text: 'x' }] }],
  ];

  for (const [name, block] of blocks) {
    it('turns every Copy and Download button off while stale: ' + name, () => {
      const tags = buttonTags(draw(block, true));
      expect(tags.length).toBeGreaterThan(0);
      for (const tag of tags) expect(tag).toContain('disabled');
    });

    it('leaves every button on when not stale: ' + name, () => {
      const tags = buttonTags(draw(block, false));
      expect(tags.length).toBeGreaterThan(0);
      for (const tag of tags) expect(tag).not.toContain('disabled');
    });
  }

  it('is off by default, so a block drawn outside the runner is unchanged', () => {
    const html = renderToStaticMarkup(createElement(OutputView, { block: { kind: 'code', value: 'x' } }));
    expect(buttonTags(html).every((tag) => !tag.includes('disabled'))).toBe(true);
  });
});

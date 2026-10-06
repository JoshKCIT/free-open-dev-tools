import { describe, expect, it } from 'vitest';
import { cueSentence, formatLimitSeconds, startSentence } from '../src/components/WorkingCue';

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

  it('says it is past the limit, still stopping, once the total limit is passed', () => {
    expect(cueSentence(11_000, { ms: 10_000 })).toBe(`Working${E} 11 s, past the 10 s limit, stopping`);
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

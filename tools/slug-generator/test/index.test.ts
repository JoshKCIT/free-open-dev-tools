import { describe, it, expect } from 'vitest';
import { slugify, uniqueSlug, PRESETS, DEFAULT_STOP_WORDS } from '../src/index';

const slug = (text: string, options = {}) => slugify(text, options).slug;

describe('basic slugification', () => {
  it('lowercases and joins with hyphens', () => {
    expect(slug('Hello World')).toBe('hello-world');
  });

  it('collapses runs of separators and punctuation', () => {
    expect(slug('Hello    World')).toBe('hello-world');
    expect(slug('Hello, World! How are you?')).toBe('hello-world-how-are-you');
    expect(slug('a---b___c')).toBe('a-b-c');
  });

  it('trims separators from the ends', () => {
    expect(slug('  Hello World  ')).toBe('hello-world');
    expect(slug('---Hello---')).toBe('hello');
    expect(slug('!!!')).toBe('');
  });

  it('keeps digits', () => {
    expect(slug('Top 10 Things in 2026')).toBe('top-10-things-in-2026');
  });

  it('handles empty input', () => {
    expect(slug('')).toBe('');
    expect(slugify('').ascii).toBe(true);
  });

  it('uses a custom separator', () => {
    expect(slug('Hello World', { separator: '_' })).toBe('hello_world');
    expect(slug('Hello World', { separator: '' })).toBe('helloworld');
    expect(slug('Hello World', { separator: '.' })).toBe('hello.world');
  });

  it('can preserve case', () => {
    expect(slug('Hello World', { lowercase: false })).toBe('Hello-World');
  });
});

describe('accents and Latin letters', () => {
  it('strips combining accents', () => {
    expect(slug('Café Münster')).toBe('cafe-munster');
    expect(slug('naïve résumé')).toBe('naive-resume');
    expect(slug('Ångström')).toBe('angstrom');
  });

  it('handles letters that are not a base plus an accent', () => {
    // These do not decompose, so they need an explicit mapping.
    expect(slug('Straße')).toBe('strasse');
    expect(slug('Ærøskøbing')).toBe('aeroskobing');
    expect(slug('Łódź')).toBe('lodz');
    expect(slug('Đà Nẵng')).toBe('da-nang');
    expect(slug('Þingvellir')).toBe('thingvellir');
  });

  it('handles a precomposed and a decomposed form the same way', () => {
    expect(slug('café')).toBe(slug('café'));
  });
});

describe('non-Latin scripts', () => {
  it('drops them by default and says which characters went', () => {
    const result = slugify('Привет мир');
    expect(result.slug).toBe('');
    expect(result.droppedCharacters.length).toBeGreaterThan(0);
  });

  it('keeps the Latin parts around dropped text', () => {
    expect(slug('Hello 世界 World')).toBe('hello-world');
  });

  it('can keep non-Latin text when asked', () => {
    expect(slug('Привет мир', { nonLatin: 'keep' })).toBe('привет-мир');
    expect(slug('日本語 テスト', { nonLatin: 'keep' })).toBe('日本語-テスト');
  });

  it('reports whether the result is safe as plain ASCII', () => {
    expect(slugify('Привет', { nonLatin: 'keep' }).ascii).toBe(false);
    expect(slugify('Privet').ascii).toBe(true);
  });

  it('drops emoji without leaving a gap', () => {
    expect(slug('Hello 👋 World')).toBe('hello-world');
  });
});

describe('symbol expansion', () => {
  it('expands the symbols that carry meaning', () => {
    expect(slug('Tom & Jerry')).toBe('tom-and-jerry');
    expect(slug('100% Done')).toBe('100-percent-done');
    expect(slug('C++ and C#')).toBe('c-plus-plus-and-c');
    expect(slug('user@example.com')).toBe('user-at-example-com');
  });

  it('can be turned off, leaving the symbol as a separator', () => {
    expect(slug('Tom & Jerry', { expandSymbols: false })).toBe('tom-jerry');
    expect(slug('100% Done', { expandSymbols: false })).toBe('100-done');
  });
});

describe('length limits', () => {
  it('truncates at a word boundary rather than mid-word', () => {
    const result = slugify('the quick brown fox jumps over the lazy dog', { maxLength: 20 });
    expect(result.slug.length).toBeLessThanOrEqual(20);
    expect(result.slug).toBe('the-quick-brown-fox');
    expect(result.truncated).toBe(true);
  });

  it('never leaves a trailing separator after truncating', () => {
    for (let limit = 5; limit < 40; limit++) {
      const result = slugify('alpha bravo charlie delta echo foxtrot', { maxLength: limit });
      expect(result.slug.endsWith('-'), `limit ${limit}`).toBe(false);
      expect(result.slug.length).toBeLessThanOrEqual(limit);
    }
  });

  it('does not truncate when the slug already fits', () => {
    const result = slugify('short', { maxLength: 100 });
    expect(result.truncated).toBe(false);
    expect(result.slug).toBe('short');
  });

  it('falls back to a hard cut when the first word is longer than the limit', () => {
    const result = slugify('supercalifragilistic', { maxLength: 10 });
    expect(result.slug).toBe('supercalif');
  });
});

describe('stop words', () => {
  it('removes them', () => {
    expect(slug('The Quick Brown Fox', { stopWords: DEFAULT_STOP_WORDS })).toBe('quick-brown-fox');
  });

  it('does not produce an empty slug when everything is a stop word', () => {
    expect(slug('The And Of', { stopWords: DEFAULT_STOP_WORDS })).toBe('the-and-of');
  });

  it('matches case-insensitively', () => {
    expect(slug('THE Quick', { stopWords: ['the'] })).toBe('quick');
  });
});

describe('uniqueness', () => {
  it('returns the base when it is free', () => {
    expect(uniqueSlug('post', ['other'])).toBe('post');
  });

  it('appends a number when the base is taken', () => {
    expect(uniqueSlug('post', ['post'])).toBe('post-2');
    expect(uniqueSlug('post', ['post', 'post-2', 'post-3'])).toBe('post-4');
  });

  it('honours a custom separator', () => {
    expect(uniqueSlug('post', ['post'], '_')).toBe('post_2');
  });
});

describe('presets', () => {
  it('produces a URL-safe slug', () => {
    const result = slugify('My First Post: Café & Crème!', PRESETS.url);
    expect(result.slug).toBe('my-first-post-cafe-and-creme');
    expect(result.ascii).toBe(true);
  });

  it('produces a branch name within a sensible length', () => {
    const result = slugify('Fix the thing that broke when we deployed on a Friday afternoon again', PRESETS.branch);
    expect(result.slug.length).toBeLessThanOrEqual(60);
    expect(/^[a-z0-9-]+$/.test(result.slug)).toBe(true);
  });

  it('produces a snake case slug', () => {
    expect(slugify('Hello World', PRESETS.snake).slug).toBe('hello_world');
  });

  it('every preset produces something URL-safe for a demanding input', () => {
    const input = 'Café & Crème: 100% Ünïcödé — Straße №5 👋';
    for (const [name, options] of Object.entries(PRESETS)) {
      const result = slugify(input, options);
      expect(result.slug.length, name).toBeGreaterThan(0);
      expect(result.slug.startsWith(options.separator ?? '-'), name).toBe(false);
      expect(result.slug.endsWith(options.separator ?? '-'), name).toBe(false);
      if (options.nonLatin !== 'keep') expect(result.ascii, name).toBe(true);
    }
  });
});

describe('idempotence', () => {
  it('slugifying a slug changes nothing', () => {
    const samples = ['Hello World', 'Café & Crème', 'Top 10 Things', 'a---b', 'Straße'];
    for (const sample of samples) {
      const once = slug(sample);
      expect(slug(once), sample).toBe(once);
    }
  });
});

describe('adversarial input', () => {
  it('produces nothing dangerous from a path traversal attempt', () => {
    expect(slug('../../etc/passwd')).toBe('etc-passwd');
    // The percent sign expands to the word, which is still harmless: what
    // matters is that no slash or dot survives into the result.
    expect(slug('..%2F..%2Fetc')).toBe('percent-2f-percent-2fetc');
    expect(slug('..%2F..%2Fetc', { expandSymbols: false })).toBe('2f-2fetc');

    // Whatever the input, no path separator, dot or null byte reaches the slug.
    const dangerous = new RegExp('[/' + '\\\\' + '.' + '\\u0000]');
    for (const attempt of [
      '../../etc/passwd',
      '..%2F..%2Fetc',
      'a/b' + '\\' + 'c',
      'x' + '\u0000' + 'y',
      '....//....//',
    ]) {
      expect(dangerous.test(slug(attempt)), attempt).toBe(false);
    }
  });

  it('neutralises markup', () => {
    expect(slug('<script>alert(1)</script>')).toBe('script-alert-1-script');
  });

  it('handles a very long input', () => {
    const result = slugify('word '.repeat(50000));
    expect(result.slug.length).toBeGreaterThan(0);
  });

  it('never returns a slug with a leading or trailing separator', () => {
    const samples = ['---', ' a ', '!a!', '...test...', '\n\ttabbed\n'];
    for (const sample of samples) {
      const out = slug(sample);
      expect(out.startsWith('-'), sample).toBe(false);
      expect(out.endsWith('-'), sample).toBe(false);
    }
  });
});

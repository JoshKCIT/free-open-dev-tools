import { describe, it, expect } from 'vitest';
import {
  count,
  words,
  sentences,
  paragraphs,
  countGraphemes,
  readingTime,
  wordFrequency,
  characterFrequency,
  syllables,
  readability,
} from '../src/index';

describe('word splitting', () => {
  it('counts ordinary words', () => {
    expect(words('the quick brown fox')).toEqual(['the', 'quick', 'brown', 'fox']);
  });

  it('keeps a contraction as one word', () => {
    expect(words("don't stop")).toEqual(["don't", 'stop']);
    expect(words('don’t stop')).toEqual(['don’t', 'stop']);
  });

  it('keeps a hyphenated word as one word', () => {
    expect(words('well-known problem')).toEqual(['well-known', 'problem']);
  });

  it('does not count punctuation as a word', () => {
    expect(words('hello, world! -- yes')).toEqual(['hello', 'world', 'yes']);
  });

  it('counts words in other scripts', () => {
    expect(words('привет мир')).toEqual(['привет', 'мир']);
    expect(words('café naïve')).toEqual(['café', 'naïve']);
  });

  it('counts numbers as words', () => {
    expect(words('version 2 released')).toEqual(['version', '2', 'released']);
  });

  it('returns nothing for empty or punctuation-only text', () => {
    expect(words('')).toEqual([]);
    expect(words('... !!! ---')).toEqual([]);
  });
});

describe('character counting', () => {
  it('distinguishes the four ways to count characters', () => {
    // A skin-toned waving hand is one grapheme, two code points and four
    // UTF-16 code units. Every one of those numbers is "the length" somewhere.
    const c = count('👋🏽');
    expect(c.graphemes).toBe(1);
    expect(c.codePoints).toBe(2);
    expect(c.codeUnits).toBe(4);
    expect(c.utf8Bytes).toBe(8);
  });

  it('counts a flag emoji as one grapheme', () => {
    expect(countGraphemes('🇬🇧')).toBe(1);
  });

  it('counts a combining sequence as one grapheme', () => {
    // e followed by a combining acute accent.
    expect(countGraphemes('é')).toBe(1);
    expect(Array.from('é').length).toBe(2);
  });

  it('counts bytes as UTF-8', () => {
    expect(count('abc').utf8Bytes).toBe(3);
    expect(count('café').utf8Bytes).toBe(5);
    expect(count('日本').utf8Bytes).toBe(6);
  });

  it('counts characters with and without spaces', () => {
    const c = count('a b c');
    expect(c.characters).toBe(5);
    expect(c.charactersNoSpaces).toBe(3);
  });

  it('counts unique words case-insensitively', () => {
    const c = count('The the THE cat');
    expect(c.words).toBe(4);
    expect(c.uniqueWords).toBe(2);
  });
});

describe('sentence and paragraph splitting', () => {
  it('splits on sentence-ending punctuation', () => {
    expect(sentences('One. Two! Three?')).toHaveLength(3);
  });

  it('does not split on a decimal point', () => {
    expect(sentences('The value is 3.5 in total.')).toHaveLength(1);
  });

  it('does not split on a common abbreviation', () => {
    // Intl.Segmenter knows Dr. is not a sentence end. A naive split does not.
    expect(sentences('Dr. Smith arrived. He was late.')).toHaveLength(2);
  });

  it('handles text with no final punctuation', () => {
    expect(sentences('just one sentence')).toHaveLength(1);
  });

  it('returns nothing for empty text', () => {
    expect(sentences('')).toEqual([]);
    expect(sentences('   ')).toEqual([]);
  });

  it('splits paragraphs on a blank line', () => {
    expect(paragraphs('one\n\ntwo\n\n\nthree')).toHaveLength(3);
  });

  it('does not treat a single newline as a paragraph break', () => {
    expect(paragraphs('one\ntwo')).toHaveLength(1);
  });

  it('counts lines separately from paragraphs', () => {
    const c = count('a\nb\n\nc');
    expect(c.lines).toBe(4);
    expect(c.nonEmptyLines).toBe(3);
    expect(c.paragraphs).toBe(2);
  });
});

describe('reading time', () => {
  it('scales with word count', () => {
    expect(readingTime(238).readingSeconds).toBeCloseTo(60, 5);
    expect(readingTime(476).readingSeconds).toBeCloseTo(120, 5);
  });

  it('speaking takes longer than reading', () => {
    expect(readingTime(1000).speakingSeconds).toBeGreaterThan(readingTime(1000).readingSeconds);
  });

  it('formats a readable label', () => {
    expect(readingTime(238).readingLabel).toBe('1 min');
    expect(readingTime(0).readingLabel).toBe('under a second');
    expect(readingTime(20000).readingLabel).toMatch(/hr/);
  });

  it('honours a custom speed', () => {
    expect(readingTime(100, { readingWordsPerMinute: 100 }).readingSeconds).toBeCloseTo(60, 5);
  });
});

describe('frequency', () => {
  it('ranks words by how often they appear', () => {
    const f = wordFrequency('the cat the dog the bird');
    expect(f[0]).toMatchObject({ value: 'the', count: 3 });
    expect(f[0]!.share).toBeCloseTo(0.5, 5);
  });

  it('folds case by default', () => {
    expect(wordFrequency('The the THE')[0]).toMatchObject({ value: 'the', count: 3 });
  });

  it('can keep case', () => {
    expect(wordFrequency('The the', { ignoreCase: false })).toHaveLength(2);
  });

  it('can exclude stop words', () => {
    const f = wordFrequency('the cat and the dog', { excludeStopWords: true });
    expect(f.map((x) => x.value).sort()).toEqual(['cat', 'dog']);
  });

  it('can require a minimum length', () => {
    expect(
      wordFrequency('a bb ccc', { minLength: 2 })
        .map((x) => x.value)
        .sort(),
    ).toEqual(['bb', 'ccc']);
  });

  it('breaks ties alphabetically so the order is stable', () => {
    const f = wordFrequency('zebra apple');
    expect(f.map((x) => x.value)).toEqual(['apple', 'zebra']);
  });

  it('ranks characters, ignoring whitespace', () => {
    const f = characterFrequency('aaa bb c');
    expect(f[0]).toMatchObject({ value: 'a', count: 3 });
    expect(f.find((x) => x.value === ' ')).toBeUndefined();
  });

  it('handles empty input without dividing by zero', () => {
    expect(wordFrequency('')).toEqual([]);
    expect(characterFrequency('')).toEqual([]);
  });
});

describe('syllable estimation', () => {
  it('gets the common cases right', () => {
    expect(syllables('cat')).toBe(1);
    expect(syllables('happy')).toBe(2);
    expect(syllables('beautiful')).toBe(3);
    expect(syllables('computer')).toBe(3);
  });

  it('handles a silent final e', () => {
    expect(syllables('make')).toBe(1);
    expect(syllables('cake')).toBe(1);
  });

  it('never returns zero for a real word', () => {
    for (const w of ['a', 'I', 'the', 'strength', 'rhythm', 'queue']) {
      expect(syllables(w), w).toBeGreaterThanOrEqual(1);
    }
  });

  it('returns zero for something with no letters', () => {
    expect(syllables('123')).toBe(0);
    expect(syllables('')).toBe(0);
  });
});

describe('readability', () => {
  it('scores simple text as easy', () => {
    const r = readability('The cat sat on the mat. The dog ran fast. We had fun.');
    expect(r).not.toBeNull();
    expect(r!.fleschReadingEase).toBeGreaterThan(80);
    expect(r!.fleschKincaidGrade).toBeLessThan(5);
  });

  it('scores dense text as harder', () => {
    const easy = readability('The cat sat. The dog ran. We had fun.')!;
    const hard = readability(
      'The implementation demonstrates considerable architectural sophistication, incorporating numerous interdependent subsystems whose configuration parameters necessitate substantial documentation.',
    )!;
    expect(hard.fleschReadingEase).toBeLessThan(easy.fleschReadingEase);
    expect(hard.fleschKincaidGrade).toBeGreaterThan(easy.fleschKincaidGrade);
  });

  it('reports the inputs to the formula so the score can be checked', () => {
    const r = readability('One two three. Four five six.')!;
    expect(r.averageWordsPerSentence).toBe(3);
    expect(r.averageSyllablesPerWord).toBeGreaterThan(0);
  });

  it('returns null rather than a meaningless score for very short text', () => {
    expect(readability('Hi.')).toBeNull();
    expect(readability('')).toBeNull();
  });

  it('gives an interpretation in words, not just a number', () => {
    expect(readability('The cat sat on the mat. The dog ran.')!.interpretation.length).toBeGreaterThan(10);
  });
});

describe('large input', () => {
  it('counts a long document quickly', () => {
    const text = 'the quick brown fox jumps over the lazy dog. '.repeat(20000);
    const started = Date.now();
    const c = count(text);
    expect(Date.now() - started).toBeLessThan(8000);
    expect(c.words).toBe(180000);
  });
});

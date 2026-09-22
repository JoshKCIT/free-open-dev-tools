import { meta, count, readingTime, wordFrequency, characterFrequency, readability, LIMITS } from '@fodt/word-counter';
import { defineTool, str, bool, num, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'word-counter',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    { name: 'input', label: 'Text', type: 'textarea', rows: 12, placeholder: 'Paste or type your text here.' },
    {
      name: 'excludeStopWords',
      label: 'Leave common words out of the frequency list',
      type: 'checkbox',
      default: false,
    },
    {
      name: 'minLength',
      label: 'Minimum word length for the frequency list',
      type: 'number',
      default: 1,
      min: 1,
      max: 20,
    },
    {
      name: 'readingSpeed',
      label: 'Reading speed, words per minute',
      type: 'number',
      default: 238,
      min: 50,
      max: 1000,
    },
    { name: 'showCharacters', label: 'Show character frequency as well', type: 'checkbox', default: false },
  ],
  examples: [
    {
      label: 'Prose',
      values: {
        input:
          'The quick brown fox jumps over the lazy dog. This sentence is short and plain.\n\nThis second paragraph is rather longer, and its vocabulary is considerably more elaborate, which demonstrates how the readability estimate responds to sentence length and syllable count.',
      },
    },
    { label: 'Emoji', values: { input: '👋🏽 🇬🇧 café' } },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input) return { outputs: [] };

    const c = count(input);
    const time = readingTime(c.words, { readingWordsPerMinute: num(values, 'readingSpeed', 238) });
    const outputs: OutputBlock[] = [];

    outputs.push({
      kind: 'keyvalue',
      label: 'Counts',
      pairs: [
        ['Words', String(c.words)],
        ['Unique words', String(c.uniqueWords)],
        ['Sentences', String(c.sentences)],
        ['Paragraphs', String(c.paragraphs)],
        ['Lines', `${c.lines} (${c.nonEmptyLines} not empty)`],
        ['Characters with spaces', String(c.characters)],
        ['Characters without spaces', String(c.charactersNoSpaces)],
      ],
    });

    outputs.push({
      kind: 'table',
      label: 'The four ways to count characters',
      table: {
        headers: ['Measure', 'Count', 'Who uses it'],
        rows: [
          ['Visible characters', c.graphemes, 'What a reader sees. A flag or skin-toned emoji counts as one.'],
          ['Unicode code points', c.codePoints, 'Python len(), Go rune count, Rust chars().count()'],
          ['UTF-16 code units', c.codeUnits, 'JavaScript .length, Java, C#, most database varchar limits'],
          ['UTF-8 bytes', c.utf8Bytes, 'Storage size, HTTP Content-Length, Postgres byte limits'],
        ],
      },
    });

    if (c.graphemes !== c.codeUnits) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value:
          'These numbers differ because your text contains characters outside the basic range. Which one a length limit means is worth checking before you trust it.',
      });
    }

    outputs.push({
      kind: 'keyvalue',
      label: 'Time',
      pairs: [
        ['Reading', time.readingLabel],
        ['Speaking aloud', time.speakingLabel],
      ],
    });

    const scores = readability(input);
    if (scores) {
      outputs.push({
        kind: 'keyvalue',
        label: 'Readability (estimate)',
        pairs: [
          ['Flesch Reading Ease', `${scores.fleschReadingEase} — ${scores.interpretation}`],
          ['Flesch-Kincaid grade', String(scores.fleschKincaidGrade)],
          ['Average words per sentence', String(scores.averageWordsPerSentence)],
          ['Average syllables per word', String(scores.averageSyllablesPerWord)],
        ],
      });
      outputs.push({
        kind: 'note',
        tone: 'info',
        value:
          'These scores depend on counting syllables, which cannot be done exactly without a pronunciation dictionary. Treat them as a rough direction, not a measurement, and only for English.',
      });
    }

    const frequency = wordFrequency(input, {
      excludeStopWords: bool(values, 'excludeStopWords'),
      minLength: num(values, 'minLength', 1),
      limit: 30,
    });
    if (frequency.length > 0) {
      outputs.push({
        kind: 'table',
        label: 'Most frequent words',
        table: {
          headers: ['Word', 'Count', 'Share'],
          rows: frequency.map((f) => [f.value, f.count, `${(f.share * 100).toFixed(1)}%`]),
          mono: [0],
        },
      });
    }

    if (bool(values, 'showCharacters')) {
      const chars = characterFrequency(input, 30);
      if (chars.length > 0) {
        outputs.push({
          kind: 'table',
          label: 'Most frequent characters',
          table: {
            headers: ['Character', 'Count', 'Share'],
            rows: chars.map((f) => [f.value, f.count, `${(f.share * 100).toFixed(1)}%`]),
            mono: [0],
          },
        });
      }
    }

    outputs.push({
      kind: 'table',
      label: 'Against common limits',
      table: {
        headers: ['Limit', 'Allowed', 'Used', 'Remaining'],
        rows: LIMITS.map((l) => {
          const used = l.unit === 'graphemes' ? c.graphemes : c.characters;
          return [l.name, l.limit, used, used > l.limit ? `over by ${used - l.limit}` : String(l.limit - used)];
        }),
      },
    });

    return { outputs };
  },
});

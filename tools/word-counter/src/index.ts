import meta from './meta.json';

export { meta };

export interface Counts {
  characters: number;
  charactersNoSpaces: number;
  /** UTF-16 code units, which is what most length checks actually measure. */
  codeUnits: number;
  /** Unicode code points, which is what a person would call characters. */
  codePoints: number;
  /** User-perceived characters, so a flag or a skin-toned emoji counts as one. */
  graphemes: number;
  utf8Bytes: number;
  words: number;
  uniqueWords: number;
  sentences: number;
  paragraphs: number;
  lines: number;
  nonEmptyLines: number;
}

export interface ReadingTime {
  readingSeconds: number;
  speakingSeconds: number;
  readingLabel: string;
  speakingLabel: string;
}

export interface Frequency {
  value: string;
  count: number;
  /** Share of the total, 0 to 1. */
  share: number;
}

export interface Readability {
  /** Flesch Reading Ease. Higher is easier; 60 to 70 is plain English. */
  fleschReadingEase: number;
  /** Flesch-Kincaid grade level, in US school years. */
  fleschKincaidGrade: number;
  averageWordsPerSentence: number;
  averageSyllablesPerWord: number;
  interpretation: string;
}

// Intl.Segmenter is in every current browser and in Node 16 and later. Where it
// is missing, fall back to code points, which over-counts emoji sequences.
const graphemeSegmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

export function countGraphemes(text: string): number {
  if (!graphemeSegmenter) return Array.from(text).length;
  let n = 0;
  for (const _ of graphemeSegmenter.segment(text)) n++;
  return n;
}

/**
 * Splits into words.
 *
 * A word is a run of letters, digits, apostrophes and hyphens. This keeps
 * "don't" and "well-known" as single words, which is what a person counting
 * would do, and it works for any script that has letters.
 */
export function words(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
}

/**
 * Abbreviations that end in a full stop without ending a sentence.
 *
 * The Unicode segmentation rules do not carry a suppression list, and neither
 * does Intl.Segmenter, so "Dr. Smith arrived." would otherwise count as two
 * sentences. This short list covers what turns up in ordinary prose. It is a
 * heuristic and it is not exhaustive.
 */
const ABBREVIATIONS = new Set([
  'dr',
  'mr',
  'mrs',
  'ms',
  'prof',
  'sr',
  'jr',
  'st',
  'mt',
  'rev',
  'hon',
  'gen',
  'col',
  'capt',
  'lt',
  'vs',
  'etc',
  'inc',
  'ltd',
  'co',
  'corp',
  'dept',
  'est',
  'fig',
  'no',
  'vol',
  'pp',
  'ed',
  'eds',
  'approx',
  'min',
  'max',
  'al',
  'ca',
  'cf',
  'ibid',
]);

/**
 * Splits into sentences.
 *
 * Uses Intl.Segmenter where available, because it correctly declines to split
 * on a decimal point, then merges back any break that followed a known
 * abbreviation. The fallback is a regular expression that gets decimals wrong.
 */
export function sentences(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed === '') return [];

  const raw =
    typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? [...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(trimmed)].map((s) => s.segment)
      : trimmed.split(/(?<=[.!?。！？])(\s+)/);

  const merged: string[] = [];
  for (const segment of raw) {
    const previous = merged[merged.length - 1];
    const endsInAbbreviation =
      previous !== undefined && ABBREVIATIONS.has((/([\p{L}]+)\.\s*$/u.exec(previous)?.[1] ?? '').toLowerCase());
    // A single initial, as in "J. R. R. Tolkien", is also not a sentence end.
    const endsInInitial = previous !== undefined && /(?:^|\s)\p{Lu}\.\s*$/u.test(previous);

    if (previous !== undefined && (endsInAbbreviation || endsInInitial)) {
      merged[merged.length - 1] = previous + segment;
    } else {
      merged.push(segment);
    }
  }

  return merged.map((s) => s.trim()).filter((s) => s !== '');
}

export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== '');
}

export function count(text: string): Counts {
  const wordList = words(text);
  const lines = text === '' ? [] : text.split('\n');

  return {
    characters: text.length,
    charactersNoSpaces: text.replace(/\s/g, '').length,
    codeUnits: text.length,
    codePoints: Array.from(text).length,
    graphemes: countGraphemes(text),
    utf8Bytes: new TextEncoder().encode(text).length,
    words: wordList.length,
    uniqueWords: new Set(wordList.map((w) => w.toLowerCase())).size,
    sentences: sentences(text).length,
    paragraphs: paragraphs(text).length,
    lines: lines.length,
    nonEmptyLines: lines.filter((l) => l.trim() !== '').length,
  };
}

function label(seconds: number): string {
  if (seconds < 1) return 'under a second';
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} sec`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr ${minutes % 60} min`;
}

export interface TimeOptions {
  /** Silent reading speed. 238 is the mean for adults reading prose in English. */
  readingWordsPerMinute?: number;
  /** Speaking speed. 150 is a common presentation pace. */
  speakingWordsPerMinute?: number;
}

export function readingTime(wordCount: number, options: TimeOptions = {}): ReadingTime {
  const { readingWordsPerMinute = 238, speakingWordsPerMinute = 150 } = options;
  const readingSeconds = (wordCount / readingWordsPerMinute) * 60;
  const speakingSeconds = (wordCount / speakingWordsPerMinute) * 60;
  return {
    readingSeconds,
    speakingSeconds,
    readingLabel: label(readingSeconds),
    speakingLabel: label(speakingSeconds),
  };
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'but',
  'by',
  'for',
  'from',
  'had',
  'has',
  'have',
  'he',
  'her',
  'his',
  'i',
  'in',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'she',
  'that',
  'the',
  'their',
  'them',
  'there',
  'they',
  'this',
  'to',
  'was',
  'were',
  'will',
  'with',
  'you',
  'your',
]);

export interface FrequencyOptions {
  ignoreCase?: boolean;
  excludeStopWords?: boolean;
  minLength?: number;
  limit?: number;
}

export function wordFrequency(text: string, options: FrequencyOptions = {}): Frequency[] {
  const { ignoreCase = true, excludeStopWords = false, minLength = 1, limit = 100 } = options;
  const list = words(text)
    .map((w) => (ignoreCase ? w.toLowerCase() : w))
    .filter((w) => w.length >= minLength)
    .filter((w) => !excludeStopWords || !STOP_WORDS.has(w.toLowerCase()));

  const counts = new Map<string, number>();
  for (const w of list) counts.set(w, (counts.get(w) ?? 0) + 1);

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, n]) => ({ value, count: n, share: list.length === 0 ? 0 : n / list.length }));
}

export function characterFrequency(text: string, limit = 50): Frequency[] {
  const counts = new Map<string, number>();
  let total = 0;
  for (const ch of text) {
    if (/\s/.test(ch)) continue;
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
    total++;
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, n]) => ({ value, count: n, share: total === 0 ? 0 : n / total }));
}

/**
 * Counts syllables in an English word, by heuristic.
 *
 * There is no exact algorithm without a pronunciation dictionary. This is the
 * usual vowel-group approach, which is right about 85% of the time on ordinary
 * prose and wrong on names and loanwords. The readability scores that depend on
 * it inherit that error, which is why they are labelled as estimates.
 */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length === 0) return 0;
  if (w.length <= 3) return 1;

  const working = w.replace(/(?:[^laeiouy]es|[^laeiouy]e)$/, '').replace(/^y/, '');
  // A run of vowels is one syllable, however long: "eau" in beautiful is one,
  // not two. Matching pairs instead is the usual bug in this heuristic.
  const groups = working.match(/[aeiouy]+/g);
  return Math.max(1, groups?.length ?? 1);
}

export function readability(text: string): Readability | null {
  const wordList = words(text);
  const sentenceList = sentences(text);
  if (wordList.length < 3 || sentenceList.length === 0) return null;

  const totalSyllables = wordList.reduce((n, w) => n + syllables(w), 0);
  const wordsPerSentence = wordList.length / sentenceList.length;
  const syllablesPerWord = totalSyllables / wordList.length;

  const ease = 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord;
  const grade = 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59;

  const interpretation =
    ease >= 90
      ? 'Very easy. Roughly a 5th grade reading level.'
      : ease >= 80
        ? 'Easy. Roughly a 6th grade reading level.'
        : ease >= 70
          ? 'Fairly easy. Roughly a 7th grade reading level.'
          : ease >= 60
            ? 'Plain English. Roughly an 8th to 9th grade reading level.'
            : ease >= 50
              ? 'Fairly difficult. Roughly a 10th to 12th grade reading level.'
              : ease >= 30
                ? 'Difficult. Roughly university level.'
                : 'Very difficult. Roughly graduate level.';

  return {
    fleschReadingEase: Math.round(ease * 10) / 10,
    fleschKincaidGrade: Math.round(grade * 10) / 10,
    averageWordsPerSentence: Math.round(wordsPerSentence * 10) / 10,
    averageSyllablesPerWord: Math.round(syllablesPerWord * 100) / 100,
    interpretation,
  };
}

/** Limits that people actually write against, so the counter can show headroom. */
export const LIMITS: { name: string; limit: number; unit: 'characters' | 'graphemes' }[] = [
  { name: 'Bluesky post', limit: 300, unit: 'graphemes' },
  { name: 'SMS, single message (GSM-7)', limit: 160, unit: 'characters' },
  { name: 'Meta description', limit: 160, unit: 'characters' },
  { name: 'Page title', limit: 60, unit: 'characters' },
  { name: 'Git commit subject line', limit: 72, unit: 'characters' },
  { name: 'Open Graph description', limit: 200, unit: 'characters' },
  { name: 'Postgres varchar(255)', limit: 255, unit: 'characters' },
];

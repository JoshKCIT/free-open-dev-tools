import meta from './meta.json';

export { meta };

/**
 * Characters that do not decompose under Unicode normalisation and therefore
 * need an explicit mapping. Stripping combining marks handles é and ü; it does
 * nothing for ß, ø, đ or ł, which are distinct letters rather than a base plus
 * an accent.
 */
const TRANSLITERATIONS: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  Æ: 'AE',
  œ: 'oe',
  Œ: 'OE',
  ø: 'o',
  Ø: 'O',
  đ: 'd',
  Đ: 'D',
  ð: 'd',
  Ð: 'D',
  þ: 'th',
  Þ: 'TH',
  ł: 'l',
  Ł: 'L',
  ı: 'i',
  İ: 'I',
  ŋ: 'n',
  Ŋ: 'N',
  ħ: 'h',
  Ħ: 'H',
  ĸ: 'k',
  ŧ: 't',
  Ŧ: 'T',
  '&': ' and ',
  '@': ' at ',
  '€': ' euro ',
  '£': ' pound ',
  $: ' dollar ',
  '%': ' percent ',
  '+': ' plus ',
  '©': ' c ',
  '®': ' r ',
  '°': ' deg ',
  '№': ' no ',
};

export type NonLatinPolicy =
  /** Drop anything that is not ASCII after transliteration. Safest for URLs. */
  | 'strip'
  /** Keep it. Modern browsers and servers handle it; older systems may not. */
  | 'keep';

export interface SlugOptions {
  separator?: string;
  lowercase?: boolean;
  /** What to do with scripts that have no Latin equivalent, such as Cyrillic. */
  nonLatin?: NonLatinPolicy;
  /** Truncate to this many characters, never cutting a word in half. */
  maxLength?: number;
  /** Words to drop entirely, such as articles. */
  stopWords?: string[];
  /** Keep these characters as-is rather than replacing them. */
  allowed?: string;
  /** Replace & with "and", % with "percent" and so on before stripping. */
  expandSymbols?: boolean;
}

export interface SlugResult {
  slug: string;
  /** True when the result is pure ASCII, and so safe in any URL. */
  ascii: boolean;
  /** Set when characters were dropped because they had no Latin equivalent. */
  droppedCharacters: string[];
  truncated: boolean;
  length: number;
}

function transliterate(text: string, expandSymbols: boolean): string {
  let out = '';
  for (const ch of text) {
    const mapped = TRANSLITERATIONS[ch];
    if (mapped !== undefined) {
      // Symbol expansions are opt-in; letter replacements always apply.
      const isSymbol = !/\p{L}/u.test(ch);
      out += isSymbol && !expandSymbols ? ' ' : mapped;
      continue;
    }
    out += ch;
  }
  return out;
}

export function slugify(text: string, options: SlugOptions = {}): SlugResult {
  const {
    separator = '-',
    lowercase = true,
    nonLatin = 'strip',
    maxLength = 0,
    stopWords = [],
    allowed = '',
    expandSymbols = true,
  } = options;

  let working = transliterate(text, expandSymbols);

  // Decompose, then remove the combining marks. This turns é into e and ü into
  // u without needing a mapping for every accented letter.
  working = working.normalize('NFKD').replace(/\p{M}+/gu, '');

  const droppedCharacters: string[] = [];
  if (nonLatin === 'strip') {
    let stripped = '';
    for (const ch of working) {
      const keep = /[A-Za-z0-9]/.test(ch) || /\s/.test(ch) || allowed.includes(ch) || ch === separator;
      if (keep) {
        stripped += ch;
      } else {
        stripped += ' ';
        if (/\p{L}|\p{N}/u.test(ch) && !droppedCharacters.includes(ch)) droppedCharacters.push(ch);
      }
    }
    working = stripped;
  } else {
    // Keep letters and numbers from any script; replace everything else.
    working = [...working]
      .map((ch) => (/\p{L}|\p{N}/u.test(ch) || /\s/.test(ch) || allowed.includes(ch) ? ch : ' '))
      .join('');
  }

  if (lowercase) working = working.toLowerCase();

  let parts = working.split(/[\s_-]+/).filter((p) => p !== '');

  if (stopWords.length > 0) {
    const stop = new Set(stopWords.map((w) => w.toLowerCase()));
    const filtered = parts.filter((p) => !stop.has(p.toLowerCase()));
    // Never return an empty slug just because every word was a stop word.
    if (filtered.length > 0) parts = filtered;
  }

  let slug = parts.join(separator);
  let truncated = false;

  if (maxLength > 0 && slug.length > maxLength) {
    truncated = true;
    const cut = slug.slice(0, maxLength);
    const lastSeparator = separator === '' ? -1 : cut.lastIndexOf(separator);
    slug = lastSeparator > 0 ? cut.slice(0, lastSeparator) : cut;
  }

  return {
    slug,
    ascii: /^[\x20-\x7e]*$/.test(slug),
    droppedCharacters,
    truncated,
    length: slug.length,
  };
}

/** Appends a number to make a slug unique against a list already in use. */
export function uniqueSlug(base: string, taken: Iterable<string>, separator = '-'): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; n < 10000; n++) {
    const candidate = `${base}${separator}${n}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error('Could not find a free slug after 10000 attempts.');
}

export const PRESETS: Record<string, SlugOptions> = {
  url: { separator: '-', lowercase: true, nonLatin: 'strip', expandSymbols: true },
  filename: { separator: '-', lowercase: true, nonLatin: 'strip', maxLength: 100, expandSymbols: false },
  branch: { separator: '-', lowercase: true, nonLatin: 'strip', maxLength: 60, expandSymbols: false },
  anchor: { separator: '-', lowercase: true, nonLatin: 'keep', expandSymbols: false },
  snake: { separator: '_', lowercase: true, nonLatin: 'strip', expandSymbols: true },
};

/** The common English stop words, for a tidier slug. */
export const DEFAULT_STOP_WORDS = [
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'of',
  'in',
  'on',
  'at',
  'to',
  'for',
  'with',
  'is',
  'are',
];

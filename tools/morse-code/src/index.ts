import meta from './meta.json';

export { meta };

/**
 * The full code table, transcribed from ITU-R M.1677-1 (International Morse
 * code), Annex 1. Every character this tool supports, canonical or alias,
 * has its own entry here — an alias (the multiplication sign) simply shares
 * its code with the canonical character it stands in for (the letter X).
 *
 * Alphabetic signals (Annex 1, Table 1, letters A-Z).
 * Numeral signals (Annex 1, Table 1, digits 0-9).
 * Punctuation marks and miscellaneous signs (Annex 1, Table 1), including
 * the at sign added in the 2009-10 revision of the recommendation.
 */
// Written as an array of [character, code] tuples rather than an object
// literal, so every character stays a quoted string literal in the source
// (prettier strips unnecessary quotes from identifier-like object keys,
// which would silently remove the letters' own quote marks).
const MORSE_ENTRIES: [string, string][] = [
  ['A', '.-'],
  ['B', '-...'],
  ['C', '-.-.'],
  ['D', '-..'],
  ['E', '.'],
  ['F', '..-.'],
  ['G', '--.'],
  ['H', '....'],
  ['I', '..'],
  ['J', '.---'],
  ['K', '-.-'],
  ['L', '.-..'],
  ['M', '--'],
  ['N', '-.'],
  ['O', '---'],
  ['P', '.--.'],
  ['Q', '--.-'],
  ['R', '.-.'],
  ['S', '...'],
  ['T', '-'],
  ['U', '..-'],
  ['V', '...-'],
  ['W', '.--'],
  ['X', '-..-'],
  ['Y', '-.--'],
  ['Z', '--..'],
  ['0', '-----'],
  ['1', '.----'],
  ['2', '..---'],
  ['3', '...--'],
  ['4', '....-'],
  ['5', '.....'],
  ['6', '-....'],
  ['7', '--...'],
  ['8', '---..'],
  ['9', '----.'],
  ['.', '.-.-.-'],
  [',', '--..--'],
  [':', '---...'],
  ['?', '..--..'],
  ["'", '.----.'],
  ['-', '-....-'],
  ['/', '-..-.'],
  ['(', '-.--.'],
  [')', '-.--.-'],
  ['"', '.-..-.'],
  ['=', '-...-'],
  ['+', '.-.-.'],
  ['@', '.--.-.'],
  // Alias: shares dash-dot-dot-dash with the letter X (see MORSE_ALIASES).
  ['×', '-..-'],
];

export const MORSE: Record<string, string> = Object.fromEntries(MORSE_ENTRIES);

/**
 * Non-canonical characters that share a code with a canonical one. The
 * published recommendation gives dash-dot-dot-dash to both the letter X and
 * the multiplication sign; there is no way to tell them apart from the code
 * alone, so decoding always returns the key named here: the canonical
 * character.
 */
export const MORSE_ALIASES: Record<string, string> = {
  '×': 'X',
};

/**
 * Procedural signals (prosigns): several letters sent with no gap between
 * them, which plain text cannot express on its own. This tool's notation
 * writes a prosign as its letters run together inside angle brackets, for
 * example `<AS>` for the wait signal. Each entry here is the concatenated
 * code with no letter gap inside it, derived from `MORSE` so it can never
 * drift from the letter table.
 *
 * `K`, the invitation-to-transmit signal, is deliberately included even
 * though it is a single letter: its code is identical to the letter K's own
 * code, which is exactly the collision `limits` documents — decoding it
 * returns the letter K and loses its brackets (rule 1 of the decoding
 * precedence beats rule 2).
 */
export const PROSIGNS: Record<string, string> = {
  AS: MORSE['A']! + MORSE['S']!, // wait
  SK: MORSE['S']! + MORSE['K']!, // end of work
  KA: MORSE['K']! + MORSE['A']!, // starting signal / attention (also written CT)
  K: MORSE['K']!, // invitation to transmit — collides with the letter K
};

/** Reverse lookup, built from MORSE minus the alias keys so exactly one canonical character owns each code. */
const REVERSE: Map<string, string> = new Map(
  Object.entries(MORSE)
    .filter(([ch]) => !(ch in MORSE_ALIASES))
    .map(([ch, code]) => [code, ch]),
);

/** Reverse lookup for prosigns: code -> prosign name. */
const PROSIGN_REVERSE: Map<string, string> = new Map(Object.entries(PROSIGNS).map(([name, code]) => [code, name]));

export class MorseError extends Error {
  /** Index into the input where the problem was found, when known. */
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'MorseError';
    this.position = position;
  }
}

export type UnsupportedPolicy = 'reject' | 'drop' | 'replace';

export interface ToMorseOptions {
  /** Separates letter codes within a word. Default a single space. */
  letterSeparator?: string;
  /** Separates word groups. Default a slash, because that is what people paste. */
  wordSeparator?: string;
  /** What to do with a character that has no code. Default 'reject'. */
  unsupportedPolicy?: UnsupportedPolicy;
  /** Code group substituted when unsupportedPolicy is 'replace'. Default the code for '?'. */
  replacement?: string;
}

export interface FromMorseOptions {
  /** The word separator to split on, in addition to a run of three or more spaces. Default a slash. */
  wordSeparator?: string;
}

type Unit = { kind: 'prosign'; name: string; index: number } | { kind: 'char'; ch: string; index: number };

/** Splits a word into character units and bracketed prosign units, tracking each unit's start index. */
function tokenizeWord(word: string, wordStart: number): Unit[] {
  const units: Unit[] = [];
  let i = 0;
  while (i < word.length) {
    if (word[i] === '<') {
      const end = word.indexOf('>', i);
      if (end === -1) {
        units.push({ kind: 'char', ch: word[i]!, index: wordStart + i });
        i++;
      } else {
        units.push({ kind: 'prosign', name: word.slice(i + 1, end), index: wordStart + i });
        i = end + 1;
      }
    } else {
      units.push({ kind: 'char', ch: word[i]!, index: wordStart + i });
      i++;
    }
  }
  return units;
}

/** Splits input text into non-whitespace words, each carrying its start index in the original string. */
function splitWords(text: string): { word: string; start: number }[] {
  const words: { word: string; start: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    words.push({ word: m[0], start: m.index });
  }
  return words;
}

/**
 * Converts text to Morse code. Case is not preserved because the code has no
 * case; every character is looked up upper-cased first.
 */
export function toMorse(text: string, options: ToMorseOptions = {}): string {
  const {
    letterSeparator = ' ',
    wordSeparator = '/',
    unsupportedPolicy = 'reject',
    replacement = MORSE['?']!,
  } = options;

  const wordGroups: string[] = [];
  for (const { word, start } of splitWords(text)) {
    const units = tokenizeWord(word, start);
    const codes: string[] = [];
    for (const unit of units) {
      if (unit.kind === 'prosign') {
        const name = unit.name.toUpperCase();
        const code = PROSIGNS[name];
        if (code === undefined) {
          throw new MorseError(`Unknown prosign "<${unit.name}>".`, unit.index);
        }
        codes.push(code);
        continue;
      }
      const raw = unit.ch;
      const upper = raw.toUpperCase();
      const code = MORSE[raw] ?? MORSE[upper];
      if (code !== undefined) {
        codes.push(code);
        continue;
      }
      if (unsupportedPolicy === 'drop') continue;
      if (unsupportedPolicy === 'replace') {
        codes.push(replacement);
        continue;
      }
      throw new MorseError(`"${raw}" has no Morse code.`, unit.index);
    }
    if (codes.length > 0) wordGroups.push(codes.join(letterSeparator));
  }
  return wordGroups.join(wordSeparator);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Converts Morse code back to text. Follows one precedence rule per
 * run-together token: (1) the code of a single canonical character wins,
 * (2) otherwise an enumerated prosign's code decodes to its bracketed form,
 * (3) otherwise the token is rejected — never split into guessed letters.
 */
export function fromMorse(code: string, options: FromMorseOptions = {}): string {
  const { wordSeparator = '/' } = options;

  const splitPattern = new RegExp(`\\s*${escapeRegExp(wordSeparator)}\\s*|\\s{3,}`);
  const words = code.split(splitPattern).filter((w) => w.trim() !== '');

  let cursor = 0;
  const decodedWords: string[] = [];
  for (const word of words) {
    const wordIndexInInput = code.indexOf(word, cursor);
    cursor = wordIndexInInput + word.length;

    const tokens = word.trim().split(/\s+/).filter(Boolean);
    let decoded = '';
    let tokenCursor = 0;
    for (const token of tokens) {
      const tokenIndex = word.indexOf(token, tokenCursor);
      tokenCursor = tokenIndex + token.length;
      const absoluteIndex = wordIndexInInput + tokenIndex;

      const canonical = REVERSE.get(token);
      if (canonical !== undefined) {
        decoded += canonical;
        continue;
      }
      const prosignName = PROSIGN_REVERSE.get(token);
      if (prosignName !== undefined) {
        decoded += `<${prosignName}>`;
        continue;
      }
      throw new MorseError(`"${token}" is not a known Morse code sequence.`, absoluteIndex);
    }
    decodedWords.push(decoded);
  }
  return decodedWords.join(' ');
}

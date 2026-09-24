import meta from './meta.json';

export { meta };

// Written as an array of [character, word] tuples rather than an object
// literal, so every character stays a quoted string literal in the source
// (prettier strips unnecessary quotes from identifier-like object keys).
//
// Letters: the standard ICAO spelling alphabet (Alpha through Zulu).
// Digits: the ICAO aviation pronunciation words, which differ from the
// ordinary English words for four of the ten digits (3, 4, 5 and 9).
const PHONETIC_ENTRIES: [string, string][] = [
  ['A', 'Alpha'],
  ['B', 'Bravo'],
  ['C', 'Charlie'],
  ['D', 'Delta'],
  ['E', 'Echo'],
  ['F', 'Foxtrot'],
  ['G', 'Golf'],
  ['H', 'Hotel'],
  ['I', 'India'],
  ['J', 'Juliett'],
  ['K', 'Kilo'],
  ['L', 'Lima'],
  ['M', 'Mike'],
  ['N', 'November'],
  ['O', 'Oscar'],
  ['P', 'Papa'],
  ['Q', 'Quebec'],
  ['R', 'Romeo'],
  ['S', 'Sierra'],
  ['T', 'Tango'],
  ['U', 'Uniform'],
  ['V', 'Victor'],
  ['W', 'Whiskey'],
  ['X', 'X-ray'],
  ['Y', 'Yankee'],
  ['Z', 'Zulu'],
  ['0', 'Zero'],
  ['1', 'One'],
  ['2', 'Two'],
  ['3', 'Tree'], // aviation pronunciation, not "Three"
  ['4', 'Fower'], // aviation pronunciation, not "Four"
  ['5', 'Fife'], // aviation pronunciation, not "Five"
  ['6', 'Six'],
  ['7', 'Seven'],
  ['8', 'Eight'],
  ['9', 'Niner'], // aviation pronunciation, not "Nine"
];

export const PHONETIC: Record<string, string> = Object.fromEntries(PHONETIC_ENTRIES);

/** Reverse lookup, derived from PHONETIC rather than written out a second time. Keys are lower-cased for case-insensitive matching. */
const REVERSE: Map<string, string> = new Map(Object.entries(PHONETIC).map(([ch, word]) => [word.toLowerCase(), ch]));

export class NatoPhoneticError extends Error {
  /** Index into the input where the problem was found, when known. */
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'NatoPhoneticError';
    this.position = position;
  }
}

export type UnsupportedPolicy = 'reject' | 'drop' | 'replace';

export interface ToPhoneticOptions {
  /** Separates spelling words within one source word. Default a single space. */
  separator?: string;
  /** Separates the spelled-out groups for different source words. Default a slash. */
  wordSeparator?: string;
  /** What to do with a character that has no word. Default 'reject'. */
  unsupportedPolicy?: UnsupportedPolicy;
  /** Word substituted when unsupportedPolicy is 'replace'. Default the word for '0'. */
  replacement?: string;
}

export interface FromPhoneticOptions {
  /** The word-group separator to split on. Default a slash. */
  wordSeparator?: string;
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

/** Converts text to its spelled-out phonetic-alphabet words. */
export function toPhonetic(text: string, options: ToPhoneticOptions = {}): string {
  const { separator = ' ', wordSeparator = '/', unsupportedPolicy = 'reject', replacement = PHONETIC['0']! } = options;

  const groups: string[] = [];
  for (const { word, start } of splitWords(text)) {
    const spelled: string[] = [];
    for (let i = 0; i < word.length; i++) {
      const raw = word[i]!;
      const upper = raw.toUpperCase();
      const spelling = PHONETIC[raw] ?? PHONETIC[upper];
      if (spelling !== undefined) {
        spelled.push(spelling);
        continue;
      }
      if (unsupportedPolicy === 'drop') continue;
      if (unsupportedPolicy === 'replace') {
        spelled.push(replacement);
        continue;
      }
      throw new NatoPhoneticError(`"${raw}" has no phonetic-alphabet word.`, start + i);
    }
    if (spelled.length > 0) groups.push(spelled.join(separator));
  }
  return groups.join(wordSeparator);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Reads a spelled-out message back into text. Case-insensitive; tolerant of any run of whitespace between words. */
export function fromPhonetic(words: string, options: FromPhoneticOptions = {}): string {
  const { wordSeparator = '/' } = options;

  const splitPattern = new RegExp(`\\s*${escapeRegExp(wordSeparator)}\\s*`);
  const groups = words.split(splitPattern).filter((g) => g.trim() !== '');

  let cursor = 0;
  const decodedGroups: string[] = [];
  for (const group of groups) {
    const groupIndexInInput = words.indexOf(group, cursor);
    cursor = groupIndexInInput + group.length;

    const tokens = group.trim().split(/\s+/).filter(Boolean);
    let decoded = '';
    let tokenCursor = 0;
    for (const token of tokens) {
      const tokenIndex = group.indexOf(token, tokenCursor);
      tokenCursor = tokenIndex + token.length;
      const absoluteIndex = groupIndexInInput + tokenIndex;

      const ch = REVERSE.get(token.toLowerCase());
      if (ch === undefined) {
        throw new NatoPhoneticError(`"${token}" is not a phonetic-alphabet word.`, absoluteIndex);
      }
      decoded += ch;
    }
    decodedGroups.push(decoded);
  }
  return decodedGroups.join(' ');
}

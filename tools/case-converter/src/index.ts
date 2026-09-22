import meta from './meta.json';

export { meta };

export type CaseName =
  | 'camel'
  | 'pascal'
  | 'snake'
  | 'constant'
  | 'kebab'
  | 'cobol'
  | 'train'
  | 'dot'
  | 'path'
  | 'space'
  | 'title'
  | 'titleAp'
  | 'sentence'
  | 'lower'
  | 'upper'
  | 'alternating'
  | 'inverse';

export interface SplitOptions {
  /**
   * Treat a run of digits as its own word. Off by default, so `utf8` stays one
   * word and `v2Model` still splits at the capital M.
   */
  splitOnNumbers?: boolean;
  /**
   * Locale used for case mapping. Matters for Turkish, where uppercasing `i`
   * gives `İ` rather than `I`.
   */
  locale?: string;
}

/**
 * Breaks an identifier or phrase into words.
 *
 * The interesting cases are acronyms. `XMLHttpRequest` splits to
 * `XML | Http | Request`, because the boundary is at the last capital of a run
 * that is followed by a lowercase letter.
 */
export function splitWords(input: string, options: SplitOptions = {}): string[] {
  const { splitOnNumbers = false } = options;
  if (!input) return [];

  const words: string[] = [];
  let current = '';

  const isUpper = (ch: string) => ch !== ch.toLowerCase() && ch === ch.toUpperCase();
  const isLower = (ch: string) => ch !== ch.toUpperCase() && ch === ch.toLowerCase();
  const isDigit = (ch: string) => ch >= '0' && ch <= '9';
  const isLetterOrDigit = (ch: string) => isUpper(ch) || isLower(ch) || isDigit(ch) || /\p{L}|\p{N}/u.test(ch);

  const push = () => {
    if (current) words.push(current);
    current = '';
  };

  const chars = Array.from(input);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    const next = chars[i + 1];

    if (!isLetterOrDigit(ch)) {
      // Any separator character ends the current word.
      push();
      continue;
    }

    if (current) {
      const prev = current[current.length - 1]!;
      // lower or digit followed by upper: fooBar, v2Model
      if (isUpper(ch) && !isUpper(prev)) {
        push();
      }
      // upper followed by upper then lower: XMLHttp -> XML | Http
      else if (isUpper(ch) && isUpper(prev) && next !== undefined && isLower(next)) {
        push();
      } else if (splitOnNumbers && isDigit(ch) !== isDigit(prev)) {
        push();
      }
    }
    current += ch;
  }
  push();
  return words;
}

const SMALL_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'but',
  'by',
  'en',
  'for',
  'if',
  'in',
  'nor',
  'of',
  'on',
  'or',
  'per',
  'the',
  'to',
  'v',
  'via',
  'vs',
]);

function upper(s: string, locale?: string): string {
  return locale ? s.toLocaleUpperCase(locale) : s.toUpperCase();
}
function lower(s: string, locale?: string): string {
  return locale ? s.toLocaleLowerCase(locale) : s.toLowerCase();
}
function capitalise(s: string, locale?: string): string {
  if (!s) return s;
  const first = Array.from(s)[0]!;
  return upper(first, locale) + lower(s.slice(first.length), locale);
}

export function convert(input: string, target: CaseName, options: SplitOptions = {}): string {
  const { locale } = options;
  const words = splitWords(input, options);

  switch (target) {
    case 'camel':
      return words.map((w, i) => (i === 0 ? lower(w, locale) : capitalise(w, locale))).join('');
    case 'pascal':
      return words.map((w) => capitalise(w, locale)).join('');
    case 'snake':
      return words.map((w) => lower(w, locale)).join('_');
    case 'constant':
      return words.map((w) => upper(w, locale)).join('_');
    case 'kebab':
      return words.map((w) => lower(w, locale)).join('-');
    case 'cobol':
      return words.map((w) => upper(w, locale)).join('-');
    case 'train':
      return words.map((w) => capitalise(w, locale)).join('-');
    case 'dot':
      return words.map((w) => lower(w, locale)).join('.');
    case 'path':
      return words.map((w) => lower(w, locale)).join('/');
    case 'space':
      return words.map((w) => lower(w, locale)).join(' ');
    case 'title':
      return words.map((w) => capitalise(w, locale)).join(' ');
    case 'titleAp':
      // Chicago and AP both keep short conjunctions, articles and prepositions
      // lowercase unless they open or close the title.
      return words
        .map((w, i) => {
          const l = lower(w, locale);
          const isEdge = i === 0 || i === words.length - 1;
          return !isEdge && SMALL_WORDS.has(l) ? l : capitalise(w, locale);
        })
        .join(' ');
    case 'sentence': {
      const joined = words.map((w) => lower(w, locale)).join(' ');
      return capitalise(joined, locale);
    }
    case 'lower':
      return lower(input, locale);
    case 'upper':
      return upper(input, locale);
    case 'alternating':
      return Array.from(input)
        .map((ch, i) => (i % 2 === 0 ? lower(ch, locale) : upper(ch, locale)))
        .join('');
    case 'inverse':
      return Array.from(input)
        .map((ch) => (ch === upper(ch, locale) ? lower(ch, locale) : upper(ch, locale)))
        .join('');
    default: {
      const exhaustive: never = target;
      throw new Error(`Unknown case: ${String(exhaustive)}`);
    }
  }
}

export interface CaseDescriptor {
  id: CaseName;
  label: string;
  example: string;
}

export const CASES: CaseDescriptor[] = [
  { id: 'camel', label: 'camelCase', example: 'userFirstName' },
  { id: 'pascal', label: 'PascalCase', example: 'UserFirstName' },
  { id: 'snake', label: 'snake_case', example: 'user_first_name' },
  { id: 'constant', label: 'CONSTANT_CASE', example: 'USER_FIRST_NAME' },
  { id: 'kebab', label: 'kebab-case', example: 'user-first-name' },
  { id: 'cobol', label: 'COBOL-CASE', example: 'USER-FIRST-NAME' },
  { id: 'train', label: 'Train-Case', example: 'User-First-Name' },
  { id: 'dot', label: 'dot.case', example: 'user.first.name' },
  { id: 'path', label: 'path/case', example: 'user/first/name' },
  { id: 'space', label: 'lower case words', example: 'user first name' },
  { id: 'title', label: 'Title Case', example: 'User First Name' },
  { id: 'titleAp', label: 'Title Case (small words lowercase)', example: 'The Name of the Wind' },
  { id: 'sentence', label: 'Sentence case', example: 'User first name' },
  { id: 'lower', label: 'lowercase (unchanged words)', example: 'user first name' },
  { id: 'upper', label: 'UPPERCASE (unchanged words)', example: 'USER FIRST NAME' },
  { id: 'alternating', label: 'aLtErNaTiNg', example: 'uSeR FiRsT NaMe' },
  { id: 'inverse', label: 'iNVERSE OF INPUT', example: 'uSER fIRST nAME' },
];

/** Converts every line independently, which is what you want for a pasted list. */
export function convertLines(input: string, target: CaseName, options: SplitOptions = {}): string {
  return input
    .split('\n')
    .map((line) => (line.trim() === '' ? line : convert(line, target, options)))
    .join('\n');
}

/** Runs every case at once so they can be compared side by side. */
export function convertAll(
  input: string,
  options: SplitOptions = {},
): { id: CaseName; label: string; output: string }[] {
  return CASES.map((c) => ({ id: c.id, label: c.label, output: convert(input, c.id, options) }));
}

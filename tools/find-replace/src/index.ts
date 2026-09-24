import meta from './meta.json';

export { meta };

export class FindReplaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FindReplaceError';
  }
}

export interface FindReplaceOptions {
  /** Default true. */
  caseSensitive?: boolean;
  /** Default false. */
  wholeWord?: boolean;
  /** Default false. */
  multiline?: boolean;
}

export interface FindReplaceResult {
  output: string;
  count: number;
}

/** Escapes every regular-expression metacharacter, so the find text is matched as literal characters. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const LINE_BREAK = /\r\n|\r|\n/;

/**
 * A Unicode letter, mark, number or connector punctuation counts as part of
 * a word for the whole-word boundary. Everything else -- including a hyphen
 * -- is a boundary. Declared as a template literal so the class contents
 * stay readable next to the surrounding pattern string.
 */
const WORD_CLASS = String.raw`\p{L}\p{M}\p{N}\p{Pc}`;

/**
 * Finds `find` in `input` and replaces every occurrence with `replacement`,
 * treating both as literal text: `find` is never read as a regular
 * expression, and `replacement` never expands a dollar-sign sequence.
 */
export function findReplace(
  input: string,
  find: string,
  replacement: string,
  options: FindReplaceOptions = {},
): FindReplaceResult {
  const caseSensitive = options.caseSensitive ?? true;
  const wholeWord = options.wholeWord ?? false;
  const multiline = options.multiline ?? false;

  if (find === '') return { output: input, count: 0 };

  if (!multiline && LINE_BREAK.test(find)) {
    throw new FindReplaceError('The text to find contains a line break. Turn on multiline to match across lines.');
  }

  // With multiline on, CRLF in both the input and the find text is
  // normalised to a single line feed before matching, so a CRLF input still
  // matches an LF-written find text (and vice versa); the output uses LF.
  const effectiveInput = multiline ? input.replace(/\r\n|\r/g, '\n') : input;
  const effectiveFind = multiline ? find.replace(/\r\n|\r/g, '\n') : find;

  let pattern = escapeRegExp(effectiveFind);
  if (wholeWord) {
    pattern = `(?<![${WORD_CLASS}])${pattern}(?![${WORD_CLASS}])`;
  }

  const flags = 'gu' + (caseSensitive ? '' : 'i');
  const re = new RegExp(pattern, flags);

  let count = 0;
  // A replacer FUNCTION, not a string pattern: only a string second argument
  // to String.replace interprets $&, $1 and friends. Returning `replacement`
  // from a function inserts it byte for byte, exactly as typed.
  const output = effectiveInput.replace(re, () => {
    count++;
    return replacement;
  });

  return { output, count };
}

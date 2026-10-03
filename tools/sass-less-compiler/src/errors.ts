import { cutWithEllipsis, head, positionAt, visible } from './text';

/** Why a stylesheet was not compiled: the compiler found a mistake, an import was refused, or a limit was reached. */
export type StylesheetErrorKind = 'syntax' | 'import' | 'limit';

export class StylesheetError extends Error {
  readonly kind: StylesheetErrorKind;
  /** The line of the problem, counted from 1 as a reader counts, when the compiler gave a position. */
  readonly line?: number;
  /** The column of the problem, counted from 1 in characters, when the compiler gave a position. */
  readonly column?: number;

  constructor(message: string, kind: StylesheetErrorKind, line?: number, column?: number) {
    super(message);
    this.name = 'StylesheetError';
    this.kind = kind;
    if (line !== undefined) this.line = line;
    if (column !== undefined) this.column = column;
  }
}

/** The sentence every refusal of an import starts with. */
export const IMPORT_REFUSED_MESSAGE = 'Imports of other files and addresses are not supported here';

/** An engine's own message is cut to this many characters. */
export const MAX_ENGINE_MESSAGE_CHARS = 160;

/** At most this many characters of an import's target are shown. */
export const MAX_TARGET_CHARS = 40;

/**
 * The refusal of one import. `target` is what the import named, shown cut to 40 characters and escaped. With
 * `inOutput`, the position is in the compiled CSS, not in the source, and the message says so.
 */
export function importRefusedError(options: {
  line?: number;
  column?: number;
  inOutput?: boolean;
  target?: string;
}): StylesheetError {
  const { line, column, inOutput, target } = options;
  let message = IMPORT_REFUSED_MESSAGE;
  if (line !== undefined && column !== undefined) {
    message += ` (line ${line}, column ${column}${inOutput ? ' of the compiled CSS' : ''}).`;
  } else {
    message += '.';
  }
  if (target !== undefined && target !== '') {
    const cut = target.length > MAX_TARGET_CHARS ? head(target, MAX_TARGET_CHARS) + '...' : target;
    message += ` Target: ${visible(cut)}`;
  }
  return new StylesheetError(message, 'import', line, column);
}

/**
 * Words an engine's own messages use. They may be shown even when the stylesheet happens to contain them too; any
 * other long word of a message that also stands in the stylesheet is left out (see `describeEngineMessage`).
 */
const MESSAGE_WORDS: ReadonlySet<string> = new Set([
  'argument',
  'arguments',
  'cannot',
  'color',
  'declaration',
  'defined',
  'division',
  'evaluating',
  'evaluated',
  'expected',
  'expecting',
  'function',
  'incompatible',
  'input',
  'invalid',
  'keyframes',
  'missing',
  'mixin',
  'number',
  'opening',
  'closing',
  'operation',
  'parameter',
  'possibly',
  'property',
  'recursion',
  'selector',
  'something',
  'stylesheet',
  'undefined',
  'unrecognised',
  'unexpected',
  'unknown',
  'variable',
  'which',
]);

function isWordUnit(unit: number): boolean {
  return (
    (unit >= 0x61 && unit <= 0x7a) ||
    (unit >= 0x41 && unit <= 0x5a) ||
    (unit >= 0x30 && unit <= 0x39) ||
    unit === 0x5f ||
    unit === 0x2d ||
    unit >= 0x80
  );
}

function isLetterUnit(unit: number): boolean {
  return (unit >= 0x61 && unit <= 0x7a) || (unit >= 0x41 && unit <= 0x5a) || unit === 0x5f || unit === 0x2d;
}

/** Step 1: the text of every quoted span is replaced by `...`, except a short span of punctuation such as `{`. */
function hideQuoted(message: string): string {
  let out = '';
  let i = 0;
  while (i < message.length) {
    const char = message.charAt(i);
    const quote = char === '"' || char === '`' || (char === "'" && (i === 0 || !isWordUnit(message.charCodeAt(i - 1))));
    if (!quote) {
      out += char;
      i++;
      continue;
    }
    const close = message.indexOf(char, i + 1);
    if (close < 0) {
      out += char + '...';
      break;
    }
    const inside = message.slice(i + 1, close);
    let punctuation = inside.length <= 3;
    for (let j = 0; punctuation && j < inside.length; j++) {
      if (isWordUnit(inside.charCodeAt(j))) punctuation = false;
    }
    out += char + (punctuation ? inside : '...') + char;
    i = close + 1;
  }
  return out;
}

/**
 * Step 2: a variable, mixin, class or id name (an at sign, dollar sign, dot or number sign followed by a name) is
 * replaced by its sign and `...`. A dot or number sign counts only at the start of a word, so the end of a sentence
 * does not.
 */
function hideSigilNames(message: string): string {
  let out = '';
  let i = 0;
  while (i < message.length) {
    const unit = message.charCodeAt(i);
    const sign = unit === 0x40 || unit === 0x24;
    const wordSign = unit === 0x2e || unit === 0x23;
    const startsWord = i === 0 || !isWordUnit(message.charCodeAt(i - 1));
    if ((sign || (wordSign && startsWord)) && isLetterUnit(message.charCodeAt(i + 1))) {
      let j = i + 1;
      while (j < message.length && isWordUnit(message.charCodeAt(j))) j++;
      out += message.charAt(i) + '...';
      i = j;
      continue;
    }
    out += message.charAt(i);
    i++;
  }
  return out;
}

/** Step 3: a long word that stands in the stylesheet and is not one the engines use is replaced by `...`. */
function hideEchoedWords(message: string, source: string): string {
  let out = '';
  let i = 0;
  while (i < message.length) {
    if (!isWordUnit(message.charCodeAt(i))) {
      out += message.charAt(i);
      i++;
      continue;
    }
    let j = i;
    while (j < message.length && isWordUnit(message.charCodeAt(j))) j++;
    const word = message.slice(i, j);
    out += word.length >= 6 && !MESSAGE_WORDS.has(word.toLowerCase()) && source.includes(word) ? '...' : word;
    i = j;
  }
  return out;
}

/**
 * The part of a compiler's message that is safe to show: its first line, with whatever it quotes from the stylesheet
 * (quoted text, variable and mixin names, long words that stand in the source) replaced by `...`, cut to 160
 * characters. Messages describe the problem and a position; they never carry pasted text back.
 */
export function describeEngineMessage(message: string | undefined, source: string, fallback: string): string {
  const firstLine = (message ?? '').split('\n', 1)[0]!.trim();
  if (firstLine === '') return fallback;
  const hidden = hideEchoedWords(hideSigilNames(hideQuoted(firstLine)), source);
  return cutWithEllipsis(visible(hidden), MAX_ENGINE_MESSAGE_CHARS);
}

/** A mistake the compiler found: its short message, then the position in parentheses when there is one. */
export function syntaxError(
  text: string,
  source: string,
  offset: number | undefined,
  fallback: { line?: number; column?: number },
): StylesheetError {
  let line: number | undefined;
  let column: number | undefined;
  if (offset !== undefined && Number.isFinite(offset)) {
    ({ line, column } = positionAt(source, offset));
  } else if (fallback.line !== undefined && fallback.column !== undefined) {
    line = fallback.line;
    column = fallback.column;
  }
  let body = text.trimEnd();
  // One closing full stop or colon goes, so the position can follow; an ellipsis stays whole.
  if ((body.endsWith('.') && !body.endsWith('..')) || body.endsWith(':')) body = body.slice(0, -1).trimEnd();
  const message = line !== undefined && column !== undefined ? `${body} (line ${line}, column ${column}).` : `${body}.`;
  return new StylesheetError(message, 'syntax', line, column);
}

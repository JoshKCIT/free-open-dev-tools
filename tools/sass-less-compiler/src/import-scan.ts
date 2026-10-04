import { positionAt } from './text';

/**
 * Finding an at-rule in stylesheet text without being fooled by comments and strings. One pass over the text with
 * `indexOf` for comments and a plain loop everywhere else: no regular expression runs over the text, so hostile input
 * (thousands of unterminated comments or strings, one name half a megabyte long) costs time proportional to its
 * length and no more.
 *
 * Compiled CSS is where plain `@import` rules show up that neither compiler asks anything about, and this scan is how
 * they are found. It follows the CSS syntax rules that matter here: a comment runs to its closing mark, a string runs
 * to its closing quote or, when it has none, to the end of its line (a "bad string"), a backslash escapes the next
 * character, and an at-keyword may be written with escapes, so `@\69mport` is the same at-rule as `@import`.
 */

const NAME_LOOKAHEAD = 8;

/** Where an at-rule was found. */
export interface AtRuleMatch {
  /** UTF-16 offset of the at sign. */
  offset: number;
  /** UTF-16 offset just after the at-rule's name. */
  end: number;
  line: number;
  column: number;
}

function isNameUnit(unit: number): boolean {
  return (
    (unit >= 0x61 && unit <= 0x7a) ||
    (unit >= 0x41 && unit <= 0x5a) ||
    (unit >= 0x30 && unit <= 0x39) ||
    unit === 0x5f ||
    unit === 0x2d ||
    unit >= 0x80
  );
}

function isHexUnit(unit: number): boolean {
  return (unit >= 0x30 && unit <= 0x39) || (unit >= 0x61 && unit <= 0x66) || (unit >= 0x41 && unit <= 0x46);
}

function isLineBreak(unit: number): boolean {
  return unit === 10 || unit === 13 || unit === 12;
}

/** The character a CSS escape stands for and where the escape ends, or null when the backslash does not escape. */
function readEscape(text: string, at: number): { char: string; end: number } | null {
  if (at + 1 >= text.length) return null;
  const next = text.charCodeAt(at + 1);
  if (isLineBreak(next)) return null;
  if (!isHexUnit(next)) return { char: text.charAt(at + 1), end: at + 2 };
  let value = 0;
  let i = at + 1;
  let digits = 0;
  while (i < text.length && digits < 6 && isHexUnit(text.charCodeAt(i))) {
    value = value * 16 + parseInt(text.charAt(i), 16);
    i++;
    digits++;
  }
  // One white space after a hexadecimal escape belongs to the escape.
  const after = text.charCodeAt(i);
  if (after === 13 && text.charCodeAt(i + 1) === 10) i += 2;
  else if (after === 32 || after === 9 || isLineBreak(after)) i += 1;
  const valid = value !== 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff);
  return { char: valid ? String.fromCodePoint(value) : '�', end: i };
}

/**
 * The at-keyword that starts at `start` (just after the at sign), lower-cased and with escapes decoded, and the offset
 * where it ends. Only the first few characters are kept, because the callers compare with short names; a longer name
 * can never be equal to one of them.
 */
function readName(text: string, start: number): { name: string; end: number } {
  let name = '';
  let i = start;
  while (i < text.length) {
    const unit = text.charCodeAt(i);
    if (isNameUnit(unit)) {
      if (name.length <= NAME_LOOKAHEAD) name += text.charAt(i).toLowerCase();
      i++;
      continue;
    }
    if (unit === 92) {
      const escaped = readEscape(text, i);
      if (escaped === null) break;
      if (name.length <= NAME_LOOKAHEAD) name += escaped.char.toLowerCase();
      i = escaped.end;
      continue;
    }
    break;
  }
  return { name, end: i };
}

/** The offset just after the string that starts at `start` with the given quote. */
function skipString(text: string, start: number, quote: number): number {
  let i = start + 1;
  while (i < text.length) {
    const unit = text.charCodeAt(i);
    if (unit === 92) {
      i += 2;
      continue;
    }
    if (unit === quote) return i + 1;
    // A string with no closing quote ends at its line; the line break is not part of it.
    if (isLineBreak(unit)) return i;
    i++;
  }
  return text.length;
}

/** True when `url(` starts at `at`, is not the end of a longer name, and is followed (past white space) by something that is not a quote. */
function startsUnquotedUrl(text: string, at: number): boolean {
  if (text.slice(at, at + 4).toLowerCase() !== 'url(') return false;
  if (at > 0 && (isNameUnit(text.charCodeAt(at - 1)) || text.charCodeAt(at - 1) === 92)) return false;
  let i = at + 4;
  while (i < text.length && (text.charCodeAt(i) === 32 || text.charCodeAt(i) === 9 || isLineBreak(text.charCodeAt(i))))
    i++;
  const next = text.charCodeAt(i);
  return i < text.length && next !== 34 && next !== 39;
}

/** The offset of the bracket that closes an unquoted url token whose contents start at `from`, or -1 when there is none. */
function urlTokenEnd(text: string, from: number): number {
  let i = from;
  while (i < text.length) {
    const unit = text.charCodeAt(i);
    if (unit === 92) {
      i += 2;
      continue;
    }
    if (unit === 41) return i;
    i++;
  }
  return -1;
}

/**
 * The first at-rule outside comments and strings whose name is one of `names` (lower case). With `lineComments`, a
 * double slash starts a comment that runs to the end of its line, as it does in the Less and SCSS source languages;
 * compiled CSS has no such comments.
 */
export function scanAtRule(text: string, names: readonly string[], lineComments: boolean): AtRuleMatch | null {
  const length = text.length;
  let i = 0;
  // Set once a url token had no closing bracket to the end of the text: no later one is looked for (each would read to the
  // end again, and many of them would make the scan quadratic), so what follows is scanned as ordinary text.
  let urlsUnclosed = false;
  while (i < length) {
    const unit = text.charCodeAt(i);
    if (unit === 47) {
      const next = text.charCodeAt(i + 1);
      if (next === 42) {
        const close = text.indexOf('*/', i + 2);
        if (close < 0) return null;
        i = close + 2;
        continue;
      }
      if (lineComments && next === 47) {
        const lineEnd = text.indexOf('\n', i + 2);
        if (lineEnd < 0) return null;
        i = lineEnd + 1;
        continue;
      }
      i++;
      continue;
    }
    if (unit === 34 || unit === 39) {
      i = skipString(text, i, unit);
      continue;
    }
    if (!urlsUnclosed && (unit === 117 || unit === 85) && startsUnquotedUrl(text, i)) {
      // An unquoted url token runs to its closing bracket, so what is inside it is not an at-rule.
      const close = urlTokenEnd(text, i + 4);
      if (close >= 0) {
        i = close + 1;
        continue;
      }
      urlsUnclosed = true;
    }
    if (unit === 64) {
      const read = readName(text, i + 1);
      if (names.includes(read.name)) {
        const position = positionAt(text, i);
        return { offset: i, end: read.end, line: position.line, column: position.column };
      }
      i = Math.max(read.end, i + 1);
      continue;
    }
    i++;
  }
  return null;
}

/** The first `@import` rule in compiled CSS, outside comments and strings, in any letter case, with its position. */
export function scanCssImport(css: string): AtRuleMatch | null {
  return scanAtRule(css, ['import'], false);
}

/** The line and column, from 1, of the first `@import` rule in compiled CSS, or null when there is none. */
export function findCssImport(css: string): { line: number; column: number } | null {
  const found = scanCssImport(css);
  return found === null ? null : { line: found.line, column: found.column };
}

/**
 * What an at-rule that ends at `end` names: the text up to the end of the statement, trimmed, from at most the next
 * 400 characters. The caller cuts and escapes it before showing any of it.
 */
export function statementAfter(text: string, end: number): string {
  const slice = text.slice(end, end + 400);
  let cut = slice.length;
  for (let i = 0; i < slice.length; i++) {
    const unit = slice.charCodeAt(i);
    if (unit === 59 || unit === 10 || unit === 13 || unit === 123 || unit === 125) {
      cut = i;
      break;
    }
  }
  return slice.slice(0, cut).trim();
}

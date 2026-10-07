import { MAX_COMMENT_DEPTH } from './limits';

/** A comment found in a header value: where its replacement space sits in the stripped text, and what it said. */
export interface FoundComment {
  at: number;
  text: string;
}

/** A header value with its comments taken out. */
export interface StrippedComments {
  /** The value with each outermost comment replaced by one space (RFC 5322 treats a comment as white space). */
  text: string;
  /** The first comments found (at most 20), outermost only, without the parentheses, each cut at 200 characters. */
  comments: FoundComment[];
  /** True when a comment nested deeper than 50 levels stopped the reading: `text` ends where that comment began. */
  tooDeep: boolean;
  /** True when a comment was never closed: `text` ends where it began. */
  unclosed: boolean;
}

const MAX_KEPT_COMMENTS = 20;
const MAX_KEPT_COMMENT_CHARACTERS = 200;

const BACKSLASH = 92;
const QUOTE = 34;
const OPEN = 40;
const CLOSE = 41;

/**
 * Takes the comments out of a structured header value (RFC 5322 section 3.2.2): a comment is text in parentheses that may
 * hold other comments and quoted pairs (a backslash and the character after it). Parentheses inside a quoted string are not
 * a comment. One pass with a depth counter and no recursion, so a value of 100,000 opening parentheses costs one pass; a
 * comment nested deeper than 50 levels stops the reading there.
 */
export function stripComments(input: string, honourQuotes = true): StrippedComments {
  const comments: FoundComment[] = [];
  let out = '';
  let copyFrom = 0;
  let depth = 0;
  let commentStart = 0;
  let inQuote = false;
  let tooDeep = false;
  const n = input.length;
  let i = 0;
  while (i < n) {
    const c = input.charCodeAt(i);
    if (depth > 0) {
      if (c === BACKSLASH) {
        i += 2;
        continue;
      }
      if (c === OPEN) {
        depth++;
        if (depth > MAX_COMMENT_DEPTH) {
          tooDeep = true;
          break;
        }
      } else if (c === CLOSE) {
        depth--;
        if (depth === 0) {
          out += ' ';
          if (comments.length < MAX_KEPT_COMMENTS) {
            comments.push({
              at: out.length - 1,
              text: input.slice(commentStart + 1, Math.min(i, commentStart + 1 + MAX_KEPT_COMMENT_CHARACTERS)),
            });
          }
          copyFrom = i + 1;
        }
      }
      i++;
      continue;
    }
    if (inQuote) {
      if (c === BACKSLASH) {
        i += 2;
        continue;
      }
      if (c === QUOTE) inQuote = false;
      i++;
      continue;
    }
    if (c === BACKSLASH) {
      // A quoted pair outside a comment and a quoted string (obsolete syntax): the next character is plain text.
      i += 2;
      continue;
    }
    if (c === QUOTE && honourQuotes) {
      inQuote = true;
      i++;
      continue;
    }
    if (c === OPEN) {
      out += input.slice(copyFrom, i);
      depth = 1;
      commentStart = i;
    }
    i++;
  }
  if (depth === 0) out += input.slice(copyFrom);
  return { text: out, comments, tooDeep, unclosed: depth > 0 && !tooDeep };
}

/** The note a caller shows when a comment stopped the reading of a header, or an empty string when none did. */
export function commentNote(stripped: StrippedComments, what: string): string {
  if (stripped.tooDeep)
    return `A comment in ${what} is nested more than 50 levels deep, so the rest of it was not read.`;
  if (stripped.unclosed) return `A comment in ${what} is never closed, so the rest of it was not read.`;
  return '';
}

import { commentNote, stripComments } from './comments';
import { MAX_AUTH_RESULTS } from './limits';

/** One property of a result: `ptype.property=value`, for example `header.d=example.com`. */
export interface AuthProperty {
  ptype: string;
  property: string;
  value: string;
}

/** One result: a method, what the server said about it, an optional reason and its properties. */
export interface AuthResult {
  method: string;
  /** The version after the method's slash, or an empty string. */
  methodVersion: string;
  result: string;
  reason: string;
  properties: AuthProperty[];
}

/** An Authentication-Results header field as the server that wrote it said it. Nothing in it is checked. */
export interface AuthResultsHeader {
  /** The authserv-id: the name of the server that wrote the field. */
  serverId: string;
  /** The version after the server name, or an empty string. */
  version: string;
  /** True when the field says `none`: no authentication was done. */
  noResult: boolean;
  results: AuthResult[];
  notes: string[];
}

function isWhiteCode(code: number): boolean {
  return code === 32 || code === 9 || code === 13 || code === 10;
}

/** Splits at every `sep` outside a quoted string. */
function splitOutsideQuotes(text: string, sep: string): string[] {
  const parts: string[] = [];
  let from = 0;
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 92 && inQuote) {
      i++;
    } else if (code === 34) {
      inQuote = !inQuote;
    } else if (!inQuote && text[i] === sep) {
      parts.push(text.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(text.slice(from));
  return parts;
}

/** Splits at white space outside a quoted string; a quoted string stays inside its word. */
function wordsOf(text: string): string[] {
  const words: string[] = [];
  let from = -1;
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (inQuote) {
      if (code === 92) i++;
      else if (code === 34) inQuote = false;
      continue;
    }
    if (isWhiteCode(code)) {
      if (from >= 0) {
        words.push(text.slice(from, i));
        from = -1;
      }
      continue;
    }
    if (from < 0) from = i;
    if (code === 34) inQuote = true;
  }
  if (from >= 0) words.push(text.slice(from));
  return words;
}

/** A value in quotes loses them and its quoted pairs; anything else is returned as it is. */
function unquote(value: string): string {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) return value;
  let out = '';
  for (let i = 1; i < value.length - 1; i++) {
    if (value.charCodeAt(i) === 92 && i + 1 < value.length - 1) i++;
    out += value[i] ?? '';
  }
  return out;
}

interface Assignment {
  left: string;
  right: string;
  next: number;
}

/**
 * Reads `left = right` from the words starting at `from`. White space is allowed around the equals sign, around a slash and
 * around a dot (RFC 8601 section 2.2), so the left side may be several words: `dkim / 1 =` or `policy . expired =`. A word
 * joins the left side only when it starts with a dot, a slash or an equals sign, or the word before it ends with a dot or a
 * slash. The right side is what follows the first equals sign of the word that has one, so a value that holds equals signs
 * (a truncated signature) stays whole. Returns null when no equals sign is found.
 */
function readAssignment(words: readonly string[], from: number): Assignment | null {
  let left = '';
  for (let j = from; j < words.length && j < from + 4; j++) {
    const word = words[j] ?? '';
    if (j > from && !(/^[./=]/.test(word) || left.endsWith('.') || left.endsWith('/'))) return null;
    const equals = word.indexOf('=');
    if (equals < 0) {
      left += word;
      continue;
    }
    left += word.slice(0, equals);
    let right = word.slice(equals + 1);
    let next = j + 1;
    if (right === '' && next < words.length) {
      right = words[next] ?? '';
      next++;
    }
    return { left, right: unquote(right), next };
  }
  return null;
}

/**
 * Reads an Authentication-Results header field value as RFC 8601 section 2.2 defines it: the server name and an optional
 * version, then either `none` or one or more results, each a method, an equals sign and a result, then an optional
 * `reason=` and `ptype.property=value` terms. Comments (including nested ones, and the comment-heavy example of Appendix
 * B.7) are taken out by an iterative scanner first. Everything it returns is what the server wrote: nothing is checked, and
 * any server can write any of it.
 */
export function parseAuthenticationResults(value: string): AuthResultsHeader {
  const stripped = stripComments(value);
  const notes: string[] = [];
  const cut = commentNote(stripped, 'this header');
  if (cut !== '') notes.push(cut);

  const segments = splitOutsideQuotes(stripped.text, ';');
  const head = wordsOf(segments[0] ?? '');
  const serverId = unquote(head[0] ?? '');
  const versionWord = head[1];
  const version = versionWord !== undefined && /^[0-9]+$/.test(versionWord) ? versionWord : '';
  if (head.length > (version === '' ? 1 : 2)) notes.push('Text after the server name and version was not read.');

  const results: AuthResult[] = [];
  let noResult = false;
  let unreadable = false;
  let tooMany = false;

  for (let s = 1; s < segments.length; s++) {
    const words = wordsOf(segments[s] ?? '');
    if (words.length === 0) continue;
    if (s === 1 && words.length === 1 && words[0]?.toLowerCase() === 'none') {
      noResult = true;
      continue;
    }
    if (results.length >= MAX_AUTH_RESULTS) {
      tooMany = true;
      break;
    }
    const first = readAssignment(words, 0);
    if (first === null || first.left === '') {
      unreadable = true;
      continue;
    }
    const slash = first.left.indexOf('/');
    const result: AuthResult = {
      method: slash < 0 ? first.left : first.left.slice(0, slash),
      methodVersion: slash < 0 ? '' : first.left.slice(slash + 1),
      result: first.right,
      reason: '',
      properties: [],
    };
    let at = first.next;
    while (at < words.length) {
      const item = readAssignment(words, at);
      if (item === null) {
        unreadable = true;
        at++;
        continue;
      }
      at = item.next;
      if (item.left.toLowerCase() === 'reason') {
        result.reason = item.right;
        continue;
      }
      const dot = item.left.indexOf('.');
      if (dot < 0) {
        unreadable = true;
        continue;
      }
      result.properties.push({ ptype: item.left.slice(0, dot), property: item.left.slice(dot + 1), value: item.right });
    }
    results.push(result);
  }

  if (!noResult && results.length === 0 && segments.length < 2) {
    notes.push('This header names a server and lists no results.');
  }
  if (unreadable) notes.push('Part of this header could not be read as a result or a property.');
  if (tooMany) notes.push(`This header has more than ${MAX_AUTH_RESULTS} results, so the rest were not read.`);
  return { serverId, version, noResult, results, notes };
}

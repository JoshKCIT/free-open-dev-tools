import { commentNote, stripComments } from './comments';
import { MAX_ADDRESSES } from './limits';

/** One mailbox read from an address header. */
export interface Mailbox {
  /** The display name, with its quotes taken off. Encoded words are not decoded here. */
  name: string;
  /** The address as written, without angle brackets, comments, white space or an obsolete route. */
  address: string;
  /** The group this mailbox was listed in, or an empty string. */
  group: string;
}

/** The mailboxes and groups of one address header. */
export interface AddressList {
  mailboxes: Mailbox[];
  groups: string[];
  notes: string[];
}

const BACKSLASH = 92;
const QUOTE = 34;
const COMMA = 44;
const COLON = 58;
const SEMICOLON = 59;
const LESS = 60;
const GREATER = 62;

function isWhiteCode(code: number): boolean {
  return code === 32 || code === 9 || code === 13 || code === 10;
}

/** An obsolete route (`@a.example,@b.example:`) in front of an address is dropped; the first colon outside brackets ends it. */
function withoutRoute(angle: string): string {
  if (!angle.startsWith('@')) return angle;
  let inBrackets = false;
  for (let i = 0; i < angle.length; i++) {
    const ch = angle[i];
    if (ch === '[') inBrackets = true;
    else if (ch === ']') inBrackets = false;
    else if (ch === ':' && !inBrackets) return angle.slice(i + 1);
  }
  return angle;
}

/**
 * White space around a dot or an at sign in a bare address is closed up (RFC 5322 section 4.4, obsolete syntax); any other
 * run of spaces is one space. The text is copied in pieces between the spaces, never one character at a time.
 */
function closeUp(text: string): string {
  const parts: string[] = [];
  const n = text.length;
  let from = 0;
  let last = '';
  let i = 0;
  while (i < n) {
    if (text.charCodeAt(i) !== 32) {
      i++;
      continue;
    }
    if (i > from) {
      parts.push(text.slice(from, i));
      last = text[i - 1] ?? '';
    }
    let j = i;
    while (j < n && text.charCodeAt(j) === 32) j++;
    const after = text[j];
    if (!(last === '.' || last === '@' || after === '.' || after === '@')) {
      parts.push(' ');
      last = ' ';
    }
    from = j;
    i = j;
  }
  if (from < n) parts.push(text.slice(from));
  return parts.join('');
}

/**
 * Reads an address list (RFC 5322 section 3.4): mailboxes with or without a display name, a name in a quoted string, an
 * address in angle brackets, groups (`Name: a@x.example, b@y.example;`, empty ones too), comments anywhere white space may
 * go, and the obsolete forms of Appendix A.6.1 (a route in an address, an empty element, spaces around the dot). One pass
 * with no recursion: a comment nested deeper than 50 levels stops the reading of the header with a note, and at most 500
 * mailboxes are read. Text is gathered in runs with `slice`, never one character at a time, so a header of one long run
 * costs one copy.
 */
export function parseAddressList(value: string): AddressList {
  const stripped = stripComments(value);
  const notes: string[] = [];
  const cut = commentNote(stripped, 'an address header');
  if (cut !== '') notes.push(cut);

  const text = stripped.text;
  const mailboxes: Mailbox[] = [];
  const groups: string[] = [];
  let phrase = '';
  // Whether `phrase` ends with a space, kept here so the string itself is never read while it is being built (reading the end
  // of a string made of many appended pieces copies the whole of it each time, which made a long header cost quadratic time).
  let phraseEndsSpace = false;
  let angle: string | null = null;
  let angleClosed = false;
  let group = '';
  let inGroup = false;
  let overflow = false;

  const flush = (): void => {
    const name = phrase.trim();
    if (angle !== null || name !== '') {
      if (mailboxes.length >= MAX_ADDRESSES) {
        overflow = true;
      } else if (angle !== null) {
        mailboxes.push({ name, address: withoutRoute(angle), group });
      } else {
        mailboxes.push({ name: '', address: closeUp(name), group });
      }
    }
    phrase = '';
    phraseEndsSpace = false;
    angle = null;
    angleClosed = false;
  };

  const n = text.length;
  let i = 0;
  while (i < n && !overflow) {
    const code = text.charCodeAt(i);
    if (code === QUOTE) {
      // A quoted string: the characters between the quotes, a quoted pair giving the character after its backslash.
      let content = '';
      i++;
      let from = i;
      while (i < n && text.charCodeAt(i) !== QUOTE) {
        if (text.charCodeAt(i) === BACKSLASH && i + 1 < n) {
          content += text.slice(from, i);
          i++;
          from = i;
        }
        i++;
      }
      content += text.slice(from, i);
      i++;
      if (angleClosed) continue;
      if (angle !== null) angle += `"${content}"`;
      else if (content !== '') {
        phrase += content;
        phraseEndsSpace = content.charCodeAt(content.length - 1) === 32;
      }
      continue;
    }

    if (angle !== null && !angleClosed) {
      // Inside the angle brackets: white space is dropped and everything else up to the closing bracket is the address.
      if (code === GREATER) {
        angleClosed = true;
        i++;
      } else if (isWhiteCode(code)) {
        i++;
      } else {
        let j = i + 1;
        while (j < n) {
          const c = text.charCodeAt(j);
          if (c === GREATER || c === QUOTE || isWhiteCode(c)) break;
          j++;
        }
        angle += text.slice(i, j);
        i = j;
      }
      continue;
    }

    if (code === COMMA) {
      flush();
      i++;
    } else if (code === SEMICOLON && inGroup) {
      flush();
      inGroup = false;
      group = '';
      i++;
    } else if (code === COLON && !inGroup && angle === null) {
      if (groups.length >= MAX_ADDRESSES) overflow = true;
      group = phrase.trim();
      groups.push(group);
      phrase = '';
      phraseEndsSpace = false;
      inGroup = true;
      i++;
    } else if (code === LESS && angle === null) {
      angle = '';
      i++;
    } else if (isWhiteCode(code)) {
      if (!angleClosed && !phraseEndsSpace) {
        phrase += ' ';
        phraseEndsSpace = true;
      }
      i++;
    } else {
      // An ordinary run: up to the next quote, comma, bracket, white space or the separator that applies in this state.
      let j = i + 1;
      while (j < n) {
        const c = text.charCodeAt(j);
        if (
          c === QUOTE ||
          c === COMMA ||
          c === LESS ||
          isWhiteCode(c) ||
          (c === SEMICOLON && inGroup) ||
          (c === COLON && !inGroup && angle === null)
        ) {
          break;
        }
        j++;
      }
      // Anything between the closing bracket and the next separator is not part of the mailbox.
      if (!angleClosed) {
        phrase += text.slice(i, j);
        phraseEndsSpace = false;
      }
      i = j;
    }
  }
  if (!overflow) flush();
  if (overflow) notes.push(`The header lists more than ${MAX_ADDRESSES} addresses, so the rest were not read.`);
  return { mailboxes, groups, notes };
}

/** The part after the last at sign, in lower case, or an empty string when the address has none. */
export function addressDomain(address: string): string {
  const at = address.lastIndexOf('@');
  return at < 0
    ? ''
    : address
        .slice(at + 1)
        .trim()
        .toLowerCase();
}

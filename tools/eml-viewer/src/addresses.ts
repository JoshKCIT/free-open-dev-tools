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

function isWhite(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n';
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

/** White space around a dot or an at sign in a bare address is closed up (RFC 5322 section 4.4, obsolete syntax). */
function closeUp(text: string): string {
  let out = '';
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i] ?? '';
    if (ch === ' ') {
      // A run of spaces is one decision: dropped next to a dot or an at sign, otherwise one space.
      let j = i;
      while (j < n && text[j] === ' ') j++;
      const before = out[out.length - 1];
      const after = text[j];
      if (!(before === '.' || before === '@' || after === '.' || after === '@')) out += ' ';
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Reads an address list (RFC 5322 section 3.4): mailboxes with or without a display name, a name in a quoted string, an
 * address in angle brackets, groups (`Name: a@x.example, b@y.example;`, empty ones too), comments anywhere white space may
 * go, and the obsolete forms of Appendix A.6.1 (a route in an address, an empty element, spaces around the dot). One pass
 * with no recursion: a comment nested deeper than 50 levels stops the reading of the header with a note, and at most 500
 * mailboxes are read.
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
    angle = null;
    angleClosed = false;
  };

  const n = text.length;
  let i = 0;
  while (i < n && !overflow) {
    const code = text.charCodeAt(i);
    if (code === QUOTE) {
      let content = '';
      i++;
      while (i < n && text.charCodeAt(i) !== QUOTE) {
        if (text.charCodeAt(i) === BACKSLASH && i + 1 < n) i++;
        content += text[i] ?? '';
        i++;
      }
      i++;
      if (angleClosed) continue;
      if (angle !== null) angle += `"${content}"`;
      else phrase += content;
      continue;
    }
    const ch = text[i] ?? '';
    if (angle !== null && !angleClosed) {
      if (ch === '>') angleClosed = true;
      else if (!isWhite(ch)) angle += ch;
      i++;
      continue;
    }
    if (ch === ',') {
      flush();
    } else if (ch === ';' && inGroup) {
      flush();
      inGroup = false;
      group = '';
    } else if (ch === ':' && !inGroup && angle === null) {
      if (groups.length >= MAX_ADDRESSES) overflow = true;
      group = phrase.trim();
      groups.push(group);
      phrase = '';
      inGroup = true;
    } else if (ch === '<' && angle === null) {
      angle = '';
    } else if (angleClosed) {
      // Anything between the closing bracket and the next separator is not part of the mailbox.
    } else if (isWhite(ch)) {
      if (!phrase.endsWith(' ')) phrase += ' ';
    } else {
      phrase += ch;
    }
    i++;
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

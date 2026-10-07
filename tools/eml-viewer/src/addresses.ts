/** One mailbox read from an address header. */
export interface Mailbox {
  /** The display name, with its quotes taken off. Encoded words are not decoded here. */
  name: string;
  /** The address as written, without angle brackets. */
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

/**
 * Reads an address list (RFC 5322 section 3.4): mailboxes with or without a display name, a name in a quoted string, and
 * addresses in angle brackets, separated by commas. One pass over the text.
 */
export function parseAddressList(value: string): AddressList {
  const mailboxes: Mailbox[] = [];
  let phrase = '';
  let angle: string | null = null;

  const flush = (): void => {
    const name = phrase.trim();
    if (angle !== null) mailboxes.push({ name, address: angle, group: '' });
    else if (name !== '') mailboxes.push({ name: '', address: name, group: '' });
    phrase = '';
    angle = null;
  };

  const n = value.length;
  let i = 0;
  while (i < n) {
    const code = value.charCodeAt(i);
    if (code === QUOTE) {
      let content = '';
      i++;
      while (i < n && value.charCodeAt(i) !== QUOTE) {
        if (value.charCodeAt(i) === BACKSLASH && i + 1 < n) i++;
        content += value[i] ?? '';
        i++;
      }
      i++;
      if (angle !== null) angle += `"${content}"`;
      else phrase += content;
      continue;
    }
    const ch = value[i] ?? '';
    if (ch === '<' && angle === null) angle = '';
    else if (ch === '>' && angle !== null) {
      // The address is complete; anything up to the next comma is ignored.
      const done = angle;
      i++;
      while (i < n && value[i] !== ',') i++;
      mailboxes.push({ name: phrase.trim(), address: done, group: '' });
      phrase = '';
      angle = null;
      continue;
    } else if (ch === ',' && angle === null) flush();
    else if (angle !== null) {
      if (ch !== ' ' && ch !== '\t') angle += ch;
    } else if (ch === ' ' || ch === '\t') {
      if (!phrase.endsWith(' ')) phrase += ' ';
    } else phrase += ch;
    i++;
  }
  flush();
  return { mailboxes, groups: [], notes: [] };
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

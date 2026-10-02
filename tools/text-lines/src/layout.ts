/**
 * Tab conversion, word wrap and IP ordering for lines of text.
 *
 * - `expandTabs` follows the tab stops of the `expand` command: a tab moves to the next multiple of the tab width,
 *   and a tab that is already at a stop moves a whole width.
 * - `unexpandTabs` follows the `unexpand` command, including its rule that a single space just before a tab stop is
 *   left as a space; by default only the run of blanks at the start of a line is converted, as `unexpand --first-only`.
 * - `wrapLines` is a greedy word wrap that counts code points, breaks only at spaces and drops the spaces at a break.
 * - `parseIp` and `compareIp` read IPv4 and IPv6 text forms (RFC 791, RFC 4291 section 2.2) and order them by version,
 *   then address value, then prefix length.
 *
 * Every function reads CRLF, LF and CR as line breaks and writes line feeds. A character is one column, whatever it
 * is: a code point outside the basic plane and a wide East Asian character each count as one.
 */

const LINE_BREAK = /\r\n|\r|\n/;

function splitText(text: string): string[] {
  return text === '' ? [] : text.split(LINE_BREAK);
}

// ---------------------------------------------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------------------------------------------

/** One line with every tab replaced by the spaces that reach the next tab stop. */
export function expandLine(line: string, width: number): string {
  let out = '';
  let column = 0;
  for (const ch of line) {
    if (ch === '\t') {
      const next = column + (width - (column % width));
      out += ' '.repeat(next - column);
      column = next;
    } else {
      if (ch === '\b') column = column > 0 ? column - 1 : 0;
      else column++;
      out += ch;
    }
  }
  return out;
}

/** Expands the tabs of every line to spaces at tab stops `width` columns apart. */
export function expandTabs(text: string, width: number): string {
  return splitText(text)
    .map((line) => expandLine(line, width))
    .join('\n');
}

/**
 * One line with runs of blanks turned into tabs wherever they reach a tab stop. This is the state machine of GNU
 * unexpand: a run of two or more blanks that ends on a tab stop becomes a tab, a single blank before a tab stop stays
 * a blank, a tab already in a run absorbs the blanks before it, and with `allRuns` off the conversion stops at the
 * first character that is not a blank.
 */
export function unexpandLine(line: string, width: number, allRuns: boolean): string {
  const chars = Array.from(line);
  let out = '';
  let convert = true;
  let column = 0;
  let oneBlankBeforeTabStop = false;
  let prevBlank = true;
  const pending: string[] = [];
  let pendingCount = 0;

  const flush = (): void => {
    if (pendingCount > 1 && oneBlankBeforeTabStop) pending[0] = '\t';
    out += pending.slice(0, pendingCount).join('');
    pendingCount = 0;
    oneBlankBeforeTabStop = false;
  };

  for (let index = 0; index < chars.length; index++) {
    let c = chars[index]!;
    if (convert) {
      const blank = c === ' ' || c === '\t';
      if (blank) {
        const nextTabColumn = column + (width - (column % width));
        if (c === '\t') {
          column = nextTabColumn;
          if (pendingCount > 0) pending[0] = '\t';
        } else {
          column++;
          if (!(prevBlank && column === nextTabColumn)) {
            // It is not yet known whether the pending blanks will be replaced by tabs.
            if (column === nextTabColumn) oneBlankBeforeTabStop = true;
            pending[pendingCount++] = c;
            prevBlank = true;
            continue;
          }
          // Replace the pending blanks by a tab.
          pending[0] = c = '\t';
        }
        // Discard the pending blanks, unless it was a single blank just before the previous tab stop.
        pendingCount = oneBlankBeforeTabStop ? 1 : 0;
      } else if (c === '\b') {
        column = column > 0 ? column - 1 : 0;
      } else {
        column++;
      }

      if (pendingCount > 0) flush();
      prevBlank = blank;
      convert = convert && (allRuns || blank);
    }
    out += c;
  }
  // The end of the line ends the run of blanks like any other character does.
  if (pendingCount > 0) flush();
  return out;
}

/** Turns runs of spaces into tabs at tab stops `width` columns apart: only leading runs, or every run with `allRuns`. */
export function unexpandTabs(text: string, width: number, allRuns: boolean): string {
  return splitText(text)
    .map((line) => unexpandLine(line, width, allRuns))
    .join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Wrap
// ---------------------------------------------------------------------------------------------------------------

const codePointLength = (text: string): number => Array.from(text).length;

/**
 * One line wrapped at `width` code points. Words are runs of anything but a space and a break may only fall at a run
 * of spaces; the spaces at a break are dropped, so a line may be exactly `width` long. A line that already fits is
 * returned unchanged. A word longer than the width stays whole on its own line, or with `breakLongWords` is cut into
 * pieces of exactly `width` code points, the last piece carrying on with the words after it. The spaces that start the
 * first line are kept and count toward the width.
 */
export function wrapLine(line: string, width: number, breakLongWords: boolean): string[] {
  if (codePointLength(line) <= width) return [line];

  const tokens: { gap: string; word: string }[] = [];
  const pattern = /( *)([^ ]+)/g;
  for (let match = pattern.exec(line); match !== null; match = pattern.exec(line)) {
    tokens.push({ gap: match[1]!, word: match[2]! });
  }
  if (tokens.length === 0) return [line];

  const out: string[] = [];
  let current = '';
  let currentLength = 0;
  let open = false;

  const place = (lead: string, word: string): void => {
    const wordLength = codePointLength(word);
    if (!breakLongWords || lead.length + wordLength <= width) {
      current = lead + word;
      currentLength = lead.length + wordLength;
      open = true;
      return;
    }
    const pieces = Array.from(word);
    out.push(lead + pieces.splice(0, Math.max(1, width - lead.length)).join(''));
    while (pieces.length > width) out.push(pieces.splice(0, width).join(''));
    current = pieces.join('');
    currentLength = pieces.length;
    open = pieces.length > 0;
  };

  tokens.forEach(({ gap, word }, index) => {
    if (!open) {
      place(index === 0 ? gap : '', word);
    } else if (currentLength + gap.length + codePointLength(word) <= width) {
      current += gap + word;
      currentLength += gap.length + codePointLength(word);
    } else {
      out.push(current);
      current = '';
      currentLength = 0;
      open = false;
      place('', word);
    }
  });
  if (open) out.push(current);
  return out;
}

/** Wraps every line at `width` code points; blank lines stay blank lines. */
export function wrapLines(text: string, width: number, breakLongWords: boolean): string {
  return splitText(text)
    .flatMap((line) => wrapLine(line, width, breakLongWords))
    .join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// IP addresses
// ---------------------------------------------------------------------------------------------------------------

export interface ParsedIp {
  version: 4 | 6;
  /** The address as an unsigned integer of 32 or 128 bits. */
  value: bigint;
  /** The prefix length written after a slash; a bare address has the length of a single host (32 or 128). */
  prefix: number;
}

const OCTET = /^(?:0|[1-9][0-9]{0,2})$/;
const HEXTET = /^[0-9a-fA-F]{1,4}$/;

/** A dotted quad of four decimal numbers 0 to 255 without leading zeros, or null. */
function parseDottedQuad(text: string): bigint | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!OCTET.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

/** The text forms of RFC 4291 section 2.2: eight groups, one run of zero groups as ::, and an IPv4 address in place of the last two groups. */
function parseV6(text: string): bigint | null {
  if (!text.includes(':')) return null;
  let address = text;
  const lastColon = address.lastIndexOf(':');
  const tail = address.slice(lastColon + 1);
  if (tail.includes('.')) {
    const quad = parseDottedQuad(tail);
    if (quad === null) return null;
    address = address.slice(0, lastColon + 1) + (quad >> 16n).toString(16) + ':' + (quad & 0xffffn).toString(16);
  }

  // A second :: or a third colon in a row leaves an empty group, which the group check below refuses.
  let groups: string[];
  const gap = address.indexOf('::');
  if (gap !== -1) {
    const left = address.slice(0, gap);
    const right = address.slice(gap + 2);
    const leftGroups = left === '' ? [] : left.split(':');
    const rightGroups = right === '' ? [] : right.split(':');
    if (leftGroups.length + rightGroups.length > 7) return null;
    groups = [
      ...leftGroups,
      ...new Array<string>(8 - leftGroups.length - rightGroups.length).fill('0'),
      ...rightGroups,
    ];
  } else {
    groups = address.split(':');
    if (groups.length !== 8) return null;
  }
  let value = 0n;
  for (const group of groups) {
    if (!HEXTET.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

/**
 * Reads a line as an IPv4 or IPv6 address with an optional /prefix. Spaces and tabs around it are ignored. Anything
 * else, including an address with a zone identifier such as %eth0, is not an address and gives null.
 */
export function parseIp(line: string): ParsedIp | null {
  const text = line.replace(/^[ \t]+|[ \t]+$/g, '');
  if (text === '') return null;
  let address = text;
  let prefix: number | null = null;
  const slash = text.indexOf('/');
  if (slash !== -1) {
    const digits = text.slice(slash + 1);
    if (!/^[0-9]{1,3}$/.test(digits)) return null;
    prefix = Number(digits);
    address = text.slice(0, slash);
  }

  const v4 = parseDottedQuad(address);
  if (v4 !== null) {
    if (prefix !== null && prefix > 32) return null;
    return { version: 4, value: v4, prefix: prefix ?? 32 };
  }
  const v6 = parseV6(address);
  if (v6 === null) return null;
  if (prefix !== null && prefix > 128) return null;
  return { version: 6, value: v6, prefix: prefix ?? 128 };
}

/** Orders two addresses: IPv4 before IPv6, then by value, then by prefix length. */
export function compareIp(a: ParsedIp, b: ParsedIp): number {
  if (a.version !== b.version) return a.version - b.version;
  if (a.value !== b.value) return a.value < b.value ? -1 : 1;
  return a.prefix - b.prefix;
}

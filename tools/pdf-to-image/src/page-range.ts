/**
 * Canonical page list parser (never a tool by name in this header): a
 * comma-separated list of pages and ranges, in the exact convention every
 * PDF page tool this project builds shares -- `1-3,5,8-` meaning 1, 2, 3,
 * 5, then 8 to the end of the document.
 */

export const MAX_PAGE_LIST_LENGTH = 10_000;

/** A quoted piece of the visitor's own text is cut at this many characters in a message. */
const MAX_QUOTED_CHARS = 20;

/** A page number is shown with at most this many digits in a message. */
const MAX_SHOWN_DIGITS = 12;

const BACKSLASH = String.fromCharCode(92);

/** True for the code units a message never shows raw: controls other than tab and line feed, direction marks and invisible format characters. */
function isHidden(unit: number): boolean {
  if (unit <= 0x1f) return true;
  if (unit >= 0x7f && unit <= 0x9f) return true;
  if (unit === 0xad || unit === 0x61c || unit === 0x2028 || unit === 0x2029 || unit === 0xfeff) return true;
  if (unit >= 0x200b && unit <= 0x200f) return true;
  if (unit >= 0x202a && unit <= 0x202e) return true;
  return (unit >= 0x2060 && unit <= 0x2064) || (unit >= 0x2066 && unit <= 0x2069);
}

/**
 * At most the first 20 characters of a piece of the visitor's text for a message, with control, direction and invisible
 * characters written as the backslash, `u{`, the code point in capital hexadecimal and `}`, and `...` when cut. Linear
 * in the 20 characters, never in the length of the text, and never ending in half a surrogate pair.
 */
function quote(text: string): string {
  let end = Math.min(text.length, MAX_QUOTED_CHARS);
  const last = text.charCodeAt(end - 1);
  if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
  let out = '';
  for (let i = 0; i < end; i++) {
    const unit = text.charCodeAt(i);
    const next = text.charCodeAt(i + 1);
    if (unit === 0xdb40 && i + 1 < end && next >= 0xdc00 && next <= 0xdc7f) {
      out += BACKSLASH + 'u{' + (0xe0000 + next - 0xdc00).toString(16).toUpperCase() + '}';
      i += 1;
    } else if (isHidden(unit)) {
      out += BACKSLASH + 'u{' + unit.toString(16).toUpperCase() + '}';
    } else {
      out += text[i];
    }
  }
  return end < text.length ? out + '...' : out;
}

/** A run of digits as a page number for a message: no leading zeros, and at most 12 digits followed by `...`. */
function shownNumber(digits: string): string {
  const trimmed = digits.replace(/^0+(?=\d)/, '');
  return trimmed.length > MAX_SHOWN_DIGITS ? trimmed.slice(0, MAX_SHOWN_DIGITS) + '...' : trimmed;
}

function pagesWord(pageCount: number): string {
  return `${pageCount} page${pageCount === 1 ? '' : 's'}`;
}

export class PageRangeError extends Error {
  /** 1-based character offset into the original text where the problem starts. */
  readonly position: number;
  readonly reason: string;
  constructor(message: string, position: number, reason: string) {
    super(message);
    this.name = 'PageRangeError';
    this.position = position;
    this.reason = reason;
  }
}

interface Item {
  /** Character position (1-based) where this item starts, for error reporting. */
  position: number;
  from: number;
  to: number | null; // null means "to the end" (an item written as "N-")
  /** The two numbers as typed, cut for a message (the numbers above lose precision past 15 digits). */
  fromShown: string;
  toShown: string | null;
}

/**
 * Parses a comma-separated page list: each item is `N`, `N-M` (M at least
 * N) or `N-` (N to the end). Spaces around an item are ignored. Empty or
 * whitespace-only text means every page, in order. Returns 1-based page
 * numbers in written order (duplicates kept exactly as written). Refuses
 * a page outside `1..pageCount`, a reversed range, an unrecognised
 * character, and a result longer than `MAX_PAGE_LIST_LENGTH`, each with
 * the 1-based character position of the problem. A message quotes at most
 * the first 20 characters of the text it names (control and invisible
 * characters written out) and shows a number with at most 12 digits, so a
 * long list never makes a long message. An empty list over a document of
 * more than `MAX_PAGE_LIST_LENGTH` pages is refused too.
 */
export function parsePageList(text: string, pageCount: number): number[] {
  if (text.trim() === '') {
    if (pageCount > MAX_PAGE_LIST_LENGTH) {
      throw new PageRangeError(
        `This document has more than ${MAX_PAGE_LIST_LENGTH.toLocaleString('en-US')} pages, more than a page list can name. Type a smaller range.`,
        1,
        'too-long',
      );
    }
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }

  const items: Item[] = [];
  let offset = 0;
  for (const rawSegment of text.split(',')) {
    const segmentStart = offset;
    offset += rawSegment.length + 1; // +1 for the consumed comma
    const segment = rawSegment.trim();
    const leadingSpaces = rawSegment.length - rawSegment.trimStart().length;
    const itemPosition = segmentStart + leadingSpaces + 1; // 1-based

    if (segment === '') {
      throw new PageRangeError(
        'A page list has an empty item where a page or range was expected.',
        itemPosition,
        'empty-item',
      );
    }

    const openRangeMatch = /^(\d+)-$/.exec(segment);
    const closedRangeMatch = /^(\d+)-(\d+)$/.exec(segment);
    const singleMatch = /^(\d+)$/.exec(segment);

    if (singleMatch) {
      const n = Number(singleMatch[1]);
      const shown = shownNumber(singleMatch[1]!);
      items.push({ position: itemPosition, from: n, to: n, fromShown: shown, toShown: shown });
    } else if (openRangeMatch) {
      const n = Number(openRangeMatch[1]);
      items.push({
        position: itemPosition,
        from: n,
        to: null,
        fromShown: shownNumber(openRangeMatch[1]!),
        toShown: null,
      });
    } else if (closedRangeMatch) {
      const from = Number(closedRangeMatch[1]);
      const to = Number(closedRangeMatch[2]);
      const fromShown = shownNumber(closedRangeMatch[1]!);
      const toShown = shownNumber(closedRangeMatch[2]!);
      if (to < from) {
        throw new PageRangeError(
          `The range "${quote(segment)}" goes backwards: ${toShown} is before ${fromShown}.`,
          itemPosition,
          'reversed-range',
        );
      }
      items.push({ position: itemPosition, from, to, fromShown, toShown });
    } else {
      throw new PageRangeError(`"${quote(segment)}" is not a page number or range.`, itemPosition, 'unrecognised');
    }
  }

  const pages: number[] = [];
  for (const item of items) {
    if (item.from < 1 || item.from > pageCount) {
      throw new PageRangeError(
        `Page ${item.fromShown} is outside this document, which has ${pagesWord(pageCount)}.`,
        item.position,
        'out-of-range',
      );
    }
    const to = item.to === null ? pageCount : item.to;
    if (to > pageCount) {
      throw new PageRangeError(
        `Page ${item.toShown ?? to} is outside this document, which has ${pagesWord(pageCount)}.`,
        item.position,
        'out-of-range',
      );
    }
    for (let p = item.from; p <= to; p++) {
      pages.push(p);
      if (pages.length > MAX_PAGE_LIST_LENGTH) {
        throw new PageRangeError(
          `This page list names more than ${MAX_PAGE_LIST_LENGTH.toLocaleString('en-US')} pages, which risks freezing the tab.`,
          item.position,
          'too-long',
        );
      }
    }
  }

  return pages;
}

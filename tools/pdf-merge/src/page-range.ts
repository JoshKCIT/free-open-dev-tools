/**
 * Canonical page list parser (never a tool by name in this header): a
 * comma-separated list of pages and ranges, in the exact convention every
 * PDF page tool this project builds shares -- `1-3,5,8-` meaning 1, 2, 3,
 * 5, then 8 to the end of the document.
 */

export const MAX_PAGE_LIST_LENGTH = 10_000;

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
}

/**
 * Parses a comma-separated page list: each item is `N`, `N-M` (M at least
 * N) or `N-` (N to the end). Spaces around an item are ignored. Empty or
 * whitespace-only text means every page, in order. Returns 1-based page
 * numbers in written order (duplicates kept exactly as written). Refuses
 * a page outside `1..pageCount`, a reversed range, an unrecognised
 * character, and a result longer than `MAX_PAGE_LIST_LENGTH`, each with
 * the 1-based character position of the problem.
 */
export function parsePageList(text: string, pageCount: number): number[] {
  if (text.trim() === '') {
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
      items.push({ position: itemPosition, from: n, to: n });
    } else if (openRangeMatch) {
      const n = Number(openRangeMatch[1]);
      items.push({ position: itemPosition, from: n, to: null });
    } else if (closedRangeMatch) {
      const from = Number(closedRangeMatch[1]);
      const to = Number(closedRangeMatch[2]);
      if (to < from) {
        throw new PageRangeError(
          `The range "${segment}" goes backwards: ${to} is before ${from}.`,
          itemPosition,
          'reversed-range',
        );
      }
      items.push({ position: itemPosition, from, to });
    } else {
      throw new PageRangeError(`"${segment}" is not a page number or range.`, itemPosition, 'unrecognised');
    }
  }

  const pages: number[] = [];
  for (const item of items) {
    if (item.from < 1 || item.from > pageCount) {
      throw new PageRangeError(
        `Page ${item.from} is outside this document, which has ${pageCount} page${pageCount === 1 ? '' : 's'}.`,
        item.position,
        'out-of-range',
      );
    }
    const to = item.to === null ? pageCount : item.to;
    if (to > pageCount) {
      throw new PageRangeError(
        `Page ${to} is outside this document, which has ${pageCount} page${pageCount === 1 ? '' : 's'}.`,
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

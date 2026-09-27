import { it, expect } from 'vitest';
import { parsePageList, PageRangeError, MAX_PAGE_LIST_LENGTH } from '../src/page-range';

it('page lists such as 1-3,5,8- give those pages in the order written', () => {
  expect(parsePageList('1-3,5,8-', 10)).toEqual([1, 2, 3, 5, 8, 9, 10]);
  expect(parsePageList('5,1,3', 10)).toEqual([5, 1, 3]);
  expect(parsePageList(' 2-4 , 7 ', 10)).toEqual([2, 3, 4, 7]);
  expect(parsePageList('1,1,1', 10)).toEqual([1, 1, 1]);
});

it('an empty page list means every page', () => {
  expect(parsePageList('', 5)).toEqual([1, 2, 3, 4, 5]);
  expect(parsePageList('   ', 3)).toEqual([1, 2, 3]);
});

it('a page outside the document, a reversed range or an unknown character is refused with its position', () => {
  expect(() => parsePageList('0', 10)).toThrow(PageRangeError);
  expect(() => parsePageList('11', 10)).toThrow(PageRangeError);
  expect(() => parsePageList('5-3', 10)).toThrow(PageRangeError);
  expect(() => parsePageList('2,,3', 10)).toThrow(PageRangeError);
  expect(() => parsePageList('a', 10)).toThrow(PageRangeError);

  try {
    parsePageList('1,a', 10);
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(PageRangeError);
    expect((err as PageRangeError).position).toBe(3);
  }

  try {
    parsePageList('11', 10);
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(PageRangeError);
    expect((err as PageRangeError).position).toBe(1);
  }
});

it('a page list longer than the limit is refused rather than risk freezing the tab', () => {
  const hugeCount = MAX_PAGE_LIST_LENGTH + 10;
  expect(() => parsePageList(`1-${hugeCount}`, hugeCount)).toThrow(PageRangeError);
  // Exactly at the limit still works.
  expect(parsePageList(`1-${MAX_PAGE_LIST_LENGTH}`, MAX_PAGE_LIST_LENGTH).length).toBe(MAX_PAGE_LIST_LENGTH);
});

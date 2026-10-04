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

it('a reversed range is refused with its position and a message that names both ends', () => {
  try {
    parsePageList('1,5-3', 10);
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(PageRangeError);
    expect((err as PageRangeError).reason).toBe('reversed-range');
    expect((err as PageRangeError).position).toBe(3);
    expect((err as PageRangeError).message).toBe('The range "5-3" goes backwards: 3 is before 5.');
  }
});

it('a range such as 1-999999999 is refused at once as outside the document, without building the list', () => {
  const started = performance.now();
  try {
    parsePageList('1-999999999', 10);
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(PageRangeError);
    expect((err as PageRangeError).reason).toBe('out-of-range');
    expect((err as PageRangeError).message).toContain('Page 999999999 is outside this document');
  }
  expect(performance.now() - started).toBeLessThan(1000);
});

it('a page list that names more than 10,000 pages in total is refused, one at the limit is not', () => {
  expect(MAX_PAGE_LIST_LENGTH).toBe(10_000);
  expect(parsePageList('1-10000', 10_000)).toHaveLength(10_000);
  for (const [text, count] of [
    ['1-10001', 10_001],
    ['1-6000,1-6000', 6000],
    ['1-', 10_001],
  ] as const) {
    try {
      parsePageList(text, count);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(PageRangeError);
      expect((err as PageRangeError).reason).toBe('too-long');
      expect((err as PageRangeError).message).toContain('10,000');
    }
  }
});

it('an empty page list over a document of more than 10,000 pages is refused instead of listing every page', () => {
  expect(parsePageList('', 10_000)).toHaveLength(10_000);
  for (const count of [10_001, 50_000_000, 200_000_000]) {
    try {
      parsePageList('  ', count);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(PageRangeError);
      expect((err as PageRangeError).reason).toBe('too-long');
      expect((err as PageRangeError).message).toContain('10,000');
    }
  }
});

const BS = String.fromCharCode(92);

it('a one million character page list gives a short message that quotes at most 20 characters, escaped', () => {
  const junk = 'x'.repeat(1_000_000);
  const started = performance.now();
  for (const text of [junk, `1,2,${junk}`, `${'1,'.repeat(1000)}${junk}`]) {
    try {
      parsePageList(text, 10);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(PageRangeError);
      const message = (err as PageRangeError).message;
      expect(message.length).toBeLessThan(200);
      expect(message).toBe(`"${'x'.repeat(20)}..." is not a page number or range.`);
    }
  }
  expect(performance.now() - started).toBeLessThan(5000);

  // A segment of control and direction-changing characters is quoted escaped, never raw.
  const hostile =
    String.fromCharCode(7) +
    String.fromCodePoint(0x202e) +
    String.fromCodePoint(0x200b) +
    String.fromCodePoint(0xe0041) +
    'ab';
  try {
    parsePageList(hostile, 10);
    expect.unreachable();
  } catch (err) {
    const message = (err as PageRangeError).message;
    expect(message).toBe(
      '"' + BS + 'u{7}' + BS + 'u{202E}' + BS + 'u{200B}' + BS + 'u{E0041}ab" is not a page number or range.',
    );
  }
}, 60_000);

it('a page number of thousands of digits is shown cut to 12 digits, in a short message', () => {
  const huge = '9'.repeat(5000);
  for (const text of [`${huge}-1`, huge, `1-${huge}`]) {
    try {
      parsePageList(text, 10);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(PageRangeError);
      const message = (err as PageRangeError).message;
      expect(message.length).toBeLessThan(200);
      expect(message).not.toContain('Infinity');
      // The numbers shown are cut to 12 digits; the quoted piece of the text is cut to 20 characters.
      expect(message.replace(/"[^"]*"/, '""')).not.toContain('9'.repeat(13));
      expect(message).toContain('9'.repeat(12) + '...');
    }
  }
});

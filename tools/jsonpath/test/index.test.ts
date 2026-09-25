import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluateJsonPath, JsonPathError } from '../src/index';

/**
 * RFC 9535 section 1.5's own bookstore example document, quoted from
 * https://www.rfc-editor.org/rfc/rfc9535.txt (fetched this session) and
 * copied byte-for-byte (as JSON) into fixtures/rfc9535-example.json.
 * Section 1.5's Table 2 pairs it with these queries and intended results:
 *
 *   $.store.book[*].author  -- the authors of all books in the store
 *   $..author               -- all authors
 *   $.store.*               -- all things in the store
 *   $.store..price           -- the prices of everything in the store
 *   $..book[2]               -- the third book
 *   $..book[2].author        -- the third book's author
 *   $..book[2].publisher     -- empty result: no "publisher" member
 *   $..book[-1]               -- the last book in order
 *   $..book[0,1] / $..book[:2] -- the first two books
 *   $..book[?@.isbn]          -- all books with an ISBN number
 *   $..book[?@.price<10]      -- all books cheaper than 10
 *   $..*                       -- all member values and array elements
 */
const fixturePath = fileURLToPath(new URL('./fixtures/rfc9535-example.json', import.meta.url));
const documentText = readFileSync(fixturePath, 'utf8');

it('RFC 9535 bookstore example returns every author, the third book, books under 10 and books with an ISBN', () => {
  const authors = evaluateJsonPath(documentText, '$.store.book[*].author');
  expect(authors.matches.map((m) => m.value)).toEqual([
    'Nigel Rees',
    'Evelyn Waugh',
    'Herman Melville',
    'J. R. R. Tolkien',
  ]);

  const allAuthors = evaluateJsonPath(documentText, '$..author');
  expect(allAuthors.matches.map((m) => m.value)).toEqual([
    'Nigel Rees',
    'Evelyn Waugh',
    'Herman Melville',
    'J. R. R. Tolkien',
  ]);

  const thirdBook = evaluateJsonPath(documentText, '$..book[2]');
  expect(thirdBook.matches).toHaveLength(1);
  expect((thirdBook.matches[0]!.value as { title: string }).title).toBe('Moby Dick');
  expect(thirdBook.matches[0]!.path).toBe("$['store']['book'][2]");

  const cheap = evaluateJsonPath(documentText, '$..book[?@.price<10]');
  expect(cheap.matches.map((m) => (m.value as { title: string }).title)).toEqual([
    'Sayings of the Century',
    'Moby Dick',
  ]);

  const withIsbn = evaluateJsonPath(documentText, '$..book[?@.isbn]');
  expect(withIsbn.matches.map((m) => (m.value as { title: string }).title)).toEqual([
    'Moby Dick',
    'The Lord of the Rings',
  ]);
});

it('RFC 9535 descendant wildcard returns every member value and array element of the example', () => {
  const result = evaluateJsonPath(documentText, '$..*');
  // Counted directly against the document rather than derived by hand:
  // every member value and array element, 27 total nodes.
  expect(result.matches).toHaveLength(27);
  const byPath = new Map(result.matches.map((m) => [m.path, m.value]));
  expect(byPath.get("$['store']['bicycle']['color']")).toBe('red');
  expect(byPath.get("$['store']['book'][0]['author']")).toBe('Nigel Rees');
  expect(byPath.get("$['store']['book'][2]['isbn']")).toBe('0-553-21311-3');
});

it('each match is reported with its RFC 9535 normalized path', () => {
  const result = evaluateJsonPath(documentText, '$.store.book[0].author');
  expect(result.matches).toEqual([{ path: "$['store']['book'][0]['author']", value: 'Nigel Rees' }]);
});

it('an invalid expression is refused as an expression error', () => {
  let caught: unknown;
  try {
    evaluateJsonPath(documentText, '$.store[');
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(JsonPathError);
  const error = caught as JsonPathError;
  expect(error.kind).toBe('expression');
  expect(typeof error.column).toBe('number');
});

it('a broken document is refused with a line and column, before the expression is even looked at', () => {
  let caught: unknown;
  try {
    evaluateJsonPath('{"a":}', '$.a');
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(JsonPathError);
  const error = caught as JsonPathError;
  expect(error.kind).toBe('document');
  expect(error.line).toBe(1);
  expect(typeof error.column).toBe('number');
});

it('a query with no matches returns an empty match list, not an error', () => {
  const result = evaluateJsonPath(documentText, '$..book[2].publisher');
  expect(result.matches).toEqual([]);
});

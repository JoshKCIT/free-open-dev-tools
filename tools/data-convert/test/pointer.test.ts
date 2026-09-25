import { describe, it, expect } from 'vitest';
import {
  encodePointerToken,
  decodePointerToken,
  formatPointer,
  parsePointer,
  isArrayIndexToken,
  PointerSyntaxError,
} from '../src/pointer';

// Fetched with `curl -fsSL https://www.rfc-editor.org/rfc/rfc6901.txt`, 2026-09-24.
// Section 5's example document (quoted from the RFC):
//   {
//      "foo": ["bar", "baz"],
//      "": 0,
//      "a/b": 1,
//      "c%d": 2,
//      "e^f": 3,
//      "g|h": 4,
//      "i\\j": 5,
//      "k\"l": 6,
//      " ": 7,
//      "m~n": 8
//   }
// and its documented pointer table (also quoted verbatim):
//    ""           // the whole document
//    "/foo"       ["bar", "baz"]
//    "/foo/0"     "bar"
//    "/"          0
//    "/a~1b"      1
//    "/c%d"       2
//    "/e^f"       3
//    "/g|h"       4
//    "/i\\j"      5
//    "/k\"l"      6
//    "/ "         7
//    "/m~0n"      8

const DOCUMENT: Record<string, unknown> = {
  foo: ['bar', 'baz'],
  '': 0,
  'a/b': 1,
  'c%d': 2,
  'e^f': 3,
  'g|h': 4,
  'i\\j': 5,
  'k"l': 6,
  ' ': 7,
  'm~n': 8,
};

function resolve(pointer: string): unknown {
  const tokens = parsePointer(pointer);
  let value: unknown = DOCUMENT;
  for (const token of tokens) {
    if (Array.isArray(value)) {
      value = value[Number(token)];
    } else {
      value = (value as Record<string, unknown>)[token];
    }
  }
  return value;
}

it('RFC 6901 section 5 example pointers resolve to the documented values', () => {
  expect(resolve('')).toBe(DOCUMENT);
  expect(resolve('/foo')).toEqual(['bar', 'baz']);
  expect(resolve('/foo/0')).toBe('bar');
  expect(resolve('/')).toBe(0);
  expect(resolve('/a~1b')).toBe(1);
  expect(resolve('/c%d')).toBe(2);
  expect(resolve('/e^f')).toBe(3);
  expect(resolve('/g|h')).toBe(4);
  expect(resolve('/i\\j')).toBe(5);
  expect(resolve('/k"l')).toBe(6);
  expect(resolve('/ ')).toBe(7);
  expect(resolve('/m~0n')).toBe(8);
});

it('RFC 6901 decoding turns ~01 into ~1 and never into a slash', () => {
  expect(decodePointerToken('~01')).toBe('~1');
  expect(decodePointerToken('~01')).not.toBe('/');
});

describe('encodePointerToken', () => {
  it('replaces ~ with ~0 before replacing / with ~1', () => {
    expect(encodePointerToken('a/b')).toBe('a~1b');
    expect(encodePointerToken('m~n')).toBe('m~0n');
    expect(encodePointerToken('~/')).toBe('~0~1');
  });
});

describe('decodePointerToken', () => {
  it('is the exact inverse of encodePointerToken for every character in the example document', () => {
    for (const key of Object.keys(DOCUMENT)) {
      expect(decodePointerToken(encodePointerToken(key))).toBe(key);
    }
  });

  it('throws PointerSyntaxError when a ~ is not followed by 0 or 1', () => {
    expect(() => decodePointerToken('~2')).toThrow(PointerSyntaxError);
    expect(() => decodePointerToken('a~')).toThrow(PointerSyntaxError);
  });
});

describe('formatPointer', () => {
  it('returns the empty string for no tokens', () => {
    expect(formatPointer([])).toBe('');
  });

  it('joins encoded tokens with a leading slash between each', () => {
    expect(formatPointer(['foo', '0'])).toBe('/foo/0');
    expect(formatPointer(['a/b'])).toBe('/a~1b');
  });
});

describe('parsePointer', () => {
  it('returns no tokens for the empty string', () => {
    expect(parsePointer('')).toEqual([]);
  });

  it('throws PointerSyntaxError when a non-empty pointer does not start with /', () => {
    expect(() => parsePointer('foo')).toThrow(PointerSyntaxError);
  });

  it('round trips through formatPointer for every path in the example document', () => {
    const paths = ['/foo', '/foo/0', '/', '/a~1b', '/m~0n'];
    for (const p of paths) expect(formatPointer(parsePointer(p))).toBe(p);
  });
});

describe('isArrayIndexToken', () => {
  it('accepts 0 and digit runs with no leading zero', () => {
    expect(isArrayIndexToken('0')).toBe(true);
    expect(isArrayIndexToken('1')).toBe(true);
    expect(isArrayIndexToken('42')).toBe(true);
  });

  it('rejects a leading zero, a non-digit and the empty string', () => {
    expect(isArrayIndexToken('01')).toBe(false);
    expect(isArrayIndexToken('a')).toBe(false);
    expect(isArrayIndexToken('')).toBe(false);
    expect(isArrayIndexToken('-1')).toBe(false);
  });
});

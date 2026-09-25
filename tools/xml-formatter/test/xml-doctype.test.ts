import { it, expect } from 'vitest';
import { findDoctype, positionAt, DOCTYPE_REFUSAL_MESSAGE } from '../src/xml-doctype';

it('a DOCTYPE in any letter case is found with its line and column', () => {
  expect(findDoctype('<a/>')).toBeNull();

  const upper = '<!DOCTYPE a><a/>';
  expect(findDoctype(upper)).toEqual({ line: 1, column: 1 });

  const lower = '<!doctype a><a/>';
  expect(findDoctype(lower)).toEqual({ line: 1, column: 1 });

  const mixed = '<!DocType a><a/>';
  expect(findDoctype(mixed)).toEqual({ line: 1, column: 1 });

  const onSecondLine = '<?xml version="1.0"?>\n<!DOCTYPE a><a/>';
  expect(findDoctype(onSecondLine)).toEqual({ line: 2, column: 1 });

  const indented = '<?xml version="1.0"?>\n  <!DOCTYPE a>\n<a/>';
  expect(findDoctype(indented)).toEqual({ line: 2, column: 3 });
});

it('positionAt computes a 1-based line and column for an offset', () => {
  expect(positionAt('abc', 0)).toEqual({ line: 1, column: 1 });
  expect(positionAt('a\nbcd', 3)).toEqual({ line: 2, column: 2 });
  expect(positionAt('a\nb\nc', 4)).toEqual({ line: 3, column: 1 });
});

it('DOCTYPE_REFUSAL_MESSAGE is a plain, non-empty sentence', () => {
  expect(DOCTYPE_REFUSAL_MESSAGE.length).toBeGreaterThan(0);
  expect(DOCTYPE_REFUSAL_MESSAGE.toLowerCase()).toContain('doctype');
});

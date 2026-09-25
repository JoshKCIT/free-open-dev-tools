import { it, expect } from 'vitest';
import { parseJsonText, exceedsDepth, MAX_JSON_DEPTH } from '../src/json-text';

// Fetched with `curl -fsSL https://www.rfc-editor.org/rfc/rfc8259.txt`, 2026-09-24.
// Section 2, quoted: "A JSON text is a sequence of tokens. The set of tokens
// includes six structural characters, strings, numbers, and three literal
// names. A JSON text is a serialized value." (JSON-text = ws value ws)

it('RFC 8259 invalid JSON is refused with the same line and column on every engine', () => {
  const result = parseJsonText('{\n  "a": ,\n}');
  expect(result.ok).toBe(false);
  expect(result.line).toBe(2);
  expect(result.column).toBe(8);
  expect(typeof result.message).toBe('string');
  expect(result.message).not.toMatch(/unexpected token/i); // not the engine's own wording
});

it('exceedsDepth reports 513 levels of nesting without overflowing the stack', () => {
  let value: unknown = 'leaf';
  for (let i = 0; i < 513; i++) value = [value];
  expect(exceedsDepth(value, MAX_JSON_DEPTH)).toBe(true);
});

it('exceedsDepth is false at exactly the maximum depth', () => {
  let value: unknown = 'leaf';
  for (let i = 0; i < MAX_JSON_DEPTH; i++) value = [value];
  expect(exceedsDepth(value, MAX_JSON_DEPTH)).toBe(false);
});

it('parses a valid document with the built-in parser and returns its value', () => {
  const result = parseJsonText('{"a": [1, 2, 3], "b": null}');
  expect(result.ok).toBe(true);
  expect(result.value).toEqual({ a: [1, 2, 3], b: null });
});

it('strips one leading byte-order mark before parsing', () => {
  const result = parseJsonText('﻿{"a": 1}');
  expect(result.ok).toBe(true);
  expect(result.value).toEqual({ a: 1 });
});

it('refuses an empty or whitespace-only document with a plain message', () => {
  expect(parseJsonText('').ok).toBe(false);
  expect(parseJsonText('   \n\t').ok).toBe(false);
  expect(parseJsonText('').message).toBe('The document is empty.');
});

it('reports an unterminated string with a position, not a crash', () => {
  const result = parseJsonText('{"a": "unterminated');
  expect(result.ok).toBe(false);
  expect(typeof result.line).toBe('number');
  expect(typeof result.column).toBe('number');
});

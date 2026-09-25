import { it, expect } from 'vitest';
import { diffJson, diffJsonText, JsonDiffError, type DiffChange } from '../src/index';
import { MAX_JSON_DEPTH } from '../src/json-text';

function find(changes: DiffChange[], path: string): DiffChange | undefined {
  return changes.find((c) => c.path === path);
}

it('added, removed and changed paths are listed as RFC 6901 pointers', () => {
  const result = diffJson({ a: 1 }, { a: 1, b: 2 });
  expect(result.identical).toBe(false);
  expect(result.changes).toHaveLength(1);
  expect(result.changes[0]).toEqual({ kind: 'added', path: '/b', before: undefined, after: 2 });
  expect(result.stats).toEqual({ added: 1, removed: 0, changed: 0 });

  const removed = diffJson({ a: 1, b: 2 }, { a: 1 });
  expect(removed.changes).toEqual([{ kind: 'removed', path: '/b', before: 2, after: undefined }]);
  expect(removed.stats).toEqual({ added: 0, removed: 1, changed: 0 });

  const changed = diffJson({ a: 1 }, { a: 2 });
  expect(changed.changes).toEqual([{ kind: 'changed', path: '/a', before: 1, after: 2 }]);
  expect(changed.stats).toEqual({ added: 0, removed: 0, changed: 1 });
});

it('keys containing slash and tilde are escaped per RFC 6901 in reported paths', () => {
  const result = diffJson({ 'a/b': { 'm~n': 1 } }, { 'a/b': { 'm~n': 2 } });
  expect(result.changes).toHaveLength(1);
  expect(result.changes[0]?.path).toBe('/a~1b/m~0n');
  expect(result.changes[0]?.kind).toBe('changed');
});

it('object key order is ignored and array elements are compared by position', () => {
  const sameOrder = diffJson({ a: 1, b: 2 }, { b: 2, a: 1 });
  expect(sameOrder.identical).toBe(true);
  expect(sameOrder.changes).toEqual([]);

  const arrayAdded = diffJson([1, 2], [1, 2, 3]);
  expect(arrayAdded.identical).toBe(false);
  expect(find(arrayAdded.changes, '/2')).toEqual({ kind: 'added', path: '/2', before: undefined, after: 3 });

  const arrayRemoved = diffJson([1, 2, 3], [1, 2]);
  expect(find(arrayRemoved.changes, '/2')).toEqual({ kind: 'removed', path: '/2', before: 3, after: undefined });
});

it('a change of type at a location is reported once there, not as child changes', () => {
  const result = diffJson({ x: { y: 1 } }, { x: [1] });
  expect(result.changes).toHaveLength(1);
  expect(result.changes[0]).toEqual({ kind: 'changed', path: '/x', before: { y: 1 }, after: [1] });
});

it('identical documents report no changes', () => {
  const result = diffJson({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] });
  expect(result.identical).toBe(true);
  expect(result.changes).toEqual([]);
  expect(result.stats).toEqual({ added: 0, removed: 0, changed: 0 });
});

it('keys are read as own properties only, so __proto__ and constructor keys compare correctly', () => {
  const a = JSON.parse('{"__proto__":{"polluted":true},"constructor":1}') as unknown;
  const b = JSON.parse('{"__proto__":{"polluted":true},"constructor":2}') as unknown;
  const result = diffJson(a, b);
  expect(result.changes).toEqual([{ kind: 'changed', path: '/constructor', before: 1, after: 2 }]);
  expect((Object.prototype as unknown as Record<string, unknown>).polluted).toBeUndefined();
});

it('RFC 8259 invalid JSON in either document is refused naming the document, line and column', () => {
  let err: JsonDiffError | undefined;
  try {
    diffJsonText('{"a": ,}', '{"a":1}');
  } catch (e) {
    err = e as JsonDiffError;
  }
  expect(err).toBeInstanceOf(JsonDiffError);
  expect(err?.message).toMatch(/first/i);
  expect(typeof err?.line).toBe('number');
  expect(typeof err?.column).toBe('number');

  let secondErr: JsonDiffError | undefined;
  try {
    diffJsonText('{"a":1}', '{"a": ,}');
  } catch (e) {
    secondErr = e as JsonDiffError;
  }
  expect(secondErr).toBeInstanceOf(JsonDiffError);
  expect(secondErr?.message).toMatch(/second/i);
});

it('nesting deeper than 512 levels is refused with a plain message', () => {
  let deep: unknown = 'leaf';
  for (let i = 0; i < MAX_JSON_DEPTH + 1; i++) deep = [deep];
  const deepText = JSON.stringify(deep);
  expect(() => diffJsonText(deepText, '{}')).toThrow(JsonDiffError);
  expect(() => diffJsonText(deepText, '{}')).toThrow(/512/);
});

it('diffJsonText parses both documents and reports their structural differences', () => {
  const result = diffJsonText('{"a":1,"b":[1,2]}', '{"a":2,"b":[1,2,3]}');
  expect(find(result.changes, '/a')).toEqual({ kind: 'changed', path: '/a', before: 1, after: 2 });
  expect(find(result.changes, '/b/2')).toEqual({ kind: 'added', path: '/b/2', before: undefined, after: 3 });
});

import { it, expect } from 'vitest';
import { flatten, unflatten, flattenText, FlattenError } from '../src/index';
import { setOwn } from '../src/own-property';

// RFC 6901 section 5's own example document (fetched with
// `curl -fsSL https://www.rfc-editor.org/rfc/rfc6901.txt`, 2026-09-24; the
// same document and table test/pointer.test.ts quotes in full).
const RFC6901_DOCUMENT: Record<string, unknown> = {
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

it('RFC 6901 section 5 example document flattens to the documented pointers', () => {
  const flat = flatten(RFC6901_DOCUMENT);
  expect(flat['/foo/0']).toBe('bar');
  expect(flat['/foo/1']).toBe('baz');
  expect(flat['/']).toBe(0);
  expect(flat['/a~1b']).toBe(1);
  expect(flat['/c%d']).toBe(2);
  expect(flat['/e^f']).toBe(3);
  expect(flat['/g|h']).toBe(4);
  expect(flat['/i\\j']).toBe(5);
  expect(flat['/k"l']).toBe(6);
  expect(flat['/ ']).toBe(7);
  expect(flat['/m~0n']).toBe(8);
});

it('an object whose keys are all digit strings rebuilds as an object not an array', () => {
  const original: Record<string, unknown> = { '0': 'a', '1': 'b' };
  const rebuilt = unflatten(flatten(original));
  expect(Array.isArray(rebuilt)).toBe(false);
  expect(rebuilt).toEqual(original);
});

it('empty objects and arrays and a scalar root survive the round trip', () => {
  expect(unflatten(flatten({}))).toEqual({});
  expect(unflatten(flatten([]))).toEqual([]);
  expect(unflatten(flatten(42))).toBe(42);
  expect(unflatten(flatten('hello'))).toBe('hello');
  expect(unflatten(flatten(true))).toBe(true);
  expect(unflatten(flatten(null))).toBe(null);
  expect(unflatten(flatten({ a: [], b: {} }))).toEqual({ a: [], b: {} });
});

it('a key named __proto__ is kept as an own key and Object.prototype is never modified', () => {
  const original: Record<string, unknown> = {};
  setOwn(original, '__proto__', { polluted: true });

  const flat = flatten(original);
  expect(flat['/__proto__/polluted']).toBe(true);

  const rebuilt = unflatten(flat) as Record<string, unknown>;
  expect(Object.hasOwn(rebuilt, '__proto__')).toBe(true);
  expect((rebuilt['__proto__'] as Record<string, unknown>).polluted).toBe(true);
  expect((Object.prototype as unknown as Record<string, unknown>).polluted).toBeUndefined();
});

it('a flat map with a leaf and a container at the same pointer is refused with the pointer named', () => {
  const badMap = { '/foo': 'bar', '/foo/x': 'y' };
  let caught: unknown;
  try {
    unflatten(badMap);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(FlattenError);
  expect((caught as InstanceType<typeof FlattenError>).path).toBe('/foo');
});

it('nesting deeper than 512 levels is refused with a plain message', () => {
  let value: unknown = 'leaf';
  for (let i = 0; i < 513; i++) value = { a: value };
  const text = JSON.stringify(value);
  expect(() => flattenText(text)).toThrow(/nested more than 512 levels deep/);
});

// --- 500-document seeded fuzz pass -----------------------------------------

/** mulberry32: a small, fast, deterministic 32-bit generator. Same seed, same sequence, every time. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deliberately includes the empty key, a digit-only key, and keys containing / and ~. */
const SPECIAL_KEYS = ['', '/', '~', '~1', '0', '01', '__proto__'];

function randomLeaf(rng: () => number): unknown {
  const kind = Math.floor(rng() * 4);
  if (kind === 0) return Math.floor(rng() * 2000) - 1000;
  if (kind === 1) return rng() < 0.5;
  if (kind === 2) return null;
  return `s${Math.floor(rng() * 1000)}`;
}

function randomValue(rng: () => number, depth: number): unknown {
  const kind = depth > 3 ? 0 : Math.floor(rng() * 5);
  if (kind === 0) return randomLeaf(rng);
  if (kind === 1) {
    const n = Math.floor(rng() * 4);
    return Array.from({ length: n }, () => randomValue(rng, depth + 1));
  }
  const n = Math.floor(rng() * 4);
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) {
    const key = rng() < 0.4 ? SPECIAL_KEYS[Math.floor(rng() * SPECIAL_KEYS.length)]! : `k${Math.floor(rng() * 1000)}`;
    setOwn(obj, key, randomValue(rng, depth + 1));
  }
  return obj;
}

it('rebuild of a flattened document is deep equal to the original for 500 seeded random documents', () => {
  const rng = mulberry32(0xc0ffee);
  for (let i = 0; i < 500; i++) {
    const original = randomValue(rng, 0);
    const rebuilt = unflatten(flatten(original));
    expect(rebuilt, `iteration ${i}: ${JSON.stringify(original)}`).toEqual(original);
  }
});

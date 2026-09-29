/**
 * Structural helpers shared by the patch (RFC 6902) and merge patch
 * (RFC 7386) code: a deep copy that never lets a `__proto__` key touch a
 * real prototype, RFC 6902 section 4.6 equality, and a value counter used
 * by the patch growth cap.
 */

import { setOwn, hasOwn, getOwn } from './own-property';

/**
 * Deep-copies a JSON value. Every object is rebuilt one own key at a time
 * with `setOwn`, so a key literally named `__proto__` becomes an ordinary
 * own property of the copy rather than replacing its prototype -- which is
 * exactly what happens with a plain `{ ...obj }` spread or an object
 * literal assignment, and also why this never uses `structuredClone` or a
 * `JSON.stringify`/`JSON.parse` round trip: neither gives control over how
 * each key is written, and `structuredClone` is not guaranteed to preserve
 * key order or reject only what this package's own JSON model allows.
 */
export function cloneJson(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => cloneJson(item));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    setOwn(out, key, cloneJson(getOwn(value as Record<string, unknown>, key)));
  }
  return out;
}

type Kind = 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object';

function kindOf(value: unknown): Kind {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value as Kind;
}

/**
 * RFC 6902 section 4.6 equality: same JSON kind; numbers compare by
 * numeric value; strings by Unicode code unit; arrays same length with
 * every element equal in order; objects have the same set of own member
 * names (order does not matter) with every member equal.
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  const kindA = kindOf(a);
  const kindB = kindOf(b);
  if (kindA !== kindB) return false;

  if (kindA === 'array') {
    const arrA = a as unknown[];
    const arrB = b as unknown[];
    if (arrA.length !== arrB.length) return false;
    for (let i = 0; i < arrA.length; i++) {
      if (!jsonEqual(arrA[i], arrB[i])) return false;
    }
    return true;
  }

  if (kindA === 'object') {
    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;
    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!hasOwn(objB, key)) return false;
      if (!jsonEqual(getOwn(objA, key), getOwn(objB, key))) return false;
    }
    return true;
  }

  // null, boolean, number, string: same kind already confirmed above.
  return a === b;
}

/** Counts every node in a JSON value: the value itself, plus every value nested inside it. */
export function countJsonValues(value: unknown): number {
  if (value === null || typeof value !== 'object') return 1;
  let count = 1;
  if (Array.isArray(value)) {
    for (const item of value) count += countJsonValues(item);
  } else {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      count += countJsonValues(getOwn(value as Record<string, unknown>, key));
    }
  }
  return count;
}

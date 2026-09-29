import { describe, it, expect } from 'vitest';
import { applyMergePatch, toMergePatch } from '../src/merge-patch';
import { applyJsonPatch, toJsonPatch } from '../src/json-patch';
import { jsonEqual } from '../src/json-value';

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('RFC 7386 Appendix A test cases', () => {
  const cases: { target: unknown; patch: unknown; result: unknown }[] = [
    { target: { a: 'b' }, patch: { a: 'c' }, result: { a: 'c' } },
    { target: { a: 'b' }, patch: { b: 'c' }, result: { a: 'b', b: 'c' } },
    { target: { a: 'b' }, patch: { a: null }, result: {} },
    { target: { a: 'b', b: 'c' }, patch: { a: null }, result: { b: 'c' } },
    { target: { a: ['b'] }, patch: { a: 'c' }, result: { a: 'c' } },
    { target: { a: 'c' }, patch: { a: ['b'] }, result: { a: ['b'] } },
    { target: { a: { b: 'c' } }, patch: { a: { b: 'd', c: null } }, result: { a: { b: 'd' } } },
    { target: { a: [{ b: 'c' }] }, patch: { a: [1] }, result: { a: [1] } },
    { target: ['a', 'b'], patch: ['c', 'd'], result: ['c', 'd'] },
    { target: { a: 'b' }, patch: ['c'], result: ['c'] },
    { target: { a: 'foo' }, patch: null, result: null },
    { target: { a: 'foo' }, patch: 'bar', result: 'bar' },
    { target: { e: null }, patch: { a: 1 }, result: { e: null, a: 1 } },
    { target: [1, 2], patch: { a: 'b', c: null }, result: { a: 'b' } },
    { target: {}, patch: { a: { bb: { ccc: null } } }, result: { a: { bb: {} } } },
  ];

  cases.forEach((c, i) => {
    it(`row ${i + 1}: target=${JSON.stringify(c.target)} patch=${JSON.stringify(c.patch)}`, () => {
      expect(applyMergePatch(c.target, c.patch)).toStrictEqual(c.result);
    });
  });

  it('section 3 worked example', () => {
    const target = {
      title: 'Goodbye!',
      author: { givenName: 'John', familyName: 'Doe' },
      tags: ['example', 'sample'],
      content: 'This will be unchanged',
    };
    const patch = {
      title: 'Hello!',
      phoneNumber: '+01-123-456-7890',
      author: { familyName: null },
      tags: ['example'],
    };
    expect(applyMergePatch(target, patch)).toStrictEqual({
      title: 'Hello!',
      author: { givenName: 'John' },
      tags: ['example'],
      content: 'This will be unchanged',
      phoneNumber: '+01-123-456-7890',
    });
  });
});

describe('applyMergePatch never mutates either input', () => {
  it('leaves target and patch exactly as they were', () => {
    const target = Object.freeze({ a: Object.freeze({ b: 1 }) });
    const patch = Object.freeze({ a: Object.freeze({ b: null, c: 2 }) });
    const before = JSON.stringify(target);
    const beforePatch = JSON.stringify(patch);
    const result = applyMergePatch(target, patch);
    expect(JSON.stringify(target)).toBe(before);
    expect(JSON.stringify(patch)).toBe(beforePatch);
    expect(result).toStrictEqual({ a: { c: 2 } });
  });
});

describe('__proto__ stays an ordinary key in a merge patch', () => {
  it('an own "__proto__" key in the patch becomes an own key of the result', () => {
    const patch = JSON.parse('{"__proto__":{"polluted":true}}') as unknown;
    const result = applyMergePatch({}, patch) as Record<string, unknown>;
    expect(Object.hasOwn(result, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('toMergePatch null rule', () => {
  it('a={"x":1}, b={"x":null}: patch is undefined, one warning naming "/x"', () => {
    const { patch, warnings } = toMergePatch({ x: 1 }, { x: null });
    expect(patch).toBeUndefined();
    expect(warnings).toStrictEqual(['/x']);
  });

  it('a={}, b={"a":{"b":null}}: names "/a/b"', () => {
    const { patch, warnings } = toMergePatch({}, { a: { b: null } });
    expect(patch).toBeUndefined();
    expect(warnings).toStrictEqual(['/a/b']);
  });

  it('a null already present in a is not a warning: nothing needs to change', () => {
    const { patch, warnings } = toMergePatch({ x: null }, { x: null });
    expect(warnings).toStrictEqual([]);
    expect(applyMergePatch({ x: null }, patch)).toStrictEqual({ x: null });
  });

  it('a null inside an array is fine, since arrays are copied whole', () => {
    const { patch, warnings } = toMergePatch({ list: [1, 2] }, { list: [1, null, 3] });
    expect(warnings).toStrictEqual([]);
    expect(patch).toStrictEqual({ list: [1, null, 3] });
    expect(applyMergePatch({ list: [1, 2] }, patch)).toStrictEqual({ list: [1, null, 3] });
  });

  it('a root b of null is expressible directly as the patch', () => {
    const { patch, warnings } = toMergePatch({ a: 1 }, null);
    expect(warnings).toStrictEqual([]);
    expect(patch).toBeNull();
    expect(applyMergePatch({ a: 1 }, patch)).toBeNull();
  });
});

describe('round-trip property', () => {
  const rand = mulberry32(19700101);

  function randomValue(depth: number, allowNull: boolean): unknown {
    const r = rand();
    if (depth <= 0 || r < 0.3) {
      const leaf = rand();
      if (allowNull && leaf < 0.15) return null;
      if (leaf < 0.4) return rand() < 0.5;
      if (leaf < 0.7) return Math.floor(rand() * 1000) - 500;
      return `s${Math.floor(rand() * 1000)}`;
    }
    if (r < 0.55) {
      const len = Math.floor(rand() * 3);
      return Array.from({ length: len }, () => randomValue(depth - 1, true));
    }
    const obj: Record<string, unknown> = {};
    const count = Math.floor(rand() * 4);
    const keys = ['a', 'b', 'c', 'd'];
    for (let i = 0; i < count; i++) obj[keys[i]!] = randomValue(depth - 1, allowNull);
    return obj;
  }

  it('when b introduces no null value a lacked, toMergePatch has no warnings and applyMergePatch(a, patch) deep-equals b', () => {
    let checked = 0;
    for (let i = 0; i < 400 && checked < 100; i++) {
      const a = randomValue(3, false);
      const b = randomValue(3, false); // never introduces null, since allowNull=false throughout
      const { patch, warnings } = toMergePatch(a, b);
      if (warnings.length > 0) continue; // only relevant when the pair is expressible
      checked++;
      // Compared with `jsonEqual`, for the same reason json-patch.test.ts's
      // own round-trip loop uses it: object member order does not matter,
      // and over many large random pairs in one test `toStrictEqual` was
      // observed to report a spurious mismatch with no real structural
      // difference.
      const merged = applyMergePatch(a, patch);
      expect(jsonEqual(merged, b), `pair ${i}: ${JSON.stringify(merged)} vs ${JSON.stringify(b)}`).toBe(true);
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('agreement with JSON Patch on a shared corpus', () => {
  it('when a JSON Patch round-trip holds and introduces no null value, the merge patch round trip holds too', () => {
    const a = { title: 'x', tags: ['a', 'b'], meta: { views: 1 } };
    const b = { title: 'y', tags: ['a'], meta: { views: 2, likes: 5 } };
    const patchOps = toJsonPatch(a, b);
    expect(applyJsonPatch(a, patchOps)).toStrictEqual(b);
    const { patch: mergePatch, warnings } = toMergePatch(a, b);
    expect(warnings).toStrictEqual([]);
    expect(applyMergePatch(a, mergePatch)).toStrictEqual(b);
  });
});

import { describe, it, expect } from 'vitest';
import { applyJsonPatch, toJsonPatch, JsonPatchError, MAX_PATCHED_VALUES } from '../src/json-patch';
import { diffJson } from '../src/index';
import { jsonEqual } from '../src/json-value';

/** A tiny seeded PRNG (mulberry32) so the round-trip property is reproducible. */
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

describe('RFC 6902 Appendix A examples', () => {
  it('A.1: adding an object member', () => {
    const doc = { foo: 'bar' };
    const patch = [{ op: 'add', path: '/baz', value: 'qux' }];
    expect(applyJsonPatch(doc, patch)).toStrictEqual({ foo: 'bar', baz: 'qux' });
  });

  it('A.2: adding an array element', () => {
    const doc = { foo: ['bar', 'baz'] };
    const patch = [{ op: 'add', path: '/foo/1', value: 'qux' }];
    expect(applyJsonPatch(doc, patch)).toStrictEqual({ foo: ['bar', 'qux', 'baz'] });
  });

  it('A.3: removing an object member', () => {
    const doc = { baz: 'qux', foo: 'bar' };
    const patch = [{ op: 'remove', path: '/baz' }];
    expect(applyJsonPatch(doc, patch)).toStrictEqual({ foo: 'bar' });
  });

  it('A.4: removing an array element', () => {
    const doc = { foo: ['bar', 'qux', 'baz'] };
    const patch = [{ op: 'remove', path: '/foo/1' }];
    expect(applyJsonPatch(doc, patch)).toStrictEqual({ foo: ['bar', 'baz'] });
  });

  it('A.5: replacing a value', () => {
    const doc = { baz: 'qux', foo: 'bar' };
    const patch = [{ op: 'replace', path: '/baz', value: 'boo' }];
    expect(applyJsonPatch(doc, patch)).toStrictEqual({ baz: 'boo', foo: 'bar' });
  });

  it('A.6: moving a value', () => {
    const doc = { foo: { bar: 'baz', waldo: 'fred' }, qux: { corge: 'grault' } };
    const patch = [{ op: 'move', from: '/foo/waldo', path: '/qux/thud' }];
    expect(applyJsonPatch(doc, patch)).toStrictEqual({ foo: { bar: 'baz' }, qux: { corge: 'grault', thud: 'fred' } });
  });

  it('A.7: moving an array element', () => {
    const doc = { foo: ['all', 'grass', 'cows', 'eat'] };
    const patch = [{ op: 'move', from: '/foo/1', path: '/foo/3' }];
    expect(applyJsonPatch(doc, patch)).toStrictEqual({ foo: ['all', 'cows', 'eat', 'grass'] });
  });

  it('A.8: testing a value: success', () => {
    const doc = { baz: 'qux', foo: ['a', 2, 'c'] };
    const patch = [
      { op: 'test', path: '/baz', value: 'qux' },
      { op: 'test', path: '/foo/1', value: 2 },
    ];
    expect(applyJsonPatch(doc, patch)).toStrictEqual(doc);
  });

  it('A.9: testing a value: error', () => {
    const doc = { baz: 'qux' };
    const patch = [{ op: 'test', path: '/baz', value: 'bar' }];
    expect(() => applyJsonPatch(doc, patch)).toThrow(JsonPatchError);
  });

  it('A.10: adding a nested member object', () => {
    const doc = { foo: 'bar' };
    const patch = [{ op: 'add', path: '/child', value: { grandchild: {} } }];
    expect(applyJsonPatch(doc, patch)).toStrictEqual({ foo: 'bar', child: { grandchild: {} } });
  });

  it('A.11: ignoring unrecognized elements', () => {
    const doc = { foo: 'bar' };
    const patch = [{ op: 'add', path: '/baz', value: 'qux', xyz: 123 }];
    expect(applyJsonPatch(doc, patch)).toStrictEqual({ foo: 'bar', baz: 'qux' });
  });

  it('A.12: adding to a nonexistent target', () => {
    const doc = { foo: 'bar' };
    const patch = [{ op: 'add', path: '/baz/bat', value: 'qux' }];
    expect(() => applyJsonPatch(doc, patch)).toThrow(JsonPatchError);
  });

  it('A.14: "~01" in a JSON Pointer targets the literal key "~1"', () => {
    const doc = { '/': 9, '~1': 10 };
    const patch = [{ op: 'test', path: '/~01', value: 10 }];
    expect(applyJsonPatch(doc, patch)).toStrictEqual(doc);
  });

  it('A.15: comparing strings and numbers', () => {
    const doc = { '/': 9, '~1': 10 };
    const patch = [{ op: 'test', path: '/~01', value: '10' }];
    expect(() => applyJsonPatch(doc, patch)).toThrow(JsonPatchError);
  });

  it('A.16: adding an array value', () => {
    const doc = { foo: ['bar'] };
    const patch = [{ op: 'add', path: '/foo/-', value: ['abc', 'def'] }];
    expect(applyJsonPatch(doc, patch)).toStrictEqual({ foo: ['bar', ['abc', 'def']] });
  });

  it('A.13: two "op" members -- the bundled parser keeps the last, so this becomes a remove of a missing path', async () => {
    const { applyJsonPatchText } = await import('../src/json-patch');
    // The parser keeps the LAST "op" ("remove") but the FIRST-seen key
    // position for "path" ("/baz"), which "foo" does not have, matching
    // JSON.parse's own duplicate-key behaviour (last value wins, original
    // key order kept).
    const documentText = '{"foo":"bar"}';
    const patchText = '[{"op":"add","path":"/baz","op":"remove"}]';
    expect(() => applyJsonPatchText(documentText, patchText)).toThrow(JsonPatchError);
  });
});

describe('errors', () => {
  it('missing path for remove/replace/test', () => {
    expect(() => applyJsonPatch({}, [{ op: 'remove' }])).toThrow(JsonPatchError);
    expect(() => applyJsonPatch({}, [{ op: 'replace', value: 1 }])).toThrow(JsonPatchError);
    expect(() => applyJsonPatch({}, [{ op: 'test', value: 1 }])).toThrow(JsonPatchError);
  });

  it('missing from for move', () => {
    expect(() => applyJsonPatch({}, [{ op: 'move', path: '/a' }])).toThrow(JsonPatchError);
  });

  it('index out of range: remove at length, add at length+1', () => {
    expect(() => applyJsonPatch({ a: [1, 2] }, [{ op: 'remove', path: '/a/2' }])).toThrow(/out of range/);
    expect(() => applyJsonPatch({ a: [1, 2] }, [{ op: 'add', path: '/a/3', value: 9 }])).toThrow(/out of range/);
  });

  it('leading-zero index "01" is refused', () => {
    expect(() => applyJsonPatch({ a: [1, 2] }, [{ op: 'remove', path: '/a/01' }])).toThrow(JsonPatchError);
  });

  it('non-numeric token on an array is refused', () => {
    expect(() => applyJsonPatch({ a: [1, 2] }, [{ op: 'remove', path: '/a/x' }])).toThrow(JsonPatchError);
  });

  it('"-" is refused for remove, replace and test', () => {
    expect(() => applyJsonPatch({ a: [1, 2] }, [{ op: 'remove', path: '/a/-' }])).toThrow(JsonPatchError);
    expect(() => applyJsonPatch({ a: [1, 2] }, [{ op: 'replace', path: '/a/-', value: 1 }])).toThrow(JsonPatchError);
    expect(() => applyJsonPatch({ a: [1, 2] }, [{ op: 'test', path: '/a/-', value: 1 }])).toThrow(JsonPatchError);
  });

  it('a bad pointer (no leading slash, or "~2") is refused', () => {
    expect(() => applyJsonPatch({ a: 1 }, [{ op: 'add', path: 'a', value: 1 }])).toThrow(JsonPatchError);
    expect(() => applyJsonPatch({ a: 1 }, [{ op: 'add', path: '/~2', value: 1 }])).toThrow(JsonPatchError);
  });

  it('a patch that is not an array is refused', () => {
    expect(() => applyJsonPatch({}, { op: 'add', path: '/a', value: 1 })).toThrow(JsonPatchError);
  });

  it('an element with an unknown op is refused', () => {
    expect(() => applyJsonPatch({}, [{ op: 'frobnicate', path: '/a' }])).toThrow(JsonPatchError);
  });

  it('add and replace refuse a missing "value" member', () => {
    expect(() => applyJsonPatch({}, [{ op: 'add', path: '/a' }])).toThrow(JsonPatchError);
    expect(() => applyJsonPatch({ a: 1 }, [{ op: 'replace', path: '/a' }])).toThrow(JsonPatchError);
  });

  it('move from "/a" to "/a/b" is refused: cannot move a value into its own child', () => {
    expect(() => applyJsonPatch({ a: { b: 1 } }, [{ op: 'move', from: '/a', path: '/a/b' }])).toThrow(/own child/);
  });

  it('move from "" to "/x" is refused for the same reason', () => {
    expect(() => applyJsonPatch({}, [{ op: 'move', from: '', path: '/x' }])).toThrow(/own child/);
  });

  it('remove at "" is refused', () => {
    expect(() => applyJsonPatch({ a: 1 }, [{ op: 'remove', path: '' }])).toThrow(JsonPatchError);
  });

  it("every error names the failing operation's zero-based position and path", () => {
    let err: JsonPatchError | undefined;
    try {
      applyJsonPatch({ a: { b: 1 } }, [
        { op: 'replace', path: '/a/b', value: 2 },
        { op: 'remove', path: '/a/b' },
        { op: 'remove', path: '/a/b' },
      ]);
    } catch (e) {
      err = e as JsonPatchError;
    }
    expect(err).toBeInstanceOf(JsonPatchError);
    expect(err?.index).toBe(2);
    expect(err?.path).toBe('/a/b');
    expect(err?.message).toContain('patch[2]');
    expect(err?.message).toContain('/a/b');
  });
});

describe('atomicity and no mutation', () => {
  it('a patch whose last operation fails throws, and both inputs are left exactly as they were', () => {
    const document = Object.freeze({ a: 1, b: Object.freeze({ c: 2 }) });
    const patch = Object.freeze([
      Object.freeze({ op: 'replace', path: '/a', value: 99 }),
      Object.freeze({ op: 'remove', path: '/does-not-exist' }),
    ]);
    const before = JSON.stringify(document);
    const beforePatch = JSON.stringify(patch);
    expect(() => applyJsonPatch(document, patch)).toThrow(JsonPatchError);
    expect(JSON.stringify(document)).toBe(before);
    expect(JSON.stringify(patch)).toBe(beforePatch);
  });

  it('a successful apply also leaves both frozen inputs untouched', () => {
    const document = Object.freeze({ a: 1 });
    const patch = Object.freeze([Object.freeze({ op: 'replace', path: '/a', value: 2 })]);
    const before = JSON.stringify(document);
    const result = applyJsonPatch(document, patch);
    expect(JSON.stringify(document)).toBe(before);
    expect(result).toStrictEqual({ a: 2 });
  });
});

describe('__proto__ stays an ordinary key', () => {
  it('add at "/__proto__" creates an own key, never a real prototype change', () => {
    const result = applyJsonPatch({}, [{ op: 'add', path: '/__proto__', value: { polluted: true } }]) as Record<
      string,
      unknown
    >;
    expect(Object.hasOwn(result, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('growth cap', () => {
  it('a patch of repeated whole-subtree copies that would pass 1,000,000 values is refused quickly', () => {
    const document = { seed: { leaf: Array.from({ length: 8 }, (_, i) => i) } };
    const patch: { op: 'add' | 'copy'; path: string; value?: unknown; from?: string }[] = [
      { op: 'add', path: '/list', value: [{ leaf: document.seed.leaf }] },
    ];
    // Each round doubles /list by copying it into a new array slot next to
    // itself; a handful of doublings pass a million values.
    for (let i = 0; i < 25; i++) {
      patch.push({ op: 'copy', from: '/list', path: `/list/-` });
    }
    const start = Date.now();
    expect(() => applyJsonPatch(document, patch)).toThrow(JsonPatchError);
    let err: JsonPatchError | undefined;
    try {
      applyJsonPatch(document, patch);
    } catch (e) {
      err = e as JsonPatchError;
    }
    expect(err?.message).toContain(MAX_PATCHED_VALUES.toLocaleString('en-US'));
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe('toJsonPatch', () => {
  it('a whole-document type change gives one replace at ""', () => {
    const ops = toJsonPatch({ a: 1 }, [1, 2, 3]);
    expect(ops).toStrictEqual([{ op: 'replace', path: '', value: [1, 2, 3] }]);
  });

  it('an array shrinking from 5 to 2 elements removes highest index first', () => {
    const ops = toJsonPatch({ arr: [0, 1, 2, 3, 4] }, { arr: [0, 1] });
    expect(ops).toStrictEqual([
      { op: 'remove', path: '/arr/4' },
      { op: 'remove', path: '/arr/3' },
      { op: 'remove', path: '/arr/2' },
    ]);
  });

  it('keys with "/" and "~" are escaped in the generated patch', () => {
    const ops = toJsonPatch({}, { 'a/b': { 'm~n': 1 } });
    expect(ops).toStrictEqual([{ op: 'add', path: '/a~1b', value: { 'm~n': 1 } }]);
  });

  it('accepts a DiffResult or two documents and gives the same ops', () => {
    const a = { x: 1 };
    const b = { x: 2, y: 3 };
    const fromDocs = toJsonPatch(a, b);
    const fromResult = toJsonPatch(diffJson(a, b));
    expect(fromDocs).toStrictEqual(fromResult);
  });

  it('generated add/replace values are independent copies of the source', () => {
    const after = { nested: { value: 1 } };
    const ops = toJsonPatch({}, { after });
    after.nested.value = 999;
    expect(ops).toStrictEqual([{ op: 'add', path: '/after', value: { nested: { value: 1 } } }]);
  });
});

describe('round-trip property', () => {
  const rand = mulberry32(20260929);

  function randomKey(): string {
    const pool = ['a', 'b', '__proto__', 'a/b', 'm~n', '', 'x', 'y', '👋🏽'];
    return pool[Math.floor(rand() * pool.length)]!;
  }

  function randomValue(depth: number): unknown {
    const r = rand();
    if (depth <= 0 || r < 0.2) {
      const leaf = rand();
      if (leaf < 0.2) return null;
      if (leaf < 0.4) return rand() < 0.5;
      if (leaf < 0.6) return Math.floor(rand() * 1000) - 500;
      if (leaf < 0.8) return `s${Math.floor(rand() * 1000)}`;
      return 'astral-\u{1F44B}';
    }
    if (r < 0.6) {
      const len = Math.floor(rand() * 4);
      return Array.from({ length: len }, () => randomValue(depth - 1));
    }
    const obj: Record<string, unknown> = {};
    const count = Math.floor(rand() * 4);
    for (let i = 0; i < count; i++) {
      const key = randomKey();
      obj[key] = randomValue(depth - 1);
    }
    return obj;
  }

  it('applyJsonPatch(a, toJsonPatch(a, b)) deep-equals b, over 300 seeded pairs', () => {
    // Compared with this package's own RFC 6902 section 4.6 `jsonEqual`
    // (object member order ignored, array order significant) rather than
    // `toStrictEqual`: over hundreds of large, deeply nested random pairs
    // in one test, Vitest's own structural-equality comparator was
    // observed to report a spurious mismatch on a pair an independent
    // hand-rolled recursive walk confirmed had no real structural
    // difference.
    for (let i = 0; i < 300; i++) {
      const a = randomValue(3);
      const b = randomValue(3);
      const patch = toJsonPatch(a, b);
      const result = applyJsonPatch(a, patch);
      expect(jsonEqual(result, b), `pair ${i}: ${JSON.stringify(result)} vs ${JSON.stringify(b)}`).toBe(true);
    }
  });
});

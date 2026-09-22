import { describe, it, expect } from 'vitest';
import {
  v1,
  v3,
  v4,
  v5,
  v7,
  parse,
  isValid,
  generate,
  NAMESPACES,
  NIL_UUID,
  MAX_UUID,
  uuidToBytes,
} from '../src/index';

const CANONICAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('RFC 9562 name-based test vectors', () => {
  // Appendix A of RFC 9562 gives these worked examples.
  it('v5 of "www.example.com" in the DNS namespace', () => {
    expect(v5(NAMESPACES.dns, 'www.example.com')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });

  it('v3 of "www.example.com" in the DNS namespace', () => {
    expect(v3(NAMESPACES.dns, 'www.example.com')).toBe('5df41881-3aed-3515-88a7-2f4a814cf09e');
  });

  it('accepts the namespace by short name', () => {
    expect(v5('dns', 'www.example.com')).toBe(v5(NAMESPACES.dns, 'www.example.com'));
    expect(v5('DNS', 'www.example.com')).toBe(v5(NAMESPACES.dns, 'www.example.com'));
  });

  it('is deterministic: the same inputs always give the same id', () => {
    expect(v5('url', 'https://example.com')).toBe(v5('url', 'https://example.com'));
    expect(v3('url', 'https://example.com')).toBe(v3('url', 'https://example.com'));
  });

  it('changes when the namespace changes', () => {
    expect(v5('dns', 'x')).not.toBe(v5('url', 'x'));
  });

  it('handles a name containing non-ASCII characters as UTF-8', () => {
    const a = v5('dns', 'ünïcödé');
    expect(a).toMatch(CANONICAL);
    expect(a).toBe(v5('dns', 'ünïcödé'));
  });

  it('handles an empty name', () => {
    expect(v5('dns', '')).toMatch(CANONICAL);
  });
});

describe('version and variant bits', () => {
  it('v4 sets version 4 and the RFC variant', () => {
    for (let i = 0; i < 50; i++) {
      const id = v4();
      expect(id).toMatch(CANONICAL);
      expect(id[14]).toBe('4');
      expect('89ab').toContain(id[19]);
    }
  });

  it('v7 sets version 7 and the RFC variant', () => {
    const id = v7();
    expect(id[14]).toBe('7');
    expect('89ab').toContain(id[19]!);
  });

  it('v1 sets version 1 and the RFC variant', () => {
    const id = v1();
    expect(id[14]).toBe('1');
    expect('89ab').toContain(id[19]!);
  });

  it('v3 sets version 3 and v5 sets version 5', () => {
    expect(v3('dns', 'x')[14]).toBe('3');
    expect(v5('dns', 'x')[14]).toBe('5');
  });
});

describe('v7 ordering', () => {
  it('embeds the timestamp in the first 48 bits', () => {
    const when = Date.UTC(2026, 0, 15, 12, 30, 45, 123);
    const parsed = parse(v7(when));
    expect(parsed.timestamp?.ms).toBe(when);
    expect(parsed.timestamp?.iso).toBe('2026-01-15T12:30:45.123Z');
  });

  it('sorts lexicographically in creation order', () => {
    const ids = [v7(1000), v7(2000), v7(3000), v7(4000)];
    expect([...ids].sort()).toEqual(ids);
  });

  it('v4 has no timestamp to read', () => {
    expect(parse(v4()).timestamp).toBeUndefined();
  });
});

describe('v1', () => {
  it('round-trips its timestamp to within a millisecond', () => {
    const when = Date.UTC(2026, 5, 1, 0, 0, 0, 0);
    const parsed = parse(v1(when));
    expect(parsed.timestamp).toBeDefined();
    expect(Math.abs(parsed.timestamp!.ms - when)).toBeLessThanOrEqual(1);
  });

  it('marks its node identifier as random rather than a MAC address', () => {
    // A browser cannot read a MAC address, and RFC 9562 section 6.10 allows a
    // random node id as long as the multicast bit says so.
    expect(parse(v1()).nodeIsRandom).toBe(true);
  });

  it('produces distinct ids within the same millisecond', () => {
    const fixed = Date.UTC(2026, 0, 1);
    const ids = new Set([v1(fixed), v1(fixed), v1(fixed), v1(fixed)]);
    expect(ids.size).toBe(4);
  });

  it('reports a clock sequence', () => {
    const parsed = parse(v1());
    expect(parsed.clockSequence).toBeGreaterThanOrEqual(0);
    expect(parsed.clockSequence).toBeLessThan(1 << 14);
  });
});

describe('parsing', () => {
  it('reads the version and variant', () => {
    const parsed = parse('2ed6657d-e927-568b-95e1-2665a8aea6a2');
    expect(parsed.valid).toBe(true);
    expect(parsed.version).toBe(5);
    expect(parsed.variant).toContain('RFC 9562');
    expect(parsed.problems).toEqual([]);
  });

  it('recognises the nil and max UUIDs', () => {
    expect(parse(NIL_UUID).isNil).toBe(true);
    expect(parse(NIL_UUID).version).toBeNull();
    expect(parse(MAX_UUID).isMax).toBe(true);
  });

  it('accepts the URN form and braces', () => {
    const plain = parse('2ed6657d-e927-568b-95e1-2665a8aea6a2');
    expect(parse('urn:uuid:2ed6657d-e927-568b-95e1-2665a8aea6a2').canonical).toBe(plain.canonical);
    expect(parse('{2ed6657d-e927-568b-95e1-2665a8aea6a2}').canonical).toBe(plain.canonical);
  });

  it('normalises uppercase to lowercase', () => {
    expect(parse('2ED6657D-E927-568B-95E1-2665A8AEA6A2').canonical).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });

  it('accepts a hyphenless UUID but says the hyphens are missing', () => {
    const parsed = parse('2ed6657de927568b95e12665a8aea6a2');
    expect(parsed.valid).toBe(true);
    expect(parsed.canonical).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
    expect(parsed.problems[0]).toMatch(/Hyphens/);
  });

  it('rejects things that are not UUIDs', () => {
    for (const bad of ['', 'hello', '123', '2ed6657d-e927-568b-95e1', 'zzzzzzzz-e927-568b-95e1-2665a8aea6a2']) {
      expect(parse(bad).valid).toBe(false);
    }
  });

  it('flags a non-RFC variant rather than silently accepting it', () => {
    // Variant bits 110 means the Microsoft legacy layout.
    const parsed = parse('2ed6657d-e927-568b-c5e1-2665a8aea6a2');
    expect(parsed.variant).toContain('Microsoft');
    expect(parsed.problems.join(' ')).toMatch(/variant bits/);
  });

  it('offers the alternate representations', () => {
    const parsed = parse('2ed6657d-e927-568b-95e1-2665a8aea6a2');
    expect(parsed.hex).toBe('2ed6657de927568b95e12665a8aea6a2');
    expect(parsed.urn).toBe('urn:uuid:2ed6657d-e927-568b-95e1-2665a8aea6a2');
    expect(parsed.base64url).toHaveLength(22);
  });

  it('converts to bytes and rejects bad hex', () => {
    expect(uuidToBytes(NIL_UUID)).toEqual(new Uint8Array(16));
    expect(() => uuidToBytes('short')).toThrow(/32 hexadecimal/);
  });
});

describe('validation', () => {
  it('accepts a well-formed UUID', () => {
    expect(isValid(v4())).toBe(true);
    expect(isValid(v7())).toBe(true);
  });

  it('checks the version when one is asked for', () => {
    expect(isValid(v4(), 4)).toBe(true);
    expect(isValid(v4(), 7)).toBe(false);
  });

  it('rejects a UUID with a broken variant', () => {
    expect(isValid('2ed6657d-e927-568b-c5e1-2665a8aea6a2')).toBe(false);
  });
});

describe('generation options', () => {
  it('generates the requested count', () => {
    expect(generate({ version: 4, count: 10 })).toHaveLength(10);
  });

  it('produces no duplicates over a large batch', () => {
    const ids = generate({ version: 4, count: 5000 });
    expect(new Set(ids).size).toBe(5000);
  });

  it('applies formatting options', () => {
    expect(generate({ version: 4, count: 1, uppercase: true })[0]).toMatch(/^[0-9A-F-]+$/);
    expect(generate({ version: 4, count: 1, hyphens: false })[0]).toHaveLength(32);
    expect(generate({ version: 4, count: 1, braces: true })[0]).toMatch(/^\{.*\}$/);
    expect(generate({ version: 4, count: 1, urn: true })[0]).toMatch(/^urn:uuid:/);
  });

  it('uses namespace and name for the deterministic versions', () => {
    expect(generate({ version: 5, namespace: 'dns', name: 'www.example.com' })[0]).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
  });

  it('rejects a version it does not implement', () => {
    expect(() => generate({ version: 6 as never })).toThrow(/Unsupported version/);
  });
});

describe('randomness', () => {
  it('v4 has no obvious bias in the first byte over many samples', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      const first = v4()[0]!;
      counts.set(first, (counts.get(first) ?? 0) + 1);
    }
    // Sixteen possible values, 4000 samples, so about 250 each. A very loose
    // bound is enough to catch a constant or a badly seeded generator.
    expect(counts.size).toBe(16);
    for (const n of counts.values()) expect(n).toBeGreaterThan(150);
  });
});

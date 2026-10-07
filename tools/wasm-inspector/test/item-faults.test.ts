import { expect, it } from 'vitest';
import { Cursor, WasmInspectorError, inspect } from '../src/index';
import { readValType } from '../src/types';
import { HEADER, moduleOf, mulberry32, name, section, uleb } from './helpers';

/*
 * Faults that repeat once per item (D-234). A module whose every function body, name or name subsection is slightly wrong
 * must cost about what a module of the same number of good items costs: a fault found per item is a finding, never an
 * error thrown and caught, and a finding past the 200 kept builds no sentence. Each broken shape is timed against its
 * good twin with the same number of items, median of 5 samples; a ratio over 10 fails. Where a ratio reads over its limit
 * under load it is measured twice more and the median of three is judged; the limit is never raised.
 */

/** The time in milliseconds of reading `bytes` `reps` times. */
function time(bytes: Uint8Array, reps: number): number {
  const start = performance.now();
  for (let i = 0; i < reps; i++) inspect(bytes);
  return performance.now() - start;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** How many times longer reading `broken` takes than reading `good`, each the median of 5 samples of at least 2 ms. */
function costRatio(broken: Uint8Array, good: Uint8Array): number {
  time(broken, 1);
  time(good, 1);
  const probe = Math.max(time(good, 1), 0.001);
  const reps = Math.min(500, Math.max(1, Math.ceil(2 / probe)));
  const samples = (bytes: Uint8Array): number => {
    const timings: number[] = [];
    for (let i = 0; i < 5; i++) timings.push(time(bytes, reps));
    return median(timings);
  };
  const a = samples(good);
  const b = samples(broken);
  return b / Math.max(a, 0.0005);
}

const MAX_BROKEN_RATIO = 10;

/** A vector of `n` copies of `item`, as bytes. */
function copies(n: number, item: readonly number[]): Uint8Array {
  const head = uleb(n);
  const out = new Uint8Array(head.length + n * item.length);
  out.set(head, 0);
  for (let i = 0; i < n; i++) out.set(item, head.length + i * item.length);
  return out;
}

/** A module of the header and one section whose content is `content`. */
function oneSection(id: number, prefix: readonly number[], content: Uint8Array): Uint8Array {
  const size = prefix.length + content.length;
  const head = [...HEADER, id, ...uleb(size), ...prefix];
  const out = new Uint8Array(head.length + content.length);
  out.set(head, 0);
  out.set(content, head.length);
  return out;
}

/** A name section whose content is the subsections given. */
function nameSection(subsections: Uint8Array): Uint8Array {
  return oneSection(0, name('name'), subsections);
}

/** The function names subsection with `n` entries whose names are each the one byte `byte`. */
function functionNames(n: number, byte: number): Uint8Array {
  const entries: number[] = [];
  for (let i = 0; i < n; i++) entries.push(...uleb(i), 0x01, byte);
  const body = [...uleb(n), ...entries];
  return Uint8Array.from([0x01, ...uleb(body.length), ...body]);
}

interface Pair {
  label: string;
  broken: (n: number) => Uint8Array;
  good: (n: number) => Uint8Array;
}

const PAIRS: readonly Pair[] = [
  {
    // A body of size 0 has no locals declaration, so every body fails the locals check. The bodies are followed by as many
    // zeros again as the good twin's bodies take, so both are the same size (the zeros left over are one more finding).
    label: 'function bodies of size 0',
    broken: (n) => oneSection(10, [], copies(n, [0x00, 0x00, 0x00])),
    good: (n) => oneSection(10, [], copies(n, [0x02, 0x00, 0x0b])),
  },
  {
    label: 'function names that are each the one byte ff',
    broken: (n) => nameSection(functionNames(n, 0xff)),
    good: (n) => nameSection(functionNames(n, 0x61)),
  },
  {
    label: 'export names that are each the one byte ff',
    broken: (n) => oneSection(7, [], copies(n, [0x01, 0xff, 0x00, 0x00])),
    good: (n) => oneSection(7, [], copies(n, [0x01, 0x65, 0x00, 0x00])),
  },
  {
    label: 'import names that are each the one byte ff',
    broken: (n) => oneSection(2, [], copies(n, [0x01, 0xff, 0x01, 0xff, 0x03, 0x7f, 0x00])),
    good: (n) => oneSection(2, [], copies(n, [0x01, 0x6d, 0x01, 0x66, 0x03, 0x7f, 0x00])),
  },
  {
    // A module name subsection with no content cannot be read; one holding the empty name can.
    label: 'name subsections that cannot be read',
    broken: (n) => nameSection(copies(n, [0x00, 0x00]).subarray(uleb(n).length)),
    good: (n) => nameSection(copies(n, [0x00, 0x01, 0x00]).subarray(uleb(n).length)),
  },
];

it('a module whose every item is slightly wrong costs about what a module of good items costs', () => {
  const n = 20_000;
  const failures: string[] = [];
  for (const pair of PAIRS) {
    const broken = pair.broken(n);
    const good = pair.good(n);
    // The broken shape really is broken, and the good one is not, in the way the label says.
    expect(inspect(broken).findings.length, pair.label).toBeGreaterThan(0);
    let ratio = costRatio(broken, good);
    if (ratio > MAX_BROKEN_RATIO)
      ratio = [ratio, costRatio(broken, good), costRatio(broken, good)].sort((a, b) => a - b)[1]!;
    if (ratio > MAX_BROKEN_RATIO) failures.push(`${pair.label}: ${ratio.toFixed(1)} (limit ${MAX_BROKEN_RATIO})`);
  }
  expect(failures).toEqual([]);
}, 240_000);

it('findings past the 200 kept are counted, and every broken item is one of them', () => {
  const n = 5_000;
  const report = inspect(oneSection(10, [], copies(n, [0x00, 0x00, 0x00])));
  // One finding per body, one for the zeros left over and one that says the function and code sections disagree.
  expect(report.findings).toHaveLength(200);
  expect(report.findings.length + report.findingsLeftOut).toBe(n + 2);
  expect(report.functions.largestLeftOut + report.functions.largest.length).toBe(n);
});

// ---------------------------------------------------------------------------------------------------------------------
// The checks made once per item give exactly the answer of the readers that throw.
// ---------------------------------------------------------------------------------------------------------------------

const STRICT = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const LOSSY = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });

/** Bytes that sit on the edges of the UTF-8 rules: lead bytes, continuation bytes, the surrogate and the overlong edges. */
const UTF8_EDGES = [
  0x00, 0x41, 0x7f, 0x80, 0x8f, 0x90, 0x9f, 0xa0, 0xbf, 0xc0, 0xc1, 0xc2, 0xdf, 0xe0, 0xe1, 0xec, 0xed, 0xee, 0xef,
  0xf0, 0xf1, 0xf3, 0xf4, 0xf5, 0xf8, 0xfe, 0xff,
];

it('a name is judged valid UTF-8 exactly when the strict decoder accepts it, and is shown as the lossy decoder shows it', () => {
  const random = mulberry32(19_190_701);
  let invalid = 0;
  for (let round = 0; round < 6000; round++) {
    const length = Math.floor(random() * 7);
    const raw = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      raw[i] = random() < 0.8 ? UTF8_EDGES[Math.floor(random() * UTF8_EDGES.length)]! : Math.floor(random() * 256);
    }
    let valid = true;
    try {
      STRICT.decode(raw);
    } catch {
      valid = false;
    }
    if (!valid) invalid++;
    const report = inspect(moduleOf(section(7, [0x01, ...uleb(length), ...raw, 0x00, 0x00])));
    const utf8Findings = report.findings.filter((f) => /malformed UTF-8 encoding/.test(f.message));
    expect(utf8Findings.length, `bytes ${Array.from(raw).join(' ')}`).toBe(valid ? 0 : 1);
    if (!valid) expect(utf8Findings[0]!.offset).toBe(HEADER.length + 3);
    expect(report.exports.rows[0]?.name).toBe(LOSSY.decode(raw));
  }
  // Both answers came up many times.
  expect(invalid).toBeGreaterThan(1000);
  expect(invalid).toBeLessThan(5000);
});

/** The locals check as the throwing readers make it: the first fault, at its offset in the body, or null. */
function referenceLocals(body: Uint8Array): { offset: number; message: string } | null {
  const c = new Cursor(body, 0, body.length);
  try {
    const groups = c.count(2);
    let total = 0;
    for (let i = 0; i < groups; i++) {
      const at = c.pos;
      total += c.u32();
      readValType(c);
      if (total > 0xffffffff) {
        return { offset: at, message: 'A function declares more than 4,294,967,295 locals (too many locals).' };
      }
    }
    return null;
  } catch (error) {
    if (!(error instanceof WasmInspectorError)) throw error;
    return { offset: error.offset ?? -1, message: error.message };
  }
}

/** Bytes that sit on the edges of the locals rules: number, vector and reference types, heap types and LEB128 edges. */
const LOCALS_EDGES = [
  0x00, 0x01, 0x02, 0x03, 0x0b, 0x0f, 0x10, 0x1f, 0x20, 0x3f, 0x40, 0x41, 0x5f, 0x60, 0x62, 0x63, 0x64, 0x68, 0x69,
  0x6f, 0x70, 0x74, 0x75, 0x77, 0x78, 0x7b, 0x7c, 0x7f, 0x80, 0x8f, 0xc0, 0xff,
];

it('the locals check gives the fault, the offset and the sentence the throwing readers give, for every seeded body', () => {
  const random = mulberry32(19_190_702);
  const bodies: Uint8Array[] = [
    // Locals that add up to more than 4,294,967,295, and exactly to it.
    Uint8Array.from([0x02, 0xff, 0xff, 0xff, 0xff, 0x0f, 0x7f, 0x01, 0x7f]),
    Uint8Array.from([0x02, 0xfe, 0xff, 0xff, 0xff, 0x0f, 0x7f, 0x01, 0x7f, 0x0b]),
    // A concrete heap type with a negative index, and one with the largest index the width allows.
    Uint8Array.from([0x01, 0x01, 0x63, 0x40, 0x0b]),
    Uint8Array.from([0x01, 0x01, 0x64, 0xff, 0xff, 0xff, 0xff, 0x0f, 0x0b]),
    Uint8Array.from([0x01, 0x01, 0x64, 0xff, 0xff, 0xff, 0xff, 0x1f, 0x0b]),
    Uint8Array.from([0x01, 0x01, 0x64, 0x80, 0x80, 0x80, 0x80, 0x70, 0x0b]),
    Uint8Array.from([0x01, 0x01, 0x64, 0x80, 0x80, 0x80, 0x80, 0x60, 0x0b]),
    // A fifth byte whose bit 5 alone breaks the sign rule, positive and negative.
    Uint8Array.from([0x01, 0x01, 0x64, 0x80, 0x80, 0x80, 0x80, 0x20, 0x0b]),
    Uint8Array.from([0x01, 0x01, 0x64, 0x80, 0x80, 0x80, 0x80, 0x50, 0x0b]),
  ];
  for (let round = 0; round < 8000; round++) {
    const length = Math.floor(random() * 10);
    const body = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      body[i] =
        random() < 0.85 ? LOCALS_EDGES[Math.floor(random() * LOCALS_EDGES.length)]! : Math.floor(random() * 256);
    }
    bodies.push(body);
  }
  let faults = 0;
  for (const body of bodies) {
    const expected = referenceLocals(body);
    // Two bytes after the body, so the code section always holds the 3 bytes a body takes at least.
    const code = [0x01, ...uleb(body.length), ...body, 0x00, 0x00];
    const bytes = Uint8Array.from([...HEADER, 10, ...uleb(code.length), ...code]);
    const bodyStart = bytes.length - 2 - body.length;
    const found = inspect(bytes).findings.filter((f) => /in the body that starts at offset/.test(f.message));
    const label = `body ${Array.from(body).join(' ')}`;
    if (expected === null) {
      expect(found, label).toEqual([]);
      continue;
    }
    faults++;
    expect(found, label).toEqual([
      {
        offset: bodyStart + expected.offset,
        message: `At offset ${bodyStart + expected.offset}: ${expected.message} This is in the code section, in the body that starts at offset ${bodyStart}.`,
      },
    ]);
  }
  expect(faults).toBeGreaterThan(2000);
  expect(bodies.length - faults).toBeGreaterThan(200);
});

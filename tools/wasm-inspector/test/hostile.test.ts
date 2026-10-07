import { expect, it, vi } from 'vitest';
import { MAX_MODULE_BYTES, WasmInspectorError, checkModuleSize, inspect } from '../src/index';
import { fixtureBytes } from './fixtures/fixture';
import { bytesOfLatin1, custom, HEADER, mulberry32, moduleOf, name, section, toHex, uleb, vec } from './helpers';
import { HOSTILE, MAX_SCALING_RATIO, scalingRatio } from './scaling';

/*
 * Hostile input (D-234). The size limit is 64 MiB and is judged from the length alone; every count is compared with the bytes
 * that remain before an array is sized; reading is one pass, with no recursion over the input. Doubling a hostile input must
 * not make a reader take more than 6 times as long (a reader that reads its input once takes about 2 times as long), and an
 * input four times as long must not take more than 12 times as long, which catches growth that doubling alone hides.
 * Where a ratio reads over its limit under load it is measured twice more and the median of three is judged; the limit is
 * never raised. No refusal repeats module bytes.
 */

const TYPE_SECTION = section(1, vec([[0x60, 0x00, 0x00]]));

it('a module over 64 MiB is refused before reading', () => {
  expect(MAX_MODULE_BYTES).toBe(67_108_864);
  expect(() => checkModuleSize(MAX_MODULE_BYTES)).not.toThrow();
  expect(() => checkModuleSize(MAX_MODULE_BYTES + 1)).toThrow(WasmInspectorError);
  expect(() => checkModuleSize(MAX_MODULE_BYTES + 1)).toThrow(/64 MiB/);

  // A file one byte over is refused from its length alone. A file of exactly 64 MiB is read (zeros are not a module, which
  // is one sentence and not a refusal).
  expect(() => inspect(new Uint8Array(MAX_MODULE_BYTES + 1))).toThrow(/larger than the 64 MiB/);
  expect(inspect(new Uint8Array(MAX_MODULE_BYTES)).kind).toBe('unreadable');
});

it('a million functions are measured as typed arrays and the 50 largest are listed', () => {
  const n = 1_000_000;
  const functionSection = Uint8Array.from([3, ...uleb(uleb(n).length + n), ...uleb(n), ...new Uint8Array(n)]);
  const bodies = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    bodies[i * 3] = 2;
    bodies[i * 3 + 2] = 0x0b;
  }
  const codeSection = Uint8Array.from([10, ...uleb(uleb(n).length + bodies.length), ...uleb(n), ...bodies]);
  const bytes = Uint8Array.from([...HEADER, ...TYPE_SECTION, ...functionSection, ...codeSection]);

  const report = inspect(bytes);
  expect(report.findings).toEqual([]);
  expect(report.functions.defined).toBe(n);
  expect(report.functions.largest).toHaveLength(50);
  expect(report.functions.largestLeftOut).toBe(n - 50);
  // Equal sizes: the lowest indices come first.
  expect(report.functions.largest.map((f) => f.index)).toEqual(Array.from({ length: 50 }, (_, i) => i));
  expect(report.functions.bodyBytes).toBe(2 * n);
});

// ---------------------------------------------------------------------------------------------------------------------
// Linear time.
// ---------------------------------------------------------------------------------------------------------------------

const read = (text: string): unknown => inspect(bytesOfLatin1(text));

/** Bytes as a string with one character per byte, in pieces so a long list does not overflow the call stack. */
function latin1(bytes: readonly number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.slice(i, i + 8192));
  return out;
}

/** A module as text: the header and the sections. */
function moduleText(...sections: (readonly number[])[]): string {
  return latin1([...HEADER, ...sections.flat()]);
}

/** A vector of `n` copies of `item`. */
function copies(n: number, item: readonly number[]): number[] {
  const out: number[] = [...uleb(n)];
  for (let i = 0; i < n; i++) out.push(...item);
  return out;
}

interface Shape {
  label: string;
  make: (n: number) => string;
}

const SHAPES: readonly Shape[] = [
  // The six hostile strings of the shared helper, as the name of a custom section and as a stray tail after a good section.
  ...HOSTILE.map((hostile, i): Shape => ({
    label: `hostile string ${i} as a name`,
    make: (n) => moduleText(custom(hostile(n))),
  })),
  ...HOSTILE.map((hostile, i): Shape => ({
    label: `hostile string ${i} after a section`,
    make: (n) => moduleText(TYPE_SECTION) + hostile(n),
  })),
  { label: 'empty custom sections', make: (n) => moduleText(copies(n, [0x00, 0x01, 0x00]).slice(uleb(n).length)) },
  { label: 'repeated sections', make: (n) => moduleText(copies(n, [0x01, 0x01, 0x00]).slice(uleb(n).length)) },
  { label: 'exports', make: (n) => moduleText(section(7, copies(n, [...name('e'), 0x00, 0x00]))) },
  { label: 'imports', make: (n) => moduleText(section(2, copies(n, [...name('m'), ...name('f'), 0x00, 0x00]))) },
  { label: 'function types', make: (n) => moduleText(section(1, copies(n, [0x60, 0x01, 0x7f, 0x01, 0x7f]))) },
  {
    label: 'one recursive group of array types',
    make: (n) => moduleText(section(1, [0x01, 0x4e, ...copies(n, [0x5e, 0x78, 0x01])])),
  },
  { label: 'globals', make: (n) => moduleText(section(6, copies(n, [0x7f, 0x00, 0x41, 0x01, 0x0b]))) },
  {
    label: 'one long constant expression',
    make: (n) => moduleText(section(6, [0x01, 0x7f, 0x00, 0x41, 0x01, ...new Array<number>(n).fill(0x6a), 0x0b])),
  },
  { label: 'element segments', make: (n) => moduleText(section(9, copies(n, [0x01, 0x00, 0x01, 0x00]))) },
  {
    label: 'data segments holding text',
    make: (n) => moduleText(section(11, copies(n, [0x01, 0x07, ...Array.from('abcdefg', (c) => c.charCodeAt(0))]))),
  },
  {
    label: 'one data segment of text',
    make: (n) => moduleText(section(11, [0x01, 0x01, ...uleb(n), ...new Array<number>(n).fill(0x61)])),
  },
  { label: 'function bodies', make: (n) => moduleText(section(10, copies(n, [0x02, 0x00, 0x0b]))) },
  {
    label: 'one body with many locals declarations',
    make: (n) => {
      const body: number[] = [...uleb(n)];
      for (let i = 0; i < n; i++) body.push(0x01, 0x7f);
      body.push(0x0b);
      return moduleText(section(10, vec([[...uleb(body.length), ...body]])));
    },
  },
  {
    label: 'a name section with many function names',
    make: (n) => {
      const entries: number[] = [];
      for (let i = 0; i < n; i++) entries.push(...uleb(i), 0x01, 0x61);
      const body = [...uleb(n), ...entries];
      return moduleText(custom('name', [0x01, ...uleb(body.length), ...body]));
    },
  },
  { label: 'producers fields', make: (n) => moduleText(custom('producers', copies(n, [0x01, 0x61, 0x00]))) },
  { label: 'target features', make: (n) => moduleText(custom('target_features', copies(n, [0x2b, 0x01, 0x61]))) },
];

/** The ratio of the time to read a four times larger input to the time to read the base one. */
function fourTimesRatio(make: (n: number) => string, n: number): number {
  return scalingRatio(read, (k) => make(k === n ? n : 4 * n), n);
}

it('every reader stays linear on hostile input', () => {
  const failures: string[] = [];
  const size = 3000;
  for (const shape of SHAPES) {
    const checks: [string, () => number, number][] = [
      ['x2', () => scalingRatio(read, shape.make, size), MAX_SCALING_RATIO],
      ['x4', () => fourTimesRatio(shape.make, size), 12],
    ];
    for (const [label, measure, limit] of checks) {
      let ratio = measure();
      if (ratio > limit) ratio = [ratio, measure(), measure()].sort((a, b) => a - b)[1]!;
      if (ratio > limit) failures.push(`${shape.label} ${label}: ${ratio.toFixed(1)} (limit ${limit})`);
    }
  }
  expect(failures).toEqual([]);
}, 240_000);

it('the same bytes read again give an equal report however many times and in whatever order', () => {
  const fixture = fixtureBytes();
  const other = moduleOf(TYPE_SECTION, custom('x', [1, 2, 3]));
  const first = inspect(fixture);
  inspect(other);
  const second = inspect(fixture);
  expect(second).toEqual(first);
  expect(inspect(other)).toEqual(inspect(other));
});

// ---------------------------------------------------------------------------------------------------------------------
// Refusals never repeat module bytes.
// ---------------------------------------------------------------------------------------------------------------------

it('refusals name offsets and never repeat module bytes', () => {
  const marker = 'MARKER-q7x2k9';
  const markerBytes = [...new TextEncoder().encode(marker)];
  const markerHex = toHex(Uint8Array.from(markerBytes));
  const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];

  // The marker rides inside names, custom section payloads and the bytes after a fault, in modules broken in many ways.
  const cases: Uint8Array[] = [
    moduleOf(section(7, vec([[...name(marker), 0x09, 0x00]]))), // an export kind that does not exist
    moduleOf(section(2, vec([[...name(marker), ...name(marker), 0x00, 0xff, 0xff, 0xff, 0xff, 0x7f]]))), // an overlong type index
    moduleOf(section(1, [0x01, 0x60, 0xff, 0xff, 0xff, 0xff, 0x0f, ...markerBytes])), // a count larger than what remains
    moduleOf(custom(marker, [0xff, 0xff, 0xff]), section(1, [0x01, 0x7f, ...markerBytes])), // a bad type definition
    moduleOf(section(0, [0x01, 0xff, ...markerBytes])), // a custom section name that is not UTF-8
    moduleOf(section(0, [...uleb(markerBytes.length), ...markerBytes.slice(0, 3)])), // a name cut short
    moduleOf(TYPE_SECTION, [10, 0xff, 0xff, 0x03, ...markerBytes]), // a section size past the end
    moduleOf([14, markerBytes.length, ...markerBytes]), // a section id that does not exist
    moduleOf(custom('name', [1, 5, ...markerBytes])), // a name subsection that does not fit
    moduleOf(custom('producers', [...uleb(1), ...name(marker), 0xff, 0xff, 0xff, 0xff, 0x0f])),
    moduleOf(custom('sourceMappingURL', [0xff, 0xff, 0xff, 0xff, 0x0f, ...markerBytes])),
    Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x02, 0x00, 0x00, 0x00, ...markerBytes]), // a version that does not exist
    Uint8Array.from(markerBytes), // not a module at all
    moduleOf(section(6, vec([[0x7f, 0x00, 0x41, 0xff, 0xff, 0xff, 0xff, 0x7f, ...markerBytes]]))), // an expression that does not end
  ];
  // Plus every cut-off copy of one module that holds the marker in a name and in an address.
  const rich = moduleOf(
    TYPE_SECTION,
    section(7, vec([[...name(marker), 0x00, 0x00]])),
    custom('sourceMappingURL', name(`https://example.test/${marker}`)),
  );
  for (let length = 0; length < rich.length; length += 3) cases.push(rich.slice(0, length));

  let withFindings = 0;
  for (const bytes of cases) {
    const report = inspect(bytes);
    if (report.findings.length > 0) withFindings++;
    for (const text of [report.sentence ?? '', ...report.findings.map((f) => f.message)]) {
      expect(text, 'a message repeats the marker').not.toContain(marker);
      expect(text.toLowerCase(), 'a message repeats the marker as hex').not.toContain(markerHex);
    }
    for (const finding of report.findings) {
      expect(finding.message, 'a finding names its offset').toContain(`offset ${finding.offset}`);
      expect(Number.isInteger(finding.offset) && finding.offset >= 0 && finding.offset <= bytes.length).toBe(true);
    }
  }
  expect(withFindings, 'most of these modules are broken').toBeGreaterThan(10);

  // The one refusal that is thrown holds the size and no byte.
  let thrown = '';
  try {
    checkModuleSize(MAX_MODULE_BYTES + 5);
  } catch (error) {
    thrown = error instanceof Error ? error.message : '';
  }
  expect(thrown).toMatch(/64 MiB/);
  expect(thrown).not.toContain(marker);

  // The package prints nothing.
  for (const spy of spies) {
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }
});

it('a seeded storm of mutations of a real module never throws and never hangs', () => {
  const random = mulberry32(19_041_004);
  const base = fixtureBytes();
  for (let round = 0; round < 3000; round++) {
    const copy = Uint8Array.from(base);
    const edits = 1 + Math.floor(random() * 4);
    for (let e = 0; e < edits; e++) copy[Math.floor(random() * copy.length)] = Math.floor(random() * 256);
    const cut = random() < 0.2 ? copy.slice(0, Math.floor(random() * copy.length)) : copy;
    const report = inspect(cut);
    expect(['module', 'component', 'unreadable']).toContain(report.kind);
    for (const finding of report.findings) expect(finding.message).toContain(`offset ${finding.offset}`);
  }
});

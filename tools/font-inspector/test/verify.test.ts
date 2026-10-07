import { expect, it } from 'vitest';
import {
  EXPANSION_REFUSAL,
  MAX_COMPARE_POINTS,
  MAX_EXPANSION_RATIO,
  compareGlyphs,
  convertFont,
  exceedsExpansionRatio,
  readGlyphValue,
  readWoff2Header,
  readSfntFont,
  sameGlyphValue,
  tableBytes,
  verifyConversion,
  withChecksumAdjustment,
  wrapWoff1,
  checksum,
  type ConversionReport,
  type ConvertEngine,
} from '../src/index';
import { woff2Compress, woff2Decompress } from '../src/engine';
import { fontBytes } from './fixtures/fonts';
import { buildSfnt, sum32, tablesOf } from './helpers';
import { HOSTILE, MAX_SCALING_RATIO, scalingRatio } from './scaling';
import { compositeGlyph, concat, glyphFont, rectangle, simpleGlyph, u16, i16, u32 } from './tables';

/*
 * The re-read check (D-232) and its parts: the arithmetic of checksums, the reference decoder's 100 times boundary, the
 * glyph comparison (exact integers, no tolerance), and every step of the check refusing its own kind of fault in plain words.
 */

const engine: ConvertEngine = { woff2Compress, woff2Decompress };

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && Buffer.from(a).equals(Buffer.from(b));
const be16 = (b: Uint8Array, o: number): number => (b[o]! << 8) | b[o + 1]!;
const be32 = (b: Uint8Array, o: number): number =>
  ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const latin1 = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
};
const bytesOf = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);

/** A table's offset in an sfnt, from the directory, read by this test. */
function tableOffset(font: Uint8Array, tag: string): number {
  for (let i = 0; i < be16(font, 4); i++) {
    const e = 12 + 16 * i;
    if (String.fromCharCode(font[e]!, font[e + 1]!, font[e + 2]!, font[e + 3]!) === tag) return be32(font, e + 8);
  }
  throw new Error(`no ${tag} table`);
}

/** The position of a table's directory entry, read by this test. */
function entryOffset(font: Uint8Array, tag: string): number {
  for (let i = 0; i < be16(font, 4); i++) {
    const e = 12 + 16 * i;
    if (String.fromCharCode(font[e]!, font[e + 1]!, font[e + 2]!, font[e + 3]!) === tag) return e;
  }
  throw new Error(`no ${tag} table`);
}

it('table checksums are unsigned 32-bit sums and the adjustment is 0xB1B0AFBA minus the file sum modulo 2 to the 32', () => {
  // A table of nine bytes: two whole words and one byte, which counts as the first byte of a last word padded with zeros.
  const nine = Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x02, 0xab]);
  const expected = (0xffffffffn + 2n + 0xab000000n) % 2n ** 32n;
  expect(checksum(nine, 0, 9)).toBe(Number(expected));
  // Sums wrap and are never negative: 0xFFFFFFFF + 0xFFFFFFFF is 0xFFFFFFFE.
  const twice = Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  expect(checksum(twice, 0, 8)).toBe(0xfffffffe);
  // Lengths of 1, 2 and 3 bytes fill the last word from the top.
  expect(checksum(Uint8Array.from([0x12]), 0, 1)).toBe(0x12000000);
  expect(checksum(Uint8Array.from([0x12, 0x34]), 0, 2)).toBe(0x12340000);
  expect(checksum(Uint8Array.from([0x12, 0x34, 0x56]), 0, 3)).toBe(0x12345600);
  // The head table's checksum counts the adjustment (bytes 8 to 11) as zero.
  const head = Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 2, 0xde, 0xad, 0xbe, 0xef, 0, 0, 0, 3]);
  expect(checksum(head, 0, 16, true)).toBe(1 + 2 + 3);
  expect(checksum(head, 0, 16)).toBe(Number((1n + 2n + 0xdeadbeefn + 3n) % 2n ** 32n));

  // The adjustment, worked out by hand with BigInt from a font whose adjustment bytes are zero.
  const font = fontBytes('plain.ttf');
  const zeroed = font.slice();
  const headAt = tableOffset(zeroed, 'head');
  zeroed.fill(0, headAt + 8, headAt + 12);
  let sum = 0n;
  for (let i = 0; i < zeroed.length; i += 4) {
    sum += BigInt(be32(Uint8Array.from([zeroed[i]!, zeroed[i + 1] ?? 0, zeroed[i + 2] ?? 0, zeroed[i + 3] ?? 0]), 0));
  }
  sum %= 2n ** 32n;
  const adjustment = (0xb1b0afban - sum + 2n ** 32n) % 2n ** 32n;
  const fixed = withChecksumAdjustment(zeroed);
  expect(BigInt(be32(fixed, headAt + 8))).toBe(adjustment);
  expect(sum32(fixed)).toBe(0xb1b0afba);
  // The same font from fontTools carries the same value, so the arithmetic is not only self-consistent.
  expect(be32(fixed, headAt + 8)).toBe(be32(font, headAt + 8));
  // A wrong adjustment is worked out again; the file is not changed anywhere else.
  const wrong = font.slice();
  wrong.set([1, 2, 3, 4], headAt + 8);
  const repaired = withChecksumAdjustment(wrong);
  expect(sum32(repaired)).toBe(0xb1b0afba);
  expect(same(repaired.subarray(0, headAt + 8), font.subarray(0, headAt + 8))).toBe(true);
  expect(same(repaired.subarray(headAt + 12), font.subarray(headAt + 12))).toBe(true);
  // The directory checksum of every table is its padded sum (head with the adjustment counted as zero), for a table whose
  // length is not a multiple of four too: the font's name table is built that way by fontTools, so compare them all.
  const read = readSfntFont(fixed, 0, false);
  for (const tag of read.order) {
    const entry = read.tables.get(tag)!;
    const table = fixed.slice(entry.offset, entry.offset + entry.length);
    if (tag === 'head') table.fill(0, 8, 12);
    const padded = new Uint8Array(Math.ceil(entry.length / 4) * 4);
    padded.set(table);
    expect(entry.checksum, tag).toBe(sum32(padded));
    expect(entry.checksumOk, tag).toBe(true);
  }
  expect(read.wholeFileOk).toBe(true);
  // A font without a head table is returned unchanged (nothing to set), as a copy.
  const noHead = buildSfnt(
    0x00010000,
    tablesOf(font).filter(([tag]) => tag !== 'head'),
  );
  expect(same(withChecksumAdjustment(noHead), noHead)).toBe(true);
});

/** A TrueType font whose extra table PADD holds n zero bytes: it packs to almost nothing, which is what trips the rule. */
const padded = (n: number): Uint8Array =>
  buildSfnt(0x00010000, [...tablesOf(fontBytes('det-sans.ttf')), ['PADD', new Uint8Array(n)]]);

const accepts = async (n: number): Promise<boolean> => {
  const woff2 = await woff2Compress(padded(n));
  try {
    await woff2Decompress(woff2);
    return true;
  } catch {
    return false;
  }
};

it('the 100 times rule of the reference decoder is applied at the same boundary, so a file one step inside it is offered and one step past it is refused', async () => {
  // google/woff2 src/woff2_dec.cc at commit 4721483ad780ee2b63cb787bfee4aa64b61a0446: line 67 declares
  // `const float kMaxPlausibleCompressionRatio = 100.0;` and lines 1368 to 1372 fail the decode when
  // `(float) hdr.uncompressed_size / length` is GREATER than it. A ratio of exactly 100 is read; the division is in 32-bit floats.
  expect(MAX_EXPANSION_RATIO).toBe(100);
  for (const length of [48, 49, 400, 1000, 4096, 65_535, 100_000]) {
    expect(exceedsExpansionRatio(100 * length, length), `exactly 100 times at ${length}`).toBe(false);
    expect(exceedsExpansionRatio(100 * length - 1, length), `just inside at ${length}`).toBe(false);
  }
  expect(exceedsExpansionRatio(100 * 400 + 1, 400)).toBe(true);
  expect(exceedsExpansionRatio(100 * 1000 + 1, 1000)).toBe(true);
  expect(exceedsExpansionRatio(100 * 48 + 1, 48)).toBe(true);
  // 32-bit rounding as the C code does it: the quotient 100.0000001 is not representable as a float and rounds to exactly 100.
  expect(exceedsExpansionRatio(100_000_001, 1_000_000)).toBe(false);
  expect(exceedsExpansionRatio(100_001_000, 1_000_000)).toBe(true);

  // The exact boundary, built on purpose: the size of the zero table is moved until the stream the file unpacks to is exactly
  // 100 times the file's length (each byte of table moves the difference by one while the packed size stays put). The engine's
  // decoder reads that file, refuses the file one byte of table larger, and the check says the same on both.
  let z = 70_000;
  let exact: { z: number; stream: number; length: number } | null = null;
  for (let step = 0; step < 24 && exact === null; step++) {
    const packed = await woff2Compress(padded(z));
    const stream = readWoff2Header(packed, { allowHighRatio: true }).streamSize;
    const difference = stream - 100 * packed.length;
    if (difference === 0) exact = { z, stream, length: packed.length };
    else z = Math.max(1000, z - difference);
  }
  expect(exact, 'a size at which the file unpacks to exactly 100 times its length').not.toBeNull();
  expect(exact!.stream).toBe(100 * exact!.length);
  expect(await accepts(exact!.z), 'the engine reads exactly 100 times').toBe(true);
  const exactReport = await verifyConversion(padded(exact!.z), await woff2Compress(padded(exact!.z)), engine);
  expect(exactReport.problems).toEqual([]);
  const pastPacked = await woff2Compress(padded(exact!.z + 1));
  const past = readWoff2Header(pastPacked, { allowHighRatio: true });
  expect(past.streamSize - 100 * pastPacked.length, 'one byte past the exact boundary').toBe(1);
  expect(await accepts(exact!.z + 1), 'the engine refuses one byte past exactly 100 times').toBe(false);
  const pastReport = await verifyConversion(padded(exact!.z + 1), pastPacked, engine);
  expect(pastReport.problems).toEqual([EXPANSION_REFUSAL]);

  // The engine's own decoder is the authority on where the boundary is. Find a size of the zero table at which the engine
  // accepts the packed font and one byte more at which it refuses, by doubling and then bisecting the near-monotone ratio.
  let low = 1000;
  let high = 2000;
  while (await accepts(high)) {
    low = high;
    high *= 2;
  }
  while (high - low > 64) {
    const middle = Math.floor((low + high) / 2);
    if (await accepts(middle)) low = middle;
    else high = middle;
  }
  // The ratio moves by 1/length per byte, so within a short window there is a step from accepted to refused; the packed size
  // may jump by a byte or two between neighbours, so look for the first step in the window, wherever it is.
  let inside = -1;
  for (let n = low - 80; n <= high + 80 && inside < 0; n++) {
    if ((await accepts(n)) && !(await accepts(n + 1))) inside = n;
  }
  expect(inside, 'a step from accepted to refused exists in the window').toBeGreaterThan(0);

  // The check agrees with the engine on one step inside (offered) and one step past (refused with the plain sentence) ...
  const good = await verifyConversion(padded(inside), await woff2Compress(padded(inside)), engine);
  expect(good.problems).toEqual([]);
  expect(good.ok).toBe(true);
  const bad = await verifyConversion(padded(inside + 1), await woff2Compress(padded(inside + 1)), engine);
  expect(bad.ok).toBe(false);
  expect(bad.problems).toEqual([EXPANSION_REFUSAL]);
  expect(EXPANSION_REFUSAL).toContain('more than 100 times');
  expect(EXPANSION_REFUSAL).toContain('WOFF');
  // ... and on every size of the window around it, in both directions: the check refuses exactly the files the engine refuses.
  let refused = 0;
  let offered = 0;
  for (let n = inside - 40; n <= inside + 40; n++) {
    const woff2 = await woff2Compress(padded(n));
    const engineSays = await accepts(n);
    const report = await verifyConversion(padded(n), woff2, engine);
    expect(report.problems.includes(EXPANSION_REFUSAL), `size ${n}`).toBe(!engineSays);
    if (engineSays) offered++;
    else refused++;
  }
  expect(offered).toBeGreaterThan(0);
  expect(refused).toBeGreaterThan(0);
}, 300_000);

it('a WOFF2 whose Brotli stream decodes to other bytes is caught by the re-read check', async () => {
  // Every byte of a WOFF2 file is inverted, and its low bit is flipped as well for every third byte. The engine refuses most
  // changes; some decode without any error to
  // other bytes (Brotli carries no checksum); a few change nothing the decoder reads. The check must never offer a file
  // whose unpacked bytes are other than the good file's. A file the check offers is decoded again here, apart from the check,
  // and must be the good file's bytes; a file it refuses for a difference in what was decoded must really decode to other bytes.
  const font = fontBytes('det-sans.ttf');
  const good = await woff2Compress(font);
  const goodDecoded = await woff2Decompress(good);
  // A refusal the check makes before or while decoding (the container does not read, the decoder refuses) needs no second
  // decode here; every other outcome is decoded again by the engine directly.
  const BEFORE_OR_WHILE_DECODING =
    /did not read back|could not be read back|could not be unpacked|expand more than|does not start as|too short/;
  let refusedEarly = 0;
  let refusedAfterwards = 0;
  let offeredIdentical = 0;
  let silentlyDifferent = 0;
  let changes = 0;
  for (let at = 0; at < good.length; at++) {
    for (const mask of at % 3 === 0 ? [0x01, 0xff] : [0xff]) {
      changes++;
      const bad = good.slice();
      bad[at] = bad[at]! ^ mask;
      const report = await verifyConversion(font, bad, engine);
      if (!report.ok && report.problems.some((p) => BEFORE_OR_WHILE_DECODING.test(p))) {
        refusedEarly++;
        continue;
      }
      let decoded: Uint8Array;
      try {
        decoded = await woff2Decompress(bad);
      } catch {
        // The engine refuses it: the check must not have offered it.
        expect(report.ok, `byte ${at} xor ${mask} was offered although the engine refuses it`).toBe(false);
        refusedEarly++;
        continue;
      }
      const identical = same(decoded, goodDecoded);
      if (report.ok) {
        // Offered: it must unpack to exactly the good file's bytes.
        expect(identical, `byte ${at} xor ${mask} was offered`).toBe(true);
        offeredIdentical++;
      } else if (identical) {
        refusedAfterwards++;
      } else {
        silentlyDifferent++;
      }
    }
  }
  // The experiment is not empty: some changes really do decode to other bytes without an error, and the check refused them
  // all (the loop above would have failed on any that it offered).
  expect(silentlyDifferent).toBeGreaterThan(0);
  expect(refusedEarly).toBeGreaterThan(0);
  expect(refusedEarly + refusedAfterwards + offeredIdentical + silentlyDifferent).toBe(changes);
}, 180_000);

/** A simple glyph's bytes written by this test, with the packing of the coordinates and flags chosen. */
function encodeGlyph(
  points: { x: number; y: number; on: boolean; overlap?: boolean }[],
  options: {
    ends?: number[];
    short?: boolean;
    repeat?: boolean;
    instructions?: number[];
    bbox?: [number, number, number, number];
  } = {},
): Uint8Array {
  const ends = options.ends ?? [points.length - 1];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const bbox = options.bbox ?? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const flags: number[] = [];
  const dxBytes: number[] = [];
  const dyBytes: number[] = [];
  let px = 0;
  let py = 0;
  for (const p of points) {
    let f = (p.on ? 0x01 : 0) | (p.overlap ? 0x40 : 0);
    const dx = p.x - px;
    const dy = p.y - py;
    if (options.short) {
      if (dx === 0) f |= 0x10;
      else if (Math.abs(dx) <= 255) {
        f |= 0x02 | (dx > 0 ? 0x10 : 0);
        dxBytes.push(Math.abs(dx));
      } else dxBytes.push(...i16(dx));
      if (dy === 0) f |= 0x20;
      else if (Math.abs(dy) <= 255) {
        f |= 0x04 | (dy > 0 ? 0x20 : 0);
        dyBytes.push(Math.abs(dy));
      } else dyBytes.push(...i16(dy));
    } else {
      dxBytes.push(...i16(dx));
      dyBytes.push(...i16(dy));
    }
    flags.push(f);
    px = p.x;
    py = p.y;
  }
  const packed: number[] = [];
  if (options.repeat) {
    for (let i = 0; i < flags.length;) {
      let run = 1;
      while (i + run < flags.length && flags[i + run] === flags[i] && run < 256) run++;
      if (run > 1) packed.push(flags[i]! | 0x08, run - 1);
      else packed.push(flags[i]!);
      i += run;
    }
  } else {
    packed.push(...flags);
  }
  const instructions = options.instructions ?? [];
  return concat(
    i16(ends.length),
    i16(bbox[0]),
    i16(bbox[1]),
    i16(bbox[2]),
    i16(bbox[3]),
    ends.flatMap((e) => u16(e)),
    u16(instructions.length),
    instructions,
    packed,
    dxBytes,
    dyBytes,
  );
}

const value = (bytes: Uint8Array) => readGlyphValue(bytes, { points: 0 });

it('glyphs are compared as exact integers: packing differs, values never do', async () => {
  const pts = [
    { x: 0, y: 0, on: true },
    { x: 300, y: 0, on: true },
    { x: 300, y: -5, on: false },
    { x: 120, y: 200, on: true },
    { x: 120, y: 200, on: true },
  ];
  // The same glyph packed three ways (words, short vectors, short vectors with repeated flags) is the same by value ...
  const words = encodeGlyph(pts);
  const short = encodeGlyph(pts, { short: true });
  const repeated = encodeGlyph(pts, { short: true, repeat: true });
  expect(short.length).toBeLessThan(words.length);
  expect(sameGlyphValue(value(words), value(short))).toBe(true);
  expect(sameGlyphValue(value(words), value(repeated))).toBe(true);
  // ... padding after the glyph is nothing ...
  expect(sameGlyphValue(value(words), value(concat(words, [0, 0, 0])))).toBe(true);
  // ... and not one number may differ: a coordinate off by one, an on-curve flag, the overlap flag, an instruction byte, a
  // contour end, the bounding box. There is no tolerance anywhere.
  const base = value(words);
  const differs = (other: Uint8Array): boolean => !sameGlyphValue(base, value(other));
  expect(differs(encodeGlyph(pts.map((p, i) => (i === 3 ? { ...p, x: p.x + 1 } : p))))).toBe(true);
  expect(differs(encodeGlyph(pts.map((p, i) => (i === 1 ? { ...p, y: p.y - 1 } : p))))).toBe(true);
  expect(differs(encodeGlyph(pts.map((p, i) => (i === 2 ? { ...p, on: true } : p))))).toBe(true);
  expect(differs(encodeGlyph(pts.map((p, i) => (i === 0 ? { ...p, overlap: true } : p))))).toBe(true);
  expect(differs(encodeGlyph(pts, { instructions: [0xb0, 0x01] }))).toBe(true);
  expect(differs(encodeGlyph(pts, { ends: [1, 4] }))).toBe(true);
  expect(differs(encodeGlyph(pts, { bbox: [0, -5, 300, 201] }))).toBe(true);
  // Instructions are compared byte for byte.
  expect(
    sameGlyphValue(
      value(encodeGlyph(pts, { instructions: [1, 2, 3] })),
      value(encodeGlyph(pts, { instructions: [1, 2, 4] })),
    ),
  ).toBe(false);
  // No contours is no glyph, whatever the header's box says, and a glyph with no bytes is the same.
  expect(sameGlyphValue(value(new Uint8Array(0)), value(new Uint8Array(10)))).toBe(true);
  expect(sameGlyphValue(value(new Uint8Array(0)), value(words))).toBe(false);
  // Composites: flags, glyph number, arguments and every transform number are compared.
  const composite = compositeGlyph([
    { glyph: 0, dx: 5, dy: 6, scale: 0.5 },
    { glyph: 1, dx: -1, dy: 2 },
  ]);
  const cBase = value(composite);
  expect(cBase.kind).toBe('composite');
  expect(
    sameGlyphValue(
      cBase,
      value(
        compositeGlyph([
          { glyph: 0, dx: 5, dy: 6, scale: 0.5 },
          { glyph: 1, dx: -1, dy: 2 },
        ]),
      ),
    ),
  ).toBe(true);
  for (const other of [
    compositeGlyph([
      { glyph: 0, dx: 5, dy: 7, scale: 0.5 },
      { glyph: 1, dx: -1, dy: 2 },
    ]),
    compositeGlyph([
      { glyph: 0, dx: 5, dy: 6, scale: 0.5 },
      { glyph: 2, dx: -1, dy: 2 },
    ]),
    compositeGlyph([
      { glyph: 0, dx: 5, dy: 6, scale: 0.5 + 1 / 16384 },
      { glyph: 1, dx: -1, dy: 2 },
    ]),
    compositeGlyph([
      { glyph: 0, dx: 5, dy: 6, scale: 0.5, flags: 0x0200 },
      { glyph: 1, dx: -1, dy: 2 },
    ]),
    compositeGlyph([{ glyph: 0, dx: 5, dy: 6, scale: 0.5 }]),
  ]) {
    expect(sameGlyphValue(cBase, value(other))).toBe(false);
  }
  // A glyph that is not a glyph is a plain sentence, never a throw of anything else.
  for (const bad of [
    Uint8Array.from([0, 1, 2]),
    concat(i16(1), new Array(8).fill(0)),
    concat(i16(-2), new Array(8).fill(0)),
  ]) {
    expect(() => value(bad)).toThrow();
  }

  // The overlap flag of a point (bit 6) survives a WOFF2 round trip through the engine, and it counts: the same glyph without it
  // is another glyph to the check.
  const withOverlap = glyphFont([encodeGlyph(pts.map((p, i) => (i === 0 ? { ...p, overlap: true } : p)))]);
  const withoutOverlap = glyphFont([encodeGlyph(pts)]);
  const packedOverlap = await woff2Compress(withOverlap);
  expect((await verifyConversion(withOverlap, packedOverlap, engine)).problems).toEqual([]);
  const lost = await verifyConversion(withoutOverlap, packedOverlap, engine);
  expect(lost.ok).toBe(false);
  expect(lost.problems.join(' ')).toContain('Glyph 0 is not the same');
});

const glyphTable = (font: Uint8Array) => {
  const read = readSfntFont(font, 0, false);
  const head = tableBytes(font, read.tables.get('head'))!;
  return {
    glyf: tableBytes(font, read.tables.get('glyf'))!,
    loca: tableBytes(font, read.tables.get('loca'))!,
    long: be16(head, 50) === 1,
    count: be16(tableBytes(font, read.tables.get('maxp'))!, 4),
  };
};

const FIXTURE_GLYPHS = [
  simpleGlyph([rectangle(0, 0, 100, 100)]),
  simpleGlyph([rectangle(10, 10, 200, 300), rectangle(50, 50, 80, 80)]),
  compositeGlyph([
    { glyph: 0, dx: 5, dy: 0 },
    { glyph: 1, dx: 0, dy: 40, scale: [1, 0.5] },
  ]),
  new Uint8Array(0),
];

it('each step of the re-read check refuses its own kind of fault in plain words', async () => {
  const font = fontBytes('det-sans.ttf');
  const woff = wrapWoff1(font);
  const packed = await woff2Compress(font);
  const first = async (output: Uint8Array, input = font): Promise<ConversionReport> =>
    verifyConversion(input, output, engine);
  const says = (report: ConversionReport, text: string): void => {
    expect(report.ok).toBe(false);
    expect(report.problems.join(' | ')).toContain(text);
  };

  // A good file of each container passes, as the control.
  for (const output of [woff, packed, withChecksumAdjustment(font)]) expect((await first(output)).problems).toEqual([]);

  // Step 1: the output's own container does not parse again.
  const badLength = woff.slice();
  badLength[11] = badLength[11]! ^ 1;
  says(await first(badLength), 'did not read back');
  const badLength2 = packed.slice();
  badLength2[11] = badLength2[11]! ^ 1;
  says(await first(badLength2), 'did not read back');
  says(
    await first(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])),
    'does not start as a TrueType',
  );
  says(await first(Uint8Array.from([1, 2, 3])), 'too short');
  const sorted = woff.slice();
  // Swap the first two directory entries: the directory is no longer in tag order, which the writer never leaves.
  const entry0 = sorted.slice(44, 64);
  sorted.set(sorted.subarray(64, 84), 44);
  sorted.set(entry0, 64);
  says(await first(sorted), 'reads back with a note');

  // Step 2: the decoder refuses what it is given.
  const damaged = packed.slice();
  for (let i = packed.length - 40; i < packed.length - 4; i++) damaged[i] = 0xff;
  says(await first(damaged), 'could not be read back');

  // Step 3: tags, bytes of a table, head.
  const withoutPost = wrapWoff1(
    buildSfnt(
      0x00010000,
      tablesOf(font).filter(([tag]) => tag !== 'post'),
    ),
  );
  says(await first(withoutPost), 'tables');
  const cmapChanged = tablesOf(font).map(([tag, data]) => {
    if (tag !== 'cmap') return [tag, data] as [string, Uint8Array];
    const copy = data.slice();
    copy[copy.length - 1] = copy[copy.length - 1]! ^ 0x01;
    return [tag, copy] as [string, Uint8Array];
  });
  says(await first(wrapWoff1(buildSfnt(0x00010000, cmapChanged))), 'Table cmap is not byte for byte the same');
  // head: the flag byte may change only after a WOFF2 conversion; an sfnt or WOFF output with it set is a fault.
  const flagged = tablesOf(font).map(([tag, data]) => {
    if (tag !== 'head') return [tag, data] as [string, Uint8Array];
    const copy = data.slice();
    copy[16] = copy[16]! | 0x08;
    return [tag, copy] as [string, Uint8Array];
  });
  says(await first(buildSfnt(0x00010000, flagged)), 'head differs in more than');
  says(await first(wrapWoff1(buildSfnt(0x00010000, flagged))), 'head differs in more than');
  // A WOFF file keeps the head table as it is, adjustment included: another adjustment is a fault there, not in an sfnt.
  const readjusted = font.slice();
  readjusted.set([9, 9, 9, 9], tableOffset(readjusted, 'head') + 8);
  says(await first(wrapWoff1(readjusted)), 'head differs in more than');

  // Step 4: a glyph that is not the same, and the glyph tables of the two fonts that do not line up.
  const fontA = glyphFont(FIXTURE_GLYPHS);
  const moved = [...FIXTURE_GLYPHS];
  moved[1] = simpleGlyph([rectangle(10, 10, 201, 300), rectangle(50, 50, 80, 80)]);
  const fontB = glyphFont(moved);
  expect((await verifyConversion(fontA, await woff2Compress(fontA), engine)).problems).toEqual([]);
  const wrongGlyph = await verifyConversion(fontA, await woff2Compress(fontB), engine);
  says(wrongGlyph, 'Glyph 1 is not the same in the converted font');
  expect(wrongGlyph.glyphsCompared).toBe(1);
  // For WOFF the glyph table must be identical byte for byte, so the same fault is a table fault there.
  says(await verifyConversion(fontA, wrapWoff1(fontB), engine), 'Table glyf is not byte for byte the same');

  // Step 5: checksums of an sfnt output.
  const wrongSum = withChecksumAdjustment(font);
  wrongSum[entryOffset(wrongSum, 'cmap') + 7] = wrongSum[entryOffset(wrongSum, 'cmap') + 7]! ^ 0x10;
  says(await first(wrongSum), 'checksum of table cmap is wrong');
  const wrongFile = withChecksumAdjustment(font);
  wrongFile[tableOffset(wrongFile, 'head') + 11] = wrongFile[tableOffset(wrongFile, 'head') + 11]! ^ 0x01;
  says(await first(wrongFile), 'whole-file checksum');
  // A table whose checksum was already wrong in the font that was opened is not a fault of the conversion.
  const alreadyWrong = font.slice();
  alreadyWrong[entryOffset(alreadyWrong, 'cmap') + 7] = alreadyWrong[entryOffset(alreadyWrong, 'cmap') + 7]! ^ 0x10;
  const converted = await convertFont({ bytes: wrapWoff1(alreadyWrong), target: 'sfnt' }, engine);
  expect((await verifyConversion(converted.sfnt, converted.bytes, engine)).problems).toEqual([]);
});

it('the re-read check never repeats input text and never throws on a damaged output', async () => {
  const marker = 'MARKER-7f3a91-convert-d4e8b2';
  const font = fontBytes('det-sans.ttf');
  const marked = buildSfnt(
    0x00010000,
    tablesOf(font).map(([tag, data]) => {
      if (tag !== 'name') return [tag, data] as [string, Uint8Array];
      return [
        tag,
        concat(
          data,
          Uint8Array.from(marker, (c) => c.charCodeAt(0)),
        ),
      ] as [string, Uint8Array];
    }),
  );
  const good = await woff2Compress(marked);
  const outputs: Uint8Array[] = [
    good,
    wrapWoff1(marked),
    new Uint8Array(0),
    Uint8Array.from(marker, (c) => c.charCodeAt(0)),
  ];
  for (let at = 0; at < good.length; at += 7) {
    const bad = good.slice();
    bad[at] = bad[at]! ^ 0xff;
    outputs.push(bad);
  }
  for (const output of outputs) {
    const report = await verifyConversion(marked, output, engine);
    const shown = JSON.stringify(report);
    expect(shown).not.toContain(marker);
    expect(typeof report.ok).toBe('boolean');
  }
  // A damaged input font is a problem as well, not a throw.
  const report = await verifyConversion(new Uint8Array(20), good, engine);
  expect(report.ok).toBe(false);
});

it('the glyph comparison caps its work and refuses glyph tables that do not line up', () => {
  const table = glyphTable(glyphFont(FIXTURE_GLYPHS));
  const ok = compareGlyphs(table, table, table.count);
  expect(ok.problem).toBeNull();
  expect(ok.compared).toBe(table.count);
  // loca too short, out of order, or past the end of glyf: each is a plain sentence naming nothing from the font.
  expect(compareGlyphs({ ...table, loca: table.loca.subarray(0, 8) }, table, table.count).problem).toContain(
    'loca table is shorter',
  );
  const outOfOrder = table.loca.slice();
  outOfOrder.set(u32(0), 8);
  expect(compareGlyphs({ ...table, loca: outOfOrder }, table, table.count).problem).toContain('out of order');
  const past = table.loca.slice();
  past.set(u32(table.glyf.length + 4), past.length - 4);
  expect(compareGlyphs({ ...table, loca: past }, table, table.count).problem).toContain('past the end');
  // A glyph the font itself cannot be read for is named by number, on the side it is on.
  const broken = table.glyf.slice();
  broken[0] = 0x7f;
  broken[1] = 0xff;
  expect(compareGlyphs({ ...table, glyf: broken }, table, table.count).problem).toContain(
    'Glyph 0 of the font you opened',
  );
  expect(compareGlyphs(table, { ...table, glyf: broken }, table.count).problem).toContain(
    'Glyph 0 of the converted font',
  );

  // A hostile glyph table: every glyph claims 65,536 points with repeated flags in 512 bytes. The point budget stops the
  // check long before billions of points are decoded, and the sentence says so.
  const flags: number[] = [];
  for (let i = 0; i < 256; i++) flags.push(0x39, 255);
  const hostile = concat(i16(1), i16(0), i16(0), i16(0), i16(0), u16(65_535), u16(0), flags);
  const glyphCount = Math.ceil(MAX_COMPARE_POINTS / 65_536 / 2) + 20;
  const offsets: number[] = [];
  const body: number[] = [];
  for (let g = 0; g <= glyphCount; g++) {
    offsets.push(...u32(body.length));
    if (g < glyphCount) body.push(...hostile, ...new Array((4 - (hostile.length % 4)) % 4).fill(0));
  }
  const started = performance.now();
  const capped = compareGlyphs(
    { glyf: Uint8Array.from(body), loca: Uint8Array.from(offsets), long: true },
    { glyf: Uint8Array.from(body), loca: Uint8Array.from(offsets), long: true },
    glyphCount,
  );
  expect(capped.problem).toContain('more points than the check can compare');
  expect(performance.now() - started).toBeLessThan(20_000);
});

/** Judges doubling and four times the size, the median of three when a ratio reads over its limit (the limit is never raised). */
function linear(label: string, fn: (text: string) => unknown, make: (n: number) => string, n: number): void {
  const judge = (): [number, number] => {
    const a = scalingRatio(fn, make, n);
    const b = scalingRatio(fn, make, 2 * n);
    return [a, a * b];
  };
  let [double, quadruple] = judge();
  if (double > MAX_SCALING_RATIO || quadruple > 2 * MAX_SCALING_RATIO) {
    const second = judge();
    const third = judge();
    const median = (values: number[]): number => [...values].sort((x, y) => x - y)[1]!;
    double = median([double, second[0], third[0]]);
    quadruple = median([quadruple, second[1], third[1]]);
  }
  expect(double, `${label} doubling`).toBeLessThanOrEqual(MAX_SCALING_RATIO);
  expect(quadruple, `${label} four times`).toBeLessThanOrEqual(2 * MAX_SCALING_RATIO);
}

it('the glyph comparison, the WOFF writer and the checksum repair stay linear on hostile input', () => {
  // Many glyphs: the comparison reads each once.
  const manyGlyphs = (n: number): string => {
    const glyph = simpleGlyph([rectangle(0, 0, 50, 50)]);
    return latin1(glyphFont(Array.from({ length: n }, () => glyph)));
  };
  const compare = (text: string): unknown => {
    const table = glyphTable(bytesOf(text));
    return compareGlyphs(table, table, table.count);
  };
  linear('glyphs', compare, manyGlyphs, 800);
  // Many tables of one font and one big table: the writer sorts the directory once and compresses each table once.
  const manyTables = (n: number): string =>
    latin1(
      buildSfnt(0x00010000, [
        ['head', new Uint8Array(54)],
        ...Array.from(
          { length: n },
          (_, i) => [`t${String(i).padStart(3, '0')}`, Uint8Array.from([i & 255, 1, 2, 3, 4])] as [string, Uint8Array],
        ),
      ]),
    );
  linear('tables', (text) => wrapWoff1(bytesOf(text)), manyTables, 60);
  const bigTable = (n: number): string =>
    latin1(
      buildSfnt(0x00010000, [
        ['head', new Uint8Array(54)],
        ['bulk', new Uint8Array(n)],
      ]),
    );
  linear('table bytes', (text) => wrapWoff1(bytesOf(text)), bigTable, 40_000);
  linear('checksum repair', (text) => withChecksumAdjustment(bytesOf(text)), bigTable, 40_000);
  // The six hostile strings, read as fonts, are refused quickly and never take longer than linear.
  for (const make of HOSTILE) {
    linear('hostile text', (text) => wrapWoff1(bytesOf(text)), make, 3000);
  }
});

it('the re-read check agrees with an independent read of the same bytes on every committed font', async () => {
  // A last cross-check by another route: the engine's output decoded by wawoff2 in the engine-equal test is the same bytes, so
  // here the check is shown to read every committed single font in all six directions without a problem.
  for (const name of ['det-sans.ttf', 'plain.ttf', 'mac-names.ttf', 'preview.ttf', 'variable.ttf', 'cff.otf']) {
    const font = fontBytes(name);
    for (const output of [wrapWoff1(font), await woff2Compress(font)]) {
      const report = await verifyConversion(font, output, engine);
      expect(report.problems, name).toEqual([]);
      expect(report.glyphsCompared, name).toBeGreaterThan(0);
    }
  }
});

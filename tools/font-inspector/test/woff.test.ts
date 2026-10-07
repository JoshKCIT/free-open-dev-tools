import { zlibSync, unzlibSync } from 'fflate';
import { expect, it } from 'vitest';
import {
  FontInspectorError,
  MAX_EXPANSION_RATIO,
  MAX_SFNT_BYTES,
  convertFont,
  inspectFont,
  planWoff2,
  readContainer,
  readSfntFont,
  tableBytes,
  unpackWoff2,
  unwrapWoff1,
  verifyConversion,
  type Woff2Decompress,
} from '../src/index';
import { woff2Compress, woff2Decompress } from '../src/engine';
import { fontBytes } from './fixtures/fonts';
import { tablesOf } from './helpers';
import { ascii, concat } from './tables';

/*
 * WOFF 1.0 (W3C Recommendation, 13 December 2012) and WOFF2 (W3C Recommendation, 08 August 2024). The files fontTools wrote are
 * read for their tables only and never compared byte for byte; the hostile files are built in this test by editing a good
 * file or from a header written here, and none is a vendored font.
 */

const tablesEqual = (a: Uint8Array, b: Uint8Array, skip: string[] = []): void => {
  const left = new Map(tablesOf(a));
  const right = new Map(tablesOf(b));
  expect([...left.keys()].sort()).toEqual([...right.keys()].sort());
  for (const [tag, data] of left) {
    if (skip.includes(tag)) continue;
    expect(Buffer.from(right.get(tag)!).equals(Buffer.from(data)), tag).toBe(true);
  }
};

/** A WOFF 1.0 file with one table of the given tag, stored with the given compressed bytes and stated sizes. */
function woff1With(
  tag: string,
  compressed: Uint8Array,
  origLength: number,
  extra: { flavor?: number; length?: number } = {},
): Uint8Array {
  const dataAt = 44 + 20;
  const padded = (compressed.length + 3) & ~3;
  const total = dataAt + padded;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x774f4646);
  view.setUint32(4, extra.flavor ?? 0x00010000);
  view.setUint32(8, extra.length ?? total);
  view.setUint16(12, 1);
  view.setUint32(16, 12 + 16 + ((origLength + 3) & ~3));
  for (let i = 0; i < 4; i++) out[44 + i] = tag.charCodeAt(i);
  view.setUint32(48, dataAt);
  view.setUint32(52, compressed.length);
  view.setUint32(56, origLength);
  out.set(compressed, dataAt);
  return out;
}

it('WOFF 1.0 tables inflate through the streaming reader and stop at their stated size', () => {
  // fontTools' WOFF of the plain font gives back every table byte for byte.
  const ttf = fontBytes('plain.ttf');
  const woff = fontBytes('plain.woff');
  expect(readContainer(woff).kind).toBe('woff');
  tablesEqual(unwrapWoff1(woff), ttf);
  expect(inspectFont(unwrapWoff1(woff), {}).font.family).toBe('Scratch Sans');

  // compLength over origLength is invalid (WOFF 1.0 section 5).
  const bad = woff.slice();
  const view = new DataView(bad.buffer);
  view.setUint32(44 + 8, view.getUint32(44 + 12) + 1);
  expect(() => unwrapWoff1(bad)).toThrow('stored longer than its original size');

  // A table stored as it is (compLength equals origLength) is copied; a damaged compressed table is a plain sentence.
  const stored = woff1With('test', Uint8Array.from([1, 2, 3, 4, 5]), 5);
  expect([...tablesOf(unwrapWoff1(stored))[0]![1]]).toEqual([1, 2, 3, 4, 5]);
  const garbage = woff1With('test', Uint8Array.from([0x78, 0x9c, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), 100);
  expect(() => unwrapWoff1(garbage)).toThrow('is not valid compressed data');

  // Inflating to fewer bytes than stated is refused; to more is stopped.
  const fifty = zlibSync(new Uint8Array(50));
  expect(() => unwrapWoff1(woff1With('test', fifty, 100))).toThrow('inflates to less than its stated size');
  expect(unwrapWoff1(woff1With('test', fifty, 50)).length).toBe(12 + 16 + 52);
  expect(() => unwrapWoff1(woff1With('test', zlibSync(new Uint8Array(200)), 100))).toThrow(
    'inflates to more than its stated size',
  );

  // The header's length must be the file size; the unpacked total is capped before anything is inflated.
  expect(() => unwrapWoff1(woff1With('test', fifty, 50, { length: 9999 }))).toThrow('length stated in the WOFF header');
  expect(() => unwrapWoff1(woff1With('test', fifty, MAX_SFNT_BYTES))).toThrow('more than 30 MiB');
  expect(() => unwrapWoff1(new Uint8Array(20))).toThrow('too short to hold a WOFF header');

  // A bomb: 200 MiB of zeros compresses to about 200 KB. The streaming reader stops it at the stated size, in a fraction of
  // the time a full inflate takes, and it never holds more than the stated size.
  const bomb = zlibSync(new Uint8Array(200 * 1024 * 1024), { level: 9 });
  expect(bomb.length).toBeLessThan(400_000);
  const file = woff1With('test', bomb, bomb.length + 1000);
  const t0 = performance.now();
  expect(() => unwrapWoff1(file)).toThrow('inflates to more than its stated size');
  const stopped = performance.now() - t0;
  const t1 = performance.now();
  unzlibSync(bomb);
  const full = performance.now() - t1;
  expect(stopped).toBeLessThan(full / 2);
});

/** A WOFF2 file: header, directory (every table untransformed, known tags by index) and an arbitrary compressed block. */
function woff2With(options: {
  tables?: { tag?: string; index?: number; flags?: number; origLength: number; transformLength?: number }[];
  numTables?: number;
  fileLength?: number;
  lengthField?: number;
  totalSfntSize?: number;
  compressed?: number;
  flavor?: number;
  reserved?: number;
  directoryBytes?: number[];
}): Uint8Array {
  const tables = options.tables ?? [{ index: 0, origLength: 100 }];
  const base128 = (n: number): number[] => {
    const out: number[] = [];
    let v = n;
    do {
      out.unshift(v % 128);
      v = Math.floor(v / 128);
    } while (v > 0);
    return out.map((b, i) => (i < out.length - 1 ? b | 0x80 : b));
  };
  const dir: number[] = options.directoryBytes ?? [];
  if (!options.directoryBytes) {
    for (const t of tables) {
      const known = t.tag === undefined;
      dir.push((t.flags ?? 0) | (known ? (t.index ?? 0) : 63));
      if (!known) dir.push(...ascii(t.tag!));
      dir.push(...base128(t.origLength));
      if (t.transformLength !== undefined) dir.push(...base128(t.transformLength));
    }
  }
  const headerAndDir = 48 + dir.length;
  const compressed = options.compressed ?? (options.fileLength !== undefined ? options.fileLength - headerAndDir : 16);
  const total = options.fileLength ?? Math.ceil((headerAndDir + compressed) / 4) * 4;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x774f4632);
  view.setUint32(4, options.flavor ?? 0x00010000);
  view.setUint32(8, options.lengthField ?? total);
  view.setUint16(12, options.numTables ?? tables.length);
  view.setUint16(14, options.reserved ?? 0);
  view.setUint32(16, options.totalSfntSize ?? 0);
  view.setUint32(20, compressed);
  out.set(dir, 48);
  return out;
}

it('a WOFF2 header claiming over 30 MiB, a ratio over 100, zero or over 512 tables or a wrong length is refused before the engine runs', async () => {
  let calls = 0;
  const spy: Woff2Decompress = async () => {
    calls++;
    throw new Error('the engine must not be called');
  };
  const refused = async (bytes: Uint8Array, text: string): Promise<void> => {
    await expect(unpackWoff2(bytes, spy)).rejects.toThrow(text);
    await expect(unpackWoff2(bytes, spy)).rejects.toBeInstanceOf(FontInspectorError);
  };
  const THIRTY = MAX_SFNT_BYTES;
  const big = 400_000; // a file this long keeps 30 MiB under the 100 times rule

  // Exactly 30 MiB of tables, in a file long enough for the ratio: accepted by the pre-checks.
  const exact = woff2With({ tables: [{ index: 0, origLength: THIRTY }], fileLength: big, totalSfntSize: THIRTY });
  expect(planWoff2(exact).sfntSize).toBe(THIRTY);
  // One byte more is refused.
  await refused(
    woff2With({ tables: [{ index: 0, origLength: THIRTY + 1 }], fileLength: big, totalSfntSize: THIRTY }),
    'more than 30 MiB',
  );
  // Two tables that together pass the cap.
  await refused(
    woff2With({
      tables: [
        { index: 0, origLength: THIRTY },
        { index: 1, origLength: 1 },
      ],
      fileLength: big,
    }),
    'more than 30 MiB',
  );
  // The header's own claim of 4 GB (or any size over the cap) is refused, never trusted or used.
  await refused(woff2With({ totalSfntSize: 0xfffffff0 }), 'unpacks to more than 30 MiB');
  await refused(woff2With({ totalSfntSize: THIRTY + 1 }), 'unpacks to more than 30 MiB');
  // A ratio over 100: 30 MiB out of a 1,000 byte file.
  expect(MAX_EXPANSION_RATIO).toBe(100);
  await refused(woff2With({ tables: [{ index: 0, origLength: THIRTY }], fileLength: 1000 }), 'more than 100 times');
  // Exactly 100 times the file passes; one byte more does not.
  expect(planWoff2(woff2With({ tables: [{ index: 0, origLength: 40_000 }], fileLength: 400 })).streamSize).toBe(40_000);
  await refused(woff2With({ tables: [{ index: 0, origLength: 40_001 }], fileLength: 400 }), 'more than 100 times');
  // Zero tables, 513 tables, and a length field that is not the size of the file.
  await refused(woff2With({ numTables: 0 }), 'lists no tables');
  await refused(
    woff2With({ numTables: 513, directoryBytes: new Array(513).fill(0).flatMap(() => [0, 5]) }),
    'more than the 512',
  );
  await refused(woff2With({ lengthField: 999 }), 'length stated in the WOFF2 header');
  // A table size of 2 to the 32 does not fit a UIntBase128, and a leading zero byte is not allowed.
  await refused(woff2With({ directoryBytes: [0, 0x80, 5] }), 'starts with a zero byte');
  await refused(woff2With({ directoryBytes: [0, 0x8f, 0xff, 0xff, 0xff, 0xff, 0x7f] }), 'uses more than five bytes');
  await refused(woff2With({ directoryBytes: [0, 0xff, 0xff, 0xff, 0xff, 0x7f] }), 'too large for 32 bits');
  // The reserved field being non-zero is only a note.
  const note = planWoff2(woff2With({ reserved: 7 }));
  expect(note.reserved).toBe(7);
  expect(note.notes.join(' ')).toContain('reserved field');
  expect(calls).toBe(0);
});

/** The set of faults built by editing a good WOFF2 file; each must give one plain sentence and never a raw error. */
function faults(good: Uint8Array): [string, Uint8Array][] {
  const edit = (fn: (b: Uint8Array, v: DataView) => void): Uint8Array => {
    const copy = good.slice();
    fn(copy, new DataView(copy.buffer));
    return copy;
  };
  const flip = (at: number) => edit((b) => (b[at] = b[at]! ^ 0xff));
  const directoryStart = 48;
  return [
    // header
    ['empty input', new Uint8Array(0)],
    ['shorter than a header', good.slice(0, 40)],
    ['wrong signature', flip(0)],
    ['length field one too long', edit((_, v) => v.setUint32(8, good.length + 1))],
    ['length field zero', edit((_, v) => v.setUint32(8, 0))],
    ['file cut in two', good.slice(0, Math.floor(good.length / 2))],
    ['numTables zero', edit((_, v) => v.setUint16(12, 0))],
    ['numTables one more', edit((_, v) => v.setUint16(12, v.getUint16(12) + 1))],
    ['numTables 512 with no room', edit((_, v) => v.setUint16(12, 512))],
    ['numTables 5000', edit((_, v) => v.setUint16(12, 5000))],
    ['reserved set', edit((_, v) => v.setUint16(14, 0xffff))],
    ['totalSfntSize huge', edit((_, v) => v.setUint32(16, 0xfffffff0))],
    ['totalSfntSize zero', edit((_, v) => v.setUint32(16, 0))],
    ['totalCompressedSize zero', edit((_, v) => v.setUint32(20, 0))],
    ['totalCompressedSize huge', edit((_, v) => v.setUint32(20, 0xffffffff))],
    ['flavor changed', edit((_, v) => v.setUint32(4, 0x12345678))],
    // directory
    ['directory flag byte changed', flip(directoryStart)],
    ['directory tag index changed', edit((b) => (b[directoryStart] = (b[directoryStart]! & 0xc0) | 0x3f))],
    [
      'UIntBase128 with a leading zero byte',
      edit((b) => {
        b[directoryStart + 1] = 0x80;
      }),
    ],
    ['UIntBase128 of six bytes', edit((b) => b.fill(0xff, directoryStart + 1, directoryStart + 7))],
    [
      'glyf transform version 3 with a transformLength',
      edit((b) => {
        b[directoryStart] = (b[directoryStart]! & 0x3f) | 0xc0;
      }),
    ],
    [
      'table length zero',
      edit((b) => {
        b[directoryStart + 1] = 0;
      }),
    ],
    // 255UInt16 and collection forms are read from a hand-made collection header
    [
      'blocks overlapping: metaOffset inside the compressed block',
      edit((_, v) => {
        v.setUint32(28, 52);
        v.setUint32(32, 8);
      }),
    ],
    [
      'private data outside the file',
      edit((_, v) => {
        v.setUint32(40, good.length + 4);
        v.setUint32(44, 4);
      }),
    ],
    [
      'metadata length past the end',
      edit((_, v) => {
        v.setUint32(28, 52);
        v.setUint32(32, 0xffffffff);
      }),
    ],
    // lengths
    ['one byte removed from the end', good.slice(0, good.length - 1)],
    ['four bytes added at the end', concat(good, [0, 0, 0, 0])],
    // Brotli
    ['a flipped byte in the compressed block', flip(good.length - 12)],
    ['the compressed block zeroed', edit((b) => b.fill(0, good.length - 40))],
    ['the compressed block all ones', edit((b) => b.fill(0xff, good.length - 40))],
    [
      'the first compressed byte changed',
      edit((b) => {
        b[b.length - Math.min(b.length - 100, 300)] = 0xaa;
      }),
    ],
  ];
}

it('every WOFF2 fault built by editing a good file gives one plain sentence and never a throw', async () => {
  const good = new Uint8Array(await woff2Compress(fontBytes('plain.ttf')));
  expect(readContainer(good).kind).toBe('woff2');
  const header = planWoff2(good);
  expect(header.numTables).toBeGreaterThan(5);
  // The good file unpacks to the same tables (head differs in the checksum adjustment and one flag; glyf and loca are laid out again).
  const ok = await unpackWoff2(good, woff2Decompress);
  tablesEqual(ok.sfnt, fontBytes('plain.ttf'), ['head', 'glyf', 'loca']);

  const marker = 'UNIQUE-MARKER';
  let refusedCount = 0;
  for (const [label, bytes] of faults(good)) {
    try {
      const result = await unpackWoff2(bytes, woff2Decompress);
      // Some faults are harmless (a note, or data the format says to ignore): then the answer is a font.
      expect(result.sfnt.length, label).toBeGreaterThan(11);
    } catch (err) {
      // The only kind of failure is the package's own, with one sentence that holds no marker and no font bytes.
      expect(err, label).toBeInstanceOf(FontInspectorError);
      const message = (err as FontInspectorError).message;
      expect(message, label).not.toContain(marker);
      expect(message.length, label).toBeLessThan(220);
      expect(message.endsWith('.') || /\(at byte \d+\)$/.test(message), label).toBe(true);
      refusedCount++;
    }
  }
  // Most of the list is refused (the rest are notes or ignored data).
  expect(refusedCount).toBeGreaterThan(15);

  // A flipped Brotli byte that the engine decodes without error to other bytes is still a font or a sentence, never a raw error.
  for (let at = good.length - 60; at < good.length; at += 3) {
    const copy = good.slice();
    copy[at] = copy[at]! ^ 0x55;
    await unpackWoff2(copy, woff2Decompress).catch((err) => expect(err).toBeInstanceOf(FontInspectorError));
  }

  // Metadata and private data have no effect on the font: fontTools' file with both unpacks to the same tables as without.
  const withBlocks = fontBytes('with-blocks.woff2');
  const blocksHeader = planWoff2(withBlocks);
  expect(blocksHeader.metaLength).toBeGreaterThan(0);
  expect(blocksHeader.privLength).toBeGreaterThan(0);
  const plainWoff2 = await unpackWoff2(fontBytes('plain.woff2'), woff2Decompress);
  const blocks = await unpackWoff2(withBlocks, woff2Decompress);
  tablesEqual(blocks.sfnt, plainWoff2.sfnt);
  tablesEqual(plainWoff2.sfnt, fontBytes('plain.ttf'), ['head', 'glyf', 'loca']);

  // A collection packed by the engine is read member by member after unpacking.
  const packed = new Uint8Array(await woff2Compress(fontBytes('collection.ttc')));
  const unpacked = await unpackWoff2(packed, woff2Decompress);
  expect(planWoff2(packed).fontCount).toBe(2);
  expect(readContainer(unpacked.sfnt).memberCount).toBe(2);
  expect(inspectFont(unpacked.sfnt, { member: 2 }).font.family).toBe('Preview Sans');

  // When the engine says something, the package says its own sentence: an engine error with text of its own is not repeated.
  // (The browser refusing code generation does not reach a call at all: the real engine never starts, which
  // engine-start.test.ts models.)
  const loud: Woff2Decompress = async () => {
    throw new Error(`${marker} something the engine said`);
  };
  const loudError = await unpackWoff2(good, loud).catch((e: Error) => e);
  expect(loudError).toBeInstanceOf(FontInspectorError);
  expect((loudError as Error).message).not.toContain(marker);
  // An engine that returns something that is not a font, or nothing, is a sentence too.
  const notFont: Woff2Decompress = async () => new Uint8Array(100);
  await expect(unpackWoff2(good, notFont)).rejects.toThrow('did not unpack into a font');
  const tiny: Woff2Decompress = async () => new Uint8Array(3);
  await expect(unpackWoff2(good, tiny)).rejects.toThrow('did not unpack into a font');

  // Tables of the unpacked font are readable (the engine's output is a font, not just bytes with a signature).
  const font = readSfntFont(ok.sfnt, 0, false);
  expect(tableBytes(ok.sfnt, font.tables.get('name'))!.length).toBeGreaterThan(0);
});

it('a WOFF2 header that states a larger total size unpacks to the font its tables make, and converts to a TrueType file of that size', async () => {
  // The specification calls totalSfntSize advisory and the engine sizes its output from it, keeping zeros after the last
  // table. The font ends where its last padded table ends, so the zeros are cut and the page says so.
  const good = fontBytes('plain.woff2');
  const real = (await unpackWoff2(good, woff2Decompress)).sfnt;
  expect((await unpackWoff2(good, woff2Decompress)).header.notes).toEqual([]);
  const engine = { woff2Compress, woff2Decompress };
  for (const stated of [real.length + 4, real.length + 1000, MAX_SFNT_BYTES]) {
    const lie = good.slice();
    new DataView(lie.buffer, lie.byteOffset, lie.byteLength).setUint32(16, stated);
    const unpacked = await unpackWoff2(lie, woff2Decompress);
    expect(unpacked.sfnt.length, `stated ${stated}`).toBe(real.length);
    expect(Buffer.from(unpacked.sfnt).equals(Buffer.from(real))).toBe(true);
    expect(unpacked.header.notes.join(' ')).toContain('states a larger font than its tables make');
    // Converted to TrueType, the file is the real size and passes the re-read check.
    const converted = await convertFont({ bytes: lie, target: 'sfnt', fileName: 'lie.woff2' }, engine);
    expect(converted.bytes.length).toBe(real.length);
    const report = await verifyConversion(converted.sfnt, converted.bytes, engine);
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
  }

  // Whatever made it, a TrueType output with bytes after its last table is not offered.
  const padded = concat(real, new Uint8Array(1024));
  const refused = await verifyConversion(real, padded, engine);
  expect(refused.ok).toBe(false);
  expect(refused.problems.join(' ')).toContain('more bytes than its tables hold');
});

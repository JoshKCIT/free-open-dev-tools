import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';
import {
  checkSplitFile,
  checkZipTotal,
  ImageSplitterError,
  MAX_INPUT_BYTES,
  MAX_INPUT_PIXELS,
  MAX_ZIP_BYTES,
  meta as toolMeta,
  planTiles,
  plainPng,
  tileName,
  zipTiles,
  type TileRect,
} from '../src/index';

/**
 * Top-level `it(...)` calls, never nested in `describe(...)`: the project's verify scripts match required titles by
 * exact full name. Expected rectangles are worked out by hand from the division rules written in meta.json and written
 * here as literals; the ZIP is read back by a reader written here from PKWARE's APPNOTE, and every CRC-32 comes from a
 * table computed here from the IEEE 802.3 polynomial, never from fflate or from the package.
 */

const consoleSpies = [] as ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  consoleSpies.length = 0;
  for (const method of ['log', 'warn', 'error'] as const) {
    consoleSpies.push(vi.spyOn(console, method).mockImplementation(() => undefined));
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A seeded generator (mulberry32), so every run builds the same pictures and bytes. */
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

/** [row, column, x, y, width, height, name] of each tile, the form the expected values are written in. */
function shape(tiles: TileRect[]): (string | number)[][] {
  return tiles.map((t) => [t.row, t.column, t.x, t.y, t.width, t.height, t.name]);
}

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ImageSplitterError);
    return (err as Error).message;
  }
  throw new Error('nothing was thrown');
}

/** How many times each pixel of a width by height picture is covered by the tiles. */
function coverage(width: number, height: number, tiles: TileRect[]): Uint8Array {
  const count = new Uint8Array(width * height);
  for (const t of tiles) {
    for (let y = t.y; y < t.y + t.height; y++) {
      for (let x = t.x; x < t.x + t.width; x++) count[y * width + x]!++;
    }
  }
  return count;
}

it('rows and columns divide the image as evenly as whole pixels allow in row-major order', () => {
  // 10 by 7 pixels in 3 rows and 4 columns. A column starts at the whole number below i * 10 / 4: 0, 2 (2.5), 5, 7 (7.5)
  // and ends at 10, so the columns are 2, 3, 2 and 3 pixels wide. A row starts at the whole number below j * 7 / 3: 0, 2
  // (2.33), 4 (4.67) and ends at 7, so the rows are 2, 2 and 3 pixels tall. Tiles run left to right, then down.
  const tiles = planTiles(10, 7, { kind: 'grid', rows: 3, columns: 4 }, 'png');
  expect(shape(tiles)).toEqual([
    [1, 1, 0, 0, 2, 2, 'tile-r1-c1.png'],
    [1, 2, 2, 0, 3, 2, 'tile-r1-c2.png'],
    [1, 3, 5, 0, 2, 2, 'tile-r1-c3.png'],
    [1, 4, 7, 0, 3, 2, 'tile-r1-c4.png'],
    [2, 1, 0, 2, 2, 2, 'tile-r2-c1.png'],
    [2, 2, 2, 2, 3, 2, 'tile-r2-c2.png'],
    [2, 3, 5, 2, 2, 2, 'tile-r2-c3.png'],
    [2, 4, 7, 2, 3, 2, 'tile-r2-c4.png'],
    [3, 1, 0, 4, 2, 3, 'tile-r3-c1.png'],
    [3, 2, 2, 4, 3, 3, 'tile-r3-c2.png'],
    [3, 3, 5, 4, 2, 3, 'tile-r3-c3.png'],
    [3, 4, 7, 4, 3, 3, 'tile-r3-c4.png'],
  ]);

  // One row and one column is the whole picture; as many rows as pixels is one pixel each.
  expect(shape(planTiles(10, 7, { kind: 'grid', rows: 1, columns: 1 }, 'png'))).toEqual([
    [1, 1, 0, 0, 10, 7, 'tile-r1-c1.png'],
  ]);
  const thin = planTiles(10, 7, { kind: 'grid', rows: 7, columns: 10 }, 'png');
  expect(thin).toHaveLength(70);
  expect(thin.every((t) => t.width === 1 && t.height === 1)).toBe(true);
  expect(thin.map((t) => [t.x, t.y])).toEqual(Array.from({ length: 70 }, (_, i) => [i % 10, Math.floor(i / 10)]));

  // Seeded pictures: every pixel is in exactly one tile, widths differ by at most one, heights too, and the order is
  // row-major with the rows and columns counted from 1.
  const next = mulberry32(2024);
  for (let n = 0; n < 150; n++) {
    const width = 1 + Math.floor(next() * 80);
    const height = 1 + Math.floor(next() * 80);
    const rows = 1 + Math.floor(next() * Math.min(height, 20));
    const columns = 1 + Math.floor(next() * Math.min(width, 20));
    const grid = planTiles(width, height, { kind: 'grid', rows, columns }, 'png');
    expect(grid).toHaveLength(rows * columns);
    expect(coverage(width, height, grid).every((c) => c === 1)).toBe(true);
    const widths = grid.map((t) => t.width);
    const heights = grid.map((t) => t.height);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
    grid.forEach((t, i) => {
      expect([t.row, t.column]).toEqual([Math.floor(i / columns) + 1, (i % columns) + 1]);
    });
  }
});

it('tile size mode makes the last row and column smaller when the size does not divide', () => {
  // 10 by 7 pixels in tiles of 4 by 3: columns start at 0, 4, 8 and the last is 2 wide; rows start at 0, 3, 6 and the
  // last is 1 tall.
  const tiles = planTiles(10, 7, { kind: 'size', tileWidth: 4, tileHeight: 3 }, 'png');
  expect(shape(tiles)).toEqual([
    [1, 1, 0, 0, 4, 3, 'tile-r1-c1.png'],
    [1, 2, 4, 0, 4, 3, 'tile-r1-c2.png'],
    [1, 3, 8, 0, 2, 3, 'tile-r1-c3.png'],
    [2, 1, 0, 3, 4, 3, 'tile-r2-c1.png'],
    [2, 2, 4, 3, 4, 3, 'tile-r2-c2.png'],
    [2, 3, 8, 3, 2, 3, 'tile-r2-c3.png'],
    [3, 1, 0, 6, 4, 1, 'tile-r3-c1.png'],
    [3, 2, 4, 6, 4, 1, 'tile-r3-c2.png'],
    [3, 3, 8, 6, 2, 1, 'tile-r3-c3.png'],
  ]);

  // A size that divides gives equal tiles; a size larger than the picture gives one tile of the picture's size.
  expect(shape(planTiles(10, 6, { kind: 'size', tileWidth: 5, tileHeight: 3 }, 'jpeg'))).toEqual([
    [1, 1, 0, 0, 5, 3, 'tile-r1-c1.jpg'],
    [1, 2, 5, 0, 5, 3, 'tile-r1-c2.jpg'],
    [2, 1, 0, 3, 5, 3, 'tile-r2-c1.jpg'],
    [2, 2, 5, 3, 5, 3, 'tile-r2-c2.jpg'],
  ]);
  expect(shape(planTiles(10, 7, { kind: 'size', tileWidth: 40_000, tileHeight: 20 }, 'png'))).toEqual([
    [1, 1, 0, 0, 10, 7, 'tile-r1-c1.png'],
  ]);

  // Seeded pictures: every pixel in exactly one tile; every tile has the size asked for except those in the last column
  // and the last row, which are what is left.
  const next = mulberry32(77);
  for (let n = 0; n < 150; n++) {
    const width = 1 + Math.floor(next() * 90);
    const height = 1 + Math.floor(next() * 90);
    const tileWidth = Math.max(1, Math.floor(next() * 40));
    const tileHeight = Math.max(1, Math.floor(next() * 40));
    const columns = Math.ceil(width / tileWidth);
    const rows = Math.ceil(height / tileHeight);
    if (rows * columns > 400) continue;
    const grid = planTiles(width, height, { kind: 'size', tileWidth, tileHeight }, 'png');
    expect(grid).toHaveLength(rows * columns);
    expect(coverage(width, height, grid).every((c) => c === 1)).toBe(true);
    for (const t of grid) {
      expect(t.x).toBe((t.column - 1) * tileWidth);
      expect(t.y).toBe((t.row - 1) * tileHeight);
      expect(t.width).toBe(t.column === columns ? width - (columns - 1) * tileWidth : tileWidth);
      expect(t.height).toBe(t.row === rows ? height - (rows - 1) * tileHeight : tileHeight);
    }
  }
});

it('tile names are zero padded to the widest index and carry the chosen format', () => {
  expect(tileName(1, 1, 3, 4, 'png')).toBe('tile-r1-c1.png');
  expect(tileName(3, 4, 3, 4, 'png')).toBe('tile-r3-c4.png');
  expect(tileName(3, 4, 3, 4, 'jpeg')).toBe('tile-r3-c4.jpg');
  // Nine of each still needs one digit; ten of either needs two for both.
  expect(tileName(9, 9, 9, 9, 'png')).toBe('tile-r9-c9.png');
  expect(tileName(1, 1, 10, 1, 'png')).toBe('tile-r01-c01.png');
  expect(tileName(1, 1, 3, 12, 'png')).toBe('tile-r01-c01.png');
  expect(tileName(3, 12, 3, 12, 'png')).toBe('tile-r03-c12.png');
  expect(tileName(12, 3, 12, 3, 'jpeg')).toBe('tile-r12-c03.jpg');
  expect(tileName(100, 100, 100, 100, 'png')).toBe('tile-r100-c100.png');
  expect(tileName(7, 42, 100, 100, 'png')).toBe('tile-r007-c042.png');

  // In a plan: a 10 by 10 grid is padded to two digits and no two names repeat.
  const grid = planTiles(100, 100, { kind: 'grid', rows: 10, columns: 10 }, 'png');
  expect(grid[0]!.name).toBe('tile-r01-c01.png');
  expect(grid[9]!.name).toBe('tile-r01-c10.png');
  expect(grid[99]!.name).toBe('tile-r10-c10.png');
  expect(new Set(grid.map((t) => t.name)).size).toBe(100);
  // Names sort in the order of the tiles, which is why they are padded.
  const names = grid.map((t) => t.name);
  expect(names.slice().sort()).toEqual(names);
  expect(planTiles(100, 100, { kind: 'grid', rows: 2, columns: 2 }, 'jpeg').map((t) => t.name)).toEqual([
    'tile-r1-c1.jpg',
    'tile-r1-c2.jpg',
    'tile-r2-c1.jpg',
    'tile-r2-c2.jpg',
  ]);
  // A name is only ever a to z, digits, hyphens and one dot.
  for (const t of planTiles(300, 300, { kind: 'grid', rows: 20, columns: 20 }, 'png')) {
    expect(t.name).toMatch(/^tile-r\d+-c\d+\.png$/);
  }
});

it('more than 400 tiles, more rows or columns than pixels and a zero side are refused with plain messages', () => {
  // 20 by 20 is 400 tiles and is accepted; one more row or column is refused, naming the count.
  expect(planTiles(100, 100, { kind: 'grid', rows: 20, columns: 20 }, 'png')).toHaveLength(400);
  const tooMany = 'That would make 420 tiles. The most is 400 tiles, so use fewer rows and columns or larger tiles.';
  expect(messageOf(() => planTiles(100, 100, { kind: 'grid', rows: 21, columns: 20 }, 'png'))).toBe(tooMany);
  expect(messageOf(() => planTiles(100, 100, { kind: 'grid', rows: 20, columns: 21 }, 'png'))).toBe(tooMany);
  // In size mode the count is worked out first, so a huge picture with tiny tiles is refused without building them.
  expect(messageOf(() => planTiles(100, 100, { kind: 'size', tileWidth: 4, tileHeight: 5 }, 'png'))).toBe(
    'That would make 500 tiles. The most is 400 tiles, so use fewer rows and columns or larger tiles.',
  );
  expect(messageOf(() => planTiles(40_000, 40_000, { kind: 'size', tileWidth: 1, tileHeight: 1 }, 'png'))).toBe(
    'That would make 1,600,000,000 tiles. The most is 400 tiles, so use fewer rows and columns or larger tiles.',
  );
  expect(planTiles(20, 20, { kind: 'size', tileWidth: 1, tileHeight: 1 }, 'png')).toHaveLength(400);

  // More rows or columns than pixels.
  expect(planTiles(10, 7, { kind: 'grid', rows: 7, columns: 1 }, 'png')).toHaveLength(7);
  expect(messageOf(() => planTiles(10, 7, { kind: 'grid', rows: 8, columns: 1 }, 'png'))).toBe(
    'The image is 7 pixels tall, so it cannot be cut into 8 rows.',
  );
  expect(planTiles(10, 7, { kind: 'grid', rows: 1, columns: 10 }, 'png')).toHaveLength(10);
  expect(messageOf(() => planTiles(10, 7, { kind: 'grid', rows: 1, columns: 11 }, 'png'))).toBe(
    'The image is 10 pixels wide, so it cannot be cut into 11 columns.',
  );

  // A zero or unusable side.
  for (const [w, h] of [
    [0, 5],
    [5, 0],
    [-3, 5],
    [2.5, 5],
    [5, Number.NaN],
  ] as [number, number][]) {
    expect(messageOf(() => planTiles(w, h, { kind: 'grid', rows: 1, columns: 1 }, 'png'))).toBe(
      'The image has no usable size.',
    );
  }
  for (const bad of [0, -1, 1.5, Number.NaN, 101, -999_999_999, Number.POSITIVE_INFINITY]) {
    expect(messageOf(() => planTiles(500, 500, { kind: 'grid', rows: bad, columns: 2 }, 'png'))).toBe(
      'Rows must be a whole number from 1 to 100.',
    );
    expect(messageOf(() => planTiles(500, 500, { kind: 'grid', rows: 2, columns: bad }, 'png'))).toBe(
      'Columns must be a whole number from 1 to 100.',
    );
  }
  for (const bad of [0, -1, 1.5, Number.NaN, 40_001, -999_999_999]) {
    expect(messageOf(() => planTiles(500, 500, { kind: 'size', tileWidth: bad, tileHeight: 8 }, 'png'))).toBe(
      'Tile width must be a whole number from 1 to 40000.',
    );
    expect(messageOf(() => planTiles(500, 500, { kind: 'size', tileWidth: 8, tileHeight: bad }, 'png'))).toBe(
      'Tile height must be a whole number from 1 to 40000.',
    );
  }
  expect(planTiles(500, 500, { kind: 'size', tileWidth: 40_000, tileHeight: 40_000 }, 'png')).toHaveLength(1);
  // 100 rows by 4 columns is 400 tiles; 100 by 100 is refused for its count.
  expect(planTiles(100, 100, { kind: 'grid', rows: 100, columns: 4 }, 'png')).toHaveLength(400);
  expect(messageOf(() => planTiles(100, 100, { kind: 'grid', rows: 100, columns: 100 }, 'png'))).toBe(
    'That would make 10,000 tiles. The most is 400 tiles, so use fewer rows and columns or larger tiles.',
  );
});

/** CRC-32 as PKWARE's APPNOTE section 4.4.7 and the PNG specification give it: polynomial 0xEDB88320, written here. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntryRead {
  name: string;
  method: number;
  flags: number;
  time: number;
  date: number;
  crc: number;
  size: number;
  data: Uint8Array;
  offset: number;
}

/** Reads a ZIP the way APPNOTE.TXT lays it out (4.3.7 local header, 4.3.12 central directory, 4.3.16 end record). */
function readZip(zip: Uint8Array): ZipEntryRead[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  expect(view.getUint16(end + 4, true)).toBe(0); // this disk
  expect(view.getUint16(end + 6, true)).toBe(0); // disk of the central directory
  const count = view.getUint16(end + 8, true);
  expect(view.getUint16(end + 10, true)).toBe(count);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  expect(view.getUint16(end + 20, true)).toBe(0); // no comment
  expect(directoryOffset + directorySize).toBe(end);

  const entries: ZipEntryRead[] = [];
  let at = directoryOffset;
  let expectedLocal = 0;
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const time = view.getUint16(at + 12, true);
    const date = view.getUint16(at + 14, true);
    const crc = view.getUint32(at + 16, true);
    const packed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;

    // The local header says the same, and the entry's bytes follow it directly.
    expect(offset).toBe(expectedLocal);
    expect(view.getUint32(offset, true)).toBe(0x04034b50);
    expect(view.getUint16(offset + 6, true)).toBe(flags);
    expect(view.getUint16(offset + 8, true)).toBe(method);
    expect(view.getUint16(offset + 10, true)).toBe(time);
    expect(view.getUint16(offset + 12, true)).toBe(date);
    expect(view.getUint32(offset + 14, true)).toBe(crc);
    expect(view.getUint32(offset + 18, true)).toBe(packed);
    expect(view.getUint32(offset + 22, true)).toBe(size);
    const localName = view.getUint16(offset + 26, true);
    const localExtra = view.getUint16(offset + 28, true);
    expect(new TextDecoder().decode(zip.subarray(offset + 30, offset + 30 + localName))).toBe(name);
    const dataStart = offset + 30 + localName + localExtra;
    expect(packed).toBe(size); // stored: nothing was compressed
    entries.push({
      name,
      method,
      flags,
      time,
      date,
      crc,
      size,
      data: zip.subarray(dataStart, dataStart + packed),
      offset,
    });
    expectedLocal = dataStart + packed;
  }
  expect(at).toBe(end);
  expect(expectedLocal).toBe(directoryOffset);
  return entries;
}

function randomBytes(seed: number, length: number): Uint8Array {
  const next = mulberry32(seed);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = Math.floor(next() * 256);
  return out;
}

it('the ZIP stores exactly the tiles with their CRC-32 values and unzips back to the same bytes', () => {
  // The independent CRC-32 gives the published check value for the nine ASCII digits, so the table above is the right one.
  expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  expect(crc32(new Uint8Array(0))).toBe(0);

  const tiles = [
    { name: 'tile-r1-c1.png', bytes: randomBytes(1, 1) },
    { name: 'tile-r1-c2.png', bytes: randomBytes(2, 300) },
    { name: 'tile-r2-c1.jpg', bytes: randomBytes(3, 70_000) },
  ];
  const zip = zipTiles(tiles);
  const entries = readZip(zip);
  expect(entries.map((e) => e.name)).toEqual(['tile-r1-c1.png', 'tile-r1-c2.png', 'tile-r2-c1.jpg']);
  entries.forEach((entry, i) => {
    expect(entry.method).toBe(0); // stored
    expect(entry.flags).toBe(0); // plain ASCII names, no data descriptor, no encryption
    expect(entry.size).toBe(tiles[i]!.bytes.length);
    expect(entry.crc).toBe(crc32(tiles[i]!.bytes));
    expect(Array.from(entry.data)).toEqual(Array.from(tiles[i]!.bytes));
    // The modification time is 1980-01-01 00:00:00: DOS date is (year - 1980) << 9 | month << 5 | day = 33, time 0.
    expect(entry.date).toBe(0x21);
    expect(entry.time).toBe(0);
  });

  // An independent reader (fflate's own) gets the same bytes back.
  const back = unzipSync(zip);
  expect(Object.keys(back)).toEqual(['tile-r1-c1.png', 'tile-r1-c2.png', 'tile-r2-c1.jpg']);
  tiles.forEach((t) => expect(Array.from(back[t.name]!)).toEqual(Array.from(t.bytes)));

  // No entries is an empty ZIP: just the end record.
  const empty = zipTiles([]);
  expect(empty.length).toBe(22);
  expect(new DataView(empty.buffer, empty.byteOffset).getUint32(0, true)).toBe(0x06054b50);
});

it('the ZIP bytes are the same for the same tiles', () => {
  const make = () => [
    { name: 'tile-r1-c1.png', bytes: randomBytes(10, 500) },
    { name: 'tile-r1-c2.png', bytes: randomBytes(11, 40) },
  ];
  const first = zipTiles(make());
  expect(Array.from(zipTiles(make()))).toEqual(Array.from(first));
  // fflate writes the modification time from the local clock, so the writer must pin it in a way that does not depend on
  // the time zone: the same bytes in zones far east and far west of Greenwich, and the same date and time fields.
  const zone = process.env.TZ;
  try {
    for (const tz of ['Pacific/Honolulu', 'Asia/Kolkata', 'Pacific/Kiritimati', 'UTC', 'America/St_Johns']) {
      process.env.TZ = tz;
      const other = zipTiles(make());
      expect(Array.from(other)).toEqual(Array.from(first));
    }
  } finally {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  }
  // Different tiles give different bytes, and the order given is the order written.
  const swapped = zipTiles(make().reverse());
  expect(Array.from(swapped)).not.toEqual(Array.from(first));
  expect(readZip(swapped).map((e) => e.name)).toEqual(['tile-r1-c2.png', 'tile-r1-c1.png']);
});

function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

/** The first 29 bytes of a PNG: the signature and an IHDR chunk, which is all the header check reads. */
function pngHeader(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    0,
    0,
    0,
    13,
    0x49,
    0x48,
    0x44,
    0x52,
    ...u32be(width),
    ...u32be(height),
    8,
    6,
    0,
    0,
    0,
  ]);
}

it('files over 100 MB or 40000000 pixels are refused before decoding', () => {
  expect(MAX_INPUT_BYTES).toBe(100 * 1024 * 1024);
  expect(MAX_INPUT_PIXELS).toBe(40_000_000);
  // 100 MB exactly is accepted, one byte more is not, whatever the header says (the reported size is checked first).
  expect(checkSplitFile(pngHeader(4, 4), MAX_INPUT_BYTES).kind).toBe('png');
  expect(messageOf(() => checkSplitFile(pngHeader(4, 4), MAX_INPUT_BYTES + 1))).toBe(
    'This file is larger than 100 MB, the most this page accepts.',
  );
  expect(messageOf(() => checkSplitFile(new Uint8Array(0), MAX_INPUT_BYTES + 1))).toBe(
    'This file is larger than 100 MB, the most this page accepts.',
  );
  // 8000 by 5000 is exactly 40,000,000 pixels; one more row is over.
  expect(checkSplitFile(pngHeader(8000, 5000), 1000)).toEqual({ kind: 'png', width: 8000, height: 5000 });
  expect(messageOf(() => checkSplitFile(pngHeader(8000, 5001), 1000))).toBe(
    'This image declares more than 40,000,000 pixels, the most this page accepts. Choose a smaller image.',
  );
  expect(messageOf(() => checkSplitFile(pngHeader(40_001, 1000), 1000))).toBe(
    'This image declares more than 40,000,000 pixels, the most this page accepts. Choose a smaller image.',
  );
  expect(messageOf(() => checkSplitFile(new Uint8Array(0), 0))).toBe('This file is empty.');
  expect(messageOf(() => checkSplitFile(new TextEncoder().encode('just some text, not a picture at all'), 40))).toBe(
    'This is not a PNG, JPEG, GIF, WebP or BMP image.',
  );
  // A PDF is a known kind but not a picture.
  expect(messageOf(() => checkSplitFile(new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n'), 40))).toBe(
    'This is not a PNG, JPEG, GIF, WebP or BMP image.',
  );
});

it('meta pins fflate 0.8.3 exactly', () => {
  expect(toolMeta.dependencies).toEqual({ fflate: '0.8.3' });
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  // Written by the sync script from meta.json: an exact version, no range.
  expect(pkg.dependencies).toEqual({ fflate: '0.8.3' });
  const installed = JSON.parse(
    readFileSync(new URL('../node_modules/fflate/package.json', import.meta.url), 'utf8'),
  ) as {
    version: string;
  };
  expect(installed.version).toBe('0.8.3');
  const limits = toolMeta.limits.join('\n');
  expect(limits).toContain('100 MB and 40,000,000 pixels');
  expect(limits).toContain('at most 400 tiles');
});

it('the ZIP refuses names that are not plain generated names, repeats and too many entries', () => {
  const one = new Uint8Array([1]);
  for (const bad of [
    '',
    '../x.png',
    'a/b.png',
    'a\\b.png',
    'tile r1.png',
    '.hidden',
    'é.png',
    'a:b.png',
    'x'.repeat(65),
  ]) {
    expect(messageOf(() => zipTiles([{ name: bad, bytes: one }]))).toBe(
      'A ZIP entry name may hold only letters, digits, hyphens, dots and underscores.',
    );
  }
  expect(
    messageOf(() =>
      zipTiles([
        { name: 'a.png', bytes: one },
        { name: 'a.png', bytes: one },
      ]),
    ),
  ).toBe('Two ZIP entries have the same name.');
  const many = Array.from({ length: 401 }, (_, i) => ({ name: `t${i}.png`, bytes: one }));
  expect(messageOf(() => zipTiles(many))).toBe('A ZIP of tiles holds at most 400 entries.');
  expect(zipTiles(many.slice(0, 400)).length).toBeGreaterThan(400);
  // The tiles together may be 1 GB and no more (checked as each tile is made, so a run stops before the memory is used).
  expect(MAX_ZIP_BYTES).toBe(1024 * 1024 * 1024);
  expect(checkZipTotal(MAX_ZIP_BYTES)).toBe(MAX_ZIP_BYTES);
  expect(messageOf(() => checkZipTotal(MAX_ZIP_BYTES + 1))).toBe(
    'The tiles together are larger than 1 GB, which this page does not put in one ZIP.',
  );
});

/** CRC-32 for a PNG chunk, from the same table. */
function pngChunk(type: string, data: number[]): number[] {
  const body = [...Array.from(type, (ch) => ch.charCodeAt(0)), ...data];
  return [...u32be(data.length), ...body, ...u32be(crc32(Uint8Array.from(body)))];
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function chunkNames(png: Uint8Array): string[] {
  const names: string[] = [];
  let at = 8;
  while (at < png.length) {
    const length = ((png[at]! << 24) | (png[at + 1]! << 16) | (png[at + 2]! << 8) | png[at + 3]!) >>> 0;
    names.push(String.fromCharCode(png[at + 4]!, png[at + 5]!, png[at + 6]!, png[at + 7]!));
    at += 12 + length;
  }
  return names;
}

it('a browser PNG loses its colour profile tags and keeps its pixels', () => {
  const ihdr = pngChunk('IHDR', [...u32be(1), ...u32be(1), 8, 6, 0, 0, 0]);
  const idat = pngChunk('IDAT', [0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0xf8, 0x0f, 0x00, 0x01, 0x01, 0x01, 0x00]);
  const iend = pngChunk('IEND', []);
  const tagged = Uint8Array.from([
    ...PNG_SIGNATURE,
    ...ihdr,
    ...pngChunk('sBIT', [8, 8, 8, 8]),
    ...pngChunk('iCCP', [0x70, 0x00, 0x00, 1, 2, 3]),
    ...pngChunk('gAMA', [0, 1, 0x8f, 0xc0]),
    ...pngChunk('cHRM', new Array<number>(32).fill(1)),
    ...pngChunk('sRGB', [0]),
    ...pngChunk('cICP', [1, 13, 0, 1]),
    ...pngChunk('tEXt', [65, 0, 66]),
    ...idat,
    ...iend,
  ]);
  const plain = plainPng(tagged);
  expect(chunkNames(plain)).toEqual(['IHDR', 'tEXt', 'IDAT', 'IEND']);
  expect(Array.from(plain)).toEqual([...PNG_SIGNATURE, ...ihdr, ...pngChunk('tEXt', [65, 0, 66]), ...idat, ...iend]);
  const untagged = Uint8Array.from([...PNG_SIGNATURE, ...ihdr, ...idat, ...iend]);
  expect(Array.from(plainPng(untagged))).toEqual(Array.from(untagged));
  const text = new TextEncoder().encode('not a picture at all, just some text');
  expect(Array.from(plainPng(text))).toEqual(Array.from(text));
  expect(Array.from(plainPng(new Uint8Array(0)))).toEqual([]);
  // A chunk (with room for a whole header after it) whose length runs past the end makes the whole input count as not a
  // PNG: even the tag before it stays.
  const lying = Uint8Array.from([
    ...PNG_SIGNATURE,
    ...ihdr,
    ...pngChunk('iCCP', [1, 2, 3]),
    0x7f,
    0xff,
    0xff,
    0xff,
    0x49,
    0x44,
    0x41,
    0x54,
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
  ]);
  expect(Array.from(plainPng(lying))).toEqual(Array.from(lying));
});

it('nothing is written to the console while planning tiles or writing the ZIP', () => {
  planTiles(10, 7, { kind: 'grid', rows: 3, columns: 4 }, 'png');
  planTiles(10, 7, { kind: 'size', tileWidth: 4, tileHeight: 3 }, 'jpeg');
  tileName(1, 1, 3, 4, 'png');
  zipTiles([{ name: 'tile-r1-c1.png', bytes: new Uint8Array([1, 2, 3]) }]);
  plainPng(Uint8Array.from([1, 2, 3]));
  for (const refusal of [
    () => planTiles(0, 0, { kind: 'grid', rows: 1, columns: 1 }, 'png'),
    () => zipTiles([{ name: '../x', bytes: new Uint8Array(1) }]),
    () => checkSplitFile(new Uint8Array(0), 0),
  ]) {
    try {
      refusal();
    } catch {
      // The refusal is expected; only the console matters here.
    }
  }
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
});

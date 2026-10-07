/**
 * Helpers for the tests: an independent way to take a font apart and put one together, written here on purpose so the
 * tests do not use the package's own reader to build the files they feed it.
 */

export function fromBase64(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'base64'));
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

const be32 = (b: Uint8Array, o: number): number =>
  ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const be16 = (b: Uint8Array, o: number): number => (b[o]! << 8) | b[o + 1]!;

/** The tables of a plain (not collection) sfnt, in directory order, as copies. */
export function tablesOf(font: Uint8Array): [string, Uint8Array][] {
  const count = be16(font, 4);
  const out: [string, Uint8Array][] = [];
  for (let i = 0; i < count; i++) {
    const e = 12 + 16 * i;
    const tag = String.fromCharCode(font[e]!, font[e + 1]!, font[e + 2]!, font[e + 3]!);
    const offset = be32(font, e + 8);
    const length = be32(font, e + 12);
    out.push([tag, font.slice(offset, offset + length)]);
  }
  return out;
}

/** The sum of a byte range read as big-endian 32-bit numbers, padded with zeros, modulo 2 to the 32. */
export function sum32(bytes: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    const word =
      ((bytes[i] ?? 0) << 24) | ((bytes[i + 1] ?? 0) << 16) | ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
    sum = (sum + (word >>> 0)) % 4294967296;
  }
  return sum;
}

/**
 * Builds a plain sfnt from tables: directory sorted by tag, every table padded to four bytes, correct table checksums,
 * and the head table's checksum adjustment set so the whole file sums to 0xB1B0AFBA.
 */
export function buildSfnt(flavor: number, tables: [string, Uint8Array][]): Uint8Array {
  const sorted = [...tables].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const n = sorted.length;
  const dirEnd = 12 + 16 * n;
  let total = dirEnd;
  const placed = sorted.map(([tag, data]) => {
    const copy = data.slice();
    if (tag === 'head' && copy.length >= 12) copy.fill(0, 8, 12);
    const at = total;
    total += (data.length + 3) & ~3;
    return { tag, data: copy, at, sum: sum32(copy), length: data.length };
  });
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, flavor);
  dv.setUint16(4, n);
  let log = 0;
  while (2 ** (log + 1) <= n) log++;
  dv.setUint16(6, 2 ** log * 16);
  dv.setUint16(8, log);
  dv.setUint16(10, n * 16 - 2 ** log * 16);
  placed.forEach((t, i) => {
    const e = 12 + 16 * i;
    for (let k = 0; k < 4; k++) out[e + k] = t.tag.charCodeAt(k);
    dv.setUint32(e + 4, t.sum);
    dv.setUint32(e + 8, t.at);
    dv.setUint32(e + 12, t.length);
    out.set(t.data, t.at);
  });
  const head = placed.find((t) => t.tag === 'head');
  if (head) dv.setUint32(head.at + 8, (0xb1b0afba - sum32(out) + 4294967296) % 4294967296);
  return out;
}

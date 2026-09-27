/**
 * Test-only ZIP builder, entirely independent of this package's own
 * `zip-write.ts`/`zip-read.ts` so a hostile fixture is never built by the
 * same code that later reads it. Uses `node:zlib`'s raw DEFLATE
 * (`deflateRawSync`) as the compression engine and a hand-rolled CRC-32
 * (kept separate from `src/crc32.ts` for the same independence reason) --
 * these functions can write hostile shapes this package's own writer
 * refuses to produce on purpose: lying, overlapping, or encrypted-flagged
 * entries.
 */
import { deflateRawSync } from 'node:zlib';

function crc32(bytes: Uint8Array): number {
  let table = crc32.table;
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    crc32.table = table;
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
namespace crc32 {
  export let table: Int32Array | undefined;
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n & 0xffff, 0);
  return b;
}
function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

export interface ZipEntrySpec {
  name: string;
  content: Uint8Array;
  /** When set, these exact bytes are written as the name instead of UTF-8-encoding `name` -- for a raw, non-UTF-8 name byte (e.g. a lone code page 437 byte) `name` cannot itself represent. */
  nameBytesOverride?: Uint8Array;
  /** 0 = stored, 8 = deflate. Default 8 when content is non-empty, else 0. */
  method?: number;
  /** Overrides the general purpose bit flag entirely; when absent, bit 11 (UTF-8) is set for a non-ASCII name. */
  generalPurposeFlag?: number;
  /** Unix mode bits (e.g. 0o120777 for a symlink) placed in the high 16 bits of external attributes; sets version-made-by host to UNIX (3). */
  unixMode?: number;
  /** Overrides the CRC-32 written into both headers -- used to build a damaged-entry fixture. */
  crcOverride?: number;
  /** Overrides the compressed size written into the central directory only, independent of the actual bytes following the local header. */
  compressedSizeOverride?: number;
  modDate?: number;
  modTime?: number;
}

export interface BuiltZip {
  bytes: Uint8Array;
  /** Byte offset of each entry's own local file header, in the order given. */
  localHeaderOffsets: number[];
}

/**
 * Writes a ZIP archive with full control over each entry's own header
 * fields, entirely independent of `src/zip-write.ts`. Every entry is
 * written to its own fresh local header (never reused), and the central
 * directory is written from the same field values -- callers that want an
 * overlapping-entry or duplicate-local-header fixture pass
 * `duplicateLocalHeaderFor` to point a later central directory entry's own
 * `relative offset of local header` field at an earlier entry's local
 * header instead of writing a fresh one.
 */
export function writeHostileZip(
  entries: ZipEntrySpec[],
  options: { duplicateLocalHeaderFor?: number[] } = {},
): BuiltZip {
  const parts: Buffer[] = [];
  let offset = 0;
  const localOffsets: number[] = [];
  const dataForCentral: { compressedSize: number; uncompressedSize: number; crc: number }[] = [];

  for (const entry of entries) {
    const method = entry.method ?? (entry.content.length > 0 ? 8 : 0);
    const compressed = method === 8 ? deflateRawSync(Buffer.from(entry.content)) : Buffer.from(entry.content);
    const nameBytes = entry.nameBytesOverride ? Buffer.from(entry.nameBytesOverride) : Buffer.from(entry.name, 'utf8');
    const crc = entry.crcOverride ?? crc32(entry.content);
    const isAsciiName = /^[\x00-\x7f]*$/.test(entry.name);
    const flag = entry.generalPurposeFlag ?? (isAsciiName ? 0 : 0x0800);

    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(flag),
      u16(method),
      u16(entry.modTime ?? 0),
      u16(entry.modDate ?? 0x21),
      u32(crc),
      u32(compressed.length),
      u32(entry.content.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
    ]);

    localOffsets.push(offset);
    parts.push(local, compressed);
    offset += local.length + compressed.length;
    dataForCentral.push({
      compressedSize: entry.compressedSizeOverride ?? compressed.length,
      uncompressedSize: entry.content.length,
      crc,
    });
  }

  const centralStart = offset;
  const centralParts: Buffer[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const nameBytes = entry.nameBytesOverride ? Buffer.from(entry.nameBytesOverride) : Buffer.from(entry.name, 'utf8');
    const method = entry.method ?? (entry.content.length > 0 ? 8 : 0);
    const isAsciiName = /^[\x00-\x7f]*$/.test(entry.name);
    const flag = entry.generalPurposeFlag ?? (isAsciiName ? 0 : 0x0800);
    const versionMadeByHost = entry.unixMode !== undefined ? 3 : 0;
    const externalAttrs = entry.unixMode !== undefined ? (entry.unixMode << 16) >>> 0 : 0;
    const localOffsetForThis =
      options.duplicateLocalHeaderFor?.[i] !== undefined
        ? localOffsets[options.duplicateLocalHeaderFor[i]!]!
        : localOffsets[i]!;
    const d = dataForCentral[i]!;

    centralParts.push(
      Buffer.concat([
        u32(0x02014b50),
        u16((versionMadeByHost << 8) | 20),
        u16(20),
        u16(flag),
        u16(method),
        u16(entry.modTime ?? 0),
        u16(entry.modDate ?? 0x21),
        u32(d.crc),
        u32(d.compressedSize),
        u32(d.uncompressedSize),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(externalAttrs),
        u32(localOffsetForThis),
        nameBytes,
      ]),
    );
  }
  const centralDir = Buffer.concat(centralParts);
  parts.push(centralDir);

  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDir.length),
    u32(centralStart),
    u16(0),
  ]);
  parts.push(eocd);

  return { bytes: new Uint8Array(Buffer.concat(parts)), localHeaderOffsets: localOffsets };
}

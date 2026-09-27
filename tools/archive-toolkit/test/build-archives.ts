/**
 * Test-only ZIP and TAR builders, entirely independent of this package's
 * own `zip-write.ts`/`tar.ts` so a hostile fixture is never built by the
 * same code that later reads it. Uses `node:zlib`'s raw DEFLATE
 * (`deflateRawSync`/`inflateRawSync`) as the compression engine and a
 * hand-rolled CRC-32 (kept separate from `src/crc32.ts` for the same
 * independence reason) -- these functions can write hostile shapes this
 * package's own writer refuses to produce on purpose: lying, overlapping,
 * or encrypted-flagged entries.
 */
import { deflateRawSync } from 'node:zlib';

let crc32Table: Int32Array | undefined;
function crc32(bytes: Uint8Array): number {
  if (!crc32Table) {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    crc32Table = table;
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crc32Table[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
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
function isAsciiName(name: string): boolean {
  for (let i = 0; i < name.length; i++) {
    if (name.charCodeAt(i) > 0x7f) return false;
  }
  return true;
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
    const flag = entry.generalPurposeFlag ?? (isAsciiName(entry.name) ? 0 : 0x0800);

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
    const flag = entry.generalPurposeFlag ?? (isAsciiName(entry.name) ? 0 : 0x0800);
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

// --- TAR ---

function octal(n: number, width: number): Buffer {
  const s = n.toString(8).padStart(width - 1, '0');
  const b = Buffer.alloc(width, 0);
  b.write(s, 0, 'ascii');
  return b;
}

export interface TarEntrySpec {
  name: string;
  content?: Uint8Array;
  typeflag?: string;
  linkname?: string;
  mode?: number;
  uid?: number;
  gid?: number;
  mtime?: number;
  devmajor?: number;
  devminor?: number;
  /** Corrupts the written checksum field so a reader must refuse this header. */
  badChecksum?: boolean;
}

function tarHeaderBlock(spec: TarEntrySpec, size: number): Buffer {
  const block = Buffer.alloc(512, 0);
  block.write(spec.name.slice(0, 100), 0, 'ascii');
  octal(spec.mode ?? 0o644, 8).copy(block, 100);
  octal(spec.uid ?? 0, 8).copy(block, 108);
  octal(spec.gid ?? 0, 8).copy(block, 116);
  octal(size, 12).copy(block, 124);
  octal(spec.mtime ?? 0, 12).copy(block, 136);
  block.write('        ', 148, 'ascii'); // checksum placeholder: eight spaces
  block.write(spec.typeflag ?? '0', 156, 'ascii');
  block.write((spec.linkname ?? '').slice(0, 100), 157, 'ascii');
  block.write('ustar\0', 257, 'ascii');
  block.write('00', 263, 'ascii');
  octal(spec.devmajor ?? 0, 8).copy(block, 329);
  octal(spec.devminor ?? 0, 8).copy(block, 337);

  let sum = 0;
  for (let i = 0; i < 512; i++) sum += block[i]!;
  if (spec.badChecksum) sum += 1; // deliberately wrong
  const chk = sum.toString(8).padStart(6, '0') + '\0 ';
  block.write(chk, 148, 'ascii');
  return block;
}

function padTo512(buf: Buffer): Buffer {
  const remainder = buf.length % 512;
  if (remainder === 0) return buf;
  return Buffer.concat([buf, Buffer.alloc(512 - remainder, 0)]);
}

/** Writes a ustar-format TAR archive from entries, ending with two zero blocks. */
export function writeHostileTar(entries: TarEntrySpec[]): Uint8Array {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const content = entry.content ?? new Uint8Array(0);
    const header = tarHeaderBlock(entry, content.length);
    parts.push(header, padTo512(Buffer.from(content)));
  }
  parts.push(Buffer.alloc(1024, 0));
  return new Uint8Array(Buffer.concat(parts));
}

/** Writes a GNU long-name (or long-link, via typeflag 'K') header block plus its data block, matching the format golang/go's own gnu-multi-hdrs.tar fixture uses. The real entry's own header must follow immediately after what this returns. */
export function writeGnuLongNameEntry(longName: string, kind: 'name' | 'link' = 'name'): Buffer[] {
  const nameBytes = Buffer.from(longName + '\0', 'utf8');
  const longHeader = tarHeaderBlock(
    { name: './@LongLink', typeflag: kind === 'name' ? 'L' : 'K', mtime: 0 },
    nameBytes.length,
  );
  return [longHeader, padTo512(nameBytes)];
}

// --- gzip ---

export interface GzipMemberSpec {
  content: Uint8Array;
  fname?: string;
  corruptCrc?: boolean;
  corruptIsize?: boolean;
}

/** Writes one or more concatenated RFC 1952 gzip members, each with a real DEFLATE body via node:zlib. */
export function writeHostileGzip(members: GzipMemberSpec[]): Uint8Array {
  const parts: Buffer[] = [];
  for (const member of members) {
    const flg = member.fname ? 0x08 : 0;
    const header = Buffer.concat([
      Buffer.from([0x1f, 0x8b, 0x08, flg]),
      u32(0),
      Buffer.from([0, 0xff]),
      member.fname ? Buffer.concat([Buffer.from(member.fname, 'ascii'), Buffer.from([0])]) : Buffer.alloc(0),
    ]);
    const body = deflateRawSync(Buffer.from(member.content));
    const crc = member.corruptCrc ? (crc32(member.content) ^ 0xffffffff) >>> 0 : crc32(member.content);
    const isize = member.corruptIsize ? (member.content.length + 1) >>> 0 : member.content.length >>> 0;
    parts.push(header, body, u32(crc), u32(isize));
  }
  return new Uint8Array(Buffer.concat(parts));
}

export { crc32 as testOnlyCrc32 };

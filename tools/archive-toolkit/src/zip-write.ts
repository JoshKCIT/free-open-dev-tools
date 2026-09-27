/**
 * Writes a ZIP archive per PKWARE's APPNOTE.TXT (fetched 2026-09-27):
 * section 4.3.7 (local file header), 4.3.12 (central directory header),
 * 4.3.16 (end of central directory record), 4.4.4 (general purpose bit
 * flag: bit 11 set for a non-ASCII name), 4.4.5 (compression method: 0
 * stored, 8 deflate). No ZIP64 record is ever written -- `ARCHIVE_LIMITS`
 * keeps every offset and size well under the 4 GiB ZIP64 threshold, stated
 * plainly in this tool's own `limits`.
 *
 * DOS date and time (the local header's own `last mod file time`/`last mod
 * file date` fields) always carry whole-UTC-second precision at best; when
 * `keepTimes` is on, the third-party mapping 0x5455 "extended timestamp"
 * extra field (APPNOTE.TXT section 4.6.1 names it, without detailing its
 * byte layout -- this reader/writer follows Info-ZIP's own long-published
 * de facto layout for it: a one-byte flag whose bit 0 means a modification
 * time follows, then that Unix time_t as 4 bytes) carries the exact
 * second, since DOS date/time cannot represent a year before 1980 or after
 * 2107, nor a leap second. When `keepTimes` is off, every entry is written
 * with a fixed 1980-01-01 00:00 timestamp, so producing the same input
 * twice gives byte-identical output.
 */
import { Deflate } from 'fflate';
import { dedupePath } from './safe-path';
import { crc32 } from './crc32';

export interface ZipWriteFile {
  name: string;
  bytes: Uint8Array;
}

export interface ZipWriteOptions {
  method: 'store' | 'deflate';
  level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  keepTimes: boolean;
}

export interface ZipWriteHooks {
  signal?: AbortSignal;
  onProgress?: (fraction: number, detail: string) => void;
}

export interface ZipWriteEntryResult {
  name: string;
  size: number;
  packedSize: number;
  modified: string;
}

export interface ZipWriteResult {
  bytes: Uint8Array;
  entries: ZipWriteEntryResult[];
}

export const ZIP_WRITE_MAX_FILES = 10_000;
export const ZIP_WRITE_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}
function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}
function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const FIXED_DOS_DATE = 0x21; // 1980-01-01
const FIXED_DOS_TIME = 0x00; // 00:00:00

function dosDateTimeFromDate(date: Date): { dosDate: number; dosTime: number } {
  const year = date.getUTCFullYear();
  const dosYear = Math.min(Math.max(year - 1980, 0), 127);
  const dosDate = (dosYear << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  const dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2);
  return { dosDate, dosTime };
}

function deflateAll(bytes: Uint8Array, level: ZipWriteOptions['level']): Uint8Array {
  const chunks: Uint8Array[] = [];
  const deflator = new Deflate({ level }, (data) => {
    if (data.length > 0) chunks.push(data.slice());
  });
  deflator.push(bytes, true);
  return concat(chunks);
}

function extendedTimestampExtra(epochSeconds: number): Uint8Array {
  const body = new Uint8Array(5);
  body[0] = 0x01; // flag bit 0: modification time follows
  new DataView(body.buffer).setUint32(1, epochSeconds >>> 0, true);
  return concat([u16(0x5455), u16(body.length), body]);
}

/**
 * Builds a ZIP archive from picked files: at most `ZIP_WRITE_MAX_FILES`
 * entries and `ZIP_WRITE_MAX_TOTAL_BYTES` of input in total, names
 * disambiguated on collision, stored or deflated at the chosen level, with
 * a CRC-32 per entry and DOS date/time (plus an extended timestamp extra
 * field when `keepTimes` is on).
 */
export async function createZip(
  files: ZipWriteFile[],
  options: ZipWriteOptions,
  hooks: ZipWriteHooks = {},
): Promise<ZipWriteResult> {
  if (files.length > ZIP_WRITE_MAX_FILES) {
    throw new Error(`Stopped: this would create more than ${ZIP_WRITE_MAX_FILES} files in one ZIP`);
  }
  const totalInputBytes = files.reduce((sum, f) => sum + f.bytes.length, 0);
  if (totalInputBytes > ZIP_WRITE_MAX_TOTAL_BYTES) {
    throw new Error(
      `Stopped: this would create a ZIP over ${Math.round(ZIP_WRITE_MAX_TOTAL_BYTES / (1024 * 1024 * 1024))} GB`,
    );
  }

  const now = new Date();
  const fixedDate = options.keepTimes ? now : new Date(Date.UTC(1980, 0, 1, 0, 0, 0));
  const { dosDate, dosTime } = options.keepTimes
    ? dosDateTimeFromDate(now)
    : { dosDate: FIXED_DOS_DATE, dosTime: FIXED_DOS_TIME };

  const usedNames = new Set<string>();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  const entryResults: ZipWriteEntryResult[] = [];
  let offset = 0;

  for (let i = 0; i < files.length; i++) {
    if (hooks.signal?.aborted) throw new DOMException('The run was cancelled.', 'AbortError');
    const file = files[i]!;
    const { path: name } = dedupePath(file.name.replace(/\\/g, '/'), usedNames);
    // eslint-disable-next-line no-control-regex -- intentionally matches the whole 0x00-0x7F ASCII range, not just printable characters.
    const isAscii = /^[\x00-\x7f]*$/.test(name);
    const flag = isAscii ? 0 : 0x0800;
    const nameBytes = new TextEncoder().encode(name);

    const method = options.method === 'store' ? 0 : 8;
    const compressed = method === 8 ? deflateAll(file.bytes, options.level) : file.bytes;
    const crc = crc32(file.bytes);
    const extra = options.keepTimes
      ? extendedTimestampExtra(Math.floor(fixedDate.getTime() / 1000))
      : new Uint8Array(0);

    const localHeaderOffset = offset;
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(flag),
      u16(method),
      u16(dosTime),
      u16(dosDate),
      u32(crc),
      u32(compressed.length),
      u32(file.bytes.length),
      u16(nameBytes.length),
      u16(extra.length),
      nameBytes,
      extra,
    ]);
    localParts.push(local, compressed);
    offset += local.length + compressed.length;

    centralParts.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(flag),
        u16(method),
        u16(dosTime),
        u16(dosDate),
        u32(crc),
        u32(compressed.length),
        u32(file.bytes.length),
        u16(nameBytes.length),
        u16(extra.length),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(localHeaderOffset),
        nameBytes,
        extra,
      ]),
    );

    entryResults.push({
      name,
      size: file.bytes.length,
      packedSize: compressed.length,
      modified: fixedDate.toISOString(),
    });

    hooks.onProgress?.((i + 1) / files.length, `File ${i + 1} of ${files.length}`);
  }

  const centralDir = concat(centralParts);
  const centralStart = offset;
  const eocd = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDir.length),
    u32(centralStart),
    u16(0),
  ]);

  const bytes = concat([...localParts, centralDir, eocd]);
  return { bytes, entries: entryResults };
}

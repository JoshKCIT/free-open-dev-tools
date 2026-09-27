/**
 * Reads a ZIP archive from its central directory outward, per PKWARE's
 * APPNOTE.TXT (pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT, fetched
 * 2026-09-27): section 4.3.16 "End of central directory record" (found by
 * scanning back from the end of the file, since its own comment field can
 * push it up to 65,557 bytes before the true end), sections 4.3.14 and
 * 4.3.15 (the ZIP64 end of central directory record and its locator, read
 * when a 4.3.16 field reads the ZIP64 sentinel 0xFFFF/0xFFFFFFFF, per
 * 4.4.1.4), section 4.3.12 (the central directory header: name, flags,
 * method, CRC-32, sizes, local header offset, version made by, external
 * attributes, comment and extra field lengths), section 4.3.7 (the local
 * file header, read only to find where an entry's compressed data starts --
 * every other fact this reader trusts comes from the central directory,
 * never the local header, which is what makes central-directory-driven
 * reading a real defense against a parser that disagrees with itself about
 * where an entry's data begins or ends), section 4.5.3 (the ZIP64 extended
 * information extra field), section 4.4.2 (version made by: the upper byte
 * names the host system, 3 for UNIX), section 4.4.4 (general purpose bit
 * flag: bit 0 is traditional encryption, bit 11 is the UTF-8 flag), section
 * 4.4.5 (compression method: 0 stored, 8 deflate), section 4.4.15 (external
 * file attributes: for a UNIX-authored entry the high 16 bits are a POSIX
 * mode, decoding a symbolic link, device, FIFO or socket exactly as
 * `S_IFMT` does), and Appendix D (code page 437, when the UTF-8 flag is
 * unset and the name is not valid UTF-8).
 *
 * The overlapping-entry decompression bomb this reader refuses outright
 * (two entries whose own byte ranges, from their local header through the
 * end of their compressed data, overlap or coincide, or an entry that
 * overlaps the central directory itself) is the construction David
 * Fifield's "A better zip bomb" (bamsoftware.com/hacks/zipbomb/) documents:
 * a total-size or ratio limit alone cannot catch it, because the same
 * compressed bytes are counted once per entry that points at them, letting
 * a tiny file expand far past any per-entry ratio before the limit ever
 * sees the "real" total.
 */
import { Inflate } from 'fflate';
import type { RandomAccessReader } from './reader';
import { safeEntryPath, dedupePath } from './safe-path';
import { ARCHIVE_LIMITS, OutputBudget, assertEntryCountWithinLimit, type ArchiveLimits } from './limits';
import { crc32 } from './crc32';
import { decodeCp437 } from './cp437';

export type ZipEntryType = 'file' | 'directory' | 'symlink' | 'device' | 'fifo' | 'socket';
export type ZipEntryStatus = 'extracted' | 'listed' | 'refused' | 'damaged';

export interface ZipEntryResult {
  path: string;
  type: ZipEntryType;
  size: number;
  packedSize?: number;
  modified?: string;
  linkTarget?: string;
  status: ZipEntryStatus;
  reason?: string;
}

export interface ZipReadHooks {
  signal?: AbortSignal;
  onProgress?: (fraction: number, detail: string) => void;
}

export interface ZipReadResult {
  entries: ZipEntryResult[];
  files: { path: string; bytes: Uint8Array }[];
  warnings: string[];
}

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;

const EOCD_FIXED_SIZE = 22;
const MAX_COMMENT_LENGTH = 0xffff;
const MAX_EOCD_SEARCH = EOCD_FIXED_SIZE + MAX_COMMENT_LENGTH;

const UTF8_FLAG = 0x0800;
const ENCRYPTED_FLAG = 0x0001;

const S_IFMT = 0xf000;
const S_IFSOCK = 0xc000;
const S_IFLNK = 0xa000;
const S_IFDIR = 0x4000;
const S_IFBLK = 0x6000;
const S_IFCHR = 0x2000;
const S_IFIFO = 0x1000;

const MAX_LINK_TARGET_BYTES = 4096;

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}
function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}
function readU64(view: DataView, offset: number): number {
  // Archive input is capped at ARCHIVE_LIMITS.maxInputBytes (2 GiB), so a
  // ZIP64 field's real value always fits in a JS-safe integer here; this
  // reader never trusts a ZIP64 size on its own for anything but locating
  // bytes already known to fit inside that cap.
  const low = view.getUint32(offset, true);
  const high = view.getUint32(offset + 4, true);
  return high * 0x100000000 + low;
}

function dosDateTimeToIso(date: number, time: number): string {
  const year = 1980 + ((date >> 9) & 0x7f);
  const month = (date >> 5) & 0x0f;
  const day = date & 0x1f;
  const hour = (time >> 11) & 0x1f;
  const minute = (time >> 5) & 0x3f;
  const second = (time & 0x1f) * 2;
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return new Date(Date.UTC(1980, 0, 1, 0, 0, 0)).toISOString();
  }
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second)).toISOString();
}

/**
 * Reads the extended timestamp extra field (third-party mapping 0x5455,
 * APPNOTE.TXT section 4.6.1) when present: a one-byte flag (bit 0 set means
 * a modification time follows) then a 4-byte little-endian Unix time_t.
 * Returns `null` when the field is absent or carries no modification time,
 * so the caller falls back to the DOS date/time fields every ZIP entry has.
 */
function readExtendedTimestampMtime(extra: Uint8Array): string | null {
  let offset = 0;
  while (offset + 4 <= extra.length) {
    const view = new DataView(extra.buffer, extra.byteOffset + offset, extra.length - offset);
    const id = readU16(view, 0);
    const size = readU16(view, 2);
    if (offset + 4 + size > extra.length) break;
    if (id === 0x5455 && size >= 5) {
      const flags = extra[offset + 4]!;
      if (flags & 0x01) {
        const mtimeView = new DataView(extra.buffer, extra.byteOffset + offset + 5, 4);
        const epochSeconds = mtimeView.getUint32(0, true);
        return new Date(epochSeconds * 1000).toISOString();
      }
    }
    offset += 4 + size;
  }
  return null;
}

/** Reads the ZIP64 extended information field (0x0001) present in a central directory extra field, when one of its own sizes is the ZIP64 sentinel. */
function readZip64Extra(
  extra: Uint8Array,
  needsUncompressed: boolean,
  needsCompressed: boolean,
  needsOffset: boolean,
): { uncompressedSize?: number; compressedSize?: number; localHeaderOffset?: number } {
  let offset = 0;
  while (offset + 4 <= extra.length) {
    const view = new DataView(extra.buffer, extra.byteOffset + offset, extra.length - offset);
    const id = readU16(view, 0);
    const size = readU16(view, 2);
    if (offset + 4 + size > extra.length) break;
    if (id === 0x0001) {
      const fieldView = new DataView(extra.buffer, extra.byteOffset + offset + 4, size);
      let p = 0;
      const result: { uncompressedSize?: number; compressedSize?: number; localHeaderOffset?: number } = {};
      if (needsUncompressed && p + 8 <= size) {
        result.uncompressedSize = readU64(fieldView, p);
        p += 8;
      }
      if (needsCompressed && p + 8 <= size) {
        result.compressedSize = readU64(fieldView, p);
        p += 8;
      }
      if (needsOffset && p + 8 <= size) {
        result.localHeaderOffset = readU64(fieldView, p);
        p += 8;
      }
      return result;
    }
    offset += 4 + size;
  }
  return {};
}

interface CentralDirEntry {
  versionMadeByHost: number;
  generalPurposeFlag: number;
  method: number;
  modDate: number;
  modTime: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  externalAttrs: number;
  localHeaderOffset: number;
  rawNameBytes: Uint8Array;
  extra: Uint8Array;
}

async function findEndOfCentralDirectory(
  reader: RandomAccessReader,
): Promise<{ base: number; view: DataView; bytes: Uint8Array }> {
  const searchLength = Math.min(reader.size, MAX_EOCD_SEARCH);
  const base = reader.size - searchLength;
  const bytes = await reader.read(base, searchLength);
  for (let i = bytes.length - EOCD_FIXED_SIZE; i >= 0; i--) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + i, EOCD_FIXED_SIZE);
    if (readU32(view, 0) === EOCD_SIGNATURE) {
      const commentLength = readU16(view, 20);
      if (base + i + EOCD_FIXED_SIZE + commentLength <= reader.size + 0) {
        return { base: base + i, view, bytes };
      }
    }
  }
  throw new Error('this is not a ZIP archive, or its central directory could not be found');
}

/**
 * Reads a ZIP archive: locates the end of central directory record (and, if
 * needed, the ZIP64 end of central directory record and locator), reads
 * every central directory header, refuses the whole archive outright when
 * two entries' own byte ranges overlap or coincide or when an entry
 * overlaps the central directory itself, then reads each entry in local
 * header order, decoding a compressed one with fflate's streaming DEFLATE
 * decompressor fed in bounded pieces and charging every produced byte to
 * `OutputBudget` before it is kept.
 */
export async function readZip(
  reader: RandomAccessReader,
  limits: ArchiveLimits = ARCHIVE_LIMITS,
  hooks: ZipReadHooks = {},
): Promise<ZipReadResult> {
  const warnings: string[] = [];
  const { base: eocdBase, view: eocdView } = await findEndOfCentralDirectory(reader);

  let totalEntries = readU16(eocdView, 10);
  let centralDirSize = readU32(eocdView, 12);
  let centralDirOffset = readU32(eocdView, 16);

  const needsZip64 = totalEntries === 0xffff || centralDirSize === 0xffffffff || centralDirOffset === 0xffffffff;
  if (needsZip64) {
    const locatorSize = 20;
    if (eocdBase - locatorSize < 0)
      throw new Error('this ZIP64 archive is missing its end of central directory locator');
    const locatorBytes = await reader.read(eocdBase - locatorSize, locatorSize);
    const locatorView = new DataView(locatorBytes.buffer, locatorBytes.byteOffset, locatorSize);
    if (readU32(locatorView, 0) !== ZIP64_EOCD_LOCATOR_SIGNATURE) {
      throw new Error('this ZIP64 archive is missing its end of central directory locator');
    }
    const zip64EocdOffset = readU64(locatorView, 8);
    const zip64RecordHeaderSize = 56;
    const zip64HeaderBytes = await reader.read(zip64EocdOffset, zip64RecordHeaderSize);
    const zip64View = new DataView(zip64HeaderBytes.buffer, zip64HeaderBytes.byteOffset, zip64RecordHeaderSize);
    if (readU32(zip64View, 0) !== ZIP64_EOCD_SIGNATURE) {
      throw new Error('this ZIP64 archive is missing its zip64 end of central directory record');
    }
    totalEntries = readU64(zip64View, 32);
    centralDirSize = readU64(zip64View, 40);
    centralDirOffset = readU64(zip64View, 48);
  }

  assertEntryCountWithinLimit(totalEntries, limits);

  const cdBytes = await reader.read(centralDirOffset, centralDirSize);
  const cdView = new DataView(cdBytes.buffer, cdBytes.byteOffset, cdBytes.length);

  const cdEntries: CentralDirEntry[] = [];
  let p = 0;
  for (let i = 0; i < totalEntries; i++) {
    if (p + 46 > cdBytes.length || readU32(cdView, p) !== CENTRAL_HEADER_SIGNATURE) {
      throw new Error('this ZIP archive’s central directory is corrupt');
    }
    const versionMadeBy = readU16(cdView, p + 4);
    const generalPurposeFlag = readU16(cdView, p + 8);
    const method = readU16(cdView, p + 10);
    const modTime = readU16(cdView, p + 12);
    const modDate = readU16(cdView, p + 14);
    const crcField = readU32(cdView, p + 16);
    let compressedSize = readU32(cdView, p + 20);
    let uncompressedSize = readU32(cdView, p + 24);
    const nameLength = readU16(cdView, p + 28);
    const extraLength = readU16(cdView, p + 30);
    const commentLength = readU16(cdView, p + 32);
    const externalAttrs = readU32(cdView, p + 38);
    let localHeaderOffset = readU32(cdView, p + 42);

    const nameStart = p + 46;
    const extraStart = nameStart + nameLength;
    const commentStart = extraStart + extraLength;
    const entryEnd = commentStart + commentLength;
    if (entryEnd > cdBytes.length) {
      throw new Error('this ZIP archive’s central directory is corrupt');
    }
    const rawNameBytes = cdBytes.subarray(nameStart, extraStart);
    const extra = cdBytes.subarray(extraStart, commentStart);

    if (uncompressedSize === 0xffffffff || compressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      const zip64 = readZip64Extra(
        extra,
        uncompressedSize === 0xffffffff,
        compressedSize === 0xffffffff,
        localHeaderOffset === 0xffffffff,
      );
      if (zip64.uncompressedSize !== undefined) uncompressedSize = zip64.uncompressedSize;
      if (zip64.compressedSize !== undefined) compressedSize = zip64.compressedSize;
      if (zip64.localHeaderOffset !== undefined) localHeaderOffset = zip64.localHeaderOffset;
    }

    cdEntries.push({
      versionMadeByHost: versionMadeBy >> 8,
      generalPurposeFlag,
      method,
      modDate,
      modTime,
      crc32: crcField,
      compressedSize,
      uncompressedSize,
      externalAttrs,
      localHeaderOffset,
      rawNameBytes,
      extra,
    });

    p = entryEnd;
  }

  // Every entry's own byte range runs from its local file header through
  // the end of its compressed data. Central-directory-driven sizing (never
  // a local header's own, possibly-zero, data-descriptor-pending fields)
  // is what makes this range trustworthy enough to refuse an overlap on.
  interface Range {
    start: number;
    end: number;
    dataStart: number;
    index: number;
  }
  const ranges: Range[] = [];
  for (let i = 0; i < cdEntries.length; i++) {
    const entry = cdEntries[i]!;
    const localHeaderBytes = await reader.read(entry.localHeaderOffset, 30);
    if (localHeaderBytes.length < 30) {
      throw new Error('this ZIP archive has a local file header that runs past the end of the file');
    }
    const localView = new DataView(localHeaderBytes.buffer, localHeaderBytes.byteOffset, 30);
    if (readU32(localView, 0) !== LOCAL_HEADER_SIGNATURE) {
      throw new Error('this ZIP archive has a local file header that does not match its central directory');
    }
    const localNameLength = readU16(localView, 26);
    const localExtraLength = readU16(localView, 28);
    const dataStart = entry.localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + entry.compressedSize;
    ranges.push({ start: entry.localHeaderOffset, end: dataEnd, dataStart, index: i });
  }

  const sortedRanges = [...ranges].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sortedRanges.length; i++) {
    if (sortedRanges[i]!.start < sortedRanges[i - 1]!.end) {
      throw new Error(
        'this ZIP archive has entries that overlap or share compressed data, which is how a decompression bomb hides',
      );
    }
  }
  const cdRangeStart = centralDirOffset;
  const cdRangeEnd = centralDirOffset + centralDirSize;
  for (const range of ranges) {
    if (range.start < cdRangeEnd && cdRangeStart < range.end) {
      throw new Error('this ZIP archive has an entry that overlaps its own central directory');
    }
  }

  const budget = new OutputBudget(limits);
  const entries: ZipEntryResult[] = [];
  const files: { path: string; bytes: Uint8Array }[] = [];
  const usedPaths = new Set<string>();

  for (let i = 0; i < cdEntries.length; i++) {
    if (hooks.signal?.aborted) throw new DOMException('The run was cancelled.', 'AbortError');
    const entry = cdEntries[i]!;
    const range = ranges[i]!;

    let decodedName: string;
    if (entry.generalPurposeFlag & UTF8_FLAG) {
      try {
        decodedName = new TextDecoder('utf-8', { fatal: true }).decode(entry.rawNameBytes);
      } catch {
        entries.push({
          path: decodeCp437(entry.rawNameBytes),
          type: 'file',
          size: entry.uncompressedSize,
          packedSize: entry.compressedSize,
          status: 'refused',
          reason: 'this entry’s name claims to be UTF-8 but is not valid UTF-8',
        });
        continue;
      }
    } else {
      try {
        decodedName = new TextDecoder('utf-8', { fatal: true }).decode(entry.rawNameBytes);
      } catch {
        decodedName = decodeCp437(entry.rawNameBytes);
      }
    }

    const isDirectoryBySlash = decodedName.endsWith('/');
    const safe = safeEntryPath(decodedName);
    const modified = readExtendedTimestampMtime(entry.extra) ?? dosDateTimeToIso(entry.modDate, entry.modTime);

    if ('refused' in safe) {
      entries.push({
        path: decodedName,
        type: isDirectoryBySlash ? 'directory' : 'file',
        size: entry.uncompressedSize,
        packedSize: entry.compressedSize,
        modified,
        status: 'refused',
        reason: safe.refused,
      });
      continue;
    }

    for (const warning of safe.warnings) warnings.push(`${safe.path}: ${warning}`);

    let type: ZipEntryType = isDirectoryBySlash ? 'directory' : 'file';
    if (!isDirectoryBySlash && entry.versionMadeByHost === 3) {
      const mode = entry.externalAttrs >>> 16;
      const fileType = mode & S_IFMT;
      if (fileType === S_IFLNK) type = 'symlink';
      else if (fileType === S_IFBLK || fileType === S_IFCHR) type = 'device';
      else if (fileType === S_IFIFO) type = 'fifo';
      else if (fileType === S_IFSOCK) type = 'socket';
      else if (fileType === S_IFDIR) type = 'directory';
      else type = 'file';
    }

    if (type === 'directory') {
      entries.push({ path: safe.path, type, size: 0, modified, status: 'listed' });
      continue;
    }

    if (entry.generalPurposeFlag & ENCRYPTED_FLAG) {
      entries.push({
        path: safe.path,
        type,
        size: entry.uncompressedSize,
        packedSize: entry.compressedSize,
        modified,
        status: 'listed',
        reason: 'this entry is encrypted and cannot be extracted',
      });
      continue;
    }

    if (entry.method !== 0 && entry.method !== 8) {
      entries.push({
        path: safe.path,
        type,
        size: entry.uncompressedSize,
        packedSize: entry.compressedSize,
        modified,
        status: 'listed',
        reason: `compression method ${entry.method} is not supported`,
      });
      continue;
    }

    // Symbolic links, devices, FIFOs and sockets are listed with their
    // target text (read, small, from the entry's own data, charged to the
    // same budget as any other entry) but never treated as a regular file
    // to extract or offer as a download.
    if (type !== 'file') {
      let linkTarget: string | undefined;
      if (type === 'symlink') {
        budget.startEntry();
        const targetBytes = await readEntryBytes(reader, range.dataStart, entry, budget, hooks);
        linkTarget = new TextDecoder('utf-8', { fatal: false }).decode(targetBytes.subarray(0, MAX_LINK_TARGET_BYTES));
      }
      entries.push({
        path: safe.path,
        type,
        size: entry.uncompressedSize,
        packedSize: entry.compressedSize,
        modified,
        status: 'listed',
        linkTarget,
      });
      continue;
    }

    budget.startEntry();
    const producedBytes = await readEntryBytes(reader, range.dataStart, entry, budget, hooks, (withinEntry) => {
      hooks.onProgress?.((i + withinEntry) / cdEntries.length, `Entry ${i + 1} of ${cdEntries.length}`);
    });

    const actualCrc = crc32(producedBytes);
    if (actualCrc !== entry.crc32 >>> 0) {
      entries.push({
        path: safe.path,
        type,
        size: entry.uncompressedSize,
        packedSize: entry.compressedSize,
        modified,
        status: 'damaged',
        reason: 'this entry is damaged: its checksum does not match',
      });
      continue;
    }

    const deduped = dedupePath(safe.path, usedPaths);
    if (deduped.deduped) warnings.push(`${safe.path}: renamed to ${deduped.path} because that name was already used`);

    entries.push({
      path: deduped.path,
      type,
      size: producedBytes.length,
      packedSize: entry.compressedSize,
      modified,
      status: 'extracted',
    });
    files.push({ path: deduped.path, bytes: producedBytes });

    hooks.onProgress?.((i + 1) / cdEntries.length, `Entry ${i + 1} of ${cdEntries.length}`);
  }

  return { entries, files, warnings };
}

/**
 * Reads and, if the entry is stored with method 8, decompresses one
 * entry's own compressed bytes at `dataStart`, feeding compressed input to
 * the decompressor in `feedChunkBytes` pieces and charging every produced
 * chunk to `budget` before it is kept, so a bomb is stopped mid-stream. The
 * decompressor used here can be paused indefinitely between pieces because
 * it keeps its own state across `push` calls -- this project never reaches
 * for a form of this library that decompresses a whole buffer in one call,
 * which cannot be stopped once started.
 */
async function readEntryBytes(
  reader: RandomAccessReader,
  dataStart: number,
  entry: Pick<CentralDirEntry, 'method' | 'compressedSize'>,
  budget: OutputBudget,
  hooks: ZipReadHooks,
  onChunk?: (consumedFraction: number) => void,
): Promise<Uint8Array> {
  const feedChunkBytes = ARCHIVE_LIMITS.feedChunkBytes;
  const chunks: Uint8Array[] = [];
  let producedTotal = 0;
  const totalToConsume = entry.compressedSize || 1;

  if (entry.method === 0) {
    let offset = dataStart;
    let remaining = entry.compressedSize;
    let consumed = 0;
    while (remaining > 0) {
      if (hooks.signal?.aborted) throw new DOMException('The run was cancelled.', 'AbortError');
      const take = Math.min(feedChunkBytes, remaining);
      const chunk = await reader.read(offset, take);
      budget.charge(chunk.length, chunk.length);
      chunks.push(chunk.slice());
      producedTotal += chunk.length;
      offset += chunk.length;
      remaining -= chunk.length;
      consumed += chunk.length;
      onChunk?.(consumed / totalToConsume);
    }
    return concatChunks(chunks, producedTotal);
  }

  let inflateError: unknown;
  const inflator = new Inflate((data) => {
    if (data.length > 0) {
      budget.charge(data.length, 0);
      chunks.push(data.slice());
      producedTotal += data.length;
    }
  });

  let offset = dataStart;
  let remaining = entry.compressedSize;
  let consumed = 0;
  while (remaining > 0) {
    if (hooks.signal?.aborted) throw new DOMException('The run was cancelled.', 'AbortError');
    const take = Math.min(feedChunkBytes, remaining);
    const chunk = await reader.read(offset, take);
    const isFinalChunk = chunk.length === remaining;
    try {
      inflator.push(chunk.slice(), isFinalChunk);
    } catch (err) {
      inflateError = err;
      break;
    }
    // Charges the consumed side of the ratio denominator for this piece.
    // `budget.charge` inside `ondata` above already recorded every
    // produced chunk against the same running totals; calling it again
    // here with zero produced bytes folds in how much compressed input
    // has been fed so far, which is what the ratio check divides by.
    budget.charge(0, chunk.length);
    offset += chunk.length;
    remaining -= chunk.length;
    consumed += chunk.length;
    onChunk?.(consumed / totalToConsume);
  }
  if (inflateError) {
    throw inflateError instanceof Error ? inflateError : new Error('this entry could not be decompressed');
  }

  return concatChunks(chunks, producedTotal);
}

function concatChunks(chunks: Uint8Array[], totalLength: number): Uint8Array {
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

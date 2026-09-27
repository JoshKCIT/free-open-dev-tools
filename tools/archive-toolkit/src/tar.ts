/**
 * Reads a TAR archive as a flat sequence of 512-byte blocks, per the Open
 * Group's own `pax` utility description (pubs.opengroup.org/onlinepubs/
 * 9699919799/utilities/pax.html, fetched 2026-09-27), "ustar Header Block":
 * the fixed `name`/`mode`/`uid`/`gid`/`size`/`mtime`/`chksum`/`typeflag`/
 * `linkname`/`magic`/`version`/`uname`/`gname`/`devmajor`/`devminor`/
 * `prefix` field layout, numeric fields as NUL-or-space-terminated octal
 * text, and the checksum as "the sum of the bytes in the header block...
 * the `chksum` field is treated as if it were all blanks" during that sum.
 * GNU tar's own long-name extension (a `./@LongLink` entry with typeflag
 * `L` or `K` whose data block holds the real name or link name as a
 * NUL-terminated string, applying to the very next header -- when several
 * such headers appear consecutively, the last of each kind wins, matching
 * golang/go's own `archive/tar` test data) and POSIX pax extended headers
 * (typeflag `x`, or `g` for a header applying to every following entry --
 * this reader merges global records first, then a per-entry `x` header's
 * own records on top -- whose data block holds `<length> <keyword>=<value>\n`
 * records; this reader reads `path`, `linkpath`, `size` and `mtime`) are
 * both implemented, since GNU tar and libarchive-family writers use one or
 * the other for anything past the 100-byte name field's own length.
 */
import type { RandomAccessReader } from './reader';
import { safeEntryPath, dedupePath } from './safe-path';
import { ARCHIVE_LIMITS, OutputBudget, assertEntryCountWithinLimit, type ArchiveLimits } from './limits';

export type TarEntryType = 'file' | 'directory' | 'symlink' | 'hardlink' | 'device' | 'fifo' | 'socket';
export type TarEntryStatus = 'extracted' | 'listed' | 'refused' | 'damaged';

export interface TarEntryResult {
  path: string;
  type: TarEntryType;
  size: number;
  modified?: string;
  linkTarget?: string;
  status: TarEntryStatus;
  reason?: string;
}

export interface TarReadHooks {
  signal?: AbortSignal;
  onProgress?: (fraction: number, detail: string) => void;
}

export interface TarReadResult {
  entries: TarEntryResult[];
  files: { path: string; bytes: Uint8Array }[];
  warnings: string[];
}

const BLOCK_SIZE = 512;

function isZeroBlock(block: Uint8Array): boolean {
  for (let i = 0; i < block.length; i++) if (block[i] !== 0) return false;
  return true;
}

/**
 * Reads a numeric header field: GNU base-256 when the field's own first
 * byte has its high bit set (a big-endian magnitude built from the
 * remaining seven bits of that byte plus every following byte -- negative
 * base-256 numbers never occur for the fields this reader uses, which are
 * always non-negative sizes and timestamps), else NUL-or-space-terminated
 * octal text.
 */
function parseNumericField(field: Uint8Array): number {
  if (field.length > 0 && (field[0]! & 0x80) !== 0) {
    let value = field[0]! & 0x7f;
    for (let i = 1; i < field.length; i++) value = value * 256 + field[i]!;
    return value;
  }
  let text = '';
  for (let i = 0; i < field.length; i++) {
    const b = field[i]!;
    if (b === 0) break;
    text += String.fromCharCode(b);
  }
  text = text.trim();
  if (text === '') return 0;
  const parsed = parseInt(text, 8);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fieldToString(field: Uint8Array): string {
  let end = field.length;
  for (let i = 0; i < field.length; i++) {
    if (field[i] === 0) {
      end = i;
      break;
    }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(field.subarray(0, end));
}

interface ParsedHeader {
  name: string;
  mode: number;
  size: number;
  mtimeEpochSeconds: number;
  typeflag: string;
  linkname: string;
  magic: string;
  prefix: string;
  checksumOk: boolean;
}

function parseHeaderBlock(block: Uint8Array): ParsedHeader {
  const name = fieldToString(block.subarray(0, 100));
  const mode = parseNumericField(block.subarray(100, 108));
  const size = parseNumericField(block.subarray(124, 136));
  const mtimeEpochSeconds = parseNumericField(block.subarray(136, 148));
  const typeflag = String.fromCharCode(block[156]!);
  const linkname = fieldToString(block.subarray(157, 257));
  const magic = fieldToString(block.subarray(257, 263));
  const prefix = magic === 'ustar' ? fieldToString(block.subarray(345, 500)) : '';

  let sum = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) {
    sum += i >= 148 && i < 156 ? 0x20 : block[i]!;
  }
  const recordedChecksum = parseNumericField(block.subarray(148, 156));
  const checksumOk = sum === recordedChecksum;

  return { name, mode, size, mtimeEpochSeconds, typeflag, linkname, magic, prefix, checksumOk };
}

/** Parses PAX extended-header records: `<length> <keyword>=<value>\n`, `<length>` counting itself. */
function parsePaxRecords(data: Uint8Array): Record<string, string> {
  const records: Record<string, string> = {};
  const text = new TextDecoder('utf-8', { fatal: false }).decode(data);
  let offset = 0;
  while (offset < text.length) {
    const spaceIndex = text.indexOf(' ', offset);
    if (spaceIndex === -1) break;
    const lengthText = text.slice(offset, spaceIndex);
    const length = parseInt(lengthText, 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = text.slice(offset, offset + length);
    const equalsIndex = record.indexOf('=');
    if (equalsIndex !== -1) {
      const keyword = record.slice(spaceIndex - offset + 1, equalsIndex);
      const value = record.slice(equalsIndex + 1).replace(/\n$/, '');
      records[keyword] = value;
    }
    offset += length;
  }
  return records;
}

function typeflagToType(typeflag: string): TarEntryType {
  switch (typeflag) {
    case '1':
      return 'hardlink';
    case '2':
      return 'symlink';
    case '3':
      return 'device';
    case '4':
      return 'device';
    case '5':
      return 'directory';
    case '6':
      return 'fifo';
    default:
      return 'file';
  }
}

/**
 * Reads a TAR archive sequentially: verifies each header's own checksum,
 * applies pending GNU long-name/long-link overrides and PAX extended
 * records to the header they precede, and reads a regular file's own
 * content through the shared `OutputBudget` in `feedChunkBytes` pieces (a
 * TAR entry is never compressed on its own, so consumed and produced bytes
 * are always equal here; the budget still bounds the total across every
 * entry and the entry count against `limits.maxEntries`, which a TAR
 * archive with no central directory can only be checked incrementally,
 * entry by entry, rather than up front).
 */
export async function readTar(
  reader: RandomAccessReader,
  limits: ArchiveLimits = ARCHIVE_LIMITS,
  hooks: TarReadHooks = {},
  budget: OutputBudget = new OutputBudget(limits),
): Promise<TarReadResult> {
  const entries: TarEntryResult[] = [];
  const files: { path: string; bytes: Uint8Array }[] = [];
  const warnings: string[] = [];
  const usedPaths = new Set<string>();

  let offset = 0;
  let pendingLongName: string | undefined;
  let pendingLongLinkName: string | undefined;
  let pendingPaxRecords: Record<string, string> | undefined;
  let globalPaxRecords: Record<string, string> = {};
  let entryCount = 0;
  let zeroBlockStreak = 0;

  while (offset + BLOCK_SIZE <= reader.size) {
    if (hooks.signal?.aborted) throw new DOMException('The run was cancelled.', 'AbortError');
    const block = await reader.read(offset, BLOCK_SIZE);
    if (block.length < BLOCK_SIZE) break;
    offset += BLOCK_SIZE;

    if (isZeroBlock(block)) {
      zeroBlockStreak++;
      if (zeroBlockStreak >= 2) break;
      continue;
    }
    zeroBlockStreak = 0;

    const header = parseHeaderBlock(block);
    if (!header.checksumOk) {
      throw new Error(`this TAR archive has a header with a wrong checksum at byte offset ${offset - BLOCK_SIZE}`);
    }

    const dataBlocks = Math.ceil(header.size / BLOCK_SIZE);

    if (header.typeflag === 'L' || header.typeflag === 'K') {
      const data = await reader.read(offset, header.size);
      const text = fieldToString(data);
      if (header.typeflag === 'L') pendingLongName = text;
      else pendingLongLinkName = text;
      offset += dataBlocks * BLOCK_SIZE;
      continue;
    }

    if (header.typeflag === 'x' || header.typeflag === 'g') {
      const data = await reader.read(offset, header.size);
      const records = parsePaxRecords(data);
      if (header.typeflag === 'g') globalPaxRecords = { ...globalPaxRecords, ...records };
      else pendingPaxRecords = { ...globalPaxRecords, ...records };
      offset += dataBlocks * BLOCK_SIZE;
      continue;
    }

    entryCount++;
    assertEntryCountWithinLimit(entryCount, limits);

    let name = header.prefix ? `${header.prefix}/${header.name}` : header.name;
    let linkname = header.linkname;
    let size = header.size;
    let modified = new Date(header.mtimeEpochSeconds * 1000).toISOString();

    if (pendingLongName !== undefined) name = pendingLongName;
    if (pendingLongLinkName !== undefined) linkname = pendingLongLinkName;
    const pax = pendingPaxRecords ?? (Object.keys(globalPaxRecords).length > 0 ? globalPaxRecords : undefined);
    if (pax) {
      if (pax.path !== undefined) name = pax.path;
      if (pax.linkpath !== undefined) linkname = pax.linkpath;
      if (pax.size !== undefined) {
        const parsedSize = parseInt(pax.size, 10);
        if (Number.isFinite(parsedSize)) size = parsedSize;
      }
      if (pax.mtime !== undefined) {
        const parsedMtime = parseFloat(pax.mtime);
        if (Number.isFinite(parsedMtime)) modified = new Date(parsedMtime * 1000).toISOString();
      }
    }
    pendingLongName = undefined;
    pendingLongLinkName = undefined;
    pendingPaxRecords = undefined;

    const type = typeflagToType(header.typeflag);
    const dataStart = offset;
    offset += dataBlocks * BLOCK_SIZE;

    const safe = safeEntryPath(name);
    if ('refused' in safe) {
      entries.push({ path: name, type, size, modified, status: 'refused', reason: safe.refused });
      continue;
    }
    for (const warning of safe.warnings) warnings.push(`${safe.path}: ${warning}`);

    if (header.typeflag === 'S') {
      entries.push({
        path: safe.path,
        type: 'file',
        size,
        modified,
        status: 'listed',
        reason: 'GNU sparse files are not supported',
      });
      continue;
    }

    if (type === 'directory') {
      entries.push({ path: safe.path, type, size: 0, modified, status: 'listed' });
      continue;
    }

    if (type !== 'file') {
      entries.push({ path: safe.path, type, size, modified, status: 'listed', linkTarget: linkname || undefined });
      continue;
    }

    budget.startEntry();
    const chunks: Uint8Array[] = [];
    let produced = 0;
    let remaining = size;
    let readOffset = dataStart;
    while (remaining > 0) {
      if (hooks.signal?.aborted) throw new DOMException('The run was cancelled.', 'AbortError');
      const take = Math.min(ARCHIVE_LIMITS.feedChunkBytes, remaining);
      const chunk = await reader.read(readOffset, take);
      budget.charge(chunk.length, chunk.length);
      chunks.push(chunk.slice());
      produced += chunk.length;
      readOffset += chunk.length;
      remaining -= chunk.length;
    }
    const out = new Uint8Array(produced);
    let writeOffset = 0;
    for (const chunk of chunks) {
      out.set(chunk, writeOffset);
      writeOffset += chunk.length;
    }

    const deduped = dedupePath(safe.path, usedPaths);
    if (deduped.deduped) warnings.push(`${safe.path}: renamed to ${deduped.path} because that name was already used`);

    entries.push({ path: deduped.path, type, size: out.length, modified, status: 'extracted' });
    files.push({ path: deduped.path, bytes: out });

    hooks.onProgress?.(dataStart / reader.size, `${deduped.path}`);
  }

  return { entries, files, warnings };
}

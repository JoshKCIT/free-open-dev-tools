/**
 * `extractArchive` dispatches on the kind the canonical `file-sniff.ts`
 * header check reports (`zip`, `tar`, `gzip`) and reads it with the
 * matching reader; a gzip file whose decompressed content itself starts
 * with a valid TAR header is read as tar.gz, streaming the already
 * budget-bounded gunzipped bytes into the TAR reader so a hostile tar.gz
 * is still stopped by the same total-output limit. `createZip` builds a
 * ZIP from picked files. Every error this package's own readers or writer
 * throw is normalised to `ArchiveError`, so a caller only ever needs to
 * catch one error type.
 */
import meta from './meta.json';
import { assertFileKind, sniffFile } from './file-sniff';
import { bytesReader, type RandomAccessReader } from './reader';
import { readZip } from './zip-read';
import { readTar, type TarEntryType } from './tar';
import { readGzip } from './gzip';
import { createZip as writeZip, type ZipWriteFile, type ZipWriteOptions } from './zip-write';
import { ARCHIVE_LIMITS, type ArchiveLimits } from './limits';
import type { ZipEntryType } from './zip-read';

export { meta };
export type { RandomAccessReader };
export { bytesReader };
export type { ZipWriteFile, ZipWriteOptions };
export { ARCHIVE_LIMITS };
export type { ArchiveLimits };

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveError';
  }
}

export type ArchiveKind = 'zip' | 'tar' | 'gzip';
export type ArchiveEntryStatus = 'extracted' | 'listed' | 'refused' | 'damaged';
export type ArchiveEntryType = ZipEntryType | TarEntryType;

export interface ArchiveEntry {
  path: string;
  type: ArchiveEntryType;
  size: number;
  packedSize?: number;
  modified?: string;
  linkTarget?: string;
  status: ArchiveEntryStatus;
  reason?: string;
}

export interface ArchiveHooks {
  signal?: AbortSignal;
  onProgress?: (fraction: number, detail: string) => void;
}

export interface ExtractResult {
  kind: ArchiveKind;
  entries: ArchiveEntry[];
  files: { name: string; bytes: Uint8Array }[];
  warnings: string[];
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function stripGzExtension(fileName: string): string {
  return /\.gz$/i.test(fileName) ? fileName.slice(0, -3) : `${fileName}.out`;
}

export interface ExtractOptions {
  /** Overrides the package's own default limits. Test-only in production usage; a page never sets this. */
  limits?: ArchiveLimits;
}

/**
 * Reads an archive: checks its header with `assertFileKind` before
 * anything else touches it, then dispatches to the matching reader. A
 * gzip whose own decompressed content starts with a valid TAR header is
 * read as tar.gz automatically.
 */
export async function extractArchive(
  reader: RandomAccessReader,
  fileName: string,
  options: ExtractOptions = {},
  hooks: ArchiveHooks = {},
): Promise<ExtractResult> {
  const limits = options.limits ?? ARCHIVE_LIMITS;
  const firstBytesLength = Math.min(reader.size, 64 * 1024);
  const firstBytes = await reader.read(0, firstBytesLength);
  const sniff = assertFileKind(firstBytes, ['zip', 'gzip', 'tar'], { maxBytes: limits.maxInputBytes });

  try {
    if (sniff.kind === 'zip') {
      const result = await readZip(reader, limits, hooks);
      return {
        kind: 'zip',
        entries: result.entries,
        files: result.files.map((f) => ({ name: f.path, bytes: f.bytes })),
        warnings: result.warnings,
      };
    }

    if (sniff.kind === 'tar') {
      const result = await readTar(reader, limits, hooks);
      return {
        kind: 'tar',
        entries: result.entries,
        files: result.files.map((f) => ({ name: f.path, bytes: f.bytes })),
        warnings: result.warnings,
      };
    }

    // gzip
    const gz = await readGzip(reader, limits, hooks);
    const inner = sniffFile(gz.bytes);
    if (inner?.kind === 'tar') {
      const tarResult = await readTar(bytesReader(gz.bytes), limits, hooks);
      return {
        kind: 'tar',
        entries: tarResult.entries,
        files: tarResult.files.map((f) => ({ name: f.path, bytes: f.bytes })),
        warnings: [...gz.warnings, ...tarResult.warnings],
      };
    }

    const outName = gz.name ?? stripGzExtension(fileName);
    return {
      kind: 'gzip',
      entries: [{ path: outName, type: 'file', size: gz.bytes.length, status: 'extracted' }],
      files: [{ name: outName, bytes: gz.bytes }],
      warnings: gz.warnings,
    };
  } catch (err) {
    if (isAbort(err)) throw err;
    if (err instanceof ArchiveError) throw err;
    throw new ArchiveError(err instanceof Error ? err.message : 'this archive could not be read');
  }
}

export interface CreateZipResult {
  files: { name: string; bytes: Uint8Array }[];
  entries: { name: string; size: number; packedSize: number; modified: string }[];
}

/** Builds a ZIP archive from picked files. See `zip-write.ts`'s own `createZip` for the full contract. */
export async function createZip(
  files: ZipWriteFile[],
  options: ZipWriteOptions,
  hooks: ArchiveHooks = {},
): Promise<CreateZipResult> {
  try {
    const result = await writeZip(files, options, hooks);
    return { files: [{ name: 'archive.zip', bytes: result.bytes }], entries: result.entries };
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new ArchiveError(err instanceof Error ? err.message : 'this ZIP could not be created');
  }
}

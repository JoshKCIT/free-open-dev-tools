/**
 * `extractArchive` dispatches on the kind the canonical `file-sniff.ts`
 * header check reports. This task implements the `zip` kind only; TAR and
 * gzip (including tar.gz) are added in a later task, which also adds
 * `createZip`. Every error `readZip` throws is normalised to
 * `ArchiveError`, so a caller only ever needs to catch one error type.
 */
import meta from './meta.json';
import { assertFileKind } from './file-sniff';
import { bytesReader, type RandomAccessReader } from './reader';
import { readZip } from './zip-read';
import type { ZipEntryType } from './zip-read';
import { ARCHIVE_LIMITS } from './limits';

export { meta };
export type { RandomAccessReader };
export { bytesReader };

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveError';
  }
}

export type ArchiveKind = 'zip' | 'tar' | 'gzip';
export type ArchiveEntryStatus = 'extracted' | 'listed' | 'refused' | 'damaged';
export type ArchiveEntryType = ZipEntryType;

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

/**
 * Reads an archive: checks its header with `assertFileKind` before
 * anything else touches it, then dispatches to the matching reader.
 */
export async function extractArchive(
  reader: RandomAccessReader,
  _fileName: string,
  _options: Record<string, never> = {},
  hooks: ArchiveHooks = {},
): Promise<ExtractResult> {
  const firstBytesLength = Math.min(reader.size, 64 * 1024);
  const firstBytes = await reader.read(0, firstBytesLength);
  const sniff = assertFileKind(firstBytes, ['zip', 'gzip', 'tar'], { maxBytes: ARCHIVE_LIMITS.maxInputBytes });

  try {
    if (sniff.kind === 'zip') {
      const result = await readZip(reader, ARCHIVE_LIMITS, hooks);
      return {
        kind: 'zip',
        entries: result.entries,
        files: result.files.map((f) => ({ name: f.path, bytes: f.bytes })),
        warnings: result.warnings,
      };
    }
    throw new ArchiveError(`reading a ${sniff.kind} archive is not implemented yet`);
  } catch (err) {
    if (isAbort(err)) throw err;
    if (err instanceof ArchiveError) throw err;
    throw new ArchiveError(err instanceof Error ? err.message : 'this archive could not be read');
  }
}

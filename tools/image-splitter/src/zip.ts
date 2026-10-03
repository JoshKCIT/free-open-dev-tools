/** Stub: the ZIP writer arrives in the next commit. */

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

export const MAX_ZIP_BYTES = 1024 * 1024 * 1024;

export function checkZipTotal(_total: number): number {
  throw new Error('not implemented');
}

export function zipTiles(_entries: ZipEntry[]): Uint8Array {
  throw new Error('not implemented');
}

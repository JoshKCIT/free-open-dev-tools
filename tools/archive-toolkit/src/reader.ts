/**
 * A random-access byte source every reader in this package reads through,
 * instead of requiring the whole archive resident in memory as one
 * `Uint8Array` up front. The worker supplies one backed by the picked
 * `File` (`File.slice` plus `arrayBuffer()`, so a large archive is never
 * read into memory whole before this package even starts); tests and the
 * standalone gate supply `bytesReader` over an in-memory `Uint8Array`.
 */
export interface RandomAccessReader {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

/** Wraps an in-memory byte array as a `RandomAccessReader`, for tests and small inputs. */
export function bytesReader(bytes: Uint8Array): RandomAccessReader {
  return {
    size: bytes.length,
    async read(offset: number, length: number): Promise<Uint8Array> {
      const end = Math.min(bytes.length, offset + length);
      if (offset >= end) return new Uint8Array(0);
      return bytes.subarray(offset, end);
    },
  };
}

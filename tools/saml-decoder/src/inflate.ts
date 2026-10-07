import { Gunzip, Inflate, Unzlib } from 'fflate';
import { SamlDecoderError } from './errors';
import { FEED_CHUNK_BYTES, TOO_LARGE_MESSAGE } from './limits';

export type Container = 'raw' | 'zlib' | 'gzip';

export interface InflateResult {
  bytes: Uint8Array;
  /** What wrapped the DEFLATE data: nothing (raw, as the HTTP-Redirect binding says), a zlib header, or a gzip header. */
  container: Container;
}

const INVALID_MESSAGE = 'The compressed data is not valid DEFLATE data, or it ends before it is complete.';

/** Looks at the first bytes only: gzip starts 1f 8b, a zlib header is a method 8 byte and a two byte value divisible by 31. */
export function detectContainer(bytes: Uint8Array): Container {
  if (bytes.length >= 2) {
    const b0 = bytes[0]!;
    const b1 = bytes[1]!;
    if (b0 === 0x1f && b1 === 0x8b) return 'gzip';
    if ((b0 & 0x0f) === 8 && b0 >> 4 <= 7 && ((b0 << 8) | b1) % 31 === 0) return 'zlib';
  }
  return 'raw';
}

/**
 * Feeds one decompressor `FEED_CHUNK_BYTES` at a time and stops the moment the output passes `maxBytes`, so a small
 * compressed message can never grow far past the limit in memory. A decompressor error becomes one fixed sentence.
 */
function run(
  make: (onData: (chunk: Uint8Array) => void) => { push(chunk: Uint8Array, final?: boolean): void },
  bytes: Uint8Array,
  maxBytes: number,
): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const stream = make((chunk) => {
    total += chunk.length;
    if (total > maxBytes) throw new SamlDecoderError(TOO_LARGE_MESSAGE, 'message');
    chunks.push(chunk);
  });
  try {
    for (let i = 0; i < bytes.length; i += FEED_CHUNK_BYTES) {
      const end = Math.min(bytes.length, i + FEED_CHUNK_BYTES);
      stream.push(bytes.subarray(i, end), end >= bytes.length);
    }
  } catch (err) {
    if (err instanceof SamlDecoderError) throw err;
    throw new SamlDecoderError(INVALID_MESSAGE, 'message');
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Decompresses a message. The HTTP-Redirect binding says raw DEFLATE (RFC 1951); a zlib or gzip wrapper is read when its
 * header is there, and the caller is told which it was. When a wrapper's header is there but the wrapped data is not valid,
 * the bytes are tried as raw DEFLATE before giving up.
 */
export function inflateCapped(bytes: Uint8Array, maxBytes: number): InflateResult {
  if (bytes.length === 0) throw new SamlDecoderError('There is no compressed data to read.', 'message');
  const container = detectContainer(bytes);
  if (container === 'gzip') {
    try {
      return { bytes: run((cb) => new Gunzip((chunk) => cb(chunk)), bytes, maxBytes), container };
    } catch (err) {
      if (err instanceof SamlDecoderError && err.message === TOO_LARGE_MESSAGE) throw err;
    }
  } else if (container === 'zlib') {
    try {
      return { bytes: run((cb) => new Unzlib((chunk) => cb(chunk)), bytes, maxBytes), container };
    } catch (err) {
      if (err instanceof SamlDecoderError && err.message === TOO_LARGE_MESSAGE) throw err;
    }
  }
  return { bytes: run((cb) => new Inflate((chunk) => cb(chunk)), bytes, maxBytes), container: 'raw' };
}

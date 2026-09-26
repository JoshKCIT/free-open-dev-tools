/**
 * Measures gzip, deflate and deflate-raw sizes with the platform's own
 * `CompressionStream` (WHATWG Compression Standard), never a bundled
 * compressor. Bytes are streamed through in 64 KB chunks so a cancel can
 * land between chunks and the tab never freezes; a format the running
 * engine does not implement (its constructor throws) is reported as
 * unsupported for that format, never silently as a zero-byte result.
 */
import meta from './meta.json';

export { meta };

export type CompressionFormat = 'gzip' | 'deflate' | 'deflate-raw';

export const DEFAULT_FORMATS: readonly CompressionFormat[] = ['gzip', 'deflate', 'deflate-raw'];

/** Refuses input this large before compressing rather than risk freezing the tab. */
export const MAX_COMPRESSION_INPUT_BYTES = 256 * 1024 * 1024;

const CHUNK_SIZE = 64 * 1024;

export class CompressionTesterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompressionTesterError';
  }
}

export interface CompressionFormatResult {
  format: CompressionFormat;
  /** Compressed byte count. 0 when `unsupported` is true (never a real measurement of zero). */
  bytes: number;
  /** `bytes / inputBytes`, or 0 when the input is empty. */
  ratio: number;
  output: Uint8Array;
  /** True when this engine's CompressionStream constructor rejected this format. */
  unsupported: boolean;
}

export interface MeasureCompressionResult {
  inputBytes: number;
  results: CompressionFormatResult[];
}

export interface MeasureCompressionOptions {
  formats?: readonly CompressionFormat[];
  signal?: AbortSignal;
  onProgress?: (fraction: number, detail?: string) => void;
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/**
 * Streams `bytes` through `new CompressionStream(format)` in `CHUNK_SIZE`
 * chunks, writing and reading concurrently so the readable side's own
 * backpressure never stalls the writer. Throws an `AbortError` DOMException
 * when `signal` is aborted before the run finishes; returns
 * `{ unsupported: true }` when the format itself is not implemented (the
 * constructor throws), never when the input happens to compress to zero
 * bytes.
 */
async function compressOneFormat(
  bytes: Uint8Array,
  format: CompressionFormat,
  signal: AbortSignal | undefined,
  onProgress: ((fraction: number) => void) | undefined,
): Promise<CompressionFormatResult> {
  let stream: CompressionStream;
  try {
    stream = new CompressionStream(format);
  } catch {
    return { format, bytes: 0, ratio: 0, output: new Uint8Array(0), unsupported: true };
  }

  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let aborted = false;

  const writeLoop = (async () => {
    for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
      if (signal?.aborted) {
        aborted = true;
        break;
      }
      const end = Math.min(offset + CHUNK_SIZE, bytes.length);
      // Cast: `bytes` is always backed by a plain ArrayBuffer in this tool (TextEncoder or a File's
      // own bytes never produce a SharedArrayBuffer-backed view), but the DOM lib types `Uint8Array`
      // generically over `ArrayBufferLike`, which `BufferSource` does not accept without this cast.
      await writer.write(bytes.subarray(offset, end) as Uint8Array<ArrayBuffer>);
      onProgress?.(end / Math.max(1, bytes.length));
    }
    if (aborted || signal?.aborted) {
      aborted = true;
      await writer.abort(signal?.reason).catch(() => undefined);
    } else {
      await writer.close();
    }
  })();

  const readLoop = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  })();

  await Promise.allSettled([writeLoop, readLoop]);

  if (aborted || signal?.aborted) {
    await reader.cancel().catch(() => undefined);
    throw new DOMException('The compression run was cancelled.', 'AbortError');
  }

  const output = concatChunks(chunks, total);
  return {
    format,
    bytes: output.length,
    ratio: bytes.length === 0 ? 0 : output.length / bytes.length,
    output,
    unsupported: false,
  };
}

/**
 * Measures the compressed size of `bytes` under every format in
 * `options.formats` (default gzip, deflate, deflate-raw), one at a time.
 * Refuses input over `MAX_COMPRESSION_INPUT_BYTES`. Rejects with an
 * `AbortError` DOMException if `options.signal` is aborted before every
 * format finishes; nothing is reported for a cancelled run.
 */
export async function measureCompression(
  bytes: Uint8Array,
  options: MeasureCompressionOptions = {},
): Promise<MeasureCompressionResult> {
  if (bytes.length > MAX_COMPRESSION_INPUT_BYTES) {
    throw new CompressionTesterError(
      'This input is larger than 256 MB, so it was refused rather than risk freezing the tab.',
    );
  }

  const formats = options.formats ?? DEFAULT_FORMATS;
  const results: CompressionFormatResult[] = [];

  for (let i = 0; i < formats.length; i++) {
    if (options.signal?.aborted) throw new DOMException('The compression run was cancelled.', 'AbortError');
    const format = formats[i]!;
    try {
      const result = await compressOneFormat(bytes, format, options.signal, (fraction) => {
        options.onProgress?.((i + fraction) / formats.length, format);
      });
      results.push(result);
    } catch (err) {
      if (isAbortError(err)) throw err;
      throw err;
    }
  }

  return { inputBytes: bytes.length, results };
}

/**
 * The smallest round { percent, bytes } margin this tool states its sizes
 * can differ from Node zlib's own default-level output on the browser
 * engines the four-browser spec measures, with at least 50% headroom over
 * the largest measured normal difference (never more than 5 percent or 64
 * bytes, per this project's own D-103 ceiling). Measured directly this
 * session: Firefox and WebKit both differ from Node zlib by about 2% on a
 * varied JSON-like sample (the largest difference any engine shows across
 * every sample except the two named exceptions below), so 3% gives that
 * over 50% headroom. WebKit alone differs far more on two phrase-repetitive
 * samples ("repeated prose" up to ~28%, "non-ASCII text" up to ~15%) --
 * named here rather than folded into this tolerance, since covering them
 * would exceed the 5%/64-byte ceiling; see `limits` in this package's
 * `meta.json` and the four-browser spec's own `KNOWN_ENGINE_DIFFERENCES`.
 */
export const SIZE_TOLERANCE: { percent: number; bytes: number } = { percent: 3, bytes: 32 };

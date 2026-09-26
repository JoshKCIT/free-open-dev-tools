import { it, expect, vi } from 'vitest';
import { gzipSync, deflateSync, deflateRawSync } from 'node:zlib';
import { measureCompression, meta, SIZE_TOLERANCE, CompressionTesterError, DEFAULT_FORMATS } from '../src/index';

const SAMPLE_TEXT = 'hello hello hello world '.repeat(2000);
const SAMPLE_BYTES = new TextEncoder().encode(SAMPLE_TEXT);

it('gzip, deflate and deflate-raw sizes equal what Node zlib produces at its default level for the same bytes', async () => {
  const result = await measureCompression(SAMPLE_BYTES);
  expect(result.inputBytes).toBe(SAMPLE_BYTES.length);

  const gzip = result.results.find((r) => r.format === 'gzip')!;
  const deflate = result.results.find((r) => r.format === 'deflate')!;
  const deflateRaw = result.results.find((r) => r.format === 'deflate-raw')!;

  expect(gzip.unsupported).toBe(false);
  expect(deflate.unsupported).toBe(false);
  expect(deflateRaw.unsupported).toBe(false);

  // Measured directly at planning time on Node 22.14 (D-103): 169, 157 and 151 bytes.
  expect(gzip.bytes).toBe(gzipSync(SAMPLE_BYTES).length);
  expect(deflate.bytes).toBe(deflateSync(SAMPLE_BYTES).length);
  expect(deflateRaw.bytes).toBe(deflateRawSync(SAMPLE_BYTES).length);
  expect(gzip.bytes).toBe(169);
  expect(deflate.bytes).toBe(157);
  expect(deflateRaw.bytes).toBe(151);
});

it('compressed output decompresses to exactly the original bytes', async () => {
  const result = await measureCompression(SAMPLE_BYTES);
  for (const item of result.results) {
    const ds = new DecompressionStream(item.format);
    const writer = ds.writable.getWriter();
    void writer.write(item.output as Uint8Array<ArrayBuffer>);
    void writer.close();
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    expect(out, item.format).toEqual(SAMPLE_BYTES);
  }
});

it('the gzip output carries the RFC 1952 header and trailer and the deflate output the RFC 1950 wrapper', async () => {
  const result = await measureCompression(SAMPLE_BYTES, { formats: ['gzip', 'deflate'] });
  const gzip = result.results.find((r) => r.format === 'gzip')!;
  // RFC 1952 section 2.3.1: the three-byte header ID1=0x1f, ID2=0x8b, CM=0x08 (deflate).
  expect(Array.from(gzip.output.slice(0, 3))).toEqual([0x1f, 0x8b, 0x08]);
  // RFC 1952 section 2.3.1: the ISIZE trailer, the input size modulo 2^32, little-endian.
  const trailer = gzip.output.slice(gzip.output.length - 4);
  const view = new DataView(trailer.buffer, trailer.byteOffset, 4);
  expect(view.getUint32(0, true)).toBe(SAMPLE_BYTES.length >>> 0);

  const deflate = result.results.find((r) => r.format === 'deflate')!;
  // RFC 1950 section 2.2: CMF's low nibble (CM) is 8 for the "deflate" compression method.
  expect(deflate.output[0]! & 0x0f).toBe(8);
});

it('text is measured as its UTF-8 bytes', async () => {
  const input = new TextEncoder().encode('é');
  expect(input.length).toBe(2);
  const result = await measureCompression(input, { formats: ['gzip'] });
  expect(result.inputBytes).toBe(2);
});

it('an empty input gives the fixed container sizes rather than an error', async () => {
  const result = await measureCompression(new Uint8Array(0));
  expect(result.inputBytes).toBe(0);
  const byFormat = Object.fromEntries(result.results.map((r) => [r.format, r]));
  // Node zlib's own fixed container sizes for zero input bytes, measured directly this session.
  expect(byFormat.gzip!.bytes).toBe(gzipSync(Buffer.alloc(0)).length);
  expect(byFormat.deflate!.bytes).toBe(deflateSync(Buffer.alloc(0)).length);
  expect(byFormat['deflate-raw']!.bytes).toBe(deflateRawSync(Buffer.alloc(0)).length);
  expect(byFormat.gzip!.bytes).toBe(20);
  expect(byFormat.deflate!.bytes).toBe(8);
  expect(byFormat['deflate-raw']!.bytes).toBe(2);
  for (const r of result.results) expect(r.unsupported).toBe(false);
});

it('a cancelled run stops between chunks and reports nothing', async () => {
  const controller = new AbortController();
  const big = new Uint8Array(4 * 1024 * 1024);
  const promise = measureCompression(big, {
    signal: controller.signal,
    onProgress: (fraction) => {
      if (fraction > 0.1) controller.abort();
    },
  });
  await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
});

it('a format this engine does not support is reported as unsupported, never as zero bytes', async () => {
  const OriginalCompressionStream = globalThis.CompressionStream;
  class ThrowingCompressionStream {
    constructor(format: string) {
      if (format === 'deflate-raw') throw new TypeError('Unsupported compression format');
      return new OriginalCompressionStream(format as CompressionFormat) as unknown as ThrowingCompressionStream;
    }
  }
  // @ts-expect-error -- test-only substitution of the platform constructor
  globalThis.CompressionStream = ThrowingCompressionStream;
  try {
    const result = await measureCompression(SAMPLE_BYTES);
    const deflateRaw = result.results.find((r) => r.format === 'deflate-raw')!;
    expect(deflateRaw.unsupported).toBe(true);
    expect(deflateRaw.bytes).toBe(0);
    const gzip = result.results.find((r) => r.format === 'gzip')!;
    expect(gzip.unsupported).toBe(false);
  } finally {
    globalThis.CompressionStream = OriginalCompressionStream;
  }
});

it('input over the size limit is refused before compressing', async () => {
  const oversized = new Uint8Array(1);
  Object.defineProperty(oversized, 'length', { value: 300 * 1024 * 1024 });
  await expect(measureCompression(oversized)).rejects.toBeInstanceOf(CompressionTesterError);
});

it('nothing is written to the console while compressing', async () => {
  const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    await measureCompression(SAMPLE_BYTES);
    await measureCompression(new Uint8Array(0));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

it('meta names this tool and SIZE_TOLERANCE stays within the D-103 ceiling', () => {
  expect(meta.id).toBe('compression-tester');
  expect(SIZE_TOLERANCE.percent).toBeLessThanOrEqual(5);
  expect(SIZE_TOLERANCE.bytes).toBeLessThanOrEqual(64);
  expect(DEFAULT_FORMATS).toEqual(['gzip', 'deflate', 'deflate-raw']);
});

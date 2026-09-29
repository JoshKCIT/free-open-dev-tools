/**
 * Streaming inflate over fflate 0.8.3's `Inflate`, fed in chunks of at most
 * 1 KiB, with a hard cap on total output and member-end detection for gzip.
 *
 * fflate's `Inflate` exposes two fields beyond its public API that this
 * module reads to know exactly where a deflate stream ends inside a larger
 * byte buffer: `s.f` (the BFINAL bit of the block currently being parsed,
 * set as soon as that block's header is read -- NOT once the block is
 * fully consumed) and `s.l` (the in-progress Huffman length-code map for
 * the block currently being decoded; truthy while a block's data is only
 * partially consumed, falsy once that block's own end-of-block symbol has
 * been read). A deflate stream is only complete when `s.f` is truthy AND
 * `s.l` is falsy -- `s.f` alone is already 1 for the whole span of a final
 * block that arrives across several pushes, so checking it alone (as
 * tools/archive-toolkit does) reports a still-in-progress final block as
 * finished. This was confirmed directly against the installed fflate 0.8.3
 * while building this tool: a valid, real-world gzip file whose final
 * block spans more than one push decodes wrong under the `s.f`-alone
 * check, and right under `s.f && !s.l`. `p` holds every byte fed so far
 * that the decoder has not yet consumed; `s.p` is the leftover bit offset
 * (0-7) into `p`'s first byte. This module is pinned to fflate 0.8.3
 * exactly because these fields are undocumented implementation detail.
 */
import { Inflate } from 'fflate';
import { GzipDeflateError } from './errors';
import { crc32, adler32 } from './checksums';
import { detectContainer, parseGzipHeader, parseZlibHeader, type Container, type ZlibLevelHint } from './container';
import { decodeInput } from './input';

export const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
export const FEED_CHUNK_BYTES = 1024;

interface InflateInternals {
  s: { f?: number; l?: unknown; p?: number };
  p: Uint8Array;
}

export interface GzipMemberInfo {
  mtime: number;
  os: number;
  osName: string;
  xfl: number;
  textFlag: boolean;
  name?: string;
  comment?: string;
  extra?: Uint8Array;
  headerCrc: boolean;
  compressedBytes: number;
  size: number;
  crc32: number;
}

export interface ZlibHeaderInfo {
  windowBits: number;
  levelHint: ZlibLevelHint;
}

export interface DecompressBytesOptions {
  container?: 'auto' | 'gzip' | 'zlib' | 'raw';
  maxOutputBytes?: number;
}

export interface DecompressBytesResult {
  bytes: Uint8Array;
  container: Container;
  detected: boolean;
  members: GzipMemberInfo[];
  zlibHeader?: ZlibHeaderInfo;
  checks: string[];
  compressedBytes: number;
  trailingBytes: number;
  warnings: string[];
}

export interface DecompressOptions {
  inputEncoding: 'base64' | 'hex' | 'url-base64';
  container?: 'auto' | 'gzip' | 'zlib' | 'raw';
  maxOutputBytes?: number;
}

export interface DecompressResult extends DecompressBytesResult {
  text: string | null;
}

function mapFflateError(e: unknown): GzipDeflateError {
  const code = (e as { code?: number } | undefined)?.code;
  if (code === 0) return new GzipDeflateError('truncated', 'the compressed data ended early');
  if (code === 1 || code === 2 || code === 3) {
    return new GzipDeflateError(
      'corrupt',
      `the compressed data is damaged (${e instanceof Error ? e.message : 'invalid deflate stream'})`,
    );
  }
  return new GzipDeflateError('corrupt', e instanceof Error ? e.message : 'the compressed data is damaged');
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Inflates one raw deflate stream starting at `startOffset` inside
 * `source`, feeding at most FEED_CHUNK_BYTES at a time and stopping with an
 * `output-cap` error if the decompressed total would exceed `cap`.
 */
function inflateStream(
  source: Uint8Array,
  startOffset: number,
  cap: number,
): { output: Uint8Array; bytesConsumed: number } {
  const outputs: Uint8Array[] = [];
  let produced = 0;
  let capped: number | null = null;

  const inflator = new Inflate((chunk) => {
    if (capped !== null) return;
    const proposed = produced + chunk.length;
    if (proposed > cap) {
      capped = proposed;
      return;
    }
    if (chunk.length > 0) {
      outputs.push(chunk.slice());
      produced = proposed;
    }
  });

  let pos = startOffset;
  let finished = false;
  while (!finished) {
    const atEnd = pos >= source.length;
    const piece = atEnd
      ? new Uint8Array(0)
      : source.subarray(pos, Math.min(pos + FEED_CHUNK_BYTES, source.length)).slice();
    if (!atEnd) pos += piece.length;
    try {
      inflator.push(piece, atEnd);
    } catch (e) {
      throw mapFflateError(e);
    }
    if (capped !== null) {
      throw new GzipDeflateError(
        'output-cap',
        'decompression stopped after producing more than the 64 MiB output cap',
        {
          producedBytes: capped,
        },
      );
    }
    const internals = inflator as unknown as InflateInternals;
    if (internals.s.f && !internals.s.l) {
      finished = true;
      break;
    }
    if (atEnd) {
      throw new GzipDeflateError('truncated', 'the compressed data ended early');
    }
  }

  const internals = inflator as unknown as InflateInternals;
  const subByteConsumed = internals.s.p ?? 0;
  const skip = subByteConsumed === 0 ? 0 : 1;
  const leftoverLength = Math.max(0, internals.p.length - skip);
  const bytesConsumed = pos - startOffset - leftoverLength;
  return { output: concatChunks(outputs), bytesConsumed };
}

function decompressRaw(bytes: Uint8Array, maxOutputBytes: number, detected: boolean): DecompressBytesResult {
  const { output, bytesConsumed } = inflateStream(bytes, 0, maxOutputBytes);
  const trailing = Math.max(0, bytes.length - bytesConsumed);
  const warnings: string[] = [];
  if (trailing > 0) {
    warnings.push(`${trailing} byte${trailing === 1 ? '' : 's'} after the raw deflate stream were ignored`);
  }
  return {
    bytes: output,
    container: 'raw',
    detected,
    members: [],
    checks: ['raw deflate carries no checksum of its own; damage can decode to the wrong bytes undetected'],
    compressedBytes: bytesConsumed,
    trailingBytes: trailing,
    warnings,
  };
}

function decompressZlib(bytes: Uint8Array, maxOutputBytes: number, detected: boolean): DecompressBytesResult {
  const header = parseZlibHeader(bytes);
  const { output, bytesConsumed } = inflateStream(bytes, header.headerLength, maxOutputBytes);
  const trailerStart = header.headerLength + bytesConsumed;
  if (bytes.length - trailerStart < 4) {
    throw new GzipDeflateError('truncated', "the zlib stream's 4-byte Adler-32 trailer is truncated");
  }
  const expectedAdler =
    ((bytes[trailerStart]! << 24) |
      (bytes[trailerStart + 1]! << 16) |
      (bytes[trailerStart + 2]! << 8) |
      bytes[trailerStart + 3]!) >>>
    0;
  const actualAdler = adler32(output);
  if (expectedAdler !== actualAdler) {
    throw new GzipDeflateError(
      'checksum',
      `the zlib Adler-32 does not match: expected ${expectedAdler.toString(16).toUpperCase().padStart(8, '0')}, computed ${actualAdler.toString(16).toUpperCase().padStart(8, '0')}`,
    );
  }
  const trailing = Math.max(0, bytes.length - (trailerStart + 4));
  const warnings: string[] = [];
  if (trailing > 0) {
    warnings.push(`${trailing} byte${trailing === 1 ? '' : 's'} after the zlib stream were ignored`);
  }
  return {
    bytes: output,
    container: 'zlib',
    detected,
    members: [],
    zlibHeader: { windowBits: header.windowBits, levelHint: header.levelHint },
    checks: ['Adler-32 verified'],
    compressedBytes: bytesConsumed,
    trailingBytes: trailing,
    warnings,
  };
}

function decompressGzip(bytes: Uint8Array, maxOutputBytes: number, detected: boolean): DecompressBytesResult {
  const members: GzipMemberInfo[] = [];
  const checks: string[] = [];
  const warnings: string[] = [];
  const outputs: Uint8Array[] = [];
  let offset = 0;
  let totalProduced = 0;

  for (;;) {
    const header = parseGzipHeader(bytes.subarray(offset));
    const bodyStart = offset + header.headerLength;
    const remainingCap = maxOutputBytes - totalProduced;
    if (remainingCap <= 0) {
      throw new GzipDeflateError(
        'output-cap',
        'decompression stopped after producing more than the 64 MiB output cap',
        {
          producedBytes: totalProduced,
        },
      );
    }
    let result: { output: Uint8Array; bytesConsumed: number };
    try {
      result = inflateStream(bytes, bodyStart, remainingCap);
    } catch (e) {
      if (e instanceof GzipDeflateError && e.kind === 'output-cap') {
        throw new GzipDeflateError('output-cap', e.message, { producedBytes: totalProduced + (e.producedBytes ?? 0) });
      }
      throw e;
    }
    totalProduced += result.output.length;
    outputs.push(result.output);

    const trailerStart = bodyStart + result.bytesConsumed;
    if (bytes.length - trailerStart < 8) {
      throw new GzipDeflateError('truncated', "this gzip member's CRC-32/ISIZE trailer is truncated");
    }
    const expectedCrc =
      (bytes[trailerStart]! |
        (bytes[trailerStart + 1]! << 8) |
        (bytes[trailerStart + 2]! << 16) |
        (bytes[trailerStart + 3]! << 24)) >>>
      0;
    const expectedIsize =
      (bytes[trailerStart + 4]! |
        (bytes[trailerStart + 5]! << 8) |
        (bytes[trailerStart + 6]! << 16) |
        (bytes[trailerStart + 7]! << 24)) >>>
      0;
    const actualCrc = crc32(result.output);
    const actualIsize = result.output.length >>> 0;
    const memberNumber = members.length + 1;
    if (actualCrc !== expectedCrc) {
      throw new GzipDeflateError(
        'checksum',
        `member ${memberNumber}'s CRC-32 does not match: expected ${expectedCrc.toString(16).toUpperCase().padStart(8, '0')}, computed ${actualCrc.toString(16).toUpperCase().padStart(8, '0')}`,
      );
    }
    if (actualIsize !== expectedIsize) {
      throw new GzipDeflateError(
        'checksum',
        `member ${memberNumber}'s decompressed size does not match its ISIZE trailer: expected ${expectedIsize}, got ${actualIsize}`,
      );
    }
    checks.push(`member ${memberNumber}: CRC-32 and ISIZE verified`);
    members.push({
      mtime: header.mtime,
      os: header.os,
      osName: header.osName,
      xfl: header.xfl,
      textFlag: header.textFlag,
      name: header.name,
      comment: header.comment,
      extra: header.extra,
      headerCrc: header.headerCrc,
      compressedBytes: result.bytesConsumed,
      size: result.output.length,
      crc32: actualCrc,
    });

    offset = trailerStart + 8;
    if (offset + 2 <= bytes.length && bytes[offset] === 0x1f && bytes[offset + 1] === 0x8b) {
      continue;
    }
    break;
  }

  const trailing = Math.max(0, bytes.length - offset);
  if (trailing > 0) {
    warnings.push(
      `${trailing} byte${trailing === 1 ? '' : 's'} after the last gzip member were ignored (trailing garbage)`,
    );
  }

  return {
    bytes: concatChunks(outputs),
    container: 'gzip',
    detected,
    members,
    checks,
    compressedBytes: offset,
    trailingBytes: trailing,
    warnings,
  };
}

export function decompressBytes(bytes: Uint8Array, options: DecompressBytesOptions = {}): DecompressBytesResult {
  const maxOutputBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES;
  const forced = options.container && options.container !== 'auto' ? options.container : undefined;
  const detected = forced === undefined;
  const container: Container = forced ?? detectContainer(bytes);

  if (container === 'gzip') return decompressGzip(bytes, maxOutputBytes, detected);
  if (container === 'zlib') return decompressZlib(bytes, maxOutputBytes, detected);
  return decompressRaw(bytes, maxOutputBytes, detected);
}

export function decompress(text: string, options: DecompressOptions): DecompressResult {
  const bytes = decodeInput(text, options.inputEncoding);
  const result = decompressBytes(bytes, { container: options.container, maxOutputBytes: options.maxOutputBytes });
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let text2: string | null;
  try {
    text2 = decoder.decode(result.bytes);
  } catch {
    text2 = null;
  }
  return { ...result, text: text2 };
}

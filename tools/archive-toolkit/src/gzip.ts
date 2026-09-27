/**
 * Reads a gzip file as a sequence of RFC 1952 members
 * (rfc-editor.org/rfc/rfc1952.txt, fetched 2026-09-27): section 2.3 "Member
 * format" (the fixed 10-byte header: ID1 0x1f, ID2 0x8b, CM (8 = deflate),
 * FLG, MTIME, XFL, OS; the optional FEXTRA/FNAME/FCOMMENT/FHCRC fields
 * section 2.3.1 names, read here only to skip past them correctly, since
 * this reader has no use for their content beyond FNAME) and section
 * 2.3.1's own trailer: "CRC32 (CRC-32): Contains a CRC-32 ... of the
 * uncompressed data" and "ISIZE (Input SIZE): This contains the size of
 * the original (uncompressed) input data modulo 2^32", each checked
 * against what this reader actually produced. Section 2.3 states plainly
 * that "gzip files ... in sequence ... can simply be concatenated": this
 * reader loops until the underlying byte source is exhausted, decoding one
 * member after another, per RFC 1952 gzip.
 *
 * Finding exactly where one member's own compressed data ends -- so its
 * trailer, and a following member's own header, can be located -- reads
 * two fields of the installed `fflate` 0.8.3 `Inflate` instance beyond its
 * public API: `s.f` (truthy once the decoder's own state has consumed a
 * real DEFLATE "final block" bit, independent of any `final` flag this
 * reader passes to `push`) and `p` (every byte fed so far that decoding has
 * not yet consumed). `s.p`, this same instance's own leftover bit offset
 * (0 to 7) into `p`'s first byte, says whether that first byte was spent
 * finishing the compressed stream's own last, sub-byte-aligned bits (spent
 * whenever `s.p` is not zero, in which case that byte is not read as part
 * of the trailer) or is untouched (`s.p` zero, meaning the trailer begins
 * at `p`'s very first byte). This reader is pinned to fflate 0.8.3 exactly
 * (BX) precisely because these two fields are undocumented implementation
 * detail, confirmed directly against the installed package this session,
 * not a documented contract -- a future fflate version could rename or
 * remove them, and this reader would need to be re-verified against it
 * before the pin is ever moved.
 */
import { Inflate } from 'fflate';
import type { RandomAccessReader } from './reader';
import { safeEntryPath } from './safe-path';
import { ARCHIVE_LIMITS, OutputBudget, type ArchiveLimits } from './limits';
import { crc32 } from './crc32';

export interface GzipReadHooks {
  signal?: AbortSignal;
  onProgress?: (fraction: number, detail: string) => void;
}

export interface GzipReadResult {
  /** The concatenated decompressed content of every member. */
  bytes: Uint8Array;
  /** The first member's own FNAME field, when present (RFC 1952 section 2.3.1), through `safeEntryPath`. */
  name?: string;
  warnings: string[];
}

interface InflateInternals {
  s: { f?: number; p?: number };
  p: Uint8Array;
}

function readCString(bytes: Uint8Array, offset: number): { text: string; nextOffset: number } {
  let end = offset;
  while (end < bytes.length && bytes[end] !== 0) end++;
  const text = new TextDecoder('iso-8859-1').decode(bytes.subarray(offset, end));
  return { text, nextOffset: end + 1 };
}

interface MemberHeaderResult {
  headerLength: number;
  fname?: string;
}

/** Parses one member's own fixed header plus any FEXTRA/FNAME/FCOMMENT/FHCRC fields, returning only how many bytes they occupy and the file name, if any. */
function parseMemberHeader(bytes: Uint8Array): MemberHeaderResult {
  if (bytes.length < 10 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    throw new Error('this is not a gzip member: its header signature is missing');
  }
  if (bytes[2] !== 8) {
    throw new Error('this gzip member uses a compression method other than deflate, which is not supported');
  }
  const flg = bytes[3]!;
  let offset = 10;
  if (flg & 0x04) {
    if (offset + 2 > bytes.length) throw new Error('this gzip member’s header is truncated');
    const xlen = bytes[offset]! | (bytes[offset + 1]! << 8);
    offset += 2 + xlen;
  }
  let fname: string | undefined;
  if (flg & 0x08) {
    const result = readCString(bytes, offset);
    fname = result.text;
    offset = result.nextOffset;
  }
  if (flg & 0x10) {
    const result = readCString(bytes, offset);
    offset = result.nextOffset;
  }
  if (flg & 0x02) {
    offset += 2;
  }
  if (offset > bytes.length) throw new Error('this gzip member’s header is truncated');
  return { headerLength: offset, fname };
}

/**
 * Reads every RFC 1952 member in `reader`, decoding each one's own DEFLATE
 * body with `fflate`'s streaming decompressor fed in `feedChunkBytes`
 * pieces, charging every produced chunk to `budget`, and checking each
 * member's own CRC-32 and ISIZE trailer once its compressed data is fully
 * consumed. Every member's decompressed content is concatenated in the
 * result, matching what a plain `gunzip` of the whole file would produce.
 */
export async function readGzip(
  reader: RandomAccessReader,
  limits: ArchiveLimits = ARCHIVE_LIMITS,
  hooks: GzipReadHooks = {},
  budget: OutputBudget = new OutputBudget(limits),
): Promise<GzipReadResult> {
  const warnings: string[] = [];
  const memberOutputs: Uint8Array<ArrayBufferLike>[][] = [];
  let firstName: string | undefined;

  // A read-ahead window: gzip has no directory telling this reader how
  // large a member's own header or trailer is ahead of time, so a small
  // amount of look-behind bookkeeping (via the leftover bytes fflate's own
  // decoder did not consume) does the same job a central directory does
  // for ZIP -- just discovered as decoding proceeds, one member at a time.
  let filePos = 0;
  let carry: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

  async function fillCarry(minLength: number): Promise<void> {
    while (carry.length < minLength && filePos < reader.size) {
      const take = Math.min(ARCHIVE_LIMITS.feedChunkBytes, reader.size - filePos);
      const chunk = await reader.read(filePos, take);
      filePos += chunk.length;
      const merged = new Uint8Array(carry.length + chunk.length);
      merged.set(carry, 0);
      merged.set(chunk, carry.length);
      carry = merged;
      if (chunk.length === 0) break;
    }
  }

  while (true) {
    await fillCarry(10);
    if (carry.length === 0) break;

    await fillCarry(Math.min(carry.length + 1, 64 * 1024));
    const header = parseMemberHeader(carry);
    if (memberOutputs.length === 0 && header.fname !== undefined) {
      firstName = header.fname;
    }
    carry = carry.subarray(header.headerLength);

    budget.startEntry();
    const outputs: Uint8Array<ArrayBufferLike>[] = [];
    const collectingInflator = new Inflate((data) => {
      if (data.length > 0) {
        budget.charge(data.length, 0);
        outputs.push(data.slice());
      }
    });

    let finished = false;
    while (!finished) {
      if (hooks.signal?.aborted) throw new DOMException('The run was cancelled.', 'AbortError');
      if (carry.length === 0) {
        await fillCarry(ARCHIVE_LIMITS.feedChunkBytes);
        if (carry.length === 0) {
          // Ran out of input without ever seeing a final DEFLATE block.
          collectingInflator.push(new Uint8Array(0), true);
          throw new Error('this gzip member is truncated');
        }
      }
      const take = Math.min(ARCHIVE_LIMITS.feedChunkBytes, carry.length);
      const piece = carry.subarray(0, take);
      carry = carry.subarray(take);
      collectingInflator.push(piece.slice(), false);
      budget.charge(0, piece.length);
      const internals = collectingInflator as unknown as InflateInternals;
      if (internals.s.f) {
        const subByteBitsConsumed = internals.s.p ?? 0;
        const skip = subByteBitsConsumed === 0 ? 0 : 1;
        const rewound = internals.p.subarray(skip);
        carry = concatBytes(rewound, carry);
        finished = true;
      }
    }

    const bodyBytes = concatOutputs(outputs);

    await fillCarry(8);
    if (carry.length < 8) throw new Error('this gzip member’s trailer is truncated');
    const trailerView = new DataView(carry.buffer, carry.byteOffset, 8);
    const expectedCrc = trailerView.getUint32(0, true);
    const expectedIsize = trailerView.getUint32(4, true);
    carry = carry.subarray(8);

    const actualCrc = crc32(bodyBytes);
    const actualIsize = bodyBytes.length >>> 0;
    if (actualCrc !== expectedCrc || actualIsize !== expectedIsize) {
      throw new Error('this gzip member is damaged: its checksum or length does not match');
    }

    memberOutputs.push([bodyBytes]);
  }

  const allBytes = concatOutputs(memberOutputs.map((m) => concatOutputs(m)));

  let name: string | undefined;
  if (firstName !== undefined) {
    const safe = safeEntryPath(firstName);
    if ('refused' in safe) {
      warnings.push(`the gzip member's own stored name was refused: ${safe.refused}`);
    } else {
      name = safe.path;
      for (const warning of safe.warnings) warnings.push(`${safe.path}: ${warning}`);
    }
  }

  return { bytes: allBytes, name, warnings };
}

function concatBytes(a: Uint8Array<ArrayBufferLike>, b: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function concatOutputs(chunks: Uint8Array<ArrayBufferLike>[]): Uint8Array<ArrayBuffer> {
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

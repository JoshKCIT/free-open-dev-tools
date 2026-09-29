/**
 * Container detection and header parsing for gzip (RFC 1952) and zlib (RFC
 * 1950). Header fields are read here only; the compressed body is decoded
 * by inflate.ts, which also verifies each trailer these headers describe.
 */
import { GzipDeflateError } from './errors';
import { crc32 } from './checksums';

export type Container = 'gzip' | 'zlib' | 'raw';

/**
 * Auto-detects the container: gzip when the bytes start `1F 8B 08`; zlib
 * when the two-byte header's compression method is 8, CINFO is at most 7,
 * the header is a multiple of 31, and FDICT is unset; otherwise raw
 * deflate. A raw stream can, by chance, look like a zlib header -- forcing
 * "raw" is the way out of a wrong auto-detection.
 */
export function detectContainer(bytes: Uint8Array): Container {
  if (bytes.length >= 3 && bytes[0] === 0x1f && bytes[1] === 0x8b && bytes[2] === 0x08) return 'gzip';
  if (bytes.length >= 2) {
    const cmf = bytes[0]!;
    const flg = bytes[1]!;
    if ((cmf & 0x0f) === 8 && cmf >> 4 <= 7 && (cmf * 256 + flg) % 31 === 0 && (flg & 0x20) === 0) {
      return 'zlib';
    }
  }
  return 'raw';
}

// RFC 1952 section 2.3.1's OS byte table.
const OS_NAMES: Record<number, string> = {
  0: 'FAT filesystem (MS-DOS, OS/2, NT/Win32)',
  1: 'Amiga',
  2: 'VMS (or OpenVMS)',
  3: 'Unix',
  4: 'VM/CMS',
  5: 'Atari TOS',
  6: 'HPFS filesystem (OS/2, NT)',
  7: 'Macintosh',
  8: 'Z-System',
  9: 'CP/M',
  10: 'TOPS-20',
  11: 'NTFS filesystem (NT)',
  12: 'QDOS',
  13: 'Acorn RISCOS',
  255: 'unknown',
};

function readCString(bytes: Uint8Array, offset: number): { text: string; nextOffset: number } {
  let end = offset;
  while (end < bytes.length && bytes[end] !== 0) end++;
  if (end >= bytes.length) {
    throw new GzipDeflateError('truncated', 'the gzip header ended before a zero-terminated field finished');
  }
  // ISO 8859-1, byte for byte (String.fromCharCode), matching RFC 1952's own statement that FNAME/FCOMMENT are Latin-1.
  let text = '';
  for (let i = offset; i < end; i++) text += String.fromCharCode(bytes[i]!);
  return { text, nextOffset: end + 1 };
}

export interface GzipHeaderResult {
  headerLength: number;
  mtime: number;
  os: number;
  osName: string;
  xfl: number;
  textFlag: boolean;
  name?: string;
  comment?: string;
  extra?: Uint8Array;
  headerCrc: boolean;
}

export function parseGzipHeader(bytes: Uint8Array): GzipHeaderResult {
  if (bytes.length < 10) {
    throw new GzipDeflateError('truncated', 'the gzip header is shorter than the required 10 bytes');
  }
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    throw new GzipDeflateError('container', 'this is not gzip data: the two-byte signature 1F 8B is missing');
  }
  if (bytes[2] !== 8) {
    throw new GzipDeflateError(
      'container',
      `this gzip member uses compression method ${bytes[2]}, not deflate (method 8), which this tool cannot decompress`,
    );
  }
  const flg = bytes[3]!;
  if (flg & 0xe0) {
    throw new GzipDeflateError(
      'container',
      'reserved bits are set in the gzip FLG byte, which RFC 1952 section 2.3.1.2 forbids',
    );
  }
  const mtime = (bytes[4]! | (bytes[5]! << 8) | (bytes[6]! << 16) | (bytes[7]! << 24)) >>> 0;
  const xfl = bytes[8]!;
  const os = bytes[9]!;
  const osName = OS_NAMES[os] ?? 'unknown';
  const textFlag = (flg & 0x01) !== 0;

  let offset = 10;
  let extra: Uint8Array | undefined;
  if (flg & 0x04) {
    if (offset + 2 > bytes.length) {
      throw new GzipDeflateError('truncated', 'the gzip header is cut off inside its FEXTRA field');
    }
    const xlen = bytes[offset]! | (bytes[offset + 1]! << 8);
    offset += 2;
    if (offset + xlen > bytes.length) {
      throw new GzipDeflateError('truncated', 'the gzip header is cut off inside its FEXTRA field');
    }
    extra = bytes.slice(offset, offset + xlen);
    offset += xlen;
  }

  let name: string | undefined;
  if (flg & 0x08) {
    const r = readCString(bytes, offset);
    name = r.text;
    offset = r.nextOffset;
  }

  let comment: string | undefined;
  if (flg & 0x10) {
    const r = readCString(bytes, offset);
    comment = r.text;
    offset = r.nextOffset;
  }

  const headerCrc = (flg & 0x02) !== 0;
  if (headerCrc) {
    if (offset + 2 > bytes.length) {
      throw new GzipDeflateError('truncated', 'the gzip header is cut off inside its FHCRC field');
    }
    const stored = bytes[offset]! | (bytes[offset + 1]! << 8);
    const actual = crc32(bytes.slice(0, offset)) & 0xffff;
    if (stored !== actual) {
      throw new GzipDeflateError(
        'checksum',
        `the gzip header's FHCRC does not match: expected ${actual.toString(16).toUpperCase()}, found ${stored.toString(16).toUpperCase()}`,
      );
    }
    offset += 2;
  }

  return { headerLength: offset, mtime, os, osName, xfl, textFlag, name, comment, extra, headerCrc };
}

export type ZlibLevelHint = 'fastest' | 'fast' | 'default' | 'maximum';

export interface ZlibHeaderResult {
  headerLength: number;
  windowBits: number;
  levelHint: ZlibLevelHint;
}

export function parseZlibHeader(bytes: Uint8Array): ZlibHeaderResult {
  if (bytes.length < 2) {
    throw new GzipDeflateError('truncated', 'the zlib header is shorter than the required 2 bytes');
  }
  const cmf = bytes[0]!;
  const flg = bytes[1]!;
  if ((cmf & 0x0f) !== 8) {
    throw new GzipDeflateError(
      'container',
      `this zlib stream uses compression method ${cmf & 0x0f}, not deflate (method 8), which this tool cannot decompress`,
    );
  }
  const cinfo = cmf >> 4;
  if (cinfo > 7) {
    throw new GzipDeflateError(
      'container',
      `this zlib stream's CINFO is ${cinfo}, which implies a window larger than this tool supports`,
    );
  }
  if ((cmf * 256 + flg) % 31 !== 0) {
    throw new GzipDeflateError(
      'container',
      'this zlib header fails its own FCHECK consistency check ((CMF*256+FLG) mod 31 must be 0)',
    );
  }
  if (flg & 0x20) {
    throw new GzipDeflateError(
      'container',
      'this zlib stream needs a preset dictionary, which this tool cannot supply',
    );
  }
  const flevel = (flg >> 6) & 0x03;
  const levelHint: ZlibLevelHint =
    flevel === 0 ? 'fastest' : flevel === 1 ? 'fast' : flevel === 2 ? 'default' : 'maximum';
  return { headerLength: 2, windowBits: cinfo + 8, levelHint };
}

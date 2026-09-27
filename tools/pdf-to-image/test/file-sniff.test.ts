import { it, expect } from 'vitest';
import { getDocument } from '../src/index';
import { sniffFile, assertFileKind, FileSignatureError } from '../src/file-sniff';
import { buildMinimalPdf } from './minimal-pdf';
import { createTestBinaryDataFactory, createTestCanvasFactory } from './pdfjs-node';

/**
 * ISO 32000-1:2008 section 7.5.2 "File Header" (quoted in src/file-sniff.ts's
 * own header): the first line of a PDF file is `%PDF-1.N`. PDF.js's own
 * leniency (src/core/document.js, `find(stream, PDF_HEADER_SIGNATURE)`,
 * mozilla/pdf.js tag v6.3.289, default search limit 1024 bytes) is what this
 * tool's own 1024-byte search window matches.
 *
 * Top-level `it(...)` calls, never nested in `describe(...)`: Vitest's JSON
 * reporter concatenates the describe name into `fullName`, and this
 * project's own verify scripts match required titles by exact equality.
 */
it('a PDF header within the first 1024 bytes is recognised as ISO 32000 and PDF.js accept it', async () => {
  const junk = new Uint8Array(300).fill(0x20); // 300 bytes of junk before the header, still inside the window
  const pdf = buildMinimalPdf({ pages: [{ text: 'Hello' }] });
  const withJunk = new Uint8Array(junk.length + pdf.length);
  withJunk.set(junk, 0);
  withJunk.set(pdf, junk.length);

  expect(sniffFile(pdf)?.kind).toBe('pdf');
  expect(sniffFile(withJunk)?.kind).toBe('pdf');

  // PDF.js itself must also accept both: header at byte 0, and header
  // starting after 300 bytes of junk (still well within its own 1024-byte
  // search window).
  for (const bytes of [pdf, withJunk]) {
    // PDF.js's own `data` option detaches the buffer it is given once
    // loading starts; `.slice()` keeps `pdf` itself usable afterwards.
    const task = getDocument({
      data: bytes.slice(),
      useWorkerFetch: false,
      BinaryDataFactory: createTestBinaryDataFactory(),
      CanvasFactory: createTestCanvasFactory(),
      verbosity: 0,
    });
    const doc = await task.promise;
    expect(doc.numPages).toBe(1);
    await task.destroy();
  }

  // Beyond the 1024-byte search window, neither this tool nor PDF.js finds it.
  const tooFarJunk = new Uint8Array(1200).fill(0x20);
  const tooFar = new Uint8Array(tooFarJunk.length + pdf.length);
  tooFar.set(tooFarJunk, 0);
  tooFar.set(pdf, tooFarJunk.length);
  expect(sniffFile(tooFar)).toBeNull();
});

it('a file that is not a PDF is refused before it is parsed', () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const text = new TextEncoder().encode('just some plain text, definitely not a PDF');
  const empty = new Uint8Array(0);

  for (const bytes of [svg, text, empty]) {
    expect(sniffFile(bytes)).toBeNull();
  }
  expect(() => assertFileKind(svg, ['pdf'], { maxBytes: 1024 })).toThrow(FileSignatureError);
  expect(() => assertFileKind(text, ['pdf'], { maxBytes: 1024 })).toThrow(FileSignatureError);
  expect(() => assertFileKind(empty, ['pdf'], { maxBytes: 1024 })).toThrow(FileSignatureError);
});

// --- Minimal, hand-built headers for every raster and archive format ------

function u16be(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}
function u16le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}
function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function minimalPng(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10, // signature
    0,
    0,
    0,
    13, // IHDR length
    0x49,
    0x48,
    0x44,
    0x52, // "IHDR"
    ...u32be(width),
    ...u32be(height),
    8,
    6,
    0,
    0,
    0, // bit depth, colour type, compression, filter, interlace
  ]);
}

function minimalBaselineJpeg(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8, // SOI
    0xff,
    0xc0, // SOF0
    ...u16be(11), // segment length
    8, // precision
    ...u16be(height),
    ...u16be(width),
    1,
    1,
    0x11,
    0, // one component
    0xff,
    0xd9, // EOI
  ]);
}

function minimalGif89a(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0x47,
    0x49,
    0x46,
    0x38,
    0x39,
    0x61, // "GIF89a"
    ...u16le(width),
    ...u16le(height),
    0,
    0,
    0,
  ]);
}

function minimalWebpVp8x(width: number, height: number): Uint8Array {
  const canvasW = width - 1;
  const canvasH = height - 1;
  return Uint8Array.from([
    0x52,
    0x49,
    0x46,
    0x46, // "RIFF"
    18,
    0,
    0,
    0, // chunk size (little-endian, approximate)
    0x57,
    0x45,
    0x42,
    0x50, // "WEBP"
    0x56,
    0x50,
    0x38,
    0x58, // "VP8X"
    10,
    0,
    0,
    0, // chunk size
    0,
    0,
    0,
    0, // flags + reserved
    canvasW & 0xff,
    (canvasW >> 8) & 0xff,
    (canvasW >> 16) & 0xff,
    canvasH & 0xff,
    (canvasH >> 8) & 0xff,
    (canvasH >> 16) & 0xff,
  ]);
}

function minimalBmp(width: number, height: number, topDown: boolean): Uint8Array {
  const h = topDown ? -height : height;
  const bytes = [
    0x42,
    0x4d, // "BM"
    0,
    0,
    0,
    0, // file size (unused by the sniffer)
    0,
    0,
    0,
    0, // reserved
    54,
    0,
    0,
    0, // pixel data offset (unused)
    40,
    0,
    0,
    0, // BITMAPINFOHEADER size
  ];
  const w32 = width >>> 0;
  const h32 = h | 0;
  bytes.push(w32 & 0xff, (w32 >> 8) & 0xff, (w32 >> 16) & 0xff, (w32 >> 24) & 0xff);
  bytes.push(h32 & 0xff, (h32 >> 8) & 0xff, (h32 >> 16) & 0xff, (h32 >> 24) & 0xff);
  return Uint8Array.from(bytes);
}

function minimalZipLocalHeader(): Uint8Array {
  return Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
}

function minimalZipEmptyEocd(): Uint8Array {
  return Uint8Array.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
}

function minimalGzip(): Uint8Array {
  return Uint8Array.from([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 0xff]);
}

/** A minimal ustar tar header for one zero-byte entry "a", with a genuinely computed checksum. */
function minimalUstarTar(): Uint8Array {
  const header = new Uint8Array(512);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) header[offset + i] = text.charCodeAt(i);
  };
  write(0, 'a'); // name
  write(100, '0000644\0'); // mode
  write(108, '0000000\0'); // uid
  write(116, '0000000\0'); // gid
  write(124, '00000000000\0'); // size
  write(136, '00000000000\0'); // mtime
  for (let i = 148; i < 156; i++) header[i] = 0x20; // chksum placeholder: eight spaces
  header[156] = '0'.charCodeAt(0); // typeflag: regular file
  write(257, 'ustar\0');
  write(263, '00');
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i]!;
  const chk = sum.toString(8).padStart(6, '0') + '\0 ';
  write(148, chk);
  return header;
}

/** A pre-POSIX tar header (no ustar magic) with a genuinely computed checksum. */
function minimalPrePosixTar(): Uint8Array {
  const header = new Uint8Array(512);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) header[offset + i] = text.charCodeAt(i);
  };
  write(0, 'b');
  write(100, '0000644\0');
  write(124, '00000000000\0');
  for (let i = 148; i < 156; i++) header[i] = 0x20;
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i]!;
  write(148, sum.toString(8).padStart(6, '0') + '\0 ');
  return header;
}

it('PNG, JPEG, GIF, WebP and BMP signatures and dimensions are read from the header as their specifications define', () => {
  expect(sniffFile(minimalPng(16, 8))).toEqual({ kind: 'png', width: 16, height: 8 });
  expect(sniffFile(minimalBaselineJpeg(20, 10))).toEqual({ kind: 'jpeg', width: 20, height: 10 });
  expect(sniffFile(minimalGif89a(12, 6))).toEqual({ kind: 'gif', width: 12, height: 6 });
  expect(sniffFile(minimalWebpVp8x(17, 9))).toEqual({ kind: 'webp', width: 17, height: 9 });
  expect(sniffFile(minimalBmp(4, 4, false))).toEqual({ kind: 'bmp', width: 4, height: 4 });
  expect(sniffFile(minimalBmp(4, 4, true))).toEqual({ kind: 'bmp', width: 4, height: 4 });
});

it('ZIP, gzip and TAR archives are recognised by the signatures APPNOTE, RFC 1952 and POSIX define', () => {
  expect(sniffFile(minimalZipLocalHeader())?.kind).toBe('zip');
  expect(sniffFile(minimalZipEmptyEocd())?.kind).toBe('zip');
  expect(sniffFile(minimalGzip())?.kind).toBe('gzip');
  expect(sniffFile(minimalUstarTar())?.kind).toBe('tar');
  expect(sniffFile(minimalPrePosixTar())?.kind).toBe('tar');
});

it('SVG, HTML, text and truncated headers are refused as not an accepted format', () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const html = new TextEncoder().encode('<!doctype html><html></html>');
  const text = new TextEncoder().encode('just plain text');
  const truncatedPng = minimalPng(16, 8).slice(0, 10);

  for (const bytes of [svg, html, text, truncatedPng]) {
    expect(sniffFile(bytes)).toBeNull();
  }
});

it('a declared image size over the pixel limit or a file over the size limit is refused before decoding', () => {
  const hugePng = minimalPng(100_000, 100_000);
  expect(() => assertFileKind(hugePng, ['png'], { maxBytes: 1024 * 1024, maxPixels: 40_000_000 })).toThrow(
    FileSignatureError,
  );
  const bigFile = new Uint8Array(2048);
  bigFile.set(minimalPng(4, 4));
  expect(() => assertFileKind(bigFile, ['png'], { maxBytes: 1024 })).toThrow(FileSignatureError);
});

it('a kind outside the accepted list is refused with the accepted kinds named', () => {
  const png = minimalPng(4, 4);
  try {
    assertFileKind(png, ['jpeg', 'gif'], { maxBytes: 1024 });
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(FileSignatureError);
    expect((err as FileSignatureError).message).toContain('JPEG');
    expect((err as FileSignatureError).message).toContain('GIF');
  }
});

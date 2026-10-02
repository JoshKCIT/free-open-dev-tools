import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SIGNATURES, identifyFile } from '../src/index';

/*
 * Grounding (D-179, P13-08). Every case below was written from the specification it names, fetched with curl on
 * 2026-10-02; the line that states the bytes is quoted in a comment beside the case. The bytes are typed here as
 * literals, not read from the table under test. Where a real program could write a file of the format on this machine,
 * its output is a second opinion, quoted:
 *   - Python 3.14.3 (zlib 1.3.1, gzip, bz2, lzma): zlib.compress(b"hello", level)[:2] is 7801 for levels 0 and 1, 785e
 *     for 2 to 5, 789c for 6 and 78da for 7 to 9; gzip.compress(...)[:4] is 1f8b0800; bz2.compress(...)[:4] is
 *     425a6839; lzma.compress(...)[:6] is fd377a585a00 (the xz container).
 *   - javac 17.0.6 (the compiler that ships with IntelliJ IDEA 2023.1.1): a class file compiled with --release 8 begins
 *     cafebabe 00000034 (major version 52) and with the default release 17 cafebabe 0000003d (major version 61), which
 *     is Table 4.1-A of the Java Virtual Machine Specification (52 is Java SE 8, 61 is Java SE 17).
 * Rows whose two spellings differ only by byte order (Mach-O, pcap, TIFF) are both listed.
 */

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  expect(console.log).not.toHaveBeenCalled();
  expect(console.warn).not.toHaveBeenCalled();
  expect(console.error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

interface Case {
  name: string;
  spec: string;
  /** Hex text placed at each offset from the start of the file. */
  at: [number, string][];
  /** Hex text placed at the very end of the file. */
  end?: string;
  size?: number;
  /** The bytes the evidence must show, when they are not the first bytes placed. */
  show?: string;
}

const bytesOfHex = (hex: string): number[] => hex.match(/../g)!.map((pair) => parseInt(pair, 16));

/** Builds a file of the case's size, filled with the letter U (0x55), which no signature starts with. */
function buildFile(c: Case): { head: Uint8Array; tail: Uint8Array; size: number } {
  const size = c.size ?? 64;
  const file = new Uint8Array(size).fill(0x55);
  for (const [offset, hex] of c.at) file.set(bytesOfHex(hex), offset);
  if (c.end) file.set(bytesOfHex(c.end), size - c.end.length / 2);
  return { head: file.subarray(0, 512), tail: file.subarray(Math.max(0, size - 22)), size };
}

const CASES: Case[] = [
  // W3C PNG 3rd edition, 5.2: "The first eight bytes of a PNG datastream always contain the following hexadecimal
  // values: 89 50 4E 47 0D 0A 1A 0A"
  { name: 'PNG image', spec: 'https://www.w3.org/TR/png-3/', at: [[0, '89504e470d0a1a0a']] },
  // RFC 1952: "ID1 = 31 (0x1f, \037), ID2 = 139 (0x8b, \213)" and "CM = 8 denotes the "deflate" compression method"
  {
    name: 'gzip compressed data',
    spec: 'https://www.rfc-editor.org/rfc/rfc1952',
    at: [[0, '1f8b0800']],
    show: '1f8b08',
  },
  // RFC 8878: "Magic_Number: 4 bytes, little-endian format. Value: 0xFD2FB528."
  { name: 'Zstandard compressed data', spec: 'https://www.rfc-editor.org/rfc/rfc8878', at: [[0, '28b52ffd']] },
  // RFC 3533: "capture_pattern: Magic number for page start "OggS""
  { name: 'Ogg media stream', spec: 'https://www.rfc-editor.org/rfc/rfc3533', at: [[0, '4f676753']] },
  // SQLite file format: "The header string: "SQLite format 3\000""
  {
    name: 'SQLite 3 database',
    spec: 'https://www.sqlite.org/fileformat2.html',
    at: [[0, '53514c69746520666f726d6174203300']],
  },
  // GIF89a specification: Signature "GIF", Version "87a" (May 1987) or "89a" (July 1989)
  {
    name: 'GIF image (version 87a)',
    spec: 'https://www.w3.org/Graphics/GIF/spec-gif89a.txt',
    at: [[0, '474946383761']],
  },
  {
    name: 'GIF image (version 89a)',
    spec: 'https://www.w3.org/Graphics/GIF/spec-gif89a.txt',
    at: [[0, '474946383961']],
  },
  // RFC 8794: EBML Element "id: 0x1A45DFA3"
  { name: 'Matroska or WebM (EBML container)', spec: 'https://www.rfc-editor.org/rfc/rfc8794', at: [[0, '1a45dfa3']] },
  // PKWARE APPNOTE: "local file header signature 4 bytes (0x04034b50)", stored little-endian: 50 4B 03 04
  { name: 'ZIP archive', spec: 'https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT', at: [[0, '504b0304']] },
  // APPNOTE: "end of central dir signature 4 bytes (0x06054b50)"; "A ZIP file containing only an "end of central
  // directory record" is considered an empty ZIP file."
  {
    name: 'ZIP archive (empty)',
    spec: 'https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT',
    at: [[0, '504b0506']],
    size: 22,
  },
  // 7zFormat.txt: "BYTE kSignature[6] = {'7', 'z', 0xBC, 0xAF, 0x27, 0x1C};"
  { name: '7-Zip archive', spec: 'https://github.com/ip7z/7zip/blob/main/DOC/7zFormat.txt', at: [[0, '377abcaf271c']] },
  // RARLAB technote: "RAR 4.x 7 byte length signature: 0x52 0x61 0x72 0x21 0x1A 0x07 0x00" and "RAR 5.0 signature
  // consists of 8 bytes: 0x52 0x61 0x72 0x21 0x1A 0x07 0x01 0x00"
  { name: 'RAR archive (version 4)', spec: 'https://www.rarlab.com/technote.htm', at: [[0, '526172211a0700']] },
  { name: 'RAR archive (version 5)', spec: 'https://www.rarlab.com/technote.htm', at: [[0, '526172211a070100']] },
  // System V gABI: e_ident "ELFMAG0 0x7f, ELFMAG1 'E', ELFMAG2 'L', ELFMAG3 'F'"
  {
    name: 'ELF executable or library',
    spec: 'https://refspecs.linuxfoundation.org/elf/gabi4+/ch4.eheader.html',
    at: [[0, '7f454c46']],
  },
  // Apple loader.h: MH_MAGIC 0xfeedface, MH_CIGAM 0xcefaedfe, MH_MAGIC_64 0xfeedfacf, MH_CIGAM_64 0xcffaedfe
  {
    name: 'Mach-O binary (32-bit)',
    spec: 'https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/EXTERNAL_HEADERS/mach-o/loader.h',
    at: [[0, 'feedface']],
  },
  {
    name: 'Mach-O binary (32-bit)',
    spec: 'https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/EXTERNAL_HEADERS/mach-o/loader.h',
    at: [[0, 'cefaedfe']],
  },
  {
    name: 'Mach-O binary (64-bit)',
    spec: 'https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/EXTERNAL_HEADERS/mach-o/loader.h',
    at: [[0, 'feedfacf']],
  },
  {
    name: 'Mach-O binary (64-bit)',
    spec: 'https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/EXTERNAL_HEADERS/mach-o/loader.h',
    at: [[0, 'cffaedfe']],
  },
  // Apple fat.h: FAT_MAGIC 0xcafebabe, then nfat_arch, the number of structs that follow (here 2)
  {
    name: 'Mach-O universal (fat) binary',
    spec: 'https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/EXTERNAL_HEADERS/mach-o/fat.h',
    at: [[0, 'cafebabe00000002']],
    show: 'cafebabe',
  },
  // JVMS SE 21, 4.1: "magic ... has the value 0xCAFEBABE", then minor_version and major_version; javac 17.0.6 wrote
  // cafebabe 00000034 for --release 8
  {
    name: 'Java class file',
    spec: 'https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-4.html',
    at: [[0, 'cafebabe00000034']],
    show: 'cafebabe',
  },
  // POSIX pax, ustar header block: magic at offset 257 holds "ustar" followed by NUL
  {
    name: 'tar archive (ustar)',
    spec: 'https://pubs.opengroup.org/onlinepubs/9699919799/utilities/pax.html',
    at: [[257, '757374617200']],
    size: 512,
    show: '7573746172',
  },
  // RFC 1950: CM = 8, CINFO up to 7, (CMF*256 + FLG) a multiple of 31; Python's zlib wrote 7801, 785e, 789c and 78da
  { name: 'zlib compressed data', spec: 'https://www.rfc-editor.org/rfc/rfc1950', at: [[0, '789c']] },
  { name: 'zlib compressed data', spec: 'https://www.rfc-editor.org/rfc/rfc1950', at: [[0, '7801']] },
  { name: 'zlib compressed data', spec: 'https://www.rfc-editor.org/rfc/rfc1950', at: [[0, '785e']] },
  { name: 'zlib compressed data', spec: 'https://www.rfc-editor.org/rfc/rfc1950', at: [[0, '78da']] },
  // WebAssembly core specification: "magic ::= 0x00 0x61 0x73 0x6D", "version ::= 0x01 0x00 0x00 0x00"
  {
    name: 'WebAssembly module',
    spec: 'https://webassembly.github.io/spec/core/binary/modules.html',
    at: [[0, '0061736d01000000']],
  },
  // LZ4 frame format: "Magic Number: 4 Bytes, Little endian format. Value : 0x184D2204"
  { name: 'LZ4 frame', spec: 'https://github.com/lz4/lz4/blob/dev/doc/lz4_Frame_format.md', at: [[0, '04224d18']] },
  // Apache Parquet: "4-byte magic number "PAR1"" first, and "4-byte magic number "PAR1"" last
  {
    name: 'Apache Parquet file',
    spec: 'https://github.com/apache/parquet-format',
    at: [[0, '50415231']],
    end: '50415231',
    size: 40,
  },
  // Microsoft BITMAPFILEHEADER: bfType "must be 0x4d42 (the ASCII string "BM")"
  {
    name: 'BMP image',
    spec: 'https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-bitmapfileheader',
    at: [[0, '424d']],
  },
  // RFC 7468: "Textual encoding begins with a line comprising "-----BEGIN ", a label, and "-----""
  {
    name: 'PEM text (certificate, key or other encoded data)',
    spec: 'https://www.rfc-editor.org/rfc/rfc7468',
    at: [[0, '2d2d2d2d2d424547494e20']],
  },
  // pcap draft: "Magic Number (32 bits): ... either 0xA1B2C3D4 or 0xA1B23C4D", in the byte order of the writer
  {
    name: 'pcap capture file',
    spec: 'https://www.ietf.org/archive/id/draft-gharris-opsawg-pcap-01.txt',
    at: [[0, 'a1b2c3d4']],
  },
  {
    name: 'pcap capture file',
    spec: 'https://www.ietf.org/archive/id/draft-gharris-opsawg-pcap-01.txt',
    at: [[0, 'd4c3b2a1']],
  },
  {
    name: 'pcap capture file (nanosecond time stamps)',
    spec: 'https://www.ietf.org/archive/id/draft-gharris-opsawg-pcap-01.txt',
    at: [[0, 'a1b23c4d']],
  },
  {
    name: 'pcap capture file (nanosecond time stamps)',
    spec: 'https://www.ietf.org/archive/id/draft-gharris-opsawg-pcap-01.txt',
    at: [[0, '4d3cb2a1']],
  },
  // pcapng draft, Section Header Block: "Block Type = 0x0A0D0D0A"
  {
    name: 'pcapng capture file',
    spec: 'https://www.ietf.org/archive/id/draft-ietf-opsawg-pcapng-04.txt',
    at: [[0, '0a0d0d0a']],
  },
  // xz file format: "HEADER_MAGIC[6] = { 0xFD, '7', 'z', 'X', 'Z', 0x00 }"; Python's lzma wrote fd377a585a00
  {
    name: 'xz compressed data',
    spec: 'https://github.com/tukaani-project/xz/blob/master/doc/xz-file-format.txt',
    at: [[0, 'fd377a585a00']],
  },
  // RFC 8118: "All PDF files start with the characters "%PDF-""
  { name: 'PDF document', spec: 'https://www.rfc-editor.org/rfc/rfc8118', at: [[0, '255044462d']] },
  // ITU-T T.81: SOI is X'FFD8' and every marker starts with X'FF' (the next marker's first byte is the third byte)
  { name: 'JPEG image', spec: 'https://www.w3.org/Graphics/JPEG/itu-t81.pdf', at: [[0, 'ffd8ff']] },
  // RFC 9649: "'RIFF': The ASCII characters 'R', 'I', 'F', 'F'" then 4 size bytes then "'WEBP': ... 'W', 'E', 'B', 'P'"
  {
    name: 'WebP image',
    spec: 'https://www.rfc-editor.org/rfc/rfc9649',
    at: [
      [0, '52494646'],
      [8, '57454250'],
    ],
  },
  // TIFF 6.0: "II" (4949.H) or "MM" (4D4D.H), then "42" in that byte order
  { name: 'TIFF image', spec: 'https://download.osgeo.org/geotiff/spec/tiff6.pdf', at: [[0, '49492a00']] },
  { name: 'TIFF image', spec: 'https://download.osgeo.org/geotiff/spec/tiff6.pdf', at: [[0, '4d4d002a']] },
  // QuickTime File Format: 32-bit size, 32-bit type 'ftyp' (first significant atom), then the major brand
  {
    name: 'ISO base media file (MP4, M4A, MOV, HEIC or AVIF)',
    spec: 'https://developer.apple.com/documentation/quicktime-file-format/file_type_compatibility_atom',
    at: [
      [0, '00000018'],
      [4, '66747970'],
      [8, '69736f6d'],
    ],
    show: '66747970',
  },
  // bzip2 format specification: HeaderMagic "BZ" then Version "h"; Python's bz2 wrote 425a6839 (level 9 block size)
  {
    name: 'bzip2 compressed data',
    spec: 'https://github.com/dsnet/compress/blob/master/doc/bzip2-format.pdf',
    at: [[0, '425a6839']],
    show: '425a68',
  },
  // HDF5 specification: "Hexadecimal: 894844460d0a1a0a"
  {
    name: 'HDF5 file',
    spec: 'https://support.hdfgroup.org/documentation/hdf5/latest/_f_m_t3.html',
    at: [[0, '894844460d0a1a0a']],
  },
  // MS-CFB: "Header Signature (8 bytes) ... MUST be set to the value 0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1"
  {
    name: 'Compound File Binary (older Word, Excel or PowerPoint file, or MSI)',
    spec: 'https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/05060311-bfce-4b12-874d-71fd4ce63aea',
    at: [[0, 'd0cf11e0a1b11ae1']],
  },
  // RTF Specification 1.5: "The \rtfN control word must follow the opening brace" (here {\rtf1)
  {
    name: 'RTF document',
    spec: 'https://www.biblioscape.com/rtf15_spec.htm',
    at: [[0, '7b5c72746631']],
    show: '7b5c727466',
  },
  // ID3v2.4.0: "ID3v2/file identifier "ID3""
  {
    name: 'ID3v2 tag (usually the start of an MP3 file)',
    spec: 'https://id3.org/id3v2.4.0-structure',
    at: [[0, '494433']],
  },
  // RFC 9639: "Magic number(s): fLaC"
  { name: 'FLAC audio', spec: 'https://www.rfc-editor.org/rfc/rfc9639', at: [[0, '664c6143']] },
];

it('every signature in the table is built in code and named, with its specification cited', () => {
  for (const c of CASES) {
    const { head, tail, size } = buildFile(c);
    const found = identifyFile(head, tail, size);
    const match = found.find((kind) => kind.name === c.name);
    expect(
      match,
      `${c.name} (${c.at[0]![1]}) was not named; got ${found.map((f) => f.name).join(' | ')}`,
    ).toBeDefined();
    // The specification address is the one the case cites, and the evidence shows the bytes that were found.
    expect(match!.spec).toBe(c.spec);
    const shown = (c.show ?? c.at[0]![1]).toUpperCase().match(/../g)!.join(' ');
    expect(match!.evidence, c.name).toContain(shown);
  }

  // Nothing is in the table that has no case above, so no row ships unverified, and every address is https.
  for (const row of SIGNATURES) {
    expect(
      CASES.some((c) => c.name === row.name && c.spec === row.spec),
      `no case for ${row.name}`,
    ).toBe(true);
    expect(row.spec.startsWith('https://'), `${row.name} cites ${row.spec}`).toBe(true);
  }
  expect(SIGNATURES.length).toBeGreaterThanOrEqual(40);
  expect(new Set(SIGNATURES.map((row) => row.spec)).size).toBeGreaterThanOrEqual(30);

  // The Parquet signature needs both ends: the start alone, or the end alone, is not named.
  const startOnly = buildFile({ name: 'x', spec: '', at: [[0, '50415231']], size: 40 });
  expect(
    identifyFile(startOnly.head, startOnly.tail, startOnly.size).some((k) => k.name === 'Apache Parquet file'),
  ).toBe(false);
  const endOnly = buildFile({ name: 'x', spec: '', at: [], end: '50415231', size: 40 });
  expect(identifyFile(endOnly.head, endOnly.tail, endOnly.size).some((k) => k.name === 'Apache Parquet file')).toBe(
    false,
  );

  // Four bytes spelling PAR1 are one marker, not the two the format needs, so a file that short is not Parquet.
  const tiny = buildFile({ name: 'x', spec: '', at: [[0, '50415231']], size: 4 });
  expect(identifyFile(tiny.head, tiny.tail, tiny.size).some((k) => k.name === 'Apache Parquet file')).toBe(false);

  // A zlib header must pass the multiple of 31 rule: 7800 is not a zlib header, and neither is CM 9 (7909).
  for (const hex of ['7800', '7909', '8801']) {
    const file = buildFile({ name: 'x', spec: '', at: [[0, hex]] });
    expect(
      identifyFile(file.head, file.tail, file.size).some((k) => k.name === 'zlib compressed data'),
      hex,
    ).toBe(false);
  }
});

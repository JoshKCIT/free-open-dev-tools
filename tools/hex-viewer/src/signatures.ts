/**
 * The signature table: for each file format, the bytes a file of that format begins (or, for a few, ends) with, and the
 * address of the specification that states them. A signature is a hint, never a check of the whole file.
 *
 * Every row was checked against the specification it names (fetched on 2026-10-02); the line that states the bytes is
 * quoted in a comment beside the row. A format whose specification could not be fetched, or does not state the bytes,
 * is not in the table.
 *
 * `offset` counts bytes from the start of the file; with `fromEnd` it counts back from the end, so offset 0 means the
 * last bytes of the file. A signature matches when every one of its parts matches.
 */
export interface SignaturePart {
  readonly offset: number;
  readonly bytes: readonly number[];
  readonly fromEnd?: boolean;
}

export interface Signature {
  readonly name: string;
  readonly parts: readonly SignaturePart[];
  /** The address of the specification that states the signature. */
  readonly spec: string;
  /**
   * A signature of only two bytes, or one that is a rule more than a fixed string, is a weak hint: many other files
   * can pass it. The evidence says so.
   */
  readonly weak?: boolean;
  /** A rule in place of fixed bytes (see `matchesRule`). The row still lists `example`, bytes the rule accepts. */
  readonly rule?: 'zlib-header';
  readonly example?: readonly number[];
  /** Something to add to the evidence from the first bytes, when the signature allows it. */
  readonly detail?: 'iso-brand';
}

const ascii = (text: string): number[] => [...text].map((character) => character.charCodeAt(0));

const RFC_1950 = 'https://www.rfc-editor.org/rfc/rfc1950';
const APPNOTE = 'https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT';
const RAR_TECHNOTE = 'https://www.rarlab.com/technote.htm';
const MACHO_LOADER =
  'https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/EXTERNAL_HEADERS/mach-o/loader.h';
const MACHO_FAT = 'https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/EXTERNAL_HEADERS/mach-o/fat.h';
const GIF_SPEC = 'https://www.w3.org/Graphics/GIF/spec-gif89a.txt';
const TIFF_SPEC = 'https://download.osgeo.org/geotiff/spec/tiff6.pdf';
const PCAP_SPEC = 'https://www.ietf.org/archive/id/draft-gharris-opsawg-pcap-01.txt';
const JVMS = 'https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-4.html';

export const SIGNATURES: readonly Signature[] = [
  {
    // W3C PNG (Third Edition), 5.2 PNG signature: "The first eight bytes of a PNG datastream always contain the
    // following hexadecimal values: 89 50 4E 47 0D 0A 1A 0A".
    name: 'PNG image',
    parts: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
    spec: 'https://www.w3.org/TR/png-3/',
  },
  {
    // RFC 1952: "These have the fixed values ID1 = 31 (0x1f, \037), ID2 = 139 (0x8b, \213), to identify the
    // file as being in gzip format." and "CM = 8 denotes the "deflate" compression method".
    name: 'gzip compressed data',
    parts: [{ offset: 0, bytes: [0x1f, 0x8b, 0x08] }],
    spec: 'https://www.rfc-editor.org/rfc/rfc1952',
  },
  {
    // RFC 8878: "Magic_Number: 4 bytes, little-endian format. Value: 0xFD2FB528."
    name: 'Zstandard compressed data',
    parts: [{ offset: 0, bytes: [0x28, 0xb5, 0x2f, 0xfd] }],
    spec: 'https://www.rfc-editor.org/rfc/rfc8878',
  },
  {
    // RFC 3533: "capture_pattern: Magic number for page start "OggS"".
    name: 'Ogg media stream',
    parts: [{ offset: 0, bytes: ascii('OggS') }],
    spec: 'https://www.rfc-editor.org/rfc/rfc3533',
  },
  {
    // SQLite file format, magic header string: "The header string: "SQLite format 3\000"".
    name: 'SQLite 3 database',
    parts: [{ offset: 0, bytes: [...ascii('SQLite format 3'), 0x00] }],
    spec: 'https://www.sqlite.org/fileformat2.html',
  },
  {
    // GIF89a specification: "Signature - Identifies the GIF Data Stream. This field contains the fixed
    // value 'GIF'." and "Version Numbers as of 10 July 1990: "87a" - May 1987, "89a" - July 1989".
    name: 'GIF image (version 87a)',
    parts: [{ offset: 0, bytes: ascii('GIF87a') }],
    spec: GIF_SPEC,
  },
  {
    name: 'GIF image (version 89a)',
    parts: [{ offset: 0, bytes: ascii('GIF89a') }],
    spec: GIF_SPEC,
  },
  {
    // RFC 8794, 11.2.1 EBML Element: "id: 0x1A45DFA3"; Matroska and WebM both begin with this EBML header.
    name: 'Matroska or WebM (EBML container)',
    parts: [{ offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] }],
    spec: 'https://www.rfc-editor.org/rfc/rfc8794',
  },
  {
    // PKWARE APPNOTE: "local file header signature 4 bytes (0x04034b50)". Refined by the first entry's name.
    name: 'ZIP archive',
    parts: [{ offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }],
    spec: APPNOTE,
  },
  {
    // APPNOTE 4.3.1: "A ZIP file containing only an "end of central directory record" is considered an empty ZIP
    // file." and 4.3.16: "end of central dir signature 4 bytes (0x06054b50)".
    name: 'ZIP archive (empty)',
    parts: [{ offset: 0, bytes: [0x50, 0x4b, 0x05, 0x06] }],
    spec: APPNOTE,
  },
  {
    // 7zFormat.txt, SignatureHeader: "BYTE kSignature[6] = {'7', 'z', 0xBC, 0xAF, 0x27, 0x1C};".
    name: '7-Zip archive',
    parts: [{ offset: 0, bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] }],
    spec: 'https://github.com/ip7z/7zip/blob/main/DOC/7zFormat.txt',
  },
  {
    // RAR technote: "RAR 5.0 signature consists of 8 bytes: 0x52 0x61 0x72 0x21 0x1A 0x07 0x01 0x00." and "RAR 4.x
    // 7 byte length signature: 0x52 0x61 0x72 0x21 0x1A 0x07 0x00."
    name: 'RAR archive (version 4)',
    parts: [{ offset: 0, bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00] }],
    spec: RAR_TECHNOTE,
  },
  {
    name: 'RAR archive (version 5)',
    parts: [{ offset: 0, bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00] }],
    spec: RAR_TECHNOTE,
  },
  {
    // System V gABI, ELF header, e_ident: "ELFMAG0 0x7f, ELFMAG1 'E', ELFMAG2 'L', ELFMAG3 'F'".
    name: 'ELF executable or library',
    parts: [{ offset: 0, bytes: [0x7f, 0x45, 0x4c, 0x46] }],
    spec: 'https://refspecs.linuxfoundation.org/elf/gabi4+/ch4.eheader.html',
  },
  {
    // loader.h: "#define MH_MAGIC 0xfeedface", "#define MH_CIGAM 0xcefaedfe /* NXSwapInt(MH_MAGIC) */",
    // "#define MH_MAGIC_64 0xfeedfacf", "#define MH_CIGAM_64 0xcffaedfe /* NXSwapInt(MH_MAGIC_64) */".
    name: 'Mach-O binary (32-bit)',
    parts: [{ offset: 0, bytes: [0xfe, 0xed, 0xfa, 0xce] }],
    spec: MACHO_LOADER,
  },
  {
    name: 'Mach-O binary (32-bit)',
    parts: [{ offset: 0, bytes: [0xce, 0xfa, 0xed, 0xfe] }],
    spec: MACHO_LOADER,
  },
  {
    name: 'Mach-O binary (64-bit)',
    parts: [{ offset: 0, bytes: [0xfe, 0xed, 0xfa, 0xcf] }],
    spec: MACHO_LOADER,
  },
  {
    name: 'Mach-O binary (64-bit)',
    parts: [{ offset: 0, bytes: [0xcf, 0xfa, 0xed, 0xfe] }],
    spec: MACHO_LOADER,
  },
  {
    // fat.h: "#define FAT_MAGIC 0xcafebabe", "struct fat_header { uint32_t magic; uint32_t nfat_arch; /* number of
    // structs that follow */ }". The same four bytes begin a Java class file; the next four bytes tell them apart.
    name: 'Mach-O universal (fat) binary',
    parts: [{ offset: 0, bytes: [0xca, 0xfe, 0xba, 0xbe] }],
    spec: MACHO_FAT,
  },
  {
    // Java Virtual Machine Specification SE 21, 4.1: "The magic item supplies the magic number identifying the class
    // file format; it has the value 0xCAFEBABE." Table 4.1-A lists major versions from 45 (JDK 1.0.2 and 1.1).
    name: 'Java class file',
    parts: [{ offset: 0, bytes: [0xca, 0xfe, 0xba, 0xbe] }],
    spec: JVMS,
  },
  {
    // POSIX pax, ustar header block: magic at offset 257, 6 bytes: "If this field contains ustar (the five characters
    // from the ISO/IEC 646:1991 standard IRV shown followed by NUL)". The five characters are matched.
    name: 'tar archive (ustar)',
    parts: [{ offset: 257, bytes: ascii('ustar') }],
    spec: 'https://pubs.opengroup.org/onlinepubs/9699919799/utilities/pax.html',
  },
  {
    // RFC 1950: CMF "bits 0 to 3 CM ... CM = 8 denotes the "deflate" compression method", CINFO "values of CINFO
    // above 7 are not allowed", and FLG "CMF and FLG, when viewed as a 16-bit unsigned integer stored in MSB order
    // (CMF*256 + FLG), is a multiple of 31". Two bytes only, so a weak hint.
    name: 'zlib compressed data',
    parts: [],
    rule: 'zlib-header',
    example: [0x78, 0x9c],
    weak: true,
    spec: RFC_1950,
  },
  {
    // WebAssembly core specification, binary modules: "magic ::= 0x00 0x61 0x73 0x6D", "version ::= 0x01 0x00 0x00 0x00".
    name: 'WebAssembly module',
    parts: [{ offset: 0, bytes: [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00] }],
    spec: 'https://webassembly.github.io/spec/core/binary/modules.html',
  },
  {
    // LZ4 frame format: "Magic Number: 4 Bytes, Little endian format. Value : 0x184D2204".
    name: 'LZ4 frame',
    parts: [{ offset: 0, bytes: [0x04, 0x22, 0x4d, 0x18] }],
    spec: 'https://github.com/lz4/lz4/blob/dev/doc/lz4_Frame_format.md',
  },
  {
    // Apache Parquet file format: "4-byte magic number "PAR1"" at the start, and again as the last four bytes.
    name: 'Apache Parquet file',
    parts: [
      { offset: 0, bytes: ascii('PAR1') },
      { offset: 0, bytes: ascii('PAR1'), fromEnd: true },
    ],
    spec: 'https://github.com/apache/parquet-format',
  },
  {
    // Microsoft BITMAPFILEHEADER, bfType: "The file type; must be 0x4d42 (the ASCII string "BM")." Two bytes only.
    name: 'BMP image',
    parts: [{ offset: 0, bytes: ascii('BM') }],
    weak: true,
    spec: 'https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-bitmapfileheader',
  },
  {
    // RFC 7468: "Textual encoding begins with a line comprising "-----BEGIN ", a label, and "-----"".
    name: 'PEM text (certificate, key or other encoded data)',
    parts: [{ offset: 0, bytes: ascii('-----BEGIN ') }],
    spec: 'https://www.rfc-editor.org/rfc/rfc7468',
  },
  {
    // pcap file format draft, file header: "Magic Number (32 bits): an unsigned magic number, whose value is either the
    // hexadecimal number 0xA1B2C3D4 or the hexadecimal number 0xA1B23C4D", written in the byte order of the file.
    name: 'pcap capture file',
    parts: [{ offset: 0, bytes: [0xa1, 0xb2, 0xc3, 0xd4] }],
    spec: PCAP_SPEC,
  },
  {
    name: 'pcap capture file',
    parts: [{ offset: 0, bytes: [0xd4, 0xc3, 0xb2, 0xa1] }],
    spec: PCAP_SPEC,
  },
  {
    name: 'pcap capture file (nanosecond time stamps)',
    parts: [{ offset: 0, bytes: [0xa1, 0xb2, 0x3c, 0x4d] }],
    spec: PCAP_SPEC,
  },
  {
    name: 'pcap capture file (nanosecond time stamps)',
    parts: [{ offset: 0, bytes: [0x4d, 0x3c, 0xb2, 0xa1] }],
    spec: PCAP_SPEC,
  },
  {
    // pcapng draft, 4.1 Section Header Block: "Block Type = 0x0A0D0D0A" ... "recognize the Section Header Block
    // regardless of the endianness of the section".
    name: 'pcapng capture file',
    parts: [{ offset: 0, bytes: [0x0a, 0x0d, 0x0d, 0x0a] }],
    spec: 'https://www.ietf.org/archive/id/draft-ietf-opsawg-pcapng-04.txt',
  },
  {
    // xz file format, 2.1.1.1 Header Magic Bytes: "const uint8_t HEADER_MAGIC[6] = { 0xFD, '7', 'z', 'X', 'Z', 0x00 };".
    name: 'xz compressed data',
    parts: [{ offset: 0, bytes: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00] }],
    spec: 'https://github.com/tukaani-project/xz/blob/master/doc/xz-file-format.txt',
  },
  {
    // RFC 8118: "Magic number(s): All PDF files start with the characters "%PDF-" followed by the PDF version
    // number".
    name: 'PDF document',
    parts: [{ offset: 0, bytes: ascii('%PDF-') }],
    spec: 'https://www.rfc-editor.org/rfc/rfc8118',
  },
  {
    // ITU-T T.81, Annex B: the marker code table lists SOI as X'FFD8'; "the non-hierarchical interchange format shall
    // begin with an SOI marker"; every marker starts with an X'FF' byte, which is the third byte here.
    name: 'JPEG image',
    parts: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
    spec: 'https://www.w3.org/Graphics/JPEG/itu-t81.pdf',
  },
  {
    // RFC 9649: "'RIFF': 4 bytes: The ASCII characters 'R', 'I', 'F', 'F'." ... "'WEBP': 32 bits: The ASCII
    // characters 'W', 'E', 'B', 'P'." The four bytes between them are the file size.
    name: 'WebP image',
    parts: [
      { offset: 0, bytes: ascii('RIFF') },
      { offset: 8, bytes: ascii('WEBP') },
    ],
    spec: 'https://www.rfc-editor.org/rfc/rfc9649',
  },
  {
    // TIFF 6.0, Image File Header: "Bytes 0-1: The byte order used within the file. Legal values are: "II" (4949.H)
    // "MM" (4D4D.H)" and "Bytes 2-3: An arbitrary but carefully chosen number (42)", in that byte order.
    name: 'TIFF image',
    parts: [{ offset: 0, bytes: [0x49, 0x49, 0x2a, 0x00] }],
    spec: TIFF_SPEC,
  },
  {
    name: 'TIFF image',
    parts: [{ offset: 0, bytes: [0x4d, 0x4d, 0x00, 0x2a] }],
    spec: TIFF_SPEC,
  },
  {
    // QuickTime File Format, Atoms: "An atom header consists of ... A 32-bit integer that indicates the size of the
    // atom ... A 32-bit integer that contains the type of the atom"; File type compatibility atom ('ftyp'): "functionally
    // identical to the file type box defined in the ISO specifications for MPEG-4 and JPEG-2000" and "If present, it
    // must be the first significant atom in the file". So 'ftyp' sits at offset 4, after the 4 byte size.
    name: 'ISO base media file (MP4, M4A, MOV, HEIC or AVIF)',
    parts: [{ offset: 4, bytes: ascii('ftyp') }],
    detail: 'iso-brand',
    spec: 'https://developer.apple.com/documentation/quicktime-file-format/file_type_compatibility_atom',
  },
  {
    // bzip2 format specification (Joe Tsai), 2.2.2 StreamHeader: "The HeaderMagic is the 2 byte string: []byte{'B',
    // 'Z'} ... The Version is always the byte 'h'".
    name: 'bzip2 compressed data',
    parts: [{ offset: 0, bytes: ascii('BZh') }],
    spec: 'https://github.com/dsnet/compress/blob/master/doc/bzip2-format.pdf',
  },
  {
    // HDF5 file format specification, Format Signature: "The file signature of an HDF5 file always contains the
    // following values: Hexadecimal: 894844460d0a1a0a (ASCII C notation: \211HDF\r\n\032\n)".
    name: 'HDF5 file',
    parts: [{ offset: 0, bytes: [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a] }],
    spec: 'https://support.hdfgroup.org/documentation/hdf5/latest/_f_m_t3.html',
  },
  {
    // MS-CFB, header: "Header Signature (8 bytes): Identification signature for the compound file structure, and MUST be
    // set to the value 0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1."
    name: 'Compound File Binary (older Word, Excel or PowerPoint file, or MSI)',
    parts: [{ offset: 0, bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] }],
    spec: 'https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/05060311-bfce-4b12-874d-71fd4ce63aea',
  },
  {
    // RTF Specification 1.5, RTF Version: "An entire RTF file is considered a group and must be enclosed in braces. The
    // \rtfN control word must follow the opening brace."
    name: 'RTF document',
    parts: [{ offset: 0, bytes: ascii('{\\rtf') }],
    spec: 'https://www.biblioscape.com/rtf15_spec.htm',
  },
  {
    // ID3 tag version 2.4.0, the ID3v2 header: "ID3v2/file identifier "ID3"".
    name: 'ID3v2 tag (usually the start of an MP3 file)',
    parts: [{ offset: 0, bytes: ascii('ID3') }],
    spec: 'https://id3.org/id3v2.4.0-structure',
  },
  {
    // RFC 9639: "Magic number(s): fLaC", and "the fLaC (i.e., 0x664C6143) marker".
    name: 'FLAC audio',
    parts: [{ offset: 0, bytes: ascii('fLaC') }],
    spec: 'https://www.rfc-editor.org/rfc/rfc9639',
  },
];

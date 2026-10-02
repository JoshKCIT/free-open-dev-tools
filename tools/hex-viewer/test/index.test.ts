import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  HexViewerError,
  MAX_LISTED_MATCHES,
  MAX_NEEDLE_BYTES,
  MAX_PASTED_BYTES,
  MAX_SEARCH_BYTES,
  MAX_VIEW_BYTES,
  checkSearchSize,
  checkViewSize,
  encodeNeedle,
  formatHexRows,
  identifyFile,
  parseHexInput,
  searchChunks,
  viewWindow,
} from '../src/index';

/*
 * Grounding (D-179, P13-08).
 *
 * Row layout. The expected rows are what hexdump from util-linux 2.39.3 (Ubuntu 24.04.2 LTS, run under WSL 2 on this
 * machine, because Git Bash has no hexdump) printed with -vC for the same bytes. Each literal below is its output,
 * minus the closing line that holds only the total length, which has no meaning for a window of a file:
 *
 *   $ printf Hello | hexdump -C
 *   00000000  48 65 6c 6c 6f                                    |Hello|
 *   00000005
 *
 *   $ printf '\x48\x65\x6c\x6c\x6f\x2c\x20\x68\x65\x78\x21\x00\x1f\x20\x7e\x7f\x80\xff\x41\x42\x43\x44\x45\x46\x47\x48\x49\x4a' | hexdump -vC
 *   00000000  48 65 6c 6c 6f 2c 20 68  65 78 21 00 1f 20 7e 7f  |Hello, hex!.. ~.|
 *   00000010  80 ff 41 42 43 44 45 46  47 48 49 4a              |..ABCDEFGHIJ|
 *   0000001c
 *
 *   $ printf '\x41' | hexdump -vC
 *   00000000  41                                                |A|
 *   00000001
 *
 * GNU od (coreutils 8.32, Git Bash) agrees on the bytes and the text column, in its own layout:
 *   $ printf Hello | od -A x -t x1z -v
 *   000000 48 65 6c 6c 6f                                   >Hello<
 *
 * File signature. The W3C PNG specification, Third Edition (https://www.w3.org/TR/png-3/), section 5.2 "PNG signature",
 * fetched 2026-10-02, states: "The first eight bytes of a PNG datastream always contain the following hexadecimal
 * values: 89 50 4E 47 0D 0A 1A 0A".
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

const bytesOf = (text: string) => new TextEncoder().encode(text);

const SAMPLE = Uint8Array.from([
  0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x2c, 0x20, 0x68, 0x65, 0x78, 0x21, 0x00, 0x1f, 0x20, 0x7e, 0x7f, 0x80, 0xff, 0x41,
  0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a,
]);

it('pasted Hello shows one row in the canonical layout that hexdump prints for the same bytes', () => {
  // hexdump -C on Hello
  expect(formatHexRows(bytesOf('Hello'), 0, 16)).toBe(
    '00000000  48 65 6c 6c 6f                                    |Hello|',
  );

  // hexdump -vC on the 28 byte sample: two rows, a gap after the eighth byte, DEL and the high bytes as full stops
  expect(formatHexRows(SAMPLE, 0, 16)).toBe(
    [
      '00000000  48 65 6c 6c 6f 2c 20 68  65 78 21 00 1f 20 7e 7f  |Hello, hex!.. ~.|',
      '00000010  80 ff 41 42 43 44 45 46  47 48 49 4a              |..ABCDEFGHIJ|',
    ].join('\n'),
  );

  // hexdump -vC on one byte: a one byte file shows one row at offset 00000000
  expect(formatHexRows(Uint8Array.from([0x41]), 0, 16)).toBe(
    '00000000  41                                                |A|',
  );

  // A window that starts inside a file keeps its real offset, 8 hex digits, lower case.
  expect(formatHexRows(Uint8Array.from([0x41]), 0xabcdef, 16).startsWith('00abcdef  41 ')).toBe(true);

  // No bytes, no rows.
  expect(formatHexRows(new Uint8Array(0), 0, 16)).toBe('');

  // 8 and 32 bytes per row follow the same rule (groups of eight, two spaces between groups, hex area padded to the
  // full row). Their expected rows are built from hexdump's own 16 byte rows above, not from this package: the 8 byte
  // rows are hexdump's two groups on separate lines, the 32 byte row is its two hex areas side by side.
  const first = '00000000  48 65 6c 6c 6f 2c 20 68  65 78 21 00 1f 20 7e 7f  |Hello, hex!.. ~.|';
  const second = '00000010  80 ff 41 42 43 44 45 46  47 48 49 4a              |..ABCDEFGHIJ|';
  const areaOf = (row: string) => row.slice(10, 58);
  const textOf = (row: string) => row.slice(61, -1);
  expect(formatHexRows(SAMPLE, 0, 8).split('\n')).toEqual([
    `00000000  ${areaOf(first).slice(0, 23)}  |${textOf(first).slice(0, 8)}|`,
    `00000008  ${areaOf(first).slice(25)}  |${textOf(first).slice(8)}|`,
    `00000010  ${areaOf(second).slice(0, 23)}  |${textOf(second).slice(0, 8)}|`,
    `00000018  ${areaOf(second).slice(25)}  |${textOf(second).slice(8)}|`,
  ]);
  expect(formatHexRows(SAMPLE, 0, 32)).toBe(
    `00000000  ${areaOf(first)}  ${areaOf(second)}  |${textOf(first)}${textOf(second)}|`,
  );
});

it('the PNG signature is named with the W3C PNG specification as its source', () => {
  // The eight bytes the specification's section 5.2 states, followed by the start of an IHDR chunk.
  const png = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);
  const found = identifyFile(png, png, png.length);
  expect(found).toHaveLength(1);
  expect(found[0]!.name).toBe('PNG image');
  expect(found[0]!.spec).toBe('https://www.w3.org/TR/png-3/');
  expect(found[0]!.evidence).toContain('89 50 4E 47 0D 0A 1A 0A');
  expect(found[0]!.evidence).toContain('offset 0');

  // Seven of the eight bytes is not the signature.
  const almost = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0b]);
  expect(identifyFile(almost, almost, almost.length).some((f) => f.name === 'PNG image')).toBe(false);
});

it('hex input reads pairs with or without spaces and an odd digit count is refused with its position', () => {
  const hello = [0x48, 0x65, 0x6c, 0x6c, 0x6f];
  expect([...parseHexInput('48 65 6c 6c 6f')]).toEqual(hello);
  expect([...parseHexInput('48656c6c6f')]).toEqual(hello);
  expect([...parseHexInput('48 65 6C 6C 6F')]).toEqual(hello);
  expect([...parseHexInput('48 65\n6c\t6c\r\n6f\n')]).toEqual(hello);
  expect(parseHexInput('')).toHaveLength(0);
  expect(parseHexInput('  \n ')).toHaveLength(0);

  // An odd number of digits names the character that has no partner: the 7th character of "48 65 6".
  try {
    parseHexInput('48 65 6');
    expect.unreachable('an odd digit count must be refused');
  } catch (err) {
    expect(err).toBeInstanceOf(HexViewerError);
    expect((err as HexViewerError).position).toBe(7);
    expect((err as HexViewerError).message).toContain('character 7');
  }

  // A character that is not a hex digit names its position too.
  try {
    parseHexInput('48 6g');
    expect.unreachable('a non-hex character must be refused');
  } catch (err) {
    expect(err).toBeInstanceOf(HexViewerError);
    expect((err as HexViewerError).position).toBe(5);
    expect((err as HexViewerError).message).toContain('character 5');
  }
});

/*
 * Task 2 grounding, quoted as literals.
 *
 * Python 3.14.3 (standard library only), make-literals.py in the session scratch directory:
 *  - zipfile wrote four stored archives whose first entries are mimetype (content application/epub+zip),
 *    [Content_Types].xml, META-INF/MANIFEST.MF and readme.txt; the first 80 bytes of each are the hex below. A ZIP local
 *    file header is 30 bytes (APPNOTE 4.3.7) and the entry name follows it: its length is the 2 bytes at offset 26, the
 *    extra field length the 2 bytes at offset 28.
 *  - zipfile.ZipFile(...).close() on a new file wrote the 22 byte empty archive 504b0506 followed by 18 zero bytes.
 *  - tarfile (USTAR_FORMAT) wrote a 512 byte header for hello.txt of 5 bytes; bytes 257 to 264 are 7573746172003030, the
 *    text ustar, NUL, 00.
 *  - secrets.token_hex(48) drew the random bytes once.
 *  - re.finditer(b"(?=" + needle + b")", haystack[, re.IGNORECASE]) found every match offset, overlapping ones too; a
 *    bytes pattern folds the ASCII letters only: abcabcabcab / abc gives 0, 3, 6; aaaa / aa gives 0, 1, 2;
 *    "Hello hello HELLO hElLo" / hello gives 6 (case kept) and 0, 6, 12, 18 (case ignored); xxabcdyy / abcd gives 2;
 *    the UTF-8 text "café CAFÉ cafÉ K <Kelvin sign> k" / café with case ignored gives 0 only, and / k gives 18 and 24
 *    (the Kelvin sign U+212A is not folded to k).
 *  - javac 17.0.6 wrote class files beginning cafebabe00000034 (--release 8) and cafebabe0000003d (default release).
 */

const hexBytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g)!.map((pair) => parseInt(pair, 16)));

async function* chunksOf(...parts: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) yield part;
}

/** Splits bytes into chunks of the given size. */
function split(bytes: Uint8Array, size: number): Uint8Array[] {
  const parts: Uint8Array[] = [];
  for (let at = 0; at < bytes.length; at += size) parts.push(bytes.subarray(at, at + size));
  return parts;
}

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

const ZIP_HEADS = {
  epub: '504b0304140000000000000021506f61ab2c1400000014000000080000006d696d65747970656170706c69636174696f6e2f657075622b7a6970504b03041400000000000000215054995f930c000000',
  office:
    '504b030414000000000000002150c71c173c0800000008000000130000005b436f6e74656e745f54797065735d2e786d6c3c54797065732f3e504b030414000000000000002150ce9e98130b0000000b',
  jar: '504b030414000000000000002150b27f02ee1900000019000000140000004d4554412d494e462f4d414e49464553542e4d464d616e69666573742d56657273696f6e3a20312e300d0a0d0a504b030414',
  plain:
    '504b03041400000000000000215086a6103605000000050000000a000000726561646d652e74787468656c6c6f504b010214001400000000000000215086a6103605000000050000000a000000000000',
};

const identify = (head: Uint8Array, size = head.length) =>
  identifyFile(head.subarray(0, 512), head.subarray(Math.max(0, head.length - 22)), size);

it('random bytes are unknown and a zero-byte file is an empty file', () => {
  // secrets.token_hex(48), drawn once: no signature starts with these bytes.
  const random = hexBytes(
    '476b8623356940c7c64e645de372b05285f9f35767e07aed36aaa6b63d317c79f8535c8bc1dd2695b1d7127baf835c14',
  );
  const found = identify(random);
  expect(found).toHaveLength(1);
  expect(found[0]!.name).toBe('unknown');
  expect(found[0]!.spec).toBe('');
  expect(found[0]!.evidence).toContain('No signature');

  const empty = identifyFile(new Uint8Array(0), new Uint8Array(0), 0);
  expect(empty).toHaveLength(1);
  expect(empty[0]!.name).toBe('empty file');
  expect(empty[0]!.evidence).toContain('0 bytes');

  // One byte is a file: it is unknown, not empty.
  expect(identify(Uint8Array.from([0x41]))[0]!.name).toBe('unknown');
});

it('ZIP containers are named with their possible family from the first entry name', () => {
  const epub = identify(hexBytes(ZIP_HEADS.epub), 266);
  expect(epub).toHaveLength(1);
  expect(epub[0]!.name).toBe('ZIP archive, possibly an EPUB book');
  expect(epub[0]!.evidence).toContain('50 4B 03 04 at offset 0');
  expect(epub[0]!.evidence).toContain('"mimetype"');
  expect(epub[0]!.evidence).toContain('application/epub+zip');
  expect(epub[0]!.spec).toBe('https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT');

  const office = identify(hexBytes(ZIP_HEADS.office), 261);
  expect(office[0]!.name).toBe('ZIP archive, possibly an Office Open XML file (XLSX, DOCX or PPTX)');
  expect(office[0]!.evidence).toContain('"[Content_Types].xml"');

  const jar = identify(hexBytes(ZIP_HEADS.jar), 254);
  expect(jar[0]!.name).toBe('ZIP archive, possibly a Java archive (JAR)');
  expect(jar[0]!.evidence).toContain('"META-INF/MANIFEST.MF"');

  // A first entry that no family claims is a plain ZIP archive, and the evidence says what else uses ZIP.
  const plain = identify(hexBytes(ZIP_HEADS.plain), 123);
  expect(plain[0]!.name).toBe('ZIP archive');
  expect(plain[0]!.evidence).toContain('"readme.txt"');
  for (const family of ['XLSX', 'DOCX', 'JAR', 'EPUB']) expect(plain[0]!.evidence).toContain(family);

  // A mimetype entry that does not hold the EPUB media type is one of two families.
  const other = hexBytes(ZIP_HEADS.epub);
  other.set(text('application/x-other+'), 38);
  expect(identify(other, 266)[0]!.name).toBe('ZIP archive, possibly an EPUB book or an OpenDocument file');

  // A head too short to hold the entry name still names the archive.
  const cut = hexBytes(ZIP_HEADS.office).subarray(0, 34);
  expect(identify(cut, 261)[0]!.name).toBe('ZIP archive');
});

it('CA FE BA BE is told apart as a Java class or a Mach-O fat file by the next four bytes', () => {
  const names = (hex: string) => identify(hexBytes(hex)).map((kind) => kind.name);

  // javac 17.0.6: --release 8 gives major version 52, the default release 17 gives 61.
  expect(names('cafebabe00000034001d0a0002000307')).toEqual(['Java class file']);
  expect(names('cafebabe0000003d001d0a0002000307')).toEqual(['Java class file']);
  // JVMS Table 4.1-A starts at major version 45 (JDK 1.0.2 and 1.1), with any minor version.
  expect(names('cafebabe0000002d')).toEqual(['Java class file']);
  expect(names('cafebabeffff003d')).toEqual(['Java class file']);
  const java = identify(hexBytes('cafebabe00000034'))[0]!;
  expect(java.evidence).toContain('major version 52');
  expect(java.spec).toBe('https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-4.html');

  // Apple fat.h: nfat_arch is the number of architectures that follow, a small count.
  expect(names('cafebabe00000001')).toEqual(['Mach-O universal (fat) binary']);
  expect(names('cafebabe00000002')).toEqual(['Mach-O universal (fat) binary']);
  expect(names('cafebabe0000001e')).toEqual(['Mach-O universal (fat) binary']);
  const fat = identify(hexBytes('cafebabe00000002'))[0]!;
  expect(fat.evidence).toContain('2 architectures');
  expect(fat.spec).toBe(
    'https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/EXTERNAL_HEADERS/mach-o/fat.h',
  );

  // Neither rule decides: both names are shown, and so are they when the head holds only the four magic bytes.
  expect(names('cafebabe00000020')).toEqual(['Mach-O universal (fat) binary', 'Java class file']);
  expect(names('cafebabe00000000')).toEqual(['Mach-O universal (fat) binary', 'Java class file']);
  expect(names('cafebabe')).toEqual(['Mach-O universal (fat) binary', 'Java class file']);
});

it('a tar file is found by ustar at offset 257 and an empty ZIP by its end record', () => {
  // tarfile (USTAR_FORMAT) header for hello.txt, 5 bytes, written by Python 3.14.3: 512 bytes, mostly zeros.
  const header = hexBytes(
    [
      '68656c6c6f2e74787400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '00000000000000000000000000000000000000000000000000000000000000000000000030303030363434003030303030303000303030303030300030303030',
      '30303030303035003133363032373630343030003030373634310020300000000000000000000000000000000000000000000000000000000000000000000000',
      '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '00757374617200303000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    ].join(''),
  );
  expect(header).toHaveLength(512);
  const tar = identifyFile(header, header.subarray(512 - 22), 10240);
  expect(tar).toHaveLength(1);
  expect(tar[0]!.name).toBe('tar archive (ustar)');
  expect(tar[0]!.evidence).toContain('75 73 74 61 72 ("ustar") at offset 257');
  expect(tar[0]!.spec).toBe('https://pubs.opengroup.org/onlinepubs/9699919799/utilities/pax.html');

  // The same bytes with ustar one byte early are not a tar header.
  const shifted = new Uint8Array(header);
  shifted.fill(0, 257, 263);
  shifted.set(text('ustar'), 256);
  expect(identifyFile(shifted, shifted.subarray(490), 10240).some((kind) => kind.name.startsWith('tar'))).toBe(false);

  // zipfile on a new file wrote exactly 22 bytes: the end of central directory record 504b0506 and 18 zero bytes.
  const empty = hexBytes('504b0506000000000000000000000000000000000000');
  const emptyZip = identifyFile(empty, empty, 22);
  expect(emptyZip).toHaveLength(1);
  expect(emptyZip[0]!.name).toBe('ZIP archive (empty)');
  expect(emptyZip[0]!.evidence).toContain('50 4B 05 06 at offset 0');
  expect(emptyZip[0]!.spec).toBe('https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT');

  // An end record in the last 22 bytes of a file that does not begin with a ZIP header is still reported.
  const prefixed = new Uint8Array(100).fill(0x55);
  prefixed.set(empty, 78);
  const behind = identifyFile(prefixed.subarray(0, 100), prefixed.subarray(78), 100);
  expect(behind.map((kind) => kind.name)).toEqual(['ZIP archive']);
  expect(behind[0]!.evidence).toContain('last 22 bytes');

  // The record anywhere but the last 22 bytes is not found.
  const early = new Uint8Array(100).fill(0x55);
  early.set(empty, 40);
  expect(identifyFile(early, early.subarray(78), 100)[0]!.name).toBe('unknown');
});

it('a search finds a needle that straddles two chunks and counts every match', async () => {
  // re.finditer gives 2 for xxabcdyy / abcd.
  expect(await searchChunks(chunksOf(text('xxab'), text('cdyy')), text('abcd'), { matchCase: true })).toEqual({
    offsets: [2],
    total: 1,
  });

  // abcabcabcab / abc is 0, 3, 6 however the haystack is cut: at every position, and in chunks of 1, 2 and 3 bytes.
  const hay = text('abcabcabcab');
  for (let cut = 1; cut < hay.length; cut++) {
    const result = await searchChunks(chunksOf(hay.subarray(0, cut), hay.subarray(cut)), text('abc'), {
      matchCase: true,
    });
    expect(result, `cut at ${cut}`).toEqual({ offsets: [0, 3, 6], total: 3 });
  }
  for (const size of [1, 2, 3]) {
    expect(await searchChunks(chunksOf(...split(hay, size)), text('abc'), { matchCase: true })).toEqual({
      offsets: [0, 3, 6],
      total: 3,
    });
  }

  // Matches overlap: aaaa / aa is 0, 1, 2, also one byte at a time.
  expect(await searchChunks(chunksOf(...split(text('aaaa'), 1)), text('aa'), { matchCase: true })).toEqual({
    offsets: [0, 1, 2],
    total: 3,
  });

  // A needle longer than a chunk, split across three chunks, with an empty chunk between.
  expect(
    await searchChunks(chunksOf(text('..ab'), new Uint8Array(0), text('cd'), text('ef..')), text('abcdef'), {
      matchCase: true,
    }),
  ).toEqual({ offsets: [2], total: 1 });

  // No match, and a haystack shorter than the needle.
  expect(await searchChunks(chunksOf(text('abc')), text('abcd'), { matchCase: true })).toEqual({
    offsets: [],
    total: 0,
  });
  expect(await searchChunks(chunksOf(), text('a'), { matchCase: true })).toEqual({ offsets: [], total: 0 });

  // Offsets continue across chunks: the match in the third chunk is at its true position in the file.
  expect(
    await searchChunks(chunksOf(text('0123'), text('4567'), text('89ab')), text('9a'), { matchCase: true }),
  ).toEqual({ offsets: [9], total: 1 });
});

it('text search ignores ASCII case only when match case is off', async () => {
  const hello = text('Hello hello HELLO hElLo');
  // Python re: case kept finds 6; case ignored finds 0, 6, 12, 18.
  expect(await searchChunks(chunksOf(hello), text('hello'), { matchCase: true })).toEqual({ offsets: [6], total: 1 });
  expect(await searchChunks(chunksOf(hello), text('hello'), { matchCase: false })).toEqual({
    offsets: [0, 6, 12, 18],
    total: 4,
  });
  // The needle may be the one in capitals, and a match may straddle chunks with its case folded.
  expect(await searchChunks(chunksOf(hello), text('HELLO'), { matchCase: false })).toEqual({
    offsets: [0, 6, 12, 18],
    total: 4,
  });
  expect(await searchChunks(chunksOf(text('xxaB'), text('cXX')), text('ABC'), { matchCase: false })).toEqual({
    offsets: [2],
    total: 1,
  });

  // UTF-8 for "café CAFÉ cafÉ K <Kelvin sign> k": only ASCII letters fold, so É never matches é and the Kelvin sign
  // (U+212A) never matches k. Python gives 0 for café and 18, 24 for k.
  const mixed = hexBytes('636166c3a920434146c38920636166c389204b20e284aa206b');
  expect(await searchChunks(chunksOf(mixed), text('café'), { matchCase: false })).toEqual({ offsets: [0], total: 1 });
  expect(await searchChunks(chunksOf(mixed), text('k'), { matchCase: false })).toEqual({
    offsets: [18, 24],
    total: 2,
  });
  // The second byte of é (a9) and of É (89) differ only in the bit 0x20, which a fold of every byte would drop.
  expect(await searchChunks(chunksOf(hexBytes('c389')), hexBytes('c3a9'), { matchCase: false })).toEqual({
    offsets: [],
    total: 0,
  });

  // With match case on, A (41) and a (61) are different bytes.
  expect(await searchChunks(chunksOf(text('Aa')), hexBytes('61'), { matchCase: true })).toEqual({
    offsets: [1],
    total: 1,
  });
});

it('a position past the end or below 0 is refused naming Go to byte', () => {
  expect(viewWindow(10, 0, 64, 16)).toEqual({ start: 0, end: 10 });
  expect(viewWindow(10, 9, 64, 16)).toEqual({ start: 9, end: 10 });
  // The first byte of an empty file is the only position it has, and nothing is shown there.
  expect(viewWindow(0, 0, 64, 16)).toEqual({ start: 0, end: 0 });

  for (const [size, position] of [
    [10, 10],
    [10, 11],
    [10, -1],
    [10, 1.5],
    [10, Number.NaN],
    [0, 1],
    [10, 2147483648],
  ] as [number, number][]) {
    try {
      viewWindow(size, position, 64, 16);
      expect.unreachable(`position ${position} of ${size} bytes must be refused`);
    } catch (err) {
      expect(err).toBeInstanceOf(HexViewerError);
      expect((err as HexViewerError).message, `${position}`).toContain('Go to byte');
      expect((err as HexViewerError).field).toBe('Go to byte');
    }
  }

  // The window is one page: rows times bytes per row from the position, never past the end.
  expect(viewWindow(1000, 100, 16, 8)).toEqual({ start: 100, end: 228 });
  expect(viewWindow(1000, 100, 64, 16)).toEqual({ start: 100, end: 1000 });
  expect(viewWindow(5000, 100, 256, 32)).toEqual({ start: 100, end: 100 + 256 * 32 });
  expect(viewWindow(2147483648, 2147483647, 256, 32)).toEqual({ start: 2147483647, end: 2147483648 });
});

it('only the first 1000 matches are listed and the total is counted', async () => {
  const hay = new Uint8Array(1500).fill(0x61);
  const result = await searchChunks(chunksOf(...split(hay, 512)), text('a'), { matchCase: true });
  expect(result.total).toBe(1500);
  expect(result.offsets).toHaveLength(MAX_LISTED_MATCHES);
  expect(MAX_LISTED_MATCHES).toBe(1000);
  expect(result.offsets[0]).toBe(0);
  expect(result.offsets[999]).toBe(999);
  expect(result.offsets).toEqual(Array.from({ length: 1000 }, (_, i) => i));

  // Exactly 1000 matches are all listed; one more is counted but not listed.
  const exact = await searchChunks(chunksOf(new Uint8Array(1000).fill(0x61)), text('a'), { matchCase: true });
  expect(exact.total).toBe(1000);
  expect(exact.offsets).toHaveLength(1000);
  const over = await searchChunks(chunksOf(new Uint8Array(1001).fill(0x61)), text('a'), { matchCase: true });
  expect(over.total).toBe(1001);
  expect(over.offsets).toHaveLength(1000);
});

it('a search over 1 GiB is refused and a view over 2 GiB is refused', () => {
  expect(MAX_SEARCH_BYTES).toBe(1073741824);
  expect(MAX_VIEW_BYTES).toBe(2147483648);
  expect(MAX_PASTED_BYTES).toBe(5242880);

  // Exactly at the limit is accepted; one byte more is refused with the sentence the page shows.
  expect(() => checkSearchSize(MAX_SEARCH_BYTES)).not.toThrow();
  expect(() => checkViewSize(MAX_VIEW_BYTES)).not.toThrow();
  expect(() => checkSearchSize(0)).not.toThrow();
  try {
    checkSearchSize(MAX_SEARCH_BYTES + 1);
    expect.unreachable('a search over 1 GiB must be refused');
  } catch (err) {
    expect(err).toBeInstanceOf(HexViewerError);
    expect((err as HexViewerError).message).toBe(
      'This file is 1,073,741,825 bytes (1 GiB). The limit for search is 1 GiB because a search over more has not been shown to finish within its 20 second limit in every browser.',
    );
  }
  try {
    checkViewSize(MAX_VIEW_BYTES + 1);
    expect.unreachable('a view over 2 GiB must be refused');
  } catch (err) {
    expect(err).toBeInstanceOf(HexViewerError);
    expect((err as HexViewerError).message).toBe(
      'This file is 2,147,483,649 bytes (2 GiB). The limit is 2 GiB because larger files have not been tested in every browser.',
    );
  }
  expect(() => checkViewSize(3 * 1024 * 1024 * 1024)).toThrow('This file is 3,221,225,472 bytes (3 GiB)');
});

it('search needs at least one byte, and a needle is the text as UTF-8 or hex bytes', async () => {
  await expect(searchChunks(chunksOf(text('abc')), new Uint8Array(0), { matchCase: true })).rejects.toThrow(
    HexViewerError,
  );
  expect([...encodeNeedle('café', 'text')]).toEqual([0x63, 0x61, 0x66, 0xc3, 0xa9]);
  expect([...encodeNeedle('6c 6C', 'hex')]).toEqual([0x6c, 0x6c]);
  expect(encodeNeedle('', 'text')).toHaveLength(0);
  expect(encodeNeedle('', 'hex')).toHaveLength(0);
  try {
    encodeNeedle('6c6', 'hex');
    expect.unreachable('an odd digit count in a hex search must be refused');
  } catch (err) {
    expect((err as HexViewerError).message).toContain('Search for');
    expect((err as HexViewerError).position).toBe(3);
  }
  // A needle over 1 MiB is refused before it is searched for.
  await expect(
    searchChunks(chunksOf(text('abc')), new Uint8Array(MAX_NEEDLE_BYTES + 1).fill(0x61), { matchCase: true }),
  ).rejects.toThrow('Search for');
});

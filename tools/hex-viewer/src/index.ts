import meta from './meta.json';
import { SIGNATURES, type Signature, type SignaturePart } from './signatures';

export { meta, SIGNATURES };
export type { Signature, SignaturePart };

/** A file can be viewed up to this many bytes (2 GiB): only the rows on screen are ever read. */
export const MAX_VIEW_BYTES = 2147483648;
/** A file can be searched up to this many bytes (1 GiB). */
export const MAX_SEARCH_BYTES = 1073741824;
/** Pasted hex or text can be up to this many bytes (5 MiB). */
export const MAX_PASTED_BYTES = 5242880;
/** A search lists at most this many match offsets and counts the rest. */
export const MAX_LISTED_MATCHES = 1000;
/** The bytes searched for can be up to this many (1 MiB). */
export const MAX_NEEDLE_BYTES = 1048576;

/**
 * Raised, with a plain message, for every expected failure: hex text that is not pairs of digits (with its position), a
 * position outside the file, a file or paste over a limit. `field` names the page field the message is about.
 */
export class HexViewerError extends Error {
  readonly field?: string;
  readonly position?: number;
  constructor(message: string, detail: { field?: string; position?: number } = {}) {
    super(message);
    this.name = 'HexViewerError';
    if (detail.field !== undefined) this.field = detail.field;
    if (detail.position !== undefined) this.position = detail.position;
  }
}

export type BytesPerRow = 8 | 16 | 32;

const hexByte = (value: number): string => value.toString(16).padStart(2, '0');

/**
 * Rows in the canonical hexdump layout, `startOffset` being the offset of the first byte in the file: an 8 digit hex
 * offset, two spaces, the bytes in groups of eight with two spaces between groups, two spaces, then the bytes as
 * text between vertical bars. Text is printable ASCII (0x20 to 0x7E); every other byte is a full stop. A short last row
 * is padded so the text column lines up. Rows are joined by line breaks; there is no closing offset line.
 */
export function formatHexRows(bytes: Uint8Array, startOffset: number, bytesPerRow: BytesPerRow): string {
  if (bytesPerRow !== 8 && bytesPerRow !== 16 && bytesPerRow !== 32) {
    throw new HexViewerError('Bytes per row must be 8, 16 or 32.', { field: 'Bytes per row' });
  }
  if (!Number.isSafeInteger(startOffset) || startOffset < 0) {
    throw new HexViewerError('The first offset must be a whole number of bytes, 0 or more.', { field: 'Go to byte' });
  }
  const rows: string[] = [];
  for (let start = 0; start < bytes.length; start += bytesPerRow) {
    const count = Math.min(bytesPerRow, bytes.length - start);
    let hex = '';
    let text = '';
    for (let column = 0; column < bytesPerRow; column++) {
      if (column > 0) hex += column % 8 === 0 ? '  ' : ' ';
      if (column < count) {
        const value = bytes[start + column]!;
        hex += hexByte(value);
        text += value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : '.';
      } else {
        hex += '  ';
      }
    }
    rows.push(`${(startOffset + start).toString(16).padStart(8, '0')}  ${hex}  |${text}|`);
  }
  return rows.join('\n');
}

/** A byte count as B, KiB, MiB, GiB or TiB with at most one decimal, for the sentences that name a limit. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${Number(value.toFixed(1))} ${units[unit]}`;
}

/** The exact count with its rounded size beside it: 1,073,741,825 bytes (1 GiB). */
const sizeWords = (bytes: number): string => `${bytes.toLocaleString('en-US')} bytes (${formatSize(bytes)})`;

const isHexDigit = (code: number): boolean =>
  (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x46) || (code >= 0x61 && code <= 0x66);

const hexValue = (code: number): number => (code <= 0x39 ? code - 0x30 : (code | 0x20) - 0x61 + 10);

const isSpace = (code: number): boolean => code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;

/**
 * Reads hex text as bytes: pairs of hex digits (either case), with spaces, tabs or line breaks between bytes or none at
 * all. A character that is not a hex digit, or a byte written with one digit, is refused naming its position (the
 * character number in the text, counting from 1) and the field it was typed in, `field`. More than `MAX_PASTED_BYTES`
 * bytes is refused.
 */
export function parseHexInput(text: string, field = 'Pasted bytes'): Uint8Array {
  // First pass: check every character and count the digits, keeping nothing, so a refusal costs no allocation.
  let digitCount = 0;
  let runLength = 0;
  const endRun = (lastDigitPosition: number): void => {
    if (runLength % 2 === 1) {
      throw new HexViewerError(
        `${field}: a byte is two hex digits, but the digit at character ${lastDigitPosition} has no partner. Write pairs such as 48 65 6c.`,
        { field, position: lastDigitPosition },
      );
    }
    runLength = 0;
  };
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (isSpace(code)) {
      endRun(index);
      continue;
    }
    if (!isHexDigit(code)) {
      throw new HexViewerError(
        `${field}: the text holds ${JSON.stringify(text[index])} at character ${index + 1}, which is not a hex digit. Use pairs of the digits 0 to 9 and a to f.`,
        { field, position: index + 1 },
      );
    }
    runLength++;
    digitCount++;
  }
  endRun(text.length);
  if (digitCount / 2 > MAX_PASTED_BYTES) {
    throw new HexViewerError(
      `${field}: the hex is ${sizeWords(digitCount / 2)}. The limit is ${formatSize(MAX_PASTED_BYTES)} because it is held in the page while it is shown.`,
      { field },
    );
  }
  // Second pass: fill the bytes.
  const bytes = new Uint8Array(digitCount / 2);
  let filled = 0;
  let high = -1;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (isSpace(code)) continue;
    if (high < 0) {
      high = hexValue(code);
    } else {
      bytes[filled++] = high * 16 + hexValue(code);
      high = -1;
    }
  }
  return bytes;
}

/**
 * The bytes to search for: the text as UTF-8, or hex text read as `parseHexInput` reads it, naming the field Search for.
 * Empty text gives no bytes.
 */
export function encodeNeedle(text: string, as: 'text' | 'hex'): Uint8Array {
  if (as === 'hex') return parseHexInput(text, 'Search for');
  return new TextEncoder().encode(text);
}

/** A file over 2 GiB is refused for viewing, before any byte of it is read. */
export function checkViewSize(size: number): void {
  if (size > MAX_VIEW_BYTES) {
    throw new HexViewerError(
      `This file is ${sizeWords(size)}. The limit is ${formatSize(MAX_VIEW_BYTES)} because larger files have not been tested in every browser.`,
      { field: 'File' },
    );
  }
}

/** A file over 1 GiB is refused for searching, before any byte of it is read. */
export function checkSearchSize(size: number): void {
  if (size > MAX_SEARCH_BYTES) {
    throw new HexViewerError(
      `This file is ${sizeWords(size)}. The limit for search is ${formatSize(MAX_SEARCH_BYTES)} because a search over more has not been shown to finish within its 20 second limit in every browser.`,
      { field: 'File' },
    );
  }
}

/**
 * The bytes to show: from `position` for `rows` rows of `bytesPerRow` bytes, never past the end of a file of `size`
 * bytes. A position that is not a whole number, is below 0 or is past the last byte is refused naming Go to byte; the
 * first byte of an empty file is the one position it has.
 */
export function viewWindow(
  size: number,
  position: number,
  rows: number,
  bytesPerRow: number,
): { start: number; end: number } {
  if (!Number.isInteger(position) || position < 0) {
    throw new HexViewerError('Go to byte must be a whole number of 0 or more.', { field: 'Go to byte' });
  }
  if (size === 0 ? position > 0 : position > size - 1) {
    throw new HexViewerError(
      size === 0
        ? `Go to byte is ${position.toLocaleString('en-US')}, but the file has no bytes. Use 0.`
        : `Go to byte is ${position.toLocaleString('en-US')}, which is past the end of ${size.toLocaleString('en-US')} bytes. Use a number from 0 to ${(size - 1).toLocaleString('en-US')}.`,
      { field: 'Go to byte' },
    );
  }
  return { start: position, end: Math.min(size, position + rows * bytesPerRow) };
}

/** Folds the letters A to Z to a to z in place, from `from` on, and leaves every other byte alone. */
function foldAscii(bytes: Uint8Array, from = 0): Uint8Array {
  for (let i = from; i < bytes.length; i++) {
    const value = bytes[i]!;
    if (value >= 0x41 && value <= 0x5a) bytes[i] = value | 0x20;
  }
  return bytes;
}

export interface SearchResult {
  /** The offset of each match, in order, at most `MAX_LISTED_MATCHES` of them. */
  offsets: number[];
  /** Every match in the file, listed or not. Matches may overlap. */
  total: number;
}

/**
 * Finds `needle` in the bytes that `chunks` yield, one chunk at a time, so the whole file is never held. The last
 * `needle.length - 1` bytes of each chunk are kept and put in front of the next, so a match that straddles two chunks is
 * found once and a match is never found twice. With `matchCase` false the letters A to Z match either case and no other
 * byte is folded. Every match is counted, the first `MAX_LISTED_MATCHES` offsets are listed.
 */
export async function searchChunks(
  chunks: AsyncIterable<Uint8Array>,
  needle: Uint8Array,
  options: { matchCase: boolean },
): Promise<SearchResult> {
  if (needle.length === 0) {
    throw new HexViewerError('Search for needs at least one byte.', { field: 'Search for' });
  }
  if (needle.length > MAX_NEEDLE_BYTES) {
    throw new HexViewerError(
      `Search for is ${sizeWords(needle.length)}. The limit is ${formatSize(MAX_NEEDLE_BYTES)} because a longer term is not a useful search.`,
      { field: 'Search for' },
    );
  }
  const fold = !options.matchCase;
  const target = fold ? foldAscii(needle.slice()) : needle;
  const first = target[0]!;
  const offsets: number[] = [];
  let total = 0;
  let carry: Uint8Array = new Uint8Array(0);
  let consumed = 0;
  for await (const chunk of chunks) {
    if (chunk.length === 0) continue;
    let buffer: Uint8Array;
    if (carry.length === 0) {
      buffer = fold ? foldAscii(chunk.slice()) : chunk;
    } else {
      buffer = new Uint8Array(carry.length + chunk.length);
      buffer.set(carry);
      buffer.set(chunk, carry.length);
      // The carried bytes were folded when they were first read.
      if (fold) foldAscii(buffer, carry.length);
    }
    const base = consumed - carry.length;
    const last = buffer.length - target.length;
    let from = 0;
    while (from <= last) {
      const at = buffer.indexOf(first, from);
      if (at === -1 || at > last) break;
      let k = 1;
      while (k < target.length && buffer[at + k] === target[k]) k++;
      if (k === target.length) {
        total++;
        if (offsets.length < MAX_LISTED_MATCHES) offsets.push(base + at);
      }
      from = at + 1;
    }
    consumed += chunk.length;
    const keep = Math.min(target.length - 1, buffer.length);
    carry = keep > 0 ? buffer.slice(buffer.length - keep) : new Uint8Array(0);
  }
  return { offsets, total };
}

export interface FileKind {
  /** What the signature suggests the file is. */
  name: string;
  /** The bytes that were found, and where. */
  evidence: string;
  /** The address of the specification that states the signature; empty when no format matched. */
  spec: string;
}

const hexUpper = (value: number): string => value.toString(16).padStart(2, '0').toUpperCase();

const isPrintable = (value: number): boolean => value >= 0x20 && value <= 0x7e;

function partMatches(part: SignaturePart, head: Uint8Array, tail: Uint8Array): boolean {
  const { bytes, offset } = part;
  if (part.fromEnd) {
    const begin = tail.length - offset - bytes.length;
    if (begin < 0) return false;
    return bytes.every((value, i) => tail[begin + i] === value);
  }
  if (offset + bytes.length > head.length) return false;
  return bytes.every((value, i) => head[offset + i] === value);
}

/** The shortest file a signature can be in: its parts from the start and from the end must not overlap. */
function minimumSize(signature: Signature): number {
  let fromStart = 0;
  let fromEnd = 0;
  for (const part of signature.parts) {
    if (part.fromEnd) fromEnd = Math.max(fromEnd, part.offset + part.bytes.length);
    else fromStart = Math.max(fromStart, part.offset + part.bytes.length);
  }
  return fromStart + fromEnd;
}

/** RFC 1950: CM is 8, CINFO is at most 7, and CMF and FLG read as a 16 bit number are a multiple of 31. */
function zlibHeader(head: Uint8Array): { windowBytes: number } | null {
  if (head.length < 2) return null;
  const cmf = head[0]!;
  const flg = head[1]!;
  if ((cmf & 0x0f) !== 8 || cmf >> 4 > 7 || (cmf * 256 + flg) % 31 !== 0) return null;
  return { windowBytes: 2 ** ((cmf >> 4) + 8) };
}

function describePart(part: SignaturePart): string {
  const bytes = part.bytes.map(hexUpper).join(' ');
  const text =
    part.bytes.length >= 2 && part.bytes.every(isPrintable) ? ` ("${String.fromCharCode(...part.bytes)}")` : '';
  return part.fromEnd
    ? `${bytes}${text} ${part.offset === 0 ? 'as the last bytes' : `ending ${part.offset} bytes before the end`}`
    : `${bytes}${text} at offset ${part.offset}`;
}

const WEAK_NOTE = ' This is a short signature, so many other files can match it.';

function evidenceOf(signature: Signature, head: Uint8Array): string {
  if (signature.rule === 'zlib-header') {
    const header = zlibHeader(head)!;
    return `Found ${hexUpper(head[0]!)} ${hexUpper(head[1]!)} at offset 0, which passes the zlib header check: compression method 8, a window of ${header.windowBytes} bytes, and the two bytes read as a number are a multiple of 31.${WEAK_NOTE}`;
  }
  let evidence = `Found ${signature.parts.map(describePart).join(' and ')}.`;
  if (signature.detail === 'iso-brand' && head.length >= 12 && head.subarray(8, 12).every(isPrintable)) {
    evidence += ` The major brand is "${String.fromCharCode(...head.subarray(8, 12))}".`;
  }
  if (signature.weak) evidence += WEAK_NOTE;
  return evidence;
}

function matches(signature: Signature, head: Uint8Array, tail: Uint8Array, size: number): boolean {
  if (size < minimumSize(signature)) return false;
  if (signature.rule === 'zlib-header') return zlibHeader(head) !== null;
  return signature.parts.every((part) => partMatches(part, head, tail));
}

const ZIP_NAME = 'ZIP archive';
const ZIP_EMPTY_NAME = 'ZIP archive (empty)';
const FAT_NAME = 'Mach-O universal (fat) binary';
const JAVA_NAME = 'Java class file';

const u16le = (bytes: Uint8Array, at: number): number => bytes[at]! | (bytes[at + 1]! << 8);
const u16be = (bytes: Uint8Array, at: number): number => (bytes[at]! << 8) | bytes[at + 1]!;

const ZIP_ALSO = 'ZIP is also the container of XLSX, DOCX, JAR, EPUB, APK and OpenDocument files.';

/**
 * Names a ZIP archive by its first entry. The local file header is 30 bytes (APPNOTE 4.3.7): the name length is the 2
 * bytes at offset 26, the extra field length the 2 bytes at offset 28, and the name follows the header. An entry name that
 * is not in the bytes read, or is not printable ASCII, leaves a plain ZIP archive. For a stored `mimetype` entry the
 * media type it holds is read too, because an EPUB book has to hold application/epub+zip there.
 */
function refineZip(signature: Signature, head: Uint8Array): FileKind {
  const found = describePart(signature.parts[0]!);
  const base = { spec: signature.spec };
  const nameLength = head.length >= 30 ? u16le(head, 26) : -1;
  const nameBytes = nameLength > 0 && head.length >= 30 + nameLength ? head.subarray(30, 30 + nameLength) : null;
  if (nameBytes === null || !nameBytes.every(isPrintable)) {
    return {
      ...base,
      name: ZIP_NAME,
      evidence: `Found ${found}. The name of the first entry is not in the bytes read. ${ZIP_ALSO}`,
    };
  }
  const entry = String.fromCharCode(...nameBytes);
  const quoted = `The first entry is named "${entry}"`;
  if (entry === '[Content_Types].xml') {
    return {
      ...base,
      name: `${ZIP_NAME}, possibly an Office Open XML file (XLSX, DOCX or PPTX)`,
      evidence: `Found ${found}. ${quoted}, the name an Office Open XML package gives its list of content types.`,
    };
  }
  if (entry === 'META-INF/MANIFEST.MF') {
    return {
      ...base,
      name: `${ZIP_NAME}, possibly a Java archive (JAR)`,
      evidence: `Found ${found}. ${quoted}, the name of a Java archive's manifest.`,
    };
  }
  if (entry === 'mimetype') {
    const flags = u16le(head, 6);
    const method = u16le(head, 8);
    const storedSize = u16le(head, 18) | (u16le(head, 20) << 16);
    const dataAt = 30 + nameLength + u16le(head, 28);
    let media = '';
    if (
      method === 0 &&
      (flags & 8) === 0 &&
      storedSize > 0 &&
      storedSize <= 100 &&
      dataAt + storedSize <= head.length
    ) {
      const content = head.subarray(dataAt, dataAt + storedSize);
      if (content.every(isPrintable)) media = String.fromCharCode(...content);
    }
    const epub = media === 'application/epub+zip';
    return {
      ...base,
      name: `${ZIP_NAME}, possibly an EPUB book${epub ? '' : ' or an OpenDocument file'}`,
      evidence: `Found ${found}. ${quoted}${media ? ` and holds "${media}"` : ''}; EPUB and OpenDocument both put a stored mimetype entry first.`,
    };
  }
  return { ...base, name: ZIP_NAME, evidence: `Found ${found}. ${quoted}. ${ZIP_ALSO}` };
}

/**
 * CA FE BA BE starts both a Mach-O universal (fat) file, where four more bytes say how many architectures follow, and a
 * Java class file, where two bytes give the minor version and two the major version, 45 or more (JVMS Table 4.1-A). A
 * count of 1 to 30 is a fat file; a major version of 45 or more is a class file; otherwise, or when the head is too
 * short to say, both names are returned.
 */
function cafebabe(head: Uint8Array, signatures: { fat: Signature; java: Signature }): FileKind[] {
  const { fat, java } = signatures;
  const bytesFound = `Found ${describePart(fat.parts[0]!)}`;
  const fatKind = (evidence: string): FileKind => ({ name: FAT_NAME, evidence, spec: fat.spec });
  const javaKind = (evidence: string): FileKind => ({ name: JAVA_NAME, evidence, spec: java.spec });
  if (head.length >= 8) {
    const minor = u16be(head, 4);
    const major = u16be(head, 6);
    if (minor === 0 && major >= 1 && major <= 30) {
      return [
        fatKind(
          `${bytesFound}. The next four bytes say ${major} ${major === 1 ? 'architecture follows' : 'architectures follow'}, as in a universal binary.`,
        ),
      ];
    }
    if (major >= 45) {
      return [
        javaKind(
          `${bytesFound}. The next four bytes give class file version ${major}.${minor}: major version ${major}, minor version ${minor}.`,
        ),
      ];
    }
  }
  const unsure = `${bytesFound}. The next four bytes do not tell the two formats apart.`;
  return [fatKind(unsure), javaKind(unsure)];
}

/**
 * Names what a file's signature bytes suggest it is. `head` is the first 512 bytes of the file (or all of it when it is
 * shorter), `tail` its last 22 bytes (or all of it) and `size` its length in bytes. Every name the bytes fit is returned
 * with the evidence and the specification address; a ZIP archive is named by the family its first entry suggests. A
 * signature is a hint, not a check of the whole file.
 */
export function identifyFile(head: Uint8Array, tail: Uint8Array, size: number): FileKind[] {
  if (size === 0) return [{ name: 'empty file', evidence: 'The file has 0 bytes.', spec: '' }];
  const found: FileKind[] = [];
  const fat = SIGNATURES.find((signature) => signature.name === FAT_NAME)!;
  const java = SIGNATURES.find((signature) => signature.name === JAVA_NAME)!;
  let cafebabeDone = false;
  let zipFound = false;
  for (const signature of SIGNATURES) {
    if (!matches(signature, head, tail, size)) continue;
    if (signature.name === FAT_NAME || signature.name === JAVA_NAME) {
      if (!cafebabeDone) found.push(...cafebabe(head, { fat, java }));
      cafebabeDone = true;
    } else if (signature.name === ZIP_NAME) {
      zipFound = true;
      found.push(refineZip(signature, head));
    } else {
      if (signature.name === ZIP_EMPTY_NAME) zipFound = true;
      found.push({ name: signature.name, evidence: evidenceOf(signature, head), spec: signature.spec });
    }
  }
  // A file that does not begin with a ZIP header can still end with the record that closes a ZIP archive.
  const zip = SIGNATURES.find((signature) => signature.name === ZIP_NAME)!;
  if (!zipFound && size >= 22 && tail.length >= 22 && [0x50, 0x4b, 0x05, 0x06].every((value, i) => tail[i] === value)) {
    found.push({
      name: ZIP_NAME,
      evidence: `Found 50 4B 05 06 at the start of the last 22 bytes, the record that ends a ZIP archive, but the file does not begin with a ZIP header (it may begin with other data, such as a self-extracting program). ${ZIP_ALSO}`,
      spec: zip.spec,
    });
  }
  if (found.length === 0) {
    return [
      {
        name: 'unknown',
        evidence: 'No signature in the table matches the bytes at the start or end of the file.',
        spec: '',
      },
    ];
  }
  return found;
}

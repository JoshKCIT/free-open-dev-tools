/**
 * A repo-owned media-type signature table (D-08): roughly thirty to forty
 * common formats detected from their own leading bytes, so a data URI's
 * media type comes from what the file actually is rather than from a file
 * extension that can lie. No dependency is added for this -- it is exactly
 * the "straightforward, testable, avoids a supply chain entry" category
 * docs/ARCHITECTURE.md lines 105-110 names.
 *
 * Every byte pattern below was checked, not recalled, against a source
 * fetched while this file was written:
 *
 *  - PNG (the 8-byte signature): W3C PNG spec, section "5 PNG file
 *    signature", https://www.w3.org/TR/png/#5PNG-file-signature
 *  - gzip (1F 8B): RFC 1952 section 2.3.1,
 *    https://www.rfc-editor.org/rfc/rfc1952
 *  - EBML / Matroska / WebM (1A 45 DF A3, the EBML root element id): RFC
 *    8794 section 11.2.1 and section 17.1's registry table,
 *    https://www.rfc-editor.org/rfc/rfc8794
 *  - EPUB's ZIP-based "mimetype" convention -- offset 0 the ZIP local file
 *    header, offset 30 the literal filename "mimetype", offset 38 the media
 *    type string itself, all stored uncompressed by the format's own rule:
 *    W3C EPUB 3.3, "Core Media Types" appendix, magic-number entry for
 *    application/epub+zip, https://www.w3.org/TR/epub-33/
 *  - PDF, ZIP, RAR (both marker generations), 7-Zip, XZ, tar/ustar, WOFF,
 *    WOFF2, TrueType/OpenType, ID3v2-tagged MP3, BMP, GIF87a/GIF89a, ICO,
 *    TIFF (little- and big-endian), the RIFF-based container family (WebP,
 *    WAVE, AVI) and the ISO-BMFF "ftyp" brand box used by MP4: Wikipedia,
 *    "List of file signatures",
 *    https://en.wikipedia.org/wiki/List_of_file_signatures -- a tertiary
 *    source, used here only for values that are themselves published magic
 *    numbers (the format owners' own spec numbers), not anything original
 *    to that page.
 *  - JPEG's shared FF D8 FF prefix, common to the JFIF, Exif and raw
 *    variants: the same Wikipedia page, cross-checked against the fact that
 *    all three of its own listed JPEG variants share that three-byte lead.
 *
 * `<svg` is a heuristic, not a numbered standard's byte pattern: an SVG
 * document that opens with an XML declaration (`<?xml version="1.0"?>`)
 * instead of a bare `<svg` root element is not caught by it and falls
 * through to the plain-text heuristic below, or to the browser-reported
 * type. That gap is recorded in `limits`, not silently assumed away.
 */
import meta from './meta.json';

export { meta };

export interface Signature {
  mediaType: string;
  label: string;
  /** Byte values (0-255), in order, checked at `offset`. */
  pattern: number[];
  /** Offset into the input the pattern is checked at. */
  offset: number;
  /** Filename extensions this format is normally saved with. At least one. */
  extensions: string[];
  /**
   * Per-byte mask, same length as `pattern`. `false` at index i means the
   * byte at that position is a wildcard -- any value matches. Absent means
   * every byte is fixed, which is the common case. Only a container
   * "brand" needs this (ISO-BMFF's `ftyp` box: bytes 4-7 are the literal
   * string "ftyp", bytes 8-11 are a four-character brand that varies by
   * format).
   */
  mask?: boolean[];
  /**
   * Marks a match that is also satisfied by many specific formats built on
   * top of it (a ZIP-based document format; an unrecognised ISO-BMFF
   * brand). Returned like any other match, but flagged so a caller can
   * prefer a more specific sniff, or a specific browser-reported type,
   * over it rather than reporting the generic container as if it were the
   * final answer.
   */
  generic?: boolean;
}

function ascii(s: string): number[] {
  return Array.from(s, (ch) => ch.charCodeAt(0));
}

export const SIGNATURES: Signature[] = [
  // --- Images ---
  {
    mediaType: 'image/png',
    label: 'PNG image',
    offset: 0,
    pattern: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    extensions: ['png'],
  },
  {
    mediaType: 'image/jpeg',
    label: 'JPEG image',
    offset: 0,
    pattern: [0xff, 0xd8, 0xff],
    extensions: ['jpg', 'jpeg'],
  },
  { mediaType: 'image/gif', label: 'GIF image (GIF87a)', offset: 0, pattern: ascii('GIF87a'), extensions: ['gif'] },
  { mediaType: 'image/gif', label: 'GIF image (GIF89a)', offset: 0, pattern: ascii('GIF89a'), extensions: ['gif'] },
  { mediaType: 'image/bmp', label: 'BMP image', offset: 0, pattern: ascii('BM'), extensions: ['bmp', 'dib'] },
  {
    mediaType: 'image/x-icon',
    label: 'Windows icon',
    offset: 0,
    pattern: [0x00, 0x00, 0x01, 0x00],
    extensions: ['ico'],
  },
  {
    mediaType: 'image/tiff',
    label: 'TIFF image (little-endian)',
    offset: 0,
    pattern: [0x49, 0x49, 0x2a, 0x00],
    extensions: ['tif', 'tiff'],
  },
  {
    mediaType: 'image/tiff',
    label: 'TIFF image (big-endian)',
    offset: 0,
    pattern: [0x4d, 0x4d, 0x00, 0x2a],
    extensions: ['tif', 'tiff'],
  },
  { mediaType: 'image/webp', label: 'WebP image', offset: 8, pattern: ascii('WEBP'), extensions: ['webp'] },
  {
    mediaType: 'image/svg+xml',
    label: 'SVG image',
    offset: 0,
    pattern: ascii('<svg'),
    extensions: ['svg'],
  },

  // --- Fonts ---
  { mediaType: 'font/ttf', label: 'TrueType font', offset: 0, pattern: [0x00, 0x01, 0x00, 0x00], extensions: ['ttf'] },
  { mediaType: 'font/otf', label: 'OpenType font', offset: 0, pattern: ascii('OTTO'), extensions: ['otf'] },
  { mediaType: 'font/woff', label: 'WOFF font', offset: 0, pattern: ascii('wOFF'), extensions: ['woff'] },
  { mediaType: 'font/woff2', label: 'WOFF2 font', offset: 0, pattern: ascii('wOF2'), extensions: ['woff2'] },

  // --- Audio ---
  {
    mediaType: 'audio/mpeg',
    label: 'MP3 audio (ID3v2 tag)',
    offset: 0,
    pattern: ascii('ID3'),
    extensions: ['mp3'],
  },
  { mediaType: 'audio/wav', label: 'WAV audio', offset: 8, pattern: ascii('WAVE'), extensions: ['wav'] },
  {
    mediaType: 'audio/ogg',
    label: 'Ogg container',
    offset: 0,
    pattern: ascii('OggS'),
    extensions: ['ogg', 'oga', 'ogv'],
  },
  { mediaType: 'audio/flac', label: 'FLAC audio', offset: 0, pattern: ascii('fLaC'), extensions: ['flac'] },

  // --- Video ---
  {
    mediaType: 'video/webm',
    label: 'WebM / Matroska container',
    offset: 0,
    pattern: [0x1a, 0x45, 0xdf, 0xa3],
    extensions: ['webm', 'mkv'],
  },
  { mediaType: 'video/x-msvideo', label: 'AVI video', offset: 8, pattern: ascii('AVI '), extensions: ['avi'] },
  {
    // The "ftyp" box's first four bytes are always literal; its next four
    // are a "major brand" that varies by format (isom, mp42, M4A , qt  ,
    // heic, avif, ...). Masked here so ANY brand is caught as a fallback,
    // then marked generic so a specific brand entry below -- or the
    // caller's own browser-reported type -- outranks it.
    mediaType: 'video/mp4',
    label: 'MPEG-4 / ISO base media container (brand not recognised)',
    offset: 4,
    pattern: [...ascii('ftyp'), 0, 0, 0, 0],
    mask: [true, true, true, true, false, false, false, false],
    extensions: ['mp4', 'm4a', 'm4v', 'mov'],
    generic: true,
  },
  {
    // Same offset and pattern length as the generic entry above, but every
    // byte fixed: this is the "equal-length masked matches" case D-08's
    // matching order resolves by fixed-byte count, and the test that
    // motivated it lives in signatures.test.ts.
    mediaType: 'video/mp4',
    label: 'MPEG-4 video (ISO Base Media, "isom" brand)',
    offset: 4,
    pattern: ascii('ftypisom'),
    extensions: ['mp4'],
  },

  // --- Documents ---
  { mediaType: 'application/pdf', label: 'PDF document', offset: 0, pattern: ascii('%PDF-'), extensions: ['pdf'] },

  // --- Archives ---
  {
    // Matches every ZIP-based format (a plain archive, but also every
    // Office/OpenDocument/EPUB/JAR file). Marked generic so the more
    // specific EPUB entry below -- which reaches further into the file --
    // wins for the files it actually applies to.
    mediaType: 'application/zip',
    label: 'ZIP archive',
    offset: 0,
    pattern: [0x50, 0x4b, 0x03, 0x04],
    extensions: ['zip'],
    generic: true,
  },
  {
    // EPUB's own container rule requires "mimetype" to be the first entry
    // in the ZIP, stored uncompressed, with content "application/epub+zip"
    // -- which puts that exact string at a fixed offset. Its 29-byte
    // pattern is longer than ZIP's 4-byte one, so plain longest-wins
    // already resolves this without needing the generic flag at all; the
    // flag on the ZIP entry above is what stops OTHER zip-based formats
    // (which have no matching entry here) from also outranking it.
    mediaType: 'application/epub+zip',
    label: 'EPUB e-book (ZIP-based, resolved via its "mimetype" entry)',
    offset: 30,
    pattern: ascii('mimetypeapplication/epub+zip'),
    extensions: ['epub'],
  },
  { mediaType: 'application/gzip', label: 'gzip archive', offset: 0, pattern: [0x1f, 0x8b], extensions: ['gz'] },
  {
    mediaType: 'application/x-7z-compressed',
    label: '7-Zip archive',
    offset: 0,
    pattern: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c],
    extensions: ['7z'],
  },
  {
    mediaType: 'application/vnd.rar',
    label: 'RAR archive (v1.5 - v4)',
    offset: 0,
    pattern: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00],
    extensions: ['rar'],
  },
  {
    mediaType: 'application/vnd.rar',
    label: 'RAR archive (v5)',
    offset: 0,
    pattern: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00],
    extensions: ['rar'],
  },
  { mediaType: 'application/x-bzip2', label: 'bzip2 archive', offset: 0, pattern: ascii('BZh'), extensions: ['bz2'] },
  {
    mediaType: 'application/x-xz',
    label: 'XZ archive',
    offset: 0,
    pattern: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00],
    extensions: ['xz'],
  },
  {
    // The ustar header field starts at byte offset 257 in every tar
    // record; "ustar" is a five-byte prefix shared by the POSIX form
    // ("ustar\0" + "00") and the GNU form ("ustar  \0").
    mediaType: 'application/x-tar',
    label: 'tar archive (ustar)',
    offset: 257,
    pattern: ascii('ustar'),
    extensions: ['tar'],
  },

  // --- Plain text carrying a byte order mark ---
  {
    mediaType: 'text/plain;charset=utf-8',
    label: 'UTF-8 text (byte order mark)',
    offset: 0,
    pattern: [0xef, 0xbb, 0xbf],
    extensions: ['txt'],
  },
  {
    mediaType: 'text/plain;charset=utf-16le',
    label: 'UTF-16LE text (byte order mark)',
    offset: 0,
    pattern: [0xff, 0xfe],
    extensions: ['txt'],
  },
  {
    mediaType: 'text/plain;charset=utf-16be',
    label: 'UTF-16BE text (byte order mark)',
    offset: 0,
    pattern: [0xfe, 0xff],
    extensions: ['txt'],
  },
];

export interface SniffResult {
  mediaType: string;
  label: string;
  extensions: string[];
  /** True when this match is a generic container rather than a specific format. */
  generic: boolean;
}

/**
 * Sniffs a media type from the leading bytes of `bytes`.
 *
 * Matching order, applied by sorting every signature whose pattern actually
 * matches: the longest pattern wins first (a longer pattern is always at
 * least as specific as a shorter one that happens to also match); for two
 * matches of equal pattern length, the one with more fixed (unmasked)
 * bytes wins, because it is the more specific of the two; if that is still
 * tied, the entry earlier in {@link SIGNATURES} wins, which is why the
 * table's own order is part of this function's contract, not an
 * implementation detail.
 *
 * Returns `undefined` for an empty array, for an array shorter than every
 * candidate pattern, and for an array matching no pattern at all -- in
 * every one of those cases the caller is expected to fall back to
 * something else, which {@link detectMediaType} below does.
 */
export function sniffMediaType(bytes: Uint8Array): SniffResult | undefined {
  if (bytes.length === 0) return undefined;

  let best: Signature | undefined;
  let bestFixedCount = -1;

  for (const sig of SIGNATURES) {
    const end = sig.offset + sig.pattern.length;
    if (bytes.length < end) continue; // never read past the end of a short array

    let matched = true;
    let fixedCount = 0;
    for (let i = 0; i < sig.pattern.length; i++) {
      const isWildcard = sig.mask !== undefined && sig.mask[i] === false;
      if (isWildcard) continue;
      fixedCount++;
      if (bytes[sig.offset + i] !== sig.pattern[i]) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;

    if (
      best === undefined ||
      sig.pattern.length > best.pattern.length ||
      (sig.pattern.length === best.pattern.length && fixedCount > bestFixedCount)
      // Equal length AND equal fixed count: keep whichever was found
      // first, which is table order because SIGNATURES is walked in
      // order and `best` is only replaced by a strictly better match.
    ) {
      best = sig;
      bestFixedCount = fixedCount;
    }
  }

  if (!best) return undefined;
  return { mediaType: best.mediaType, label: best.label, extensions: best.extensions, generic: best.generic ?? false };
}

/**
 * A byte array with no null byte and no control character outside the
 * ordinary whitespace set (tab, LF, CR), decodable as valid text under
 * UTF-8, is treated as plain text. This is a heuristic over the bytes
 * themselves, kept in its own named function and deliberately NOT a
 * {@link SIGNATURES} entry, because plain text has no fixed leading byte
 * pattern to match against.
 */
export function looksLikePlainText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  for (const b of bytes) {
    if (b === 0x00) return false;
    if (b === 0x7f) return false;
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) return false;
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export type MediaTypeSource = 'signature' | 'browser-reported' | 'generic-signature' | 'unknown';

export interface MediaTypeDecision {
  mediaType: string;
  source: MediaTypeSource;
  /** The signature's own label, when a signature (specific or generic) produced the answer. */
  label?: string;
}

/**
 * Combines a byte-pattern sniff with the browser's own reported type. This
 * is the three-tier half of the full precedence rule this tool documents; a
 * visitor's explicit manual override, layered on top by the caller, is the
 * fourth and highest tier and does not belong in this file, which knows
 * nothing about page-level input.
 *
 * Order, highest first:
 *   1. A SPECIFIC signature match (`generic` false or absent) -- the bytes
 *      themselves said so, unambiguously.
 *   2. The browser's reported type, when it supplied one -- treated as
 *      more trustworthy than a signature that only matched a generic
 *      container, because a generic match on its own is an admission that
 *      this table could not tell which specific format it is looking at.
 *   3. A GENERIC signature match, when the browser supplied nothing at
 *      all -- better than nothing, worse than either of the above.
 *   4. `application/octet-stream`, marked `unknown`, when neither this
 *      table nor the browser produced anything.
 */
export function detectMediaType(bytes: Uint8Array, browserReportedType: string): MediaTypeDecision {
  const sniffed = sniffMediaType(bytes);

  if (sniffed && !sniffed.generic) {
    return { mediaType: sniffed.mediaType, source: 'signature', label: sniffed.label };
  }
  if (browserReportedType) {
    return { mediaType: browserReportedType, source: 'browser-reported' };
  }
  if (sniffed) {
    return { mediaType: sniffed.mediaType, source: 'generic-signature', label: sniffed.label };
  }
  return { mediaType: 'application/octet-stream', source: 'unknown' };
}

/**
 * What every module of this folder shares and what the removal worker may import without pulling PDF.js in: the one
 * error class, the limits, and the escaping of text that came from a file. This file imports nothing.
 */

/** Why a file was refused, so a caller can branch on it. */
export type PdfToolErrorKind = 'size' | 'not-pdf' | 'password' | 'encrypted' | 'damaged' | 'not-clean';

/** The plain sentence for each refusal. None of them holds a file name, a byte or any text that came from a file. */
export const PDF_MESSAGES: Record<PdfToolErrorKind, string> = {
  size: 'This file is larger than 100 MB, the most this page accepts.',
  'not-pdf': 'This is not a PDF file.',
  password: 'This PDF needs a password, which this page cannot use.',
  encrypted: 'This PDF is encrypted, so no copy is made: rewriting it would drop its protection.',
  damaged: 'This PDF could not be read. It may be damaged.',
  'not-clean': 'The copy still held metadata after removal, so it is not offered.',
};

export class PdfToolError extends Error {
  readonly kind: PdfToolErrorKind;
  constructor(kind: PdfToolErrorKind, message: string = PDF_MESSAGES[kind]) {
    super(message);
    this.name = 'PdfToolError';
    this.kind = kind;
  }
}

/** 100 MB, checked from the file's own reported size before anything is read. */
export const MAX_PDF_BYTES = 100 * 1024 * 1024;

/** Text is read from at most this many pages in one run. */
export const MAX_TEXT_PAGES = 500;

/** Text is read up to this many characters in one run. */
export const MAX_TEXT_CHARS = 2_000_000;

/** Every metadata value shown is cut at this many characters. */
export const MAX_VALUE_CHARS = 1000;

/** At most this many custom keys and this many XMP properties are listed. */
export const MAX_ROWS = 200;

const BACKSLASH = String.fromCharCode(92);

/** True for the code units `visible` escapes: controls other than tab and line feed, direction marks and invisible format characters. */
function isEscaped(unit: number): boolean {
  if (unit <= 0x1f) return unit !== 0x09 && unit !== 0x0a;
  if (unit >= 0x7f && unit <= 0x9f) return true;
  // The soft hyphen, the Arabic letter mark, the line and paragraph separators and the byte order mark.
  if (unit === 0xad || unit === 0x61c || unit === 0x2028 || unit === 0x2029 || unit === 0xfeff) return true;
  // The zero width marks and the direction marks LRM and RLM.
  if (unit >= 0x200b && unit <= 0x200f) return true;
  if (unit >= 0x202a && unit <= 0x202e) return true;
  // The word joiner and the invisible operators, then the direction isolates.
  if (unit >= 0x2060 && unit <= 0x2064) return true;
  return unit >= 0x2066 && unit <= 0x2069;
}

/**
 * The text with U+0000 to U+001F (except tab and line feed), U+007F, U+0080 to U+009F, U+00AD, U+061C, U+200B to U+200F,
 * U+2028, U+2029, U+202A to U+202E, U+2060 to U+2064, U+2066 to U+2069, U+FEFF and the tag characters U+E0000 to U+E007F
 * written as the backslash, `u{`, the code point in capital hexadecimal and `}`, so text read from a file cannot move the cursor,
 * hide text, hide a message in characters that draw nothing or reorder what a reader sees. One pass, linear in the text.
 */
export function visible(text: string): string {
  let out = '';
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    let codePoint = -1;
    let width = 1;
    if (unit === 0xdb40) {
      // A tag character is a surrogate pair: U+DB40 then U+DC00 to U+DC7F stand for U+E0000 to U+E007F.
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdc7f) {
        codePoint = 0xe0000 + (low - 0xdc00);
        width = 2;
      }
    } else if (isEscaped(unit)) {
      codePoint = unit;
    }
    if (codePoint < 0) continue;
    out += text.slice(from, i) + BACKSLASH + 'u{' + codePoint.toString(16).toUpperCase() + '}';
    i += width - 1;
    from = i + 1;
  }
  return out + text.slice(from);
}

/** The first `limit` characters of the text, never ending in the first half of a surrogate pair. */
export function head(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const last = text.charCodeAt(limit - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? limit - 1 : limit;
  return text.slice(0, end);
}

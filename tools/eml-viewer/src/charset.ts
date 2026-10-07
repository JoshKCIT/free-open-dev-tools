import { MAX_TEXT_BODY_SHOWN } from './limits';

/** The text of some bytes in a named character set, and whether the set was one this page can read. */
export interface DecodedText {
  text: string;
  /** The label as the message wrote it, trimmed, with any quotes and language suffix removed. */
  label: string;
  /** False when the label is not one the browser's decoder reads: the text is then the bytes, escaped. */
  known: boolean;
  /** True when escaped text was cut at the display limit. */
  cut: boolean;
}

const BACKSLASH = String.fromCharCode(92);

/**
 * What the WHATWG windows-1252 table puts at the bytes 0x80 to 0x9F, as code points, in byte order. Browsers give these
 * from the decoder; some runtimes hand back the control character with the same number instead (the ISO 8859-1 reading),
 * so the characters in that range are mapped here and the result is the same everywhere. The five bytes the table leaves
 * undefined (0x81, 0x8D, 0x8F, 0x90, 0x9D) map to the control character with their own number, as the table says.
 */
const WINDOWS_1252_HIGH: readonly number[] = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d,
  0x017d, 0x008f, 0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x009d, 0x017e, 0x0178,
];

function mapWindows1252(text: string): string {
  let out = '';
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x80 && code <= 0x9f) {
      const mapped = WINDOWS_1252_HIGH[code - 0x80] ?? code;
      if (mapped !== code) {
        out += text.slice(from, i) + String.fromCharCode(mapped);
        from = i + 1;
      }
    }
  }
  return from === 0 ? text : out + text.slice(from);
}

/** The label as written, without quotes, spaces or an RFC 2231 language suffix. */
export function cleanLabel(label: string): string {
  let text = label.trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1).trim();
  const star = text.indexOf('*');
  if (star !== -1) text = text.slice(0, star);
  return text;
}

/**
 * Bytes written so they can be shown without being read as any character set: printable ASCII as itself, tab and line
 * ends as themselves, a backslash doubled, every other byte as backslash, x and two hexadecimal digits.
 */
export function escapeBytes(bytes: Uint8Array, limit: number = MAX_TEXT_BODY_SHOWN): { text: string; cut: boolean } {
  const end = Math.min(bytes.length, limit);
  const parts: string[] = [];
  let run = '';
  for (let i = 0; i < end; i++) {
    const byte = bytes[i] ?? 0;
    if (byte === 0x5c) run += BACKSLASH + BACKSLASH;
    else if ((byte >= 0x20 && byte <= 0x7e) || byte === 0x09 || byte === 0x0a || byte === 0x0d)
      run += String.fromCharCode(byte);
    else run += BACKSLASH + 'x' + (byte < 16 ? '0' : '') + byte.toString(16).toUpperCase();
    if (run.length > 4096) {
      parts.push(run);
      run = '';
    }
  }
  parts.push(run);
  return { text: parts.join(''), cut: bytes.length > limit };
}

/**
 * Reads bytes in a named character set with the browser's decoder (the WHATWG labels). The labels us-ascii and
 * iso-8859-1 are windows-1252 there, as browsers read them. A label the decoder rejects (utf-7, x-unknown) and the
 * labels it maps to its no-output set (hz-gb-2312, iso-2022-kr) give the bytes, escaped, with the label named by the
 * caller. An empty label is the RFC 2045 default, us-ascii.
 */
export function decodeBytes(bytes: Uint8Array, label: string, escapeLimit: number = MAX_TEXT_BODY_SHOWN): DecodedText {
  const cleaned = cleanLabel(label);
  const wanted = cleaned === '' ? 'us-ascii' : cleaned;
  try {
    const decoder = new TextDecoder(wanted, { fatal: false });
    if (decoder.encoding !== 'replacement') {
      const text = decoder.decode(bytes);
      return {
        text: decoder.encoding === 'windows-1252' ? mapWindows1252(text) : text,
        label: cleaned,
        known: true,
        cut: false,
      };
    }
  } catch {
    // A RangeError for a label the decoder does not know: fall through to the escaped form.
  }
  const escaped = escapeBytes(bytes, escapeLimit);
  return { text: escaped.text, label: cleaned, known: false, cut: escaped.cut };
}

const UTF8_STRICT = new TextDecoder('utf-8', { fatal: true });
const LATIN = new TextDecoder('windows-1252', { fatal: false });

/**
 * Header text from raw bytes: UTF-8 when the bytes are valid UTF-8 (RFC 6532 and every ASCII header), otherwise
 * windows-1252 so no byte is lost.
 */
export function decodeHeaderBytes(bytes: Uint8Array): string {
  try {
    return UTF8_STRICT.decode(bytes);
  } catch {
    return LATIN.decode(bytes);
  }
}

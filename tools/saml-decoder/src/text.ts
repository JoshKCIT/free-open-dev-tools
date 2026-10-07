import { SamlDecoderError } from './errors';

export type XmlEncoding = 'UTF-8' | 'UTF-16LE' | 'UTF-16BE';

export interface DecodedText {
  text: string;
  encoding: XmlEncoding;
  /** True when a byte order mark was read and removed. */
  marked: boolean;
}

const NOT_TEXT_MESSAGE = 'The message is not valid UTF-8 or UTF-16 text, so it was not read.';
const UTF32_MESSAGE = 'The message looks like UTF-32 text, which is not read. Save it as UTF-8 or UTF-16.';

/** True when the first bytes are a UTF-32 byte order mark or an ASCII less-than sign padded to four bytes. */
function looksLikeUtf32(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const [a, b, c, d] = [bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!];
  if (a === 0x00 && b === 0x00 && c === 0xfe && d === 0xff) return true;
  if (a === 0xff && b === 0xfe && c === 0x00 && d === 0x00) return true;
  if (a === 0x3c && b === 0x00 && c === 0x00 && d === 0x00) return true;
  return a === 0x00 && b === 0x00 && c === 0x00 && d === 0x3c;
}

function decodeUtf16(bytes: Uint8Array, bigEndian: boolean): string {
  let data = bytes;
  if (data.length % 2 === 1) throw new SamlDecoderError(NOT_TEXT_MESSAGE, 'message');
  if (bigEndian) {
    data = new Uint8Array(bytes.length);
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      data[i] = bytes[i + 1]!;
      data[i + 1] = bytes[i]!;
    }
  }
  try {
    return new TextDecoder('utf-16le', { fatal: true }).decode(data);
  } catch {
    throw new SamlDecoderError(NOT_TEXT_MESSAGE, 'message');
  }
}

/**
 * Turns the decoded and decompressed bytes into text, finding the encoding before anything looks for a DOCTYPE, so a
 * UTF-16 message cannot slip past that check. A byte order mark decides; without one, a first byte pair of a character and
 * a zero byte decides UTF-16; otherwise the bytes must be valid UTF-8.
 */
export function decodeXml(bytes: Uint8Array): DecodedText {
  if (looksLikeUtf32(bytes)) throw new SamlDecoderError(UTF32_MESSAGE, 'message');
  const b0 = bytes[0];
  const b1 = bytes[1];
  if (b0 === 0xef && b1 === 0xbb && bytes[2] === 0xbf) {
    return { text: decodeUtf8(bytes.subarray(3)), encoding: 'UTF-8', marked: true };
  }
  if (b0 === 0xff && b1 === 0xfe)
    return { text: decodeUtf16(bytes.subarray(2), false), encoding: 'UTF-16LE', marked: true };
  if (b0 === 0xfe && b1 === 0xff)
    return { text: decodeUtf16(bytes.subarray(2), true), encoding: 'UTF-16BE', marked: true };
  if (b0 !== undefined && b1 !== undefined) {
    if (b0 !== 0 && b1 === 0) return { text: decodeUtf16(bytes, false), encoding: 'UTF-16LE', marked: false };
    if (b0 === 0 && b1 !== 0) return { text: decodeUtf16(bytes, true), encoding: 'UTF-16BE', marked: false };
  }
  return { text: decodeUtf8(bytes), encoding: 'UTF-8', marked: false };
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new SamlDecoderError(NOT_TEXT_MESSAGE, 'message');
  }
}

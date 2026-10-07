import { SamlDecoderError } from './errors';

/** The most characters in the pasted message box (3 MiB of text). */
export const MAX_PASTE_CHARACTERS = 3_145_728;
/** The most bytes of XML: the message once decoded and decompressed (2 MiB). */
export const MAX_XML_BYTES = 2_097_152;
/** The most tags (start tags and empty tags) in one message. */
export const MAX_TAGS = 50_000;
/** The deepest nesting of elements. */
export const MAX_DEPTH = 64;
/** The most attributes written on one element. */
export const MAX_ATTRIBUTES_PER_ELEMENT = 200;
/** The most lines of formatted XML shown. */
export const MAX_SHOWN_LINES = 20_000;
/** The size of each piece of compressed data handed to the decompressor. */
export const FEED_CHUNK_BYTES = 1_024;
/** The most rows of the attributes table, and of the signatures table, shown. */
export const MAX_ROWS_SHOWN = 1_000;
/** The most notes in the list of things worth a look. */
export const MAX_NOTES = 50;

/** A whole number with a comma between thousands, the same in every locale. */
export function withCommas(value: number): string {
  const digits = String(value);
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}

/** Refuses a paste that is too long, before any work. The message names the limit, never the text. */
export function checkPaste(text: string): void {
  if (text.length > MAX_PASTE_CHARACTERS) {
    throw new SamlDecoderError(
      `The message box holds ${withCommas(text.length)} characters. The limit is ${withCommas(MAX_PASTE_CHARACTERS)} (3 MiB), so nothing was read.`,
      'message',
    );
  }
}

/** The number of bytes a string takes as UTF-8, counted in one pass without making a copy. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/** The sentence for a message that is over the XML size limit, whichever step found it. */
export const TOO_LARGE_MESSAGE = `The message is larger than 2 MiB (${withCommas(MAX_XML_BYTES)} bytes) once decompressed, so it was not read.`;

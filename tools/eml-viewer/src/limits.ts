import { EmlViewerError } from './errors';

/** The most bytes of a message file (25 MiB). The cap counts file bytes. */
export const MAX_MESSAGE_BYTES = 26_214_400;
/** The most characters of a pasted message (5 MiB). The cap counts characters. */
export const MAX_PASTE_CHARACTERS = 5_242_880;
/** The most header fields read in one header block. */
export const MAX_HEADERS = 2_000;
/** The most bytes of one header field, folds included. */
export const MAX_HEADER_BYTES = 65_536;
/** The most encoded words decoded in one header. */
export const MAX_ENCODED_WORDS = 200;
/** The deepest nesting of parts, the message itself being level 1. */
export const MAX_DEPTH = 16;
/** The most parts read, not counting the message itself. */
export const MAX_PARTS = 1_000;
/** The most sections of one RFC 2231 parameter. */
export const MAX_CONTINUATIONS = 100;
/** The most parameters read from one header. */
export const MAX_PARAMETERS = 200;
/** The most mailboxes read from one address header. */
export const MAX_ADDRESSES = 500;
/** The most Received lines listed as delivery hops (the oldest 200). */
export const MAX_HOPS = 200;
/** The deepest nesting of comments read in a header; a deeper one stops the reading of that header. */
export const MAX_COMMENT_DEPTH = 50;
/** The most Authentication-Results, DKIM-Signature and ARC header fields read of each kind. */
export const MAX_AUTH_HEADERS = 50;
/** The most results read from one Authentication-Results header field. */
export const MAX_AUTH_RESULTS = 100;
/** The most attachments that get a Save button. */
export const MAX_ATTACHMENTS_OFFERED = 200;
/** The most characters of a plain text body shown. */
export const MAX_TEXT_BODY_SHOWN = 262_144;
/** The most bytes of an HTML body that is rendered in the preview (1 MiB). */
export const MAX_HTML_PREVIEW_BYTES = 1_048_576;
/** The most tags (the number of < characters) in an HTML body that is rendered. */
export const MAX_HTML_TAGS = 20_000;
/** The deepest nesting of elements in an HTML body that is rendered. */
export const MAX_HTML_DEPTH = 200;
/** The most bytes of one image a cid address may show (1 MiB). */
export const MAX_CID_IMAGE_BYTES = 1_048_576;
/** The most bytes of all the images cid addresses may show (5 MiB). */
export const MAX_CID_TOTAL_BYTES = 5_242_880;
/** The longest cleaned attachment name, in UTF-16 units. */
export const MAX_FILENAME_CHARACTERS = 120;
/** The most characters of one blocked address or link text kept (the page shows fewer). */
export const MAX_ADDRESS_CHARACTERS = 2_000;
/** The most blocked references and the most links listed. */
export const MAX_LISTED_REFERENCES = 500;

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

/** Refuses a file that is too large, before anything is read. The message names the limit, never the content. */
export function checkFileSize(bytes: number): void {
  if (bytes > MAX_MESSAGE_BYTES) {
    throw new EmlViewerError(
      `The file is ${withCommas(bytes)} bytes. The limit is ${withCommas(MAX_MESSAGE_BYTES)} (25 MiB), so it was not read.`,
      'file',
    );
  }
}

/** Refuses pasted text that is too long, before anything is read. */
export function checkPasteSize(characters: number): void {
  if (characters > MAX_PASTE_CHARACTERS) {
    throw new EmlViewerError(
      `The pasted message is ${withCommas(characters)} characters. The limit is ${withCommas(MAX_PASTE_CHARACTERS)} (5 MiB), so it was not read.`,
      'pasted message',
    );
  }
}

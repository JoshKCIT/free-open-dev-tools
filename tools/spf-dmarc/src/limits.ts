import { SpfDmarcError, type SpfDmarcPart } from './errors';

/** The most characters in one box (the SPF box, the DMARC box). */
export const MAX_PASTE_CHARACTERS = 65_536;
/** The most records read from one box. */
export const MAX_RECORDS = 100;
/** The most characters in one record. */
export const MAX_RECORD_CHARACTERS = 16_384;
/** The most rows of a terms table or a tags table a page shows. */
export const MAX_TERMS_SHOWN = 500;
/** The most terms that cause DNS lookups in one evaluation (RFC 7208 section 4.6.4). */
export const LOOKUP_LIMIT = 10;
/** A record longer than this many octets is noted: it may not fit a 512 octet DNS answer (RFC 7208 section 3.4). */
export const SIZE_NOTE_OCTETS = 450;
/** One character-string of a TXT record holds at most this many octets (RFC 7208 section 3.3). */
export const STRING_OCTETS = 255;

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

/** What a box is called in a sentence. */
export function boxName(part: SpfDmarcPart): string {
  if (part === 'spf') return 'SPF box';
  if (part === 'dmarc') return 'DMARC box';
  if (part === 'domain') return 'domain field';
  return 'builder';
}

/** Refuses a box that is too long, before any work. The message names the box, the limit and a position, never the text. */
export function checkPaste(text: string, part: SpfDmarcPart): void {
  if (text.length > MAX_PASTE_CHARACTERS) {
    throw new SpfDmarcError(
      `The ${boxName(part)} holds ${withCommas(text.length)} characters. The limit is ${withCommas(MAX_PASTE_CHARACTERS)}, so the text from character ${withCommas(MAX_PASTE_CHARACTERS + 1)} on was not read.`,
      part,
      MAX_PASTE_CHARACTERS + 1,
    );
  }
}

/** Refuses one record that is too long, before any work. */
export function checkRecordLength(text: string, part: SpfDmarcPart): void {
  if (text.length > MAX_RECORD_CHARACTERS) {
    throw new SpfDmarcError(
      `A record in the ${boxName(part)} holds ${withCommas(text.length)} characters. The limit is ${withCommas(MAX_RECORD_CHARACTERS)}, so the text from character ${withCommas(MAX_RECORD_CHARACTERS + 1)} on was not read.`,
      part,
      MAX_RECORD_CHARACTERS + 1,
    );
  }
}

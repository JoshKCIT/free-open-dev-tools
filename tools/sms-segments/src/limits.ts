import { SmsSegmentsError } from './errors';

/** The longest message that is analysed, in UTF-16 code units (what a JavaScript string length counts). */
export const MAX_MESSAGE_UNITS = 100_000;
/** The most parts a concatenated message can have (TS 23.040: the reference count is one octet and starts at 1). */
export const MAX_PARTS = 255;
/** How many segment rows a page shows before it says how many more there are. */
export const MAX_SEGMENT_ROWS = 50;
/** How many forced-character rows a page shows before it says how many more there are. */
export const MAX_FORCED_ROWS = 100;
/** How many characters of a GSM-safe copy a page shows. */
export const MAX_COPY_CHARACTERS = 5_000;
/** The most characters of a message that any refusal or warning may show. */
export const MAX_SHOWN_CHARACTERS = 40;

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

/** Refuses a message over the length limit, before anything else is done with it. */
export function checkMessageLength(text: string): void {
  if (text.length > MAX_MESSAGE_UNITS) {
    throw new SmsSegmentsError(
      `The message is ${withCommas(text.length)} UTF-16 units long and this page reads at most ${withCommas(MAX_MESSAGE_UNITS)}. A concatenated message has at most ${MAX_PARTS} parts (39,015 septets or 17,085 UCS-2 units), so a message this long could not be sent as one.`,
    );
  }
}

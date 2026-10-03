/**
 * Base32 as RFC 4648 section 6 writes it (the alphabet A to Z then 2 to 7, `=` padding to groups of 8 characters), read
 * the way a person types a 2FA secret: in either case, with spaces and hyphens between groups, with or without padding.
 *
 * RULE, stated once and enforced by a test: no message thrown or returned from this file may ever contain a fragment of a
 * secret. Describe the shape of the problem and its position, never the content. A position counts the characters that
 * were typed, spaces and hyphens included, so a visitor can find it; `position` is the index from 0 and the message says
 * the same place counted from 1 ("character 6" for position 5).
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** 255 marks a character that is not in the alphabet; index by the character code below 128. */
const VALUE = new Uint8Array(128).fill(255);
for (let i = 0; i < ALPHABET.length; i++) {
  VALUE[ALPHABET.charCodeAt(i)] = i;
  VALUE[ALPHABET.toLowerCase().charCodeAt(i)] = i;
}

/** How many `=` fill the last group of 8, by the number of data characters left over in it. */
const PADDING_FOR_REMAINDER = new Map<number, number>([
  [0, 0],
  [2, 6],
  [4, 4],
  [5, 3],
  [7, 1],
]);

export class Base32Error extends Error {
  /** Index in the text that was typed, counting from 0. */
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'Base32Error';
    this.position = position;
  }
}

function at(position: number): string {
  return `at character ${position + 1}`;
}

/** True for the characters a person puts between groups: space, tab, line feed, carriage return and hyphen. */
function isSeparator(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 45;
}

/**
 * Decodes Base32 text to bytes. The unused bits after the last whole byte are not checked (RFC 4648 section 3.5 lets a
 * decoder reject them; this one reads the secret as typed). An empty text gives no bytes; a caller that needs a secret
 * refuses that itself.
 */
export function decodeBase32(text: string): Uint8Array {
  const out: number[] = [];
  let bits = 0;
  let acc = 0;
  let data = 0;
  let padStart = -1;
  let pad = 0;
  let lastData = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (isSeparator(code)) continue;
    if (code === 61) {
      if (padStart < 0) padStart = i;
      pad++;
      continue;
    }
    if (padStart >= 0) {
      throw new Base32Error(
        `This secret has a padding sign ${at(padStart)} that is followed by more characters. Padding may only end the secret.`,
        padStart,
      );
    }
    const value = code < 128 ? (VALUE[code] ?? 255) : 255;
    if (value === 255) {
      throw new Base32Error(
        `This secret has a character that is not in the Base32 alphabet (A to Z and 2 to 7) ${at(i)}.`,
        i,
      );
    }
    acc = ((acc << 5) | value) & 0xfff;
    bits += 5;
    data++;
    lastData = i;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
      acc &= (1 << bits) - 1;
    }
  }
  const remainder = data % 8;
  const required = PADDING_FOR_REMAINDER.get(remainder);
  if (required === undefined) {
    throw new Base32Error(
      `The last group of this secret ends ${at(lastData)} and is too short to hold whole bytes. Base32 groups hold 2, 4, 5, 7 or 8 characters, so check that nothing was cut off.`,
      lastData,
    );
  }
  if (pad > 0 && pad !== required) {
    throw new Base32Error(
      `The padding at the end of this secret starts ${at(padStart)} and is not the length RFC 4648 writes for it. Padding fills the last group to 8 characters, and it may also be left off.`,
      padStart,
    );
  }
  return Uint8Array.from(out);
}

/** Encodes bytes as Base32 in upper case, padded to a multiple of 8 characters unless `pad` is false. */
export function encodeBase32(bytes: Uint8Array, pad = true): string {
  let out = '';
  let bits = 0;
  let acc = 0;
  for (const byte of bytes) {
    acc = ((acc << 8) | byte) & 0xfff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(acc >> bits) & 31];
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(acc << (5 - bits)) & 31];
  if (pad) while (out.length % 8 !== 0) out += '=';
  return out;
}

/**
 * Short hints for a secret that could not be read, said only for text whose shape gives it away: all hexadecimal digits,
 * or Base64. The hints name a kind of text and never repeat any of it.
 */
export function secretHints(text: string): string[] {
  const hints: string[] = [];
  let hex = true;
  let base64 = true;
  let count = 0;
  let outside = false;
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 61) end--;
  for (let i = 0; i < end; i++) {
    const code = text.charCodeAt(i);
    if (isSeparator(code) || code === 58) continue;
    count++;
    const digit = code >= 48 && code <= 57;
    const upper = code >= 65 && code <= 90;
    const lower = code >= 97 && code <= 122;
    if (!(digit || (code >= 65 && code <= 70) || (code >= 97 && code <= 102))) hex = false;
    if (!(digit || upper || lower || code === 43 || code === 47)) base64 = false;
    // 0, 1, 8, 9, + and / are what Base32 does not have.
    if (code === 48 || code === 49 || code === 56 || code === 57 || code === 43 || code === 47) outside = true;
  }
  if (count < 8 || !outside) return hints;
  if (hex && count % 2 === 0) {
    hints.push(
      'This looks like hexadecimal text. This page needs the secret in Base32, which is the form an authenticator app is given (letters A to Z and digits 2 to 7).',
    );
  } else if (base64) {
    hints.push(
      'This looks like Base64 text. This page needs the secret in Base32, which is the form an authenticator app is given (letters A to Z and digits 2 to 7).',
    );
  }
  return hints;
}

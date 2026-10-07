import { SamlDecoderError } from './errors';
import { withCommas } from './limits';

export interface Base64Result {
  bytes: Uint8Array;
  warnings: string[];
}

/** The value of each Base64 character (the standard alphabet), or -1. The URL-safe - and _ are mapped before the lookup. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VALUE_OF: Int8Array = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d || code === 0x0c || code === 0x0b;
}

/**
 * Reads Base64 text into bytes in one pass. White space of any kind (a value wrapped at 64 or 76 columns, or a line break
 * inside a copied address) is removed first, `-` and `_` are read as `+` and `/`, and missing or wrong `=` padding is
 * repaired, each with a warning. A character that is not Base64 is refused by its position, never by showing it.
 */
export function decodeBase64(text: string): Base64Result {
  const warnings: string[] = [];
  const sextets = new Uint8Array(text.length);
  let count = 0;
  let padding = 0;
  let urlSafe = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (isSpace(code)) continue;
    if (code === 0x3d) {
      padding++;
      continue;
    }
    if (padding > 0) {
      throw new SamlDecoderError(
        `The Base64 text has an equals sign in the middle (character ${withCommas(i + 1)}), where only padding at the end is allowed.`,
        'message',
      );
    }
    let value = code < 128 ? (VALUE_OF[code] ?? -1) : -1;
    if (code === 0x2d) {
      value = 62;
      urlSafe = true;
    } else if (code === 0x5f) {
      value = 63;
      urlSafe = true;
    }
    if (value < 0) {
      throw new SamlDecoderError(
        `The text holds a character that is not Base64 at character ${withCommas(i + 1)}, so it was not read.`,
        'message',
      );
    }
    sextets[count++] = value;
  }
  if (count === 0) throw new SamlDecoderError('The Base64 text holds no data.', 'message');
  if (count % 4 === 1) {
    throw new SamlDecoderError(
      `The Base64 text holds ${withCommas(count)} characters, a count that no Base64 data can have (one more than a multiple of 4).`,
      'message',
    );
  }
  if (urlSafe) warnings.push('The text uses the URL-safe Base64 alphabet (- and _); it was read as + and /.');
  const wanted = (4 - (count % 4)) % 4;
  if (padding !== wanted)
    warnings.push('The Base64 padding (=) was missing or wrong at the end; it was repaired before reading.');
  const length = Math.floor((count * 6) / 8);
  const bytes = new Uint8Array(length);
  let out = 0;
  let i = 0;
  for (; i + 4 <= count; i += 4) {
    const n = (sextets[i]! << 18) | (sextets[i + 1]! << 12) | (sextets[i + 2]! << 6) | sextets[i + 3]!;
    bytes[out++] = (n >> 16) & 0xff;
    bytes[out++] = (n >> 8) & 0xff;
    bytes[out++] = n & 0xff;
  }
  const rest = count - i;
  if (rest === 2) {
    const n = (sextets[i]! << 18) | (sextets[i + 1]! << 12);
    bytes[out++] = (n >> 16) & 0xff;
  } else if (rest === 3) {
    const n = (sextets[i]! << 18) | (sextets[i + 1]! << 12) | (sextets[i + 2]! << 6);
    bytes[out++] = (n >> 16) & 0xff;
    bytes[out++] = (n >> 8) & 0xff;
  }
  return { bytes, warnings };
}

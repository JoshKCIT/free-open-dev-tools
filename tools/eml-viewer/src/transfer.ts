// Content-Transfer-Encoding decoders (RFC 2045 section 6). Each reads a byte range once and allocates its output once.

const NOT_BASE64 = 255;

const BASE64_VALUES: Uint8Array = (() => {
  const table = new Uint8Array(256).fill(NOT_BASE64);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < alphabet.length; i++) table[alphabet.charCodeAt(i)] = i;
  return table;
})();

/**
 * Base64 read leniently: every character outside the alphabet (line ends, spaces, line noise) is skipped, the data ends
 * at the first "=", and missing padding is accepted. A last group of one character carries no whole byte and is ignored.
 */
export function decodeBase64Lenient(bytes: Uint8Array, start: number = 0, end: number = bytes.length): Uint8Array {
  const out = new Uint8Array(Math.ceil(((end - start) * 3) / 4) + 3);
  let produced = 0;
  let accumulator = 0;
  let bits = 0;
  for (let i = start; i < end; i++) {
    const byte = bytes[i] ?? 0;
    if (byte === 0x3d) break;
    const value = BASE64_VALUES[byte] ?? NOT_BASE64;
    if (value === NOT_BASE64) continue;
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[produced++] = (accumulator >> bits) & 0xff;
      accumulator &= (1 << bits) - 1;
    }
  }
  return out.slice(0, produced);
}

function hexValue(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  return -1;
}

/**
 * Quoted-printable (RFC 2045 section 6.7): =XX in either case, soft line breaks (= at the end of a line, with or without
 * spaces and tabs after it) removed, a trailing = at the end of the data dropped, a = that does not start a valid
 * sequence kept as it is, and spaces and tabs before a hard line break dropped as transport padding. Line breaks stay as
 * they are written.
 */
export function decodeQuotedPrintable(bytes: Uint8Array, start: number = 0, end: number = bytes.length): Uint8Array {
  const out = new Uint8Array(end - start);
  let produced = 0;
  // Where the current run of spaces and tabs began in the output, or -1 when the last byte was not white space.
  let padStart = -1;
  let i = start;
  while (i < end) {
    const byte = bytes[i] ?? 0;
    if (byte === 0x3d) {
      // A soft line break: = then optional spaces and tabs (transport padding, rule 3 deletes them) then a line break or
      // the end of the data. The white space before the = is text, so it is no longer padding. The run after the = is
      // read once here; when it does not end a line, the bytes are read again below as ordinary text.
      let k = i + 1;
      while (k < end && (bytes[k] === 0x20 || bytes[k] === 0x09)) k++;
      const a = k < end ? (bytes[k] ?? 0) : -1;
      if (a === 0x0a) {
        padStart = -1;
        i = k + 1;
        continue;
      }
      if (a === 0x0d) {
        padStart = -1;
        i = k + 1 < end && bytes[k + 1] === 0x0a ? k + 2 : k + 1;
        continue;
      }
      if (a === -1) {
        padStart = -1;
        i = end;
        continue;
      }
      const high = hexValue(bytes[i + 1] ?? 0);
      const low = i + 2 < end ? hexValue(bytes[i + 2] ?? 0) : -1;
      if (high >= 0 && low >= 0) {
        out[produced++] = (high << 4) | low;
        padStart = -1;
        i += 3;
        continue;
      }
      out[produced++] = byte;
      padStart = -1;
      i++;
      continue;
    }
    if (byte === 0x0a || byte === 0x0d) {
      if (padStart >= 0) produced = padStart;
      padStart = -1;
      out[produced++] = byte;
      i++;
      continue;
    }
    if (byte === 0x20 || byte === 0x09) {
      if (padStart < 0) padStart = produced;
      out[produced++] = byte;
      i++;
      continue;
    }
    padStart = -1;
    out[produced++] = byte;
    i++;
  }
  return out.slice(0, produced);
}

/** A copy of the bytes of a range, for the encodings that change nothing (7bit, 8bit, binary). */
export function copyRange(bytes: Uint8Array, start: number, end: number): Uint8Array {
  return bytes.slice(start, end);
}

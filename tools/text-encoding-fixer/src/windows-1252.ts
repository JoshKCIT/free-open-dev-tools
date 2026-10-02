/**
 * The windows-1252 encoding as the WHATWG Encoding Standard defines it, from this folder's own table.
 *
 * Why a table of its own: the decoder built into the platform is not the same everywhere. Node decodes the label
 * windows-1252 as Latin-1 (the byte 80 becomes U+0080), while the browsers decode it as the standard requires (the byte
 * 80 becomes the euro sign U+20AC). A table typed from the standard's index file gives the same answer in Node and in
 * every browser. Nothing here asks the platform to decode or encode anything.
 *
 * Source: https://encoding.spec.whatwg.org/index-windows-1252.txt (index of windows-1252). Pointer n of that file is the
 * byte 0x80 + n. Pointers 32 to 127 (the bytes A0 to FF) are the code points with the same numbers, so only the 32
 * entries for the bytes 80 to 9F are listed here. Unlike Microsoft's table, the standard maps the five bytes Microsoft
 * leaves undefined (81, 8D, 8F, 90 and 9D) to the control characters with the same numbers, so every byte decodes.
 */
export const WINDOWS_1252_HIGH: readonly number[] = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d,
  0x017d, 0x008f, 0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x009d, 0x017e, 0x0178,
];

/** The code point of every byte: the table for 80 to 9F, and the byte itself everywhere else. */
const BYTE_TO_CODE_POINT: readonly number[] = Array.from({ length: 256 }, (_, byte) =>
  byte >= 0x80 && byte < 0xa0 ? WINDOWS_1252_HIGH[byte - 0x80]! : byte,
);

/** The byte of every code point the table holds. Built from the same table, so the two directions cannot disagree. */
const CODE_POINT_TO_BYTE: ReadonlyMap<number, number> = new Map(
  BYTE_TO_CODE_POINT.map((codePoint, byte) => [codePoint, byte] as const),
);

/** How many characters one call of String.fromCharCode is given at a time, so a 20 MiB input does not overflow the stack. */
const CHUNK = 8192;

/** Decodes bytes as windows-1252. Every byte has a character, so nothing is ever replaced. */
export function decodeWindows1252(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const end = Math.min(start + CHUNK, bytes.length);
    const units = new Array<number>(end - start);
    for (let i = start; i < end; i++) units[i - start] = BYTE_TO_CODE_POINT[bytes[i]!]!;
    parts.push(String.fromCharCode(...units));
  }
  return parts.join('');
}

/**
 * Encodes text as windows-1252. When a character has no byte (any character the table does not hold, which includes
 * U+0080 and the other C1 controls the standard moves elsewhere), the bytes before it are returned and `badPosition` is
 * its position counted in characters (code points) from 0.
 */
export function encodeWindows1252(text: string): { bytes: Uint8Array; badPosition?: number } {
  const bytes = new Uint8Array(text.length);
  let written = 0;
  let position = 0;
  for (const character of text) {
    const byte = CODE_POINT_TO_BYTE.get(character.codePointAt(0)!);
    if (byte === undefined) return { bytes: bytes.slice(0, written), badPosition: position };
    bytes[written++] = byte;
    position++;
  }
  return { bytes: bytes.slice(0, written) };
}

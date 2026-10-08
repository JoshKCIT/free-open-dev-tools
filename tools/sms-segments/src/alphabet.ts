/**
 * The GSM 7-bit default alphabet of 3GPP TS 23.038 clause 6.2.1 and its extension table of clause 6.2.1.1, written out by
 * hand. The tests compare every cell with the vendored Unicode mapping file and with the recorded Android table; code 0x09
 * is the capital C cedilla as TS 23.038 draws it (the Unicode file draws the lower case one there and says why in its own
 * header), so a lower case c cedilla is outside the alphabet.
 */

/** The code of the escape to the extension table. It stands for no character of its own. */
export const ESCAPE_CODE = 0x1b;

/**
 * The 128 cells of the default alphabet, indexed by septet code. Index 0x1B is the escape code: it holds the empty string
 * because it is not a character. Sixteen cells to a row, so row N starts at code N times 16. The tests check every cell
 * by code point against the Unicode file, so a look-alike character in this list would be caught.
 */
export const DEFAULT_ALPHABET: readonly string[] = [
  // 0x00
  '@',
  '£',
  '$',
  '¥',
  'è',
  'é',
  'ù',
  'ì',
  'ò',
  'Ç',
  '\n',
  'Ø',
  'ø',
  '\r',
  'Å',
  'å',
  // 0x10
  'Δ',
  '_',
  'Φ',
  'Γ',
  'Λ',
  'Ω',
  'Π',
  'Ψ',
  'Σ',
  'Θ',
  'Ξ',
  '',
  'Æ',
  'æ',
  'ß',
  'É',
  // 0x20
  ' ',
  '!',
  '"',
  '#',
  '¤',
  '%',
  '&',
  "'",
  '(',
  ')',
  '*',
  '+',
  ',',
  '-',
  '.',
  '/',
  // 0x30
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  ':',
  ';',
  '<',
  '=',
  '>',
  '?',
  // 0x40
  '¡',
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  // 0x50
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z',
  'Ä',
  'Ö',
  'Ñ',
  'Ü',
  '§',
  // 0x60
  '¿',
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
  'i',
  'j',
  'k',
  'l',
  'm',
  'n',
  'o',
  // 0x70
  'p',
  'q',
  'r',
  's',
  't',
  'u',
  'v',
  'w',
  'x',
  'y',
  'z',
  'ä',
  'ö',
  'ñ',
  'ü',
  'à',
];

/**
 * The extension table: each character, mapped to the code that follows the escape. A character here is sent as two
 * septets, the escape and then its code. Form feed, ^, {, }, backslash, [, ~, ], the vertical bar and the euro sign.
 */
export const EXTENSION: ReadonlyMap<string, number> = new Map<string, number>([
  ['\f', 0x0a],
  ['^', 0x14],
  ['{', 0x28],
  ['}', 0x29],
  ['\\', 0x2f],
  ['[', 0x3c],
  ['~', 0x3d],
  [']', 0x3e],
  ['|', 0x40],
  ['€', 0x65],
]);

/** Each character of the default alphabet and its code. A Map, so a character named like an object key is just text. */
const DEFAULT_CODES: ReadonlyMap<string, number> = (() => {
  const codes = new Map<string, number>();
  for (let code = 0; code < DEFAULT_ALPHABET.length; code++) {
    const character = DEFAULT_ALPHABET[code]!;
    if (code !== ESCAPE_CODE) codes.set(character, code);
  }
  return codes;
})();

/**
 * How many septets one character takes in the GSM 7-bit alphabet: 1 for a character of the default alphabet, 2 for a
 * character of the extension table (the escape and its code), and undefined for anything else, which cannot be sent in
 * this alphabet. `character` is one code point written as a string; anything longer is not a cell and gives undefined.
 */
export function septetsOf(character: string): 1 | 2 | undefined {
  if (DEFAULT_CODES.has(character)) return 1;
  if (EXTENSION.has(character)) return 2;
  return undefined;
}

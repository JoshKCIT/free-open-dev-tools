import meta from './meta.json';

export { meta };

export type Radix = 'binary' | 'octal' | 'decimal' | 'hexadecimal';

export type TextEncodingName = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';

export class TextRadixError extends Error {
  /** Index into the input where the problem was found, when known. */
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'TextRadixError';
    this.position = position;
  }
}

/** Base and conventional per-byte digit width for each radix (used for padded output). */
const RADIX_BASE: Record<Radix, number> = { binary: 2, octal: 8, decimal: 10, hexadecimal: 16 };
const RADIX_WIDTH: Record<Radix, number> = { binary: 8, octal: 3, decimal: 3, hexadecimal: 2 };
const RADIX_DIGITS: Record<Radix, RegExp> = {
  binary: /^[01]$/,
  octal: /^[0-7]$/,
  decimal: /^[0-9]$/,
  hexadecimal: /^[0-9a-fA-F]$/,
};

export const ENCODINGS: Record<TextEncodingName, { label: string; note: string }> = {
  'utf-8': {
    label: 'UTF-8',
    note: 'The default. A character below U+0080 is one byte; every other character is two to four bytes.',
  },
  'utf-16le': {
    label: 'UTF-16 (little-endian)',
    note: 'Two bytes per UTF-16 code unit, low byte first. A character outside the basic multilingual plane is a surrogate pair, so four bytes.',
  },
  'utf-16be': {
    label: 'UTF-16 (big-endian)',
    note: 'Two bytes per UTF-16 code unit, high byte first. Same characters as little-endian, byte order reversed within each pair.',
  },
  'windows-1252': {
    label: 'windows-1252',
    note: 'One byte per character for the characters it has. Everything else is refused rather than substituted. See limits for the iso-8859-1 label.',
  },
};

/**
 * The upper half of the WHATWG index-windows-1252 table (pointers 0 to 127,
 * bytes 0x80 to 0xFF), transcribed verbatim from
 * https://encoding.spec.whatwg.org/index-windows-1252.txt (fetched 2026-09-23,
 * "Identifier: e56d49d9176e9a412283cf29ac9bd613f5620462f2a080a84eceaf974cfa18b7").
 *
 * This is NOT a byte-equals-code-point mapping: under this standard the
 * label "iso-8859-1" resolves to windows-1252, so pointer 0 (byte 0x80)
 * decodes to U+20AC, the euro sign, not U+0080. All 128 positions are
 * mapped, including the five that look unmapped at a glance -- pointers 1,
 * 13, 15, 16 and 29 (bytes 0x81, 0x8D, 0x8F, 0x90, 0x9D) decode to the C1
 * control code points U+0081, U+008D, U+008F, U+0090 and U+009D. Do not use
 * Node's own `TextDecoder('windows-1252')` to check this table: on the Node
 * this project runs (22.14.0, pinned by the CI workflow), it decodes
 * windows-1252 with each byte equal to its own code point (0x80 -> U+0080),
 * which is exactly the wrong answer this table exists to avoid. The test
 * file vendors the source index file itself and checks every one of these
 * 128 entries against it independently.
 */
const WINDOWS_1252_UPPER: readonly number[] = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d,
  0x017d, 0x008f, 0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x009d, 0x017e, 0x0178, 0x00a0, 0x00a1, 0x00a2, 0x00a3, 0x00a4, 0x00a5, 0x00a6, 0x00a7, 0x00a8, 0x00a9,
  0x00aa, 0x00ab, 0x00ac, 0x00ad, 0x00ae, 0x00af, 0x00b0, 0x00b1, 0x00b2, 0x00b3, 0x00b4, 0x00b5, 0x00b6, 0x00b7,
  0x00b8, 0x00b9, 0x00ba, 0x00bb, 0x00bc, 0x00bd, 0x00be, 0x00bf, 0x00c0, 0x00c1, 0x00c2, 0x00c3, 0x00c4, 0x00c5,
  0x00c6, 0x00c7, 0x00c8, 0x00c9, 0x00ca, 0x00cb, 0x00cc, 0x00cd, 0x00ce, 0x00cf, 0x00d0, 0x00d1, 0x00d2, 0x00d3,
  0x00d4, 0x00d5, 0x00d6, 0x00d7, 0x00d8, 0x00d9, 0x00da, 0x00db, 0x00dc, 0x00dd, 0x00de, 0x00df, 0x00e0, 0x00e1,
  0x00e2, 0x00e3, 0x00e4, 0x00e5, 0x00e6, 0x00e7, 0x00e8, 0x00e9, 0x00ea, 0x00eb, 0x00ec, 0x00ed, 0x00ee, 0x00ef,
  0x00f0, 0x00f1, 0x00f2, 0x00f3, 0x00f4, 0x00f5, 0x00f6, 0x00f7, 0x00f8, 0x00f9, 0x00fa, 0x00fb, 0x00fc, 0x00fd,
  0x00fe, 0x00ff,
];

/** Reverse of {@link WINDOWS_1252_UPPER}, plus the identity mapping for 0x00-0x7F. */
const WINDOWS_1252_ENCODE: ReadonlyMap<number, number> = (() => {
  const map = new Map<number, number>();
  for (let b = 0; b < 0x80; b++) map.set(b, b);
  for (let pointer = 0; pointer < WINDOWS_1252_UPPER.length; pointer++) {
    const codePoint = WINDOWS_1252_UPPER[pointer]!;
    if (!map.has(codePoint)) map.set(codePoint, 0x80 + pointer);
  }
  return map;
})();

/**
 * Every direction below is written out by hand rather than delegated to a
 * decoder label, deliberately. `TextEncoder`/`TextDecoder` for UTF-8 are used
 * because every target this project runs on has them, but a decoder label
 * for UTF-16 or windows-1252 is not guaranteed to exist in every JavaScript
 * engine this package may run in outside a browser (Node's own
 * `TextDecoder` does not implement 'utf-16le' as a *labelled* codec the way
 * a browser's does, and windows-1252 disagrees with a browser as noted
 * above), and this package has to work in both. Producing the bytes
 * ourselves is the only choice that is correct everywhere.
 */
function encodeToBytes(text: string, encoding: TextEncodingName): Uint8Array {
  switch (encoding) {
    case 'utf-8':
      return new TextEncoder().encode(text);

    case 'utf-16le':
    case 'utf-16be': {
      const out = new Uint8Array(text.length * 2);
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        const hi = (code >> 8) & 0xff;
        const lo = code & 0xff;
        if (encoding === 'utf-16le') {
          out[i * 2] = lo;
          out[i * 2 + 1] = hi;
        } else {
          out[i * 2] = hi;
          out[i * 2 + 1] = lo;
        }
      }
      return out;
    }

    case 'windows-1252': {
      const out: number[] = [];
      for (const ch of text) {
        const codePoint = ch.codePointAt(0)!;
        const byte = WINDOWS_1252_ENCODE.get(codePoint);
        if (byte === undefined) {
          const hex = codePoint.toString(16).toUpperCase().padStart(4, '0');
          throw new TextRadixError(`"${ch}" (U+${hex}) cannot be represented in windows-1252.`);
        }
        out.push(byte);
      }
      return Uint8Array.from(out);
    }
  }
}

function decodeFromBytes(bytes: Uint8Array, encoding: TextEncodingName): string {
  switch (encoding) {
    case 'utf-8':
      return new TextDecoder('utf-8').decode(bytes);

    case 'utf-16le':
    case 'utf-16be': {
      if (bytes.length % 2 !== 0) {
        throw new TextRadixError(
          'UTF-16 needs an even number of bytes: two bytes per code unit. This input has an odd number of bytes.',
          bytes.length,
        );
      }
      let out = '';
      for (let i = 0; i < bytes.length; i += 2) {
        const b0 = bytes[i]!;
        const b1 = bytes[i + 1]!;
        const code = encoding === 'utf-16le' ? (b1 << 8) | b0 : (b0 << 8) | b1;
        out += String.fromCharCode(code);
      }
      return out;
    }

    case 'windows-1252': {
      // Every one of the 256 byte values decodes; none is an error.
      let out = '';
      for (const byte of bytes) {
        const codePoint = byte < 0x80 ? byte : WINDOWS_1252_UPPER[byte - 0x80]!;
        out += String.fromCodePoint(codePoint);
      }
      return out;
    }
  }
}

export interface TextToRadixOptions {
  /** Which base each byte is rendered in. Default 'hexadecimal'. */
  radix?: Radix;
  /** Which character encoding produces the bytes. Default 'utf-8'. */
  encoding?: TextEncodingName;
  /** String placed between groups. Default a single space. */
  separator?: string;
  /** Pad every group to the radix's conventional per-byte width. Default true. */
  fixedWidth?: boolean;
  /** Upper-case hexadecimal digits. Ignored for every other radix. Default false. */
  upperCase?: boolean;
}

/**
 * Converts text to groups of digits, one group per byte.
 *
 * This ALWAYS reads its input as characters, never as a numeric value: the
 * text "255" produces the bytes of the three characters '2', '5' and '5',
 * never the single byte 255 or the sixteen bits of the integer 255. There is
 * no option, mode or heuristic anywhere in this file that changes that (D-03).
 */
export function textToRadix(text: string, options: TextToRadixOptions = {}): string {
  const { radix = 'hexadecimal', encoding = 'utf-8', separator = ' ', fixedWidth = true, upperCase = false } = options;

  const bytes = encodeToBytes(text, encoding);
  const base = RADIX_BASE[radix];
  const width = RADIX_WIDTH[radix];

  const groups: string[] = [];
  for (const byte of bytes) {
    let digits = byte.toString(base);
    if (radix === 'hexadecimal' && upperCase) digits = digits.toUpperCase();
    groups.push(fixedWidth ? digits.padStart(width, '0') : digits);
  }
  return groups.join(separator);
}

export interface RadixToTextOptions {
  /** Which base each group is read as. Default 'hexadecimal'. */
  radix?: Radix;
  /** Which character encoding the bytes are interpreted under. Default 'utf-8'. */
  encoding?: TextEncodingName;
  /**
   * The separator this tool itself would have written. Parsing always also
   * accepts any run of whitespace as a group boundary regardless of this
   * value, because text pasted from elsewhere is rarely separated exactly
   * the way this tool writes it.
   */
  separator?: string;
}

interface Token {
  text: string;
  position: number;
}

/** True when the character at `i` starts a delimiter: whitespace, or the configured separator. */
function isDelimiterAt(input: string, i: number, separator: string): boolean {
  if (/\s/.test(input[i]!)) return true;
  return separator.length > 0 && input.startsWith(separator, i);
}

function delimiterLengthAt(input: string, i: number, separator: string): number {
  if (separator.length > 0 && input.startsWith(separator, i)) return separator.length;
  return 1;
}

/** Splits on any run of whitespace and/or the configured separator, tracking each token's position. */
function tokenize(input: string, separator: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    while (i < n && isDelimiterAt(input, i, separator)) i += delimiterLengthAt(input, i, separator);
    if (i >= n) break;
    const start = i;
    while (i < n && !isDelimiterAt(input, i, separator)) i++;
    tokens.push({ text: input.slice(start, i), position: start });
  }
  return tokens;
}

/**
 * Converts groups of digits back to text. The inverse of {@link textToRadix}.
 *
 * Always reads each group as the literal bytes it names, in the selected
 * encoding -- the same character-only contract as {@link textToRadix}.
 */
export function radixToText(input: string, options: RadixToTextOptions = {}): string {
  const { radix = 'hexadecimal', encoding = 'utf-8', separator = ' ' } = options;
  if (input.trim() === '') return '';

  const digitPattern = RADIX_DIGITS[radix];
  const tokens = tokenize(input, separator);
  const bytes = new Uint8Array(tokens.length);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    for (let c = 0; c < token.text.length; c++) {
      const ch = token.text[c]!;
      if (!digitPattern.test(ch)) {
        throw new TextRadixError(`"${ch}" is not a valid ${radix} digit.`, token.position + c);
      }
    }
    const value = parseInt(token.text, RADIX_BASE[radix]);
    if (value > 255) {
      throw new TextRadixError(
        `Group "${token.text}" is larger than one byte can hold. Each group is one byte, 0 to 255 in decimal.`,
        token.position,
      );
    }
    bytes[i] = value;
  }

  return decodeFromBytes(bytes, encoding);
}

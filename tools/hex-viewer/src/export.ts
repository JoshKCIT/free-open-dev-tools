/*
 * Export bytes as a code array (D-231). The C form is the output of `xxd -i`, rule for rule (xxd.c in the Vim
 * repository, blob 9b1ca6ea5555df413546e48126d75ab91e1c8393, lines 971 and 1079 to 1135): 12 bytes a line, two spaces
 * before the first byte of a line, a comma and a space inside a line, a comma at the end of every line but the last, a
 * length variable after the array, and a variable name in which every UTF-8 byte that is not an ASCII letter or digit
 * is an underscore. The Rust, Go, Python and JavaScript forms are conventional ones, not the output of any program.
 * Everything here is pure: bytes in, text out, one pass, nothing read or written elsewhere.
 */

// index.ts re-exports this file and this file throws index.ts's error class. The class is only used when a function
// runs, long after both modules have been evaluated, so the cycle is harmless.
import { HexViewerError } from './index';

export type ExportLanguage = 'c' | 'rust' | 'go' | 'python' | 'javascript';

/** One language the export can write, with the label the page shows and the extension of the saved file. */
export interface ExportLanguageInfo {
  readonly id: ExportLanguage;
  readonly label: string;
  /** The extension of the saved file, without the dot. */
  readonly extension: string;
}

export const EXPORT_LANGUAGES: readonly ExportLanguageInfo[] = [
  { id: 'c', label: 'C or C++ (xxd -i form)', extension: 'h' },
  { id: 'rust', label: 'Rust', extension: 'rs' },
  { id: 'go', label: 'Go', extension: 'go' },
  { id: 'python', label: 'Python', extension: 'py' },
  { id: 'javascript', label: 'JavaScript', extension: 'js' },
];

/** Most bytes one export writes: 4 MiB, which is about 25 MB of C text. */
export const MAX_EXPORT_BYTES = 4_194_304;
/** Most bytes on one line of the array. */
export const MAX_EXPORT_PER_LINE = 256;
/** Bytes on one line when the visitor does not choose; the value xxd -i uses. */
export const DEFAULT_EXPORT_PER_LINE = 12;
/** The page shows at most this many characters of the text; the saved file holds all of it. */
export const MAX_EXPORT_PREVIEW_CHARS = 65_536;
/** Longest variable name accepted, in characters. */
export const MAX_EXPORT_NAME_CHARS = 200;
/** Largest start or length: the same bound as Go to byte. */
const MAX_POSITION = 2147483647;

export interface ExportOptions {
  language: ExportLanguage;
  /** The name to clean into a variable name: a file name, or whatever the visitor typed. */
  name: string;
  /** Bytes on each line, 1 to 256. */
  perLine: number;
  /** Upper-case hex digits (the C form also writes the prefix as 0X, as xxd -u does). */
  upper: boolean;
  /** C only, and only for the package: the name and the length variable go upper case (xxd -C). The page never sets it. */
  capital?: boolean;
}

export interface ExportResult {
  /** The whole text, every line ending in a line feed. */
  text: string;
  /** The cleaned variable name; the saved file is named from it. */
  identifier: string;
  /** The extension of the saved file, without the dot. */
  extension: string;
  /** How many bytes were written. */
  bytes: number;
  /** How many lines of bytes the array holds. */
  lines: number;
}

const HEX = Array.from({ length: 256 }, (_, value) => value.toString(16).padStart(2, '0'));
const HEX_UPPER = HEX.map((digits) => digits.toUpperCase());

// Reserved words, read on 2026-10-07. A cleaned name equal to one of them gets a trailing underscore.
// Go: the 25 keywords of go.dev/ref/spec ("The following keywords are reserved"), and init, which Go refuses as anything
// but a function at package level.
const GO_RESERVED = new Set(
  'break default func interface select case defer go map struct chan else goto package switch const fallthrough if range type continue for import return var init'.split(
    ' ',
  ),
);
// Python 3.14.3: keyword.kwlist (35 words), and __debug__, which Python refuses to assign ("cannot assign to
// __debug__"). The soft keywords _, case, match and type are legal names and stay.
const PYTHON_RESERVED = new Set(
  'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield __debug__'.split(
    ' ',
  ),
);
// JavaScript: ReservedWord (ECMA-262 section 12.7.2: await is reserved in modules and yield in generators and strict
// code), the strict mode words of section 13.1.1, arguments and eval, which a strict binding refuses, and NaN, Infinity
// and undefined, global properties that cannot be redefined, so a classic script refuses a const of that name.
const JAVASCRIPT_RESERVED = new Set(
  'await break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield implements interface let package private protected public static arguments eval NaN Infinity undefined'.split(
    ' ',
  ),
);

const isLetterOrDigit = (byte: number): boolean =>
  (byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122);

/**
 * Whether the text has more than `limit` characters (code points; a lone surrogate counts as one). Text longer than
 * twice the limit in UTF-16 units always has, so a huge name is judged without walking it; otherwise the walk stops at
 * the first character past the limit.
 */
function characterCountOver(text: string, limit: number): boolean {
  if (text.length <= limit) return false;
  if (text.length > limit * 2) return true;
  let count = 0;
  for (const _character of text) {
    count += 1;
    if (count > limit) return true;
  }
  return false;
}

/**
 * The name cleaned over the UTF-8 bytes of the name, not its characters: every byte that is not an ASCII letter or
 * digit becomes an underscore (so an accented letter is two underscores and a CJK character three), as xxd does.
 * A name that is too long is refused naming the field and is never repeated.
 */
function underscored(rawName: string): { text: string; startsWithDigit: boolean } {
  if (characterCountOver(rawName, MAX_EXPORT_NAME_CHARS)) {
    throw new HexViewerError(`Variable name must be at most ${MAX_EXPORT_NAME_CHARS} characters.`, {
      field: 'Variable name',
    });
  }
  const bytes = new TextEncoder().encode(rawName);
  let text = '';
  for (const byte of bytes) text += isLetterOrDigit(byte) ? String.fromCharCode(byte) : '_';
  return { text, startsWithDigit: bytes.length > 0 && bytes[0]! >= 48 && bytes[0]! <= 57 };
}

/**
 * The variable name for a language. C is the xxd rule (two underscores before a leading digit), so a C keyword stays as
 * it is and the C name is the only one that can be illegal. Go, Python and JavaScript put one underscore before a
 * leading digit and add one after a reserved word. Rust makes a constant, which is upper case. An empty name, and for
 * Go and Rust a name that is only the blank underscore, becomes data.
 */
export function cleanIdentifier(language: ExportLanguage, rawName: string): string {
  const { text, startsWithDigit } = underscored(rawName);
  switch (language) {
    case 'c':
      return text === '' ? 'data' : (startsWithDigit ? '__' : '') + text;
    case 'rust': {
      const name = (startsWithDigit ? '_' : '') + text.toUpperCase();
      return name === '' || name === '_' ? 'DATA' : name;
    }
    case 'go': {
      const name = (startsWithDigit ? '_' : '') + text;
      if (name === '' || name === '_') return 'data';
      return GO_RESERVED.has(name) ? `${name}_` : name;
    }
    case 'python': {
      const name = (startsWithDigit ? '_' : '') + text;
      if (name === '') return 'data';
      return PYTHON_RESERVED.has(name) ? `${name}_` : name;
    }
    case 'javascript': {
      const name = (startsWithDigit ? '_' : '') + text;
      if (name === '') return 'data';
      return JAVASCRIPT_RESERVED.has(name) ? `${name}_` : name;
    }
  }
}

/**
 * The window of a file to export: `from` is a whole number from 0 to 2147483647, `length` absent means to the end and
 * 0 means none, a start at or past the end is the empty window, and a window over 4 MiB is refused naming the limit.
 */
export function exportRange(size: number, from: number, length?: number): { start: number; end: number } {
  if (!Number.isInteger(from) || from < 0 || from > MAX_POSITION) {
    throw new HexViewerError(
      `Export from byte must be a whole number from 0 to ${MAX_POSITION.toLocaleString('en-US')}.`,
      { field: 'Export from byte' },
    );
  }
  if (length !== undefined && (!Number.isInteger(length) || length < 0 || length > MAX_POSITION)) {
    throw new HexViewerError(`Length must be a whole number from 0 to ${MAX_POSITION.toLocaleString('en-US')}.`, {
      field: 'Length',
    });
  }
  const start = Math.min(from, size);
  const end = length === undefined ? size : Math.min(size, start + length);
  if (end - start > MAX_EXPORT_BYTES) {
    throw new HexViewerError(
      'Export: the selection is over the limit of 4 MiB. Set Length to 4194304 or less, or move Export from byte.',
      { field: 'Export' },
    );
  }
  return { start, end };
}

function checkOptions(bytes: Uint8Array, perLine: number): void {
  if (!Number.isInteger(perLine) || perLine < 1 || perLine > MAX_EXPORT_PER_LINE) {
    throw new HexViewerError(`Bytes per line must be a whole number from 1 to ${MAX_EXPORT_PER_LINE}.`, {
      field: 'Bytes per line',
    });
  }
  if (bytes.length > MAX_EXPORT_BYTES) {
    throw new HexViewerError('Export: the selection is over the limit of 4 MiB.', { field: 'Export' });
  }
}

/**
 * The rows of bytes: `prefix` before each byte, `indent` before each row. A comma follows every row but the last, and
 * also the last when `closing` is set (a trailing comma is allowed and customary in Rust, Go, Python and JavaScript, and
 * a C initialiser written by xxd -i has none).
 */
function rowsOf(
  bytes: Uint8Array,
  perLine: number,
  indent: string,
  prefix: string,
  digits: string[],
  closing: boolean,
): string[] {
  const rows: string[] = [];
  for (let from = 0; from < bytes.length; from += perLine) {
    const to = Math.min(from + perLine, bytes.length);
    let row = indent;
    for (let at = from; at < to; at++) row += (at > from ? ', ' : '') + prefix + digits[bytes[at]!]!;
    rows.push(to < bytes.length || closing ? row + ',' : row);
  }
  return rows;
}

/** The bytes as an array in one of the languages, with the cleaned name, in one pass over the bytes. */
export function exportCodeArray(bytes: Uint8Array, options: ExportOptions): ExportResult {
  checkOptions(bytes, options.perLine);
  const info = EXPORT_LANGUAGES.find((item) => item.id === options.language);
  if (info === undefined) throw new HexViewerError('Export: that language is not offered.', { field: 'Export' });

  const language = info.id;
  const base = cleanIdentifier(language, options.name);
  const capital = language === 'c' && options.capital === true;
  const identifier = capital ? base.toUpperCase() : base;
  const digits = options.upper ? HEX_UPPER : HEX;
  const count = bytes.length;
  const make = (indent: string, prefix: string, closing: boolean): string[] =>
    rowsOf(bytes, options.perLine, indent, prefix, digits, closing);

  let rows: string[];
  let text: string;
  if (language === 'c') {
    // The xxd -i form: the prefix turns 0X with -u, the array has no closing comma, and the length follows it.
    rows = make('  ', options.upper ? '0X' : '0x', false);
    const lengthName = `${identifier}_${capital ? 'LEN' : 'len'}`;
    text =
      `unsigned char ${identifier}[] = {\n` +
      (count > 0 ? `${rows.join('\n')}\n` : '') +
      `};\nunsigned int ${lengthName} = ${count};\n`;
  } else if (language === 'rust') {
    rows = make('    ', '0x', true);
    text =
      count === 0
        ? `pub const ${identifier}: [u8; 0] = [];\n`
        : `pub const ${identifier}: [u8; ${count}] = [\n${rows.join('\n')}\n];\n`;
  } else if (language === 'go') {
    rows = make('\t', '0x', true);
    text = count === 0 ? `var ${identifier} = []byte{}\n` : `var ${identifier} = []byte{\n${rows.join('\n')}\n}\n`;
  } else if (language === 'python') {
    rows = make('    ', '0x', true);
    text = count === 0 ? `${identifier} = bytes([])\n` : `${identifier} = bytes([\n${rows.join('\n')}\n])\n`;
  } else {
    rows = make('  ', '0x', true);
    text =
      count === 0
        ? `const ${identifier} = new Uint8Array([]);\n`
        : `const ${identifier} = new Uint8Array([\n${rows.join('\n')}\n]);\n`;
  }
  return { text, identifier, extension: info.extension, bytes: count, lines: rows.length };
}

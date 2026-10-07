/*
 * Export bytes as a code array (D-231). The C form is the output of `xxd -i`, rule for rule (xxd.c in the Vim
 * repository, blob 9b1ca6ea5555df413546e48126d75ab91e1c8393, lines 971 and 1079 to 1135): 12 bytes a line, two spaces
 * before the first byte of a line, a comma and a space inside a line, a comma at the end of every line but the last, a
 * length variable after the array, and a variable name in which every UTF-8 byte that is not an ASCII letter or digit
 * is an underscore. Everything here is pure: bytes in, text out, one pass, nothing read or written elsewhere.
 */

// index.ts re-exports this file and this file throws index.ts's error class. The class is only used when a function
// runs, long after both modules have been evaluated, so the cycle is harmless.
import { HexViewerError } from './index';

/** One language the export can write, with the label the page shows and the extension of the saved file. */
export interface ExportLanguageInfo {
  readonly id: 'c';
  readonly label: string;
  readonly extension: string;
}

export const EXPORT_LANGUAGES: readonly ExportLanguageInfo[] = [
  { id: 'c', label: 'C or C++ (xxd -i form)', extension: 'h' },
];

export type ExportLanguage = ExportLanguageInfo['id'];

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

const isLetterOrDigit = (byte: number): boolean =>
  (byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122);

/**
 * The name cleaned over the UTF-8 bytes of the name, not its characters: every byte that is not an ASCII letter or
 * digit becomes an underscore (so an accented letter is two underscores and a CJK character three), as xxd does.
 * A name that is too long is refused naming the field and is never repeated.
 */
function underscored(rawName: string): { text: string; startsWithDigit: boolean } {
  if (rawName.length > MAX_EXPORT_NAME_CHARS) {
    throw new HexViewerError(`Variable name must be at most ${MAX_EXPORT_NAME_CHARS} characters.`, {
      field: 'Variable name',
    });
  }
  const bytes = new TextEncoder().encode(rawName);
  let text = '';
  for (const byte of bytes) text += isLetterOrDigit(byte) ? String.fromCharCode(byte) : '_';
  return { text, startsWithDigit: bytes.length > 0 && bytes[0]! >= 48 && bytes[0]! <= 57 };
}

/** The legal variable name for a language: the C rule is xxd's, and an empty result becomes data. */
export function cleanIdentifier(language: ExportLanguage, rawName: string): string {
  const { text, startsWithDigit } = underscored(rawName);
  if (language === 'c') return text === '' ? 'data' : (startsWithDigit ? '__' : '') + text;
  return text === '' ? 'data' : text;
}

/**
 * The window of a file to export: `from` is a whole number from 0 to 2147483647, `length` absent means to the end and
 * 0 means none, a start at or past the end is the empty window, and a window over 4 MiB is refused naming the limit.
 */
export function exportRange(size: number, from: number, length?: number): { start: number; end: number } {
  if (!Number.isInteger(from) || from < 0 || from > MAX_POSITION) {
    throw new HexViewerError(
      `Export from byte must be a whole number from 0 to ${MAX_POSITION.toLocaleString('en-US')}.`,
      {
        field: 'Export from byte',
      },
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

/** The rows of bytes: `prefix` before each byte, `indent` before each row, a comma ends every row but the last. */
function rowsOf(bytes: Uint8Array, perLine: number, indent: string, prefix: string, digits: string[]): string[] {
  const rows: string[] = [];
  for (let from = 0; from < bytes.length; from += perLine) {
    const to = Math.min(from + perLine, bytes.length);
    let row = indent;
    for (let at = from; at < to; at++) row += (at > from ? ', ' : '') + prefix + digits[bytes[at]!]!;
    rows.push(to < bytes.length ? row + ',' : row);
  }
  return rows;
}

/** The bytes as an array in one of the languages, with the cleaned name, in one pass over the bytes. */
export function exportCodeArray(bytes: Uint8Array, options: ExportOptions): ExportResult {
  checkOptions(bytes, options.perLine);
  const language = EXPORT_LANGUAGES.find((info) => info.id === options.language);
  if (language === undefined) throw new HexViewerError('Export: that language is not offered.', { field: 'Export' });

  const base = cleanIdentifier(language.id, options.name);
  const identifier = options.capital === true ? base.toUpperCase() : base;
  const rows = rowsOf(bytes, options.perLine, '  ', options.upper ? '0X' : '0x', options.upper ? HEX_UPPER : HEX);
  const lengthName = `${identifier}_${options.capital === true ? 'LEN' : 'len'}`;
  const text =
    `unsigned char ${identifier}[] = {\n` +
    (rows.length > 0 ? `${rows.join('\n')}\n` : '') +
    `};\nunsigned int ${lengthName} = ${bytes.length};\n`;
  return { text, identifier, extension: language.extension, bytes: bytes.length, lines: rows.length };
}

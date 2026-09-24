import meta from './meta.json';

export { meta };

/**
 * RFC 20 section 4.1's control-character names, transcribed by hand: code,
 * abbreviation, full name. RFC 20 tags each name with a category --
 * (CC) Communication Control, (FE) Format Effector, (IS) Information
 * Separator -- those tags are not part of the transcription here (see
 * meta.json's ambiguities). Also includes 32 (SP, "Space") and 127 (DEL,
 * "Delete"); RFC 20 lists 32 among the printable characters and DEL outside
 * the control-character table entirely ("In the strict sense, DEL is not a
 * control character"), but both get the same abbreviation-plus-name
 * treatment here because neither has an ordinary printable glyph.
 *
 * Source: https://www.rfc-editor.org/rfc/rfc20, section 4.1.
 */
export const CONTROL_CODES: readonly [number, string, string][] = [
  [0, 'NUL', 'Null'],
  [1, 'SOH', 'Start of Heading'],
  [2, 'STX', 'Start of Text'],
  [3, 'ETX', 'End of Text'],
  [4, 'EOT', 'End of Transmission'],
  [5, 'ENQ', 'Enquiry'],
  [6, 'ACK', 'Acknowledge'],
  [7, 'BEL', 'Bell (audible or attention signal)'],
  [8, 'BS', 'Backspace'],
  [9, 'HT', 'Horizontal Tabulation'],
  [10, 'LF', 'Line Feed'],
  [11, 'VT', 'Vertical Tabulation'],
  [12, 'FF', 'Form Feed'],
  [13, 'CR', 'Carriage Return'],
  [14, 'SO', 'Shift Out'],
  [15, 'SI', 'Shift In'],
  [16, 'DLE', 'Data Link Escape'],
  [17, 'DC1', 'Device Control 1'],
  [18, 'DC2', 'Device Control 2'],
  [19, 'DC3', 'Device Control 3'],
  [20, 'DC4', 'Device Control 4 (Stop)'],
  [21, 'NAK', 'Negative Acknowledge'],
  [22, 'SYN', 'Synchronous Idle'],
  [23, 'ETB', 'End of Transmission Block'],
  [24, 'CAN', 'Cancel'],
  [25, 'EM', 'End of Medium'],
  [26, 'SUB', 'Substitute'],
  [27, 'ESC', 'Escape'],
  [28, 'FS', 'File Separator'],
  [29, 'GS', 'Group Separator'],
  [30, 'RS', 'Record Separator'],
  [31, 'US', 'Unit Separator'],
  [32, 'SP', 'Space'],
  [127, 'DEL', 'Delete'],
];

const CONTROL_BY_CODE: ReadonlyMap<number, { abbreviation: string; name: string }> = new Map(
  CONTROL_CODES.map(([code, abbreviation, name]) => [code, { abbreviation, name }]),
);

export interface AsciiRow {
  code: number;
  dec: string;
  /** Two-digit, upper-case. */
  hex: string;
  /** Three-digit. */
  oct: string;
  /** Seven-bit: ASCII is a seven-bit code (see meta.json limits). */
  bin: string;
  /** The literal character for a printable code; the control abbreviation (or "SP"/"DEL") otherwise. */
  char: string;
  abbreviation?: string;
  name?: string;
}

function padLeft(value: string, width: number): string {
  return value.length >= width ? value : '0'.repeat(width - value.length) + value;
}

/** The 128 rows of the seven-bit ASCII table (codes 0-127), generated arithmetically from each code -- never hand-typed. */
export const ASCII_ROWS: readonly AsciiRow[] = Array.from({ length: 128 }, (_, code) => {
  const control = CONTROL_BY_CODE.get(code);
  return {
    code,
    dec: String(code),
    hex: padLeft(code.toString(16).toUpperCase(), 2),
    oct: padLeft(code.toString(8), 3),
    bin: padLeft(code.toString(2), 7),
    char: control ? control.abbreviation : String.fromCharCode(code),
    abbreviation: control?.abbreviation,
    name: control?.name,
  };
});

/** Parses `query` as an exact decimal, 0x/0X hex, 0o octal or 0b binary number. Returns undefined if it is not one. */
function parseExactNumber(query: string): number | undefined {
  if (/^\d+$/.test(query)) return Number(query);
  if (/^0x[0-9a-f]+$/i.test(query)) return Number.parseInt(query.slice(2), 16);
  if (/^0o[0-7]+$/i.test(query)) return Number.parseInt(query.slice(2), 8);
  if (/^0b[01]+$/i.test(query)) return Number.parseInt(query.slice(2), 2);
  return undefined;
}

/**
 * Filters ASCII_ROWS, case-insensitively, by:
 *  - an exact number: decimal, 0x/0X hex, 0o octal or 0b binary;
 *  - a single literal character, compared against the printed character
 *    itself (so it still finds a control row even though that row's `char`
 *    field displays its abbreviation rather than an unprintable glyph);
 *  - otherwise, a substring of a row's control abbreviation or name.
 * An empty (or all-whitespace) query returns every row, so the page can run
 * as you type with no query yet entered.
 */
export function filterRows(query: string): AsciiRow[] {
  const trimmed = query.trim();
  if (trimmed === '') return [...ASCII_ROWS];

  const numeric = parseExactNumber(trimmed);
  if (numeric !== undefined) {
    return ASCII_ROWS.filter((row) => row.code === numeric);
  }

  if ([...trimmed].length === 1) {
    return ASCII_ROWS.filter((row) => row.char === trimmed || String.fromCharCode(row.code) === trimmed);
  }

  const needle = trimmed.toLowerCase();
  return ASCII_ROWS.filter(
    (row) =>
      (row.abbreviation !== undefined && row.abbreviation.toLowerCase().includes(needle)) ||
      (row.name !== undefined && row.name.toLowerCase().includes(needle)),
  );
}

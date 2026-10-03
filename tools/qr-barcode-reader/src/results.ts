/**
 * Turns what the reading engine returns for one code into what a page shows: a plain symbology name, the exact decoded
 * text, the same text with control and direction-changing characters escaped, and notes that explain anything the
 * engine does differently from what a reader might expect. Pure: no DOM, no clock, nothing logged.
 */

/** Decoded text longer than this is cut for display only; the exact text is still returned whole. */
export const MAX_TEXT_SHOWN = 4096;

export interface CodeResult {
  /** The engine's own name for the symbology, for example `QRCode` or `EAN13`. */
  format: string;
  /** A plain name for it, for example `QR Code` or `EAN-13`; an unknown engine name is shown as written, escaped. */
  label: string;
  /** The exact decoded text. */
  text: string;
  /** The text as shown: cut at MAX_TEXT_SHOWN characters and with control and direction-changing characters escaped. */
  shown: string;
  /** True when `shown` leaves out the end of `text`. */
  truncated: boolean;
  /** Plain sentences about this code, possibly none. */
  notes: string[];
}

/** The two fields of an engine result this module needs. */
export interface RawRead {
  format: string;
  text: string;
}

/** Plain names for the symbologies the engine reads. A Map, so an engine name such as `__proto__` is just a miss. */
export const SYMBOLOGY_LABELS: ReadonlyMap<string, string> = new Map([
  ['QRCode', 'QR Code'],
  ['QRCodeModel1', 'QR Code (Model 1)'],
  ['QRCodeModel2', 'QR Code'],
  ['MicroQRCode', 'Micro QR Code'],
  ['RMQRCode', 'Rectangular Micro QR Code'],
  ['DataMatrix', 'Data Matrix'],
  ['Aztec', 'Aztec Code'],
  ['AztecCode', 'Aztec Code'],
  ['AztecRune', 'Aztec Rune'],
  ['PDF417', 'PDF417'],
  ['CompactPDF417', 'Compact PDF417'],
  ['MicroPDF417', 'Micro PDF417'],
  ['MaxiCode', 'MaxiCode'],
  ['Code128', 'Code 128'],
  ['Code39', 'Code 39'],
  ['Code39Std', 'Code 39'],
  ['Code39Ext', 'Code 39 Extended'],
  ['Code32', 'Code 32'],
  ['PZN', 'PZN'],
  ['Code93', 'Code 93'],
  ['Codabar', 'Codabar'],
  ['ITF', 'ITF (Interleaved 2 of 5)'],
  ['ITF14', 'ITF-14'],
  ['EAN13', 'EAN-13'],
  ['EAN8', 'EAN-8'],
  ['EAN5', 'EAN-5 add-on'],
  ['EAN2', 'EAN-2 add-on'],
  ['ISBN', 'ISBN'],
  ['UPCA', 'UPC-A'],
  ['UPCE', 'UPC-E'],
  ['EANUPC', 'EAN or UPC'],
  ['DataBar', 'GS1 DataBar'],
  ['DataBarOmni', 'GS1 DataBar Omnidirectional'],
  ['DataBarStk', 'GS1 DataBar Stacked'],
  ['DataBarStkOmni', 'GS1 DataBar Stacked Omnidirectional'],
  ['DataBarLtd', 'GS1 DataBar Limited'],
  ['DataBarExp', 'GS1 DataBar Expanded'],
  ['DataBarExpanded', 'GS1 DataBar Expanded'],
  ['DataBarExpStk', 'GS1 DataBar Expanded Stacked'],
  ['Telepen', 'Telepen'],
  ['TelepenAlpha', 'Telepen Alpha'],
  ['TelepenNumeric', 'Telepen Numeric'],
  ['DXFilmEdge', 'DX Film Edge'],
  ['OtherBarcode', 'Other barcode'],
]);

const BACKSLASH = String.fromCharCode(92);

/** True for the code units `visible` escapes: control characters other than tab and line feed, and the direction marks. */
function isEscaped(unit: number): boolean {
  if (unit <= 0x1f) return unit !== 0x09 && unit !== 0x0a;
  if (unit >= 0x7f && unit <= 0x9f) return true;
  if (unit === 0x61c || unit === 0x200e || unit === 0x200f) return true;
  if (unit >= 0x202a && unit <= 0x202e) return true;
  return unit >= 0x2066 && unit <= 0x2069;
}

/**
 * The text with U+0000 to U+001F (except tab and line feed), U+007F, U+0080 to U+009F, U+061C, U+200E, U+200F,
 * U+202A to U+202E and U+2066 to U+2069 written as the backslash, `u{`, the code point in capital hexadecimal and `}`,
 * so a decoded code cannot move the cursor, hide text or reorder what a reader sees. One pass, linear in the text.
 */
export function visible(text: string): string {
  let out = '';
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (!isEscaped(unit)) continue;
    out += text.slice(from, i) + BACKSLASH + 'u{' + unit.toString(16).toUpperCase() + '}';
    from = i + 1;
  }
  return out + text.slice(from);
}

/** The first `limit` characters of the text, never ending in the first half of a surrogate pair. */
function head(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const last = text.charCodeAt(limit - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? limit - 1 : limit;
  return text.slice(0, end);
}

/** The 12 digit UPC-A form of an EAN-13 text that starts with a zero, or null when the text is not one. */
function upcaForm(text: string): string | null {
  if (text.length !== 13 || text.charCodeAt(0) !== 0x30) return null;
  for (let i = 1; i < 13; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x30 || c > 0x39) return null;
  }
  return text.slice(1);
}

export function toCodeResult(raw: RawRead): CodeResult {
  const label = SYMBOLOGY_LABELS.get(raw.format) ?? visible(raw.format);
  const notes: string[] = [];

  if (raw.format === 'EAN13') {
    const upca = upcaForm(raw.text);
    if (upca !== null) {
      notes.push(`If this is a UPC-A code, its 12 digit form is ${upca}; UPC-A is an EAN-13 code with a leading zero.`);
    }
  }
  if (raw.format === 'UPCE') {
    notes.push('The engine gives the 13 digit form this UPC-E code expands to.');
  }

  const truncated = raw.text.length > MAX_TEXT_SHOWN;
  if (truncated) notes.push(`Only the first ${MAX_TEXT_SHOWN} characters are shown here; the code holds more.`);

  return {
    format: raw.format,
    label,
    text: raw.text,
    shown: visible(head(raw.text, MAX_TEXT_SHOWN)),
    truncated,
    notes,
  };
}

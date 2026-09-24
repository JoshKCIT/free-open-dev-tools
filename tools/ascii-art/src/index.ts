import meta from './meta.json';
import { FONTS, FONT_NAMES, type FontName } from './fonts/index';

export { meta, FONT_NAMES };
export type { FontName };

export class FigletFontError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FigletFontError';
  }
}

export interface FigFont {
  hardblank: string;
  height: number;
  baseline: number;
  maxLength: number;
  oldLayout: number;
  commentLines: number;
  printDirection?: number;
  fullLayout?: number;
  codetagCount?: number;
  /** Each character's glyph lines (length === height), endmarks stripped, hardblank characters kept as-is (not yet substituted for a space). Keyed by Unicode code point. */
  characters: Map<number, string[]>;
}

export type Layout = 'full' | 'fitted';

export interface BannerResult {
  /** The rendered banner, `height` lines per input line, stacked in input order. */
  lines: string[];
  /** Input characters with no glyph in the chosen font, in first-encountered order, without duplicates. */
  missing: string[];
}

/**
 * The 95 printable ASCII codes (32-126) plus the seven required Deutsch
 * (German) characters, in the exact order the FIGfont Version 2
 * specification requires them to appear: umlauted A, O, U, a, o, u, then
 * ess-zed.
 */
const REQUIRED_CODES: readonly number[] = [
  ...Array.from({ length: 95 }, (_, i) => 32 + i),
  196,
  214,
  220,
  228,
  246,
  252,
  223,
];

/**
 * Removes the trailing run of a FIGcharacter line's endmark: the FIGfont
 * spec defines this as "the last block of consecutive equal characters"
 * (one endmark on most lines, two on a character's last line -- but the
 * rule itself only cares about the repeated run, not the count).
 */
function stripEndmark(line: string): string {
  if (line.length === 0) return line;
  const last = line[line.length - 1];
  let i = line.length;
  while (i > 0 && line[i - 1] === last) i--;
  return line.slice(0, i);
}

/**
 * Parses a raw FIGfont Version 2 file's text into a FigFont. Reads the
 * header, skips the comment lines, then reads the 95 printable ASCII
 * characters and the seven required Deutsch characters, in that fixed
 * order. Throws FigletFontError for anything that does not match the
 * format.
 */
export function parseFont(text: string): FigFont {
  const lines = text.split(/\r\n|\r|\n/);
  const headerLine = lines[0] ?? '';

  if (headerLine.slice(0, 5) !== 'flf2a') {
    throw new FigletFontError('Not a FIGfont Version 2 file: the header does not start with the "flf2a" signature.');
  }
  // The hardblank character immediately follows the signature, with no
  // separator -- reading it by character position (rather than splitting
  // the header line on whitespace) is what lets a hardblank that is
  // itself a literal space parse correctly, since several bundled fonts
  // (bubble, digital, term) use exactly that.
  const hardblank = headerLine[5];
  if (hardblank === undefined) {
    throw new FigletFontError('Not a FIGfont Version 2 file: the header has no hardblank character.');
  }

  const numberFields = headerLine
    .slice(6)
    .trim()
    .split(/\s+/)
    .map((n) => Number(n));
  if (numberFields.length < 5 || numberFields.some((n) => Number.isNaN(n))) {
    throw new FigletFontError(
      'Malformed FIGfont header: expected at least five numeric parameters after the hardblank.',
    );
  }
  const [height, baseline, maxLength, oldLayout, commentLines, printDirection, fullLayout, codetagCount] =
    numberFields as [
      number,
      number,
      number,
      number,
      number,
      number | undefined,
      number | undefined,
      number | undefined,
    ];

  if (!Number.isInteger(height) || height < 1) {
    throw new FigletFontError('Malformed FIGfont header: Height must be a positive integer.');
  }
  if (!Number.isInteger(baseline) || baseline < 1 || baseline > height) {
    throw new FigletFontError('Malformed FIGfont header: Baseline must be between 1 and Height.');
  }

  let cursor = 1 + commentLines;
  const characters = new Map<number, string[]>();
  for (const code of REQUIRED_CODES) {
    const glyphLines: string[] = [];
    for (let i = 0; i < height; i++) {
      const raw = lines[cursor];
      if (raw === undefined) {
        throw new FigletFontError(`Malformed FIGfont: ran out of lines while reading the character for code ${code}.`);
      }
      glyphLines.push(stripEndmark(raw));
      cursor++;
    }
    characters.set(code, glyphLines);
  }

  return {
    hardblank,
    height,
    baseline,
    maxLength,
    oldLayout,
    commentLines,
    printDirection,
    fullLayout,
    codetagCount,
    characters,
  };
}

/** Parsed fonts are cached by name so repeated renders (as the visitor types) do not re-parse the same font text. */
const fontCache = new Map<string, FigFont>();

function getFont(fontName: string): FigFont {
  const cached = fontCache.get(fontName);
  if (cached) return cached;
  const text = FONTS[fontName as FontName];
  if (text === undefined) {
    throw new FigletFontError(`"${fontName}" is not one of this tool's bundled fonts.`);
  }
  const font = parseFont(text);
  fontCache.set(fontName, font);
  return font;
}

/**
 * Composes one input line's characters side by side in full-width layout,
 * where every character keeps its own designed width as-is. Fitted
 * (kerning) layout is added in a later task of this plan.
 */
function composeLine(font: FigFont, lineText: string, layout: Layout, missing: Set<string>): string[] {
  if (layout !== 'full') {
    throw new FigletFontError('Fitted layout is not supported yet.');
  }

  let buffer: string[] = Array.from({ length: font.height }, () => '');
  let started = false;

  for (const ch of lineText) {
    const code = ch.codePointAt(0)!;
    const glyph = font.characters.get(code);
    if (!glyph) {
      missing.add(ch);
      continue;
    }
    if (!started) {
      buffer = glyph.slice();
      started = true;
      continue;
    }
    buffer = buffer.map((row, i) => row + glyph[i]!);
  }

  // A hardblank substitutes for an ordinary space only at the very end,
  // after fitting has used the distinction between a real space and a
  // hardblank to decide how far characters may move.
  return buffer.map((row) => row.split(font.hardblank).join(' '));
}

/**
 * Renders `text` as a FIGlet banner using one of this tool's bundled
 * fonts, named by `fontName`. Each line of `text` (split on any line
 * break) becomes its own block of `font.height` output lines, stacked in
 * order with no vertical smushing between blocks (out of scope; see
 * meta.json limits).
 */
export function renderBanner(fontName: string, text: string, options: { layout: Layout }): BannerResult {
  const font = getFont(fontName);
  const missing = new Set<string>();
  const lines: string[] = [];

  for (const inputLine of text.split(/\r\n|\r|\n/)) {
    lines.push(...composeLine(font, inputLine, options.layout, missing));
  }

  return { lines, missing: [...missing] };
}

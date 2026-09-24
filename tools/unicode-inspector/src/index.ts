import meta from './meta.json';

export { meta };

export class UnicodeInspectorError extends Error {
  /** Index into the input where the problem was found. */
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'UnicodeInspectorError';
    this.position = position;
  }
}

export interface CodePointRow {
  /** The literal character, unmodified, whatever it renders as (including nothing at all). */
  char: string;
  /** What to show in place of `char` when it has no printable glyph or is easy to mistake for another. */
  visibleAs: string;
  /** The code point in the conventional U+XXXX form, four hex digits or more. */
  codePoint: string;
  /** A real short name for a table-listed character, or the general category's human-readable name otherwise. */
  name: string;
  /** The Unicode general category, as a two-letter code plus its human-readable label. */
  category: string;
  /** UTF-8 bytes in hexadecimal, space separated. Empty for an unpaired surrogate, which has no UTF-8 encoding. */
  utf8Bytes: string;
  /** Whether this row counts toward the invisible-character total. */
  invisible: boolean;
  /** A short explanatory note, set only when one is needed (currently: unpaired surrogates). */
  note?: string;
}

export interface InvisibleEntry {
  /** A real short name: what a person would call this character. */
  name: string;
  /** The visible stand-in shown in the "Visible as" column. */
  standIn: string;
}

const CONTROL_NAMES = [
  'NUL',
  'SOH',
  'STX',
  'ETX',
  'EOT',
  'ENQ',
  'ACK',
  'BEL',
  'BS',
  'TAB',
  'LF',
  'VT',
  'FF',
  'CR',
  'SO',
  'SI',
  'DLE',
  'DC1',
  'DC2',
  'DC3',
  'DC4',
  'NAK',
  'SYN',
  'ETB',
  'CAN',
  'EM',
  'SUB',
  'ESC',
  'FS',
  'GS',
  'RS',
  'US',
];

/**
 * The independent, hand-maintained table this package builds invisible-
 * character detection on. It covers the C0 control characters (with their
 * matching Unicode Control Pictures glyphs, U+2400-U+241F and U+2421 for
 * DEL), zero-width and bidirectional format characters, uncommon space
 * characters, and a short list of characters that render normally but are
 * routinely mistaken for something else.
 *
 * This table -- and the general category catch-all below it -- are the
 * ONLY inputs to invisible-character detection. Normalisation is an
 * unrelated Unicode property: most invisible characters (a zero-width
 * space, for instance) pass through all four normalisation forms
 * completely unchanged, so deriving invisibility from what `.normalize()`
 * changes would miss nearly all of them. Wiring one through the other is
 * exactly the mistake this comment exists to prevent.
 */
const INVISIBLE = new Map<number, InvisibleEntry>();

for (let code = 0; code <= 0x1f; code++) {
  INVISIBLE.set(code, { name: CONTROL_NAMES[code]!, standIn: String.fromCodePoint(0x2400 + code) });
}
INVISIBLE.set(0x7f, { name: 'DEL', standIn: '␡' });

const FORMAT_CHARACTERS: [number, string, string][] = [
  [0x00ad, 'SOFT HYPHEN', '[SHY]'],
  [0x200b, 'ZERO WIDTH SPACE', '[ZWSP]'],
  [0x200c, 'ZERO WIDTH NON-JOINER', '[ZWNJ]'],
  [0x200d, 'ZERO WIDTH JOINER', '[ZWJ]'],
  [0x200e, 'LEFT-TO-RIGHT MARK', '[LRM]'],
  [0x200f, 'RIGHT-TO-LEFT MARK', '[RLM]'],
  [0x2028, 'LINE SEPARATOR', '[LINE SEP]'],
  [0x2029, 'PARAGRAPH SEPARATOR', '[PARA SEP]'],
  [0x2060, 'WORD JOINER', '[WJ]'],
  [0x2061, 'FUNCTION APPLICATION', '[FUNCTION APPLICATION]'],
  [0x202a, 'LEFT-TO-RIGHT EMBEDDING', '[LRE]'],
  [0x202b, 'RIGHT-TO-LEFT EMBEDDING', '[RLE]'],
  [0x202c, 'POP DIRECTIONAL FORMATTING', '[PDF]'],
  [0x202d, 'LEFT-TO-RIGHT OVERRIDE', '[LRO]'],
  [0x202e, 'RIGHT-TO-LEFT OVERRIDE', '[RLO]'],
  [0x2066, 'LEFT-TO-RIGHT ISOLATE', '[LRI]'],
  [0x2067, 'RIGHT-TO-LEFT ISOLATE', '[RLI]'],
  [0x2068, 'FIRST STRONG ISOLATE', '[FSI]'],
  [0x2069, 'POP DIRECTIONAL ISOLATE', '[PDI]'],
  [0xfeff, 'ZERO WIDTH NO-BREAK SPACE (BYTE ORDER MARK)', '[BOM]'],
];
for (const [code, name, standIn] of FORMAT_CHARACTERS) INVISIBLE.set(code, { name, standIn });

const SPACE_CHARACTERS: [number, string, string][] = [
  [0x00a0, 'NO-BREAK SPACE', '[NBSP]'],
  [0x2000, 'EN QUAD', '[EN QUAD]'],
  [0x2001, 'EM QUAD', '[EM QUAD]'],
  [0x2002, 'EN SPACE', '[EN SP]'],
  [0x2003, 'EM SPACE', '[EM SP]'],
  [0x2004, 'THREE-PER-EM SPACE', '[3/EM SP]'],
  [0x2005, 'FOUR-PER-EM SPACE', '[4/EM SP]'],
  [0x2006, 'SIX-PER-EM SPACE', '[6/EM SP]'],
  [0x2007, 'FIGURE SPACE', '[FIGURE SP]'],
  [0x2008, 'PUNCTUATION SPACE', '[PUNCT SP]'],
  [0x2009, 'THIN SPACE', '[THIN SP]'],
  [0x200a, 'HAIR SPACE', '[HAIR SP]'],
  [0x202f, 'NARROW NO-BREAK SPACE', '[NNBSP]'],
  [0x205f, 'MEDIUM MATHEMATICAL SPACE', '[MMSP]'],
  [0x3000, 'IDEOGRAPHIC SPACE', '[IDEOGRAPHIC SP]'],
];
for (const [code, name, standIn] of SPACE_CHARACTERS) INVISIBLE.set(code, { name, standIn });

const CONFUSABLE_CHARACTERS: [number, string, string][] = [
  [0x180e, 'MONGOLIAN VOWEL SEPARATOR', '[MVS]'],
  [0x2011, 'NON-BREAKING HYPHEN', '[NB HYPHEN]'],
];
for (const [code, name, standIn] of CONFUSABLE_CHARACTERS) INVISIBLE.set(code, { name, standIn });

export { INVISIBLE };

const CATEGORY_LABELS: Record<string, string> = {
  Lu: 'Uppercase Letter',
  Ll: 'Lowercase Letter',
  Lt: 'Titlecase Letter',
  Lm: 'Modifier Letter',
  Lo: 'Other Letter',
  Mn: 'Nonspacing Mark',
  Mc: 'Spacing Mark',
  Me: 'Enclosing Mark',
  Nd: 'Decimal Number',
  Nl: 'Letter Number',
  No: 'Other Number',
  Pc: 'Connector Punctuation',
  Pd: 'Dash Punctuation',
  Ps: 'Open Punctuation',
  Pe: 'Close Punctuation',
  Pi: 'Initial Punctuation',
  Pf: 'Final Punctuation',
  Po: 'Other Punctuation',
  Sm: 'Math Symbol',
  Sc: 'Currency Symbol',
  Sk: 'Modifier Symbol',
  So: 'Other Symbol',
  Zs: 'Space Separator',
  Zl: 'Line Separator',
  Zp: 'Paragraph Separator',
  Cc: 'Control',
  Cf: 'Format',
  Cs: 'Surrogate',
  Co: 'Private Use',
  Cn: 'Unassigned',
};

/**
 * One compiled Unicode property-escape regular expression per general
 * category value. This is what gives an accurate category with no bundled
 * character database at all: `\p{General_Category=...}` is native to every
 * JavaScript engine this project targets. Order matters only for speed
 * (commoner categories first); every code point matches exactly one.
 */
const CATEGORY_TESTS: { code: string; test: RegExp }[] = [
  'Ll',
  'Lu',
  'Nd',
  'Po',
  'Zs',
  'Lo',
  'Lt',
  'Lm',
  'Mn',
  'Mc',
  'Me',
  'Nl',
  'No',
  'Pc',
  'Pd',
  'Ps',
  'Pe',
  'Pi',
  'Pf',
  'Sm',
  'Sc',
  'Sk',
  'So',
  'Zl',
  'Zp',
  'Cc',
  'Cf',
  'Cs',
  'Co',
].map((code) => ({ code, test: new RegExp(`\\p{General_Category=${code}}`, 'u') }));

function generalCategory(codePoint: number): { code: string; label: string } {
  const ch = String.fromCodePoint(codePoint);
  for (const { code, test } of CATEGORY_TESTS) {
    if (test.test(ch)) return { code, label: CATEGORY_LABELS[code]! };
  }
  return { code: 'Cn', label: CATEGORY_LABELS.Cn! };
}

/** Control, format and surrogate code points are invisible even when not individually named in the table above. */
function isInvisibleCategory(categoryCode: string): boolean {
  return (
    categoryCode === 'Cc' ||
    categoryCode === 'Cf' ||
    categoryCode === 'Cs' ||
    categoryCode === 'Zl' ||
    categoryCode === 'Zp'
  );
}

function genericStandIn(codePoint: number, categoryCode: string): string {
  const hex = codePointLabel(codePoint);
  if (categoryCode === 'Cc') return `[CONTROL ${hex}]`;
  if (categoryCode === 'Cf') return `[FORMAT ${hex}]`;
  if (categoryCode === 'Cs') return `[SURROGATE ${hex}]`;
  if (categoryCode === 'Zl') return `[LINE SEP ${hex}]`;
  if (categoryCode === 'Zp') return `[PARA SEP ${hex}]`;
  return `[${hex}]`;
}

function codePointLabel(codePoint: number): string {
  return 'U+' + codePoint.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Inspects a string, returning one row per code point -- never per code
 * unit, so a character outside the Basic Multilingual Plane produces one
 * row carrying both its full code point value and its UTF-8 bytes.
 *
 * Iterates using the string's own iterator (a `for...of` loop), never by
 * index, so a valid surrogate pair stays whole and an unpaired surrogate is
 * reported as exactly the lone code unit it is.
 */
export function inspect(text: string): CodePointRow[] {
  const rows: CodePointRow[] = [];
  for (const ch of text) {
    const codePoint = ch.codePointAt(0)!;
    const isUnpairedSurrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
    const category = generalCategory(codePoint);
    const tableEntry = INVISIBLE.get(codePoint);
    const invisible = tableEntry !== undefined || isInvisibleCategory(category.code);

    const visibleAs = tableEntry ? tableEntry.standIn : invisible ? genericStandIn(codePoint, category.code) : ch;
    const name = tableEntry ? tableEntry.name : category.label;

    // A string iterator hands back an unpaired surrogate intact, but a
    // conventional TextEncoder turns it into the three bytes of the
    // replacement character (EF BF BD), which are NOT the surrogate's own
    // bytes -- an unpaired surrogate has no UTF-8 encoding at all. Presenting
    // those bytes as though they belonged to the surrogate would be exactly
    // the kind of quiet wrong answer this tool exists to prevent, so the
    // byte column is left empty and a note explains why.
    const utf8Bytes = isUnpairedSurrogate
      ? ''
      : Array.from(new TextEncoder().encode(ch), (b) => b.toString(16).padStart(2, '0'))
          .join(' ')
          .toUpperCase();

    rows.push({
      char: ch,
      visibleAs,
      codePoint: codePointLabel(codePoint),
      name,
      category: `${category.code} (${category.label})`,
      utf8Bytes,
      invisible,
      note: isUnpairedSurrogate ? 'Unpaired surrogate: no UTF-8 encoding.' : undefined,
    });
  }
  return rows;
}

export type NormalisationForm = 'NFC' | 'NFD' | 'NFKC' | 'NFKD';

/** Wraps the JavaScript engine's own `String.prototype.normalize`. The Unicode version tracks the runtime, not this package. */
export function normalise(text: string, form: NormalisationForm): string {
  return text.normalize(form);
}

export type EscapeStyle = 'javascript' | 'html-numeric' | 'code-point';

export interface ToEscapesOptions {
  /** Default 'javascript'. */
  style?: EscapeStyle;
}

/**
 * Converts text to escape sequences.
 *
 * 'javascript' walks by UTF-16 code unit (classic \uXXXX form), so a
 * character outside the Basic Multilingual Plane produces two escapes, one
 * per surrogate half. 'html-numeric' and 'code-point' walk by code point,
 * each producing exactly one escape per character regardless of plane.
 */
export function toEscapes(text: string, options: ToEscapesOptions = {}): string {
  const { style = 'javascript' } = options;

  if (style === 'javascript') {
    let out = '';
    for (let i = 0; i < text.length; i++) {
      out += '\\u' + text.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
    }
    return out;
  }

  let out = '';
  for (const ch of text) {
    const codePoint = ch.codePointAt(0)!;
    out += style === 'html-numeric' ? `&#${codePoint};` : `\\u{${codePoint.toString(16).toUpperCase()}}`;
  }
  return out;
}

export interface FromEscapesOptions {
  /** Default 'javascript'. Must match the style {@link toEscapes} produced. */
  style?: EscapeStyle;
}

/**
 * Converts escape sequences back to text. Any character that is not the
 * start of a recognised escape for the chosen style is copied through
 * literally, so a text mixing escaped and literal characters still parses.
 * A recognised-but-malformed escape is rejected with its position.
 */
export function fromEscapes(text: string, options: FromEscapesOptions = {}): string {
  const { style = 'javascript' } = options;
  let out = '';
  let i = 0;

  while (i < text.length) {
    if (style === 'javascript' && text.startsWith('\\u', i)) {
      const hex = text.slice(i + 2, i + 6);
      if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
        throw new UnicodeInspectorError(
          `"\\u" must be followed by exactly four hexadecimal digits; found "${hex}".`,
          i,
        );
      }
      out += String.fromCharCode(parseInt(hex, 16));
      i += 6;
      continue;
    }

    if (style === 'code-point' && text.startsWith('\\u{', i)) {
      const end = text.indexOf('}', i + 3);
      if (end === -1) throw new UnicodeInspectorError('Missing closing "}" in a \\u{...} escape.', i);
      const hex = text.slice(i + 3, end);
      if (!/^[0-9a-fA-F]{1,6}$/.test(hex)) {
        throw new UnicodeInspectorError(`"\\u{...}" must contain one to six hexadecimal digits; found "${hex}".`, i);
      }
      const codePoint = parseInt(hex, 16);
      if (codePoint > 0x10ffff) {
        throw new UnicodeInspectorError(
          `U+${hex.toUpperCase()} is beyond the maximum Unicode code point, U+10FFFF.`,
          i,
        );
      }
      out += String.fromCodePoint(codePoint);
      i = end + 1;
      continue;
    }

    if (style === 'html-numeric' && text.startsWith('&#', i)) {
      const end = text.indexOf(';', i + 2);
      if (end === -1) throw new UnicodeInspectorError('Missing closing ";" in a numeric character reference.', i);
      const body = text.slice(i + 2, end);
      const isHex = body[0] === 'x' || body[0] === 'X';
      const digits = isHex ? body.slice(1) : body;
      const valid = isHex ? /^[0-9a-fA-F]+$/.test(digits) : /^[0-9]+$/.test(digits);
      if (!valid || digits.length === 0) {
        throw new UnicodeInspectorError(`"${text.slice(i, end + 1)}" is not a valid numeric character reference.`, i);
      }
      const codePoint = parseInt(digits, isHex ? 16 : 10);
      if (codePoint > 0x10ffff) {
        throw new UnicodeInspectorError(
          `U+${codePoint.toString(16).toUpperCase()} is beyond the maximum Unicode code point, U+10FFFF.`,
          i,
        );
      }
      out += String.fromCodePoint(codePoint);
      i = end + 1;
      continue;
    }

    out += text[i];
    i++;
  }

  return out;
}

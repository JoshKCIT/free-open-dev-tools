/** What the page knows about a character that forces a message into UCS-2. */
export interface Offender {
  /** What it is, in this project's own words. */
  name: string;
  /** The Unicode character name, as recorded from Python's unicodedata in test/fixtures/names (compared by a test). */
  unicodeName: string;
  /** What to write instead, entirely in the GSM 7-bit alphabet. An empty string means the character can simply go. */
  suggestion: string;
}

/**
 * The characters that most often turn a message into UCS-2, each with a replacement written in the GSM 7-bit alphabet.
 * Keyed by code point in a Map, so a character named like an object key is just text. Each row is
 * [code point, name, Unicode name, replacement]; test/fixtures/names/record-names.py reads the code points from the rows
 * that start with `[0x`.
 */
const ROWS: ReadonlyArray<readonly [number, string, string, string]> = [
  // Quotation marks, dashes and signs that word processors and phones put in for you
  [0x2018, 'Curly single quote, opening', 'LEFT SINGLE QUOTATION MARK', "'"],
  [0x2019, 'Curly single quote, closing, also the curly apostrophe', 'RIGHT SINGLE QUOTATION MARK', "'"],
  [0x201c, 'Curly double quote, opening', 'LEFT DOUBLE QUOTATION MARK', '"'],
  [0x201d, 'Curly double quote, closing', 'RIGHT DOUBLE QUOTATION MARK', '"'],
  [0x2013, 'En dash', 'EN DASH', '-'],
  [0x2014, 'Em dash', 'EM DASH', '-'],
  [0x2212, 'Minus sign', 'MINUS SIGN', '-'],
  [0x2026, 'Ellipsis written as one character', 'HORIZONTAL ELLIPSIS', '...'],
  [0x2022, 'Bullet', 'BULLET', '*'],
  [0x2122, 'Trade mark sign', 'TRADE MARK SIGN', 'TM'],
  [0x00a9, 'Copyright sign', 'COPYRIGHT SIGN', '(c)'],
  [0x00ae, 'Registered sign', 'REGISTERED SIGN', '(R)'],
  [0x00b0, 'Degree sign', 'DEGREE SIGN', 'deg'],
  [0x00d7, 'Multiplication sign', 'MULTIPLICATION SIGN', 'x'],
  [0x00bd, 'One half as one character', 'VULGAR FRACTION ONE HALF', '1/2'],
  [0x2192, 'Right arrow', 'RIGHTWARDS ARROW', '->'],
  // Spaces and invisible characters
  [0x00a0, 'No-break space (looks like a space)', 'NO-BREAK SPACE', ' '],
  [0x200b, 'Zero-width space (invisible)', 'ZERO WIDTH SPACE', ''],
  [0x200c, 'Zero-width non-joiner (invisible)', 'ZERO WIDTH NON-JOINER', ''],
  [0x200d, 'Zero-width joiner (invisible)', 'ZERO WIDTH JOINER', ''],
  [0xfeff, 'Byte order mark, or zero-width no-break space (invisible)', 'ZERO WIDTH NO-BREAK SPACE', ''],
  [0x00ad, 'Soft hyphen (invisible)', 'SOFT HYPHEN', ''],
  [0x2028, 'Line separator (a line break that is not a line feed)', 'LINE SEPARATOR', '\n'],
  [0x2029, 'Paragraph separator (a line break that is not a line feed)', 'PARAGRAPH SEPARATOR', '\n'],
  [0x0009, 'Tab', 'CHARACTER TABULATION', ' '],
  // Letters with marks that the default alphabet does not have (it has only a few such letters, and capital C cedilla)
  [
    0x00e7,
    'Lower case c with a cedilla (only the capital is in the alphabet)',
    'LATIN SMALL LETTER C WITH CEDILLA',
    'c',
  ],
  [0x00e1, 'Lower case a with an acute accent', 'LATIN SMALL LETTER A WITH ACUTE', 'a'],
  [0x00e2, 'Lower case a with a circumflex', 'LATIN SMALL LETTER A WITH CIRCUMFLEX', 'a'],
  [0x00ea, 'Lower case e with a circumflex', 'LATIN SMALL LETTER E WITH CIRCUMFLEX', 'e'],
  [0x00ed, 'Lower case i with an acute accent', 'LATIN SMALL LETTER I WITH ACUTE', 'i'],
  [0x00f3, 'Lower case o with an acute accent', 'LATIN SMALL LETTER O WITH ACUTE', 'o'],
  [0x00f4, 'Lower case o with a circumflex', 'LATIN SMALL LETTER O WITH CIRCUMFLEX', 'o'],
  [0x00fa, 'Lower case u with an acute accent', 'LATIN SMALL LETTER U WITH ACUTE', 'u'],
  // Letters of other alphabets that look like Latin letters
  [0x0430, 'Cyrillic letter that looks like a Latin a', 'CYRILLIC SMALL LETTER A', 'a'],
  [0x0435, 'Cyrillic letter that looks like a Latin e', 'CYRILLIC SMALL LETTER IE', 'e'],
  [0x043e, 'Cyrillic letter that looks like a Latin o', 'CYRILLIC SMALL LETTER O', 'o'],
  [0x0440, 'Cyrillic letter that looks like a Latin p', 'CYRILLIC SMALL LETTER ER', 'p'],
  [0x0441, 'Cyrillic letter that looks like a Latin c', 'CYRILLIC SMALL LETTER ES', 'c'],
  [0x0445, 'Cyrillic letter that looks like a Latin x', 'CYRILLIC SMALL LETTER HA', 'x'],
  [0x0391, 'Greek capital that looks like a Latin A', 'GREEK CAPITAL LETTER ALPHA', 'A'],
  [0x039f, 'Greek capital that looks like a Latin O', 'GREEK CAPITAL LETTER OMICRON', 'O'],
  // Emoji
  [0x1f600, 'Grinning face emoji', 'GRINNING FACE', ':)'],
  [0x2764, 'Heart symbol', 'HEAVY BLACK HEART', '<3'],
  [0x1f44d, 'Thumbs up emoji', 'THUMBS UP SIGN', 'OK'],
];

/** The listed characters, by code point. */
export const OFFENDERS: ReadonlyMap<number, Offender> = new Map(
  ROWS.map(([codePoint, name, unicodeName, suggestion]) => [codePoint, { name, unicodeName, suggestion }]),
);

/** `U+` and the code point in at least four upper case hexadecimal digits. */
export function codePointLabel(codePoint: number): string {
  return 'U+' + codePoint.toString(16).toUpperCase().padStart(4, '0');
}

/** What the page says about a forced character: its listed name and replacement, or the code point when it is not listed. */
export function describeForced(codePoint: number): { name: string; suggestion: string | undefined } {
  const listed = OFFENDERS.get(codePoint);
  if (listed) return { name: listed.name, suggestion: listed.suggestion };
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
    return { name: 'Unpaired surrogate (half of a character above U+FFFF)', suggestion: undefined };
  }
  return { name: codePointLabel(codePoint), suggestion: undefined };
}

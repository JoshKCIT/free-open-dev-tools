/**
 * What the registered OpenType layout features do, in the project's own words (the registry's text is not copied). The tags
 * are the 124 the OpenType 1.9.1 feature list names one by one; `cv01` to `cv99` and `ss01` to `ss20` are patterns. Every
 * lookup is a `Map` read, so a tag such as a prototype property name finds nothing.
 */
const REGISTERED: readonly (readonly [string, string])[] = [
  ['aalt', 'Gathers every alternate form of a glyph into one place so a menu can offer them'],
  ['abvf', 'Swaps in the form a base character takes under a mark placed above it'],
  ['abvm', 'Positions marks that sit above their base character'],
  ['abvs', 'Substitutes the joined forms used with marks above the base'],
  ['afrc', 'Builds fractions with the numerator stacked above the denominator'],
  ['akhn', 'Forms the fixed two-letter ligatures of Indic scripts'],
  ['apkn', 'Kerning that goes with alternate proportional widths'],
  ['blwf', 'Swaps in the forms characters take below a base character'],
  ['blwm', 'Positions marks that sit below their base character'],
  ['blws', 'Substitutes the joined forms used with marks below the base'],
  ['calt', 'Picks alternate glyphs depending on the letters around them'],
  ['case', 'Adjusts punctuation and symbols to sit well beside capital letters'],
  ['ccmp', 'Splits or joins characters into the glyph sequences the font really draws'],
  ['cfar', 'Forms the conjunct that follows a Khmer coeng ro'],
  ['chws', 'Adjusts the spacing of half-width CJK characters by context'],
  ['cjct', 'Forms conjuncts of consonants in Indic scripts'],
  ['clig', 'Ligatures that apply only in certain letter contexts'],
  ['cpct', 'Centres CJK punctuation in its cell'],
  ['cpsp', 'Opens up the spacing of capital letters'],
  ['cswh', 'Contextual swash forms'],
  ['curs', 'Connects cursive letters so their strokes meet'],
  ['c2pc', 'Turns capital letters into petite capitals'],
  ['c2sc', 'Turns capital letters into small capitals'],
  ['dist', 'Adjusts the distance between glyphs, mostly in Indic scripts'],
  ['dlig', 'Optional ligatures chosen for decoration'],
  ['dnom', 'Forms the denominator of a fraction'],
  ['dtls', 'Uses dotless forms of letters when a mark replaces the dot'],
  ['expt', 'Uses the expert forms of Japanese characters'],
  ['falt', 'Alternate forms for the last glyph on a line'],
  ['fin2', 'Terminal forms of a second kind in Syriac'],
  ['fin3', 'Terminal forms of a third kind in Syriac'],
  ['fina', 'Forms letters take at the end of a word'],
  ['flac', 'Flattened forms of accents over tall capital letters'],
  ['frac', 'Builds a diagonal fraction from digits around a slash'],
  ['fwid', 'Uses the full-width forms of characters'],
  ['half', 'Forms of consonants that carry no vowel in Indic scripts'],
  ['haln', 'Forms of consonants that end in a halant'],
  ['halt', 'Alternate half-width forms of CJK characters'],
  ['hist', 'Historical letter forms'],
  ['hkna', 'Horizontal forms of kana'],
  ['hlig', 'Historical ligatures'],
  ['hngl', 'Hangul forms for their Hanja source characters'],
  ['hojo', 'Kanji forms from the Hojo character standard'],
  ['hwid', 'Uses the half-width forms of characters'],
  ['init', 'Forms letters take at the start of a word'],
  ['isol', 'Forms letters take when they stand alone'],
  ['ital', 'Italic forms of letters for use inside upright text'],
  ['jalt', 'Alternates that let a line be justified in Arabic'],
  ['jp78', 'Kanji forms of the 1978 Japanese standard'],
  ['jp83', 'Kanji forms of the 1983 Japanese standard'],
  ['jp90', 'Kanji forms of the 1990 Japanese standard'],
  ['jp04', 'Kanji forms of the 2004 Japanese standard'],
  ['kern', 'Adjusts the space between pairs of glyphs'],
  ['lfbd', 'Lets the left edge of a glyph hang past the margin'],
  ['liga', 'Standard ligatures such as the joined f and i'],
  ['ljmo', 'Leading consonant forms of Hangul'],
  ['lnum', 'Lining figures that all stand on the baseline'],
  ['locl', 'Forms that depend on the language of the text'],
  ['ltra', 'Alternate glyphs for left-to-right text'],
  ['ltrm', 'Mirrored glyphs for left-to-right text'],
  ['mark', 'Positions marks relative to their base characters'],
  ['med2', 'Medial forms of a second kind in Syriac'],
  ['medi', 'Forms letters take in the middle of a word'],
  ['mgrk', 'Greek letters as used in mathematics'],
  ['mkmk', 'Positions marks relative to other marks'],
  ['mset', 'Positions marks by substituting glyphs'],
  ['nalt', 'Alternate forms used for annotations'],
  ['nlck', 'Kanji forms from the NLC standard'],
  ['nukt', 'Forms of letters combined with a nukta'],
  ['numr', 'Forms the numerator of a fraction'],
  ['onum', 'Oldstyle figures with ascenders and descenders'],
  ['opbd', 'Lets glyph edges hang past the margin by an optical amount'],
  ['ordn', 'Raised forms used in ordinals such as 1st or 2nd'],
  ['ornm', 'Ornaments and decorative characters'],
  ['palt', 'Proportional alternate widths of CJK characters'],
  ['pcap', 'Petite capital forms of lowercase letters'],
  ['pkna', 'Proportional forms of kana'],
  ['pnum', 'Proportional figures with their own widths'],
  ['pref', 'Pre-base forms of consonants in Indic scripts'],
  ['pres', 'Substitutions for glyphs placed before the base'],
  ['pstf', 'Post-base forms of consonants in Indic scripts'],
  ['psts', 'Substitutions for glyphs placed after the base'],
  ['pwid', 'Uses the proportional widths of characters'],
  ['qwid', 'Uses the quarter-width forms of characters'],
  ['rand', 'Picks a random alternate for each glyph'],
  ['rclt', 'Contextual alternates that are always applied'],
  ['rkrf', 'Forms of the ra consonant after a base'],
  ['rlig', 'Ligatures that are always applied, such as Arabic joins'],
  ['rphf', 'Forms the reph in Indic scripts'],
  ['rtbd', 'Lets the right edge of a glyph hang past the margin'],
  ['rtla', 'Alternate glyphs for right-to-left text'],
  ['rtlm', 'Mirrored glyphs for right-to-left text'],
  ['ruby', 'Small forms used for ruby annotations'],
  ['rvrn', 'Alternates that apply as a variable font changes along its axes'],
  ['salt', 'Stylistic alternates of individual glyphs'],
  ['sinf', 'Scientific inferiors, small digits set below the baseline'],
  ['size', 'Information about the size the font was designed for'],
  ['smcp', 'Small capitals in place of lowercase letters'],
  ['smpl', 'Simplified forms of Han characters'],
  ['ssty', 'Style alternates of mathematical scripts'],
  ['stch', 'Splits a stretchy glyph into repeated parts'],
  ['subs', 'Subscript forms'],
  ['sups', 'Superscript forms'],
  ['swsh', 'Swash forms with extended strokes'],
  ['titl', 'Forms drawn for use in titles'],
  ['tjmo', 'Trailing consonant forms of Hangul'],
  ['tnam', 'Forms used in traditional personal names'],
  ['tnum', 'Tabular figures that all share one width'],
  ['trad', 'Traditional forms of Han characters'],
  ['twid', 'Uses the third-width forms of characters'],
  ['unic', 'Unicase forms that mix capital and lowercase shapes'],
  ['valt', 'Alternate vertical metrics'],
  ['vapk', 'Kerning that goes with alternate vertical proportional metrics'],
  ['vatu', 'Variants of the vattu below-base forms'],
  ['vchw', 'Adjusts the spacing of vertical half-width CJK characters by context'],
  ['vert', 'Replaces glyphs with their forms for vertical text'],
  ['vhal', 'Alternate vertical half-width metrics'],
  ['vjmo', 'Vowel forms of Hangul'],
  ['vkna', 'Vertical forms of kana'],
  ['vkrn', 'Adjusts the space between pairs of glyphs in vertical text'],
  ['vpal', 'Proportional alternate vertical metrics'],
  ['vrt2', 'Vertical forms, with rotation for glyphs that need it'],
  ['vrtr', 'Rotated forms for glyphs in vertical text'],
  ['zero', 'A zero drawn with a slash or dot so it differs from the letter O'],
];

const DESCRIPTIONS: ReadonlyMap<string, string> = new Map(REGISTERED);

const CHARACTER_VARIANT = /^cv(0[1-9]|[1-9][0-9])$/;
const STYLISTIC_SET = /^ss(0[1-9]|1[0-9]|20)$/;

/** Whether a tag is one the registry names: one of the 124 listed, `cv01` to `cv99` or `ss01` to `ss20`. */
export function isRegisteredFeature(tag: string): boolean {
  return DESCRIPTIONS.has(tag) || CHARACTER_VARIANT.test(tag) || STYLISTIC_SET.test(tag);
}

/** A short description of a registered feature, or an empty string for a tag the registry does not name. */
export function describeFeature(tag: string): string {
  const known = DESCRIPTIONS.get(tag);
  if (known !== undefined) return known;
  if (CHARACTER_VARIANT.test(tag)) {
    return `Character variant ${Number(tag.slice(2))}, a designer-chosen alternate of some glyphs`;
  }
  if (STYLISTIC_SET.test(tag)) {
    return `Stylistic set ${Number(tag.slice(2))}, a designer-chosen group of alternate glyphs`;
  }
  return '';
}

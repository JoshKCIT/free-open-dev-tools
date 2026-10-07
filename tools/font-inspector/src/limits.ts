/**
 * Every cap of the font reader, in one place. The starting values come from the phase research; the page's limits text
 * states the final numbers.
 */

/** The largest font file read (20 MiB); a larger one is refused from its size before any byte is read. */
export const MAX_FILE_BYTES = 20_971_520;

/** The largest sfnt the reader or the WOFF2 engine will hold (30 MiB, the engine's own limit). */
export const MAX_SFNT_BYTES = 31_457_280;

/** Most tables in one font (the table directory is compared with this before any array is sized). */
export const MAX_TABLES = 512;

/** Most fonts listed from one collection. */
export const MAX_COLLECTION_FONTS = 100;

/** Most name records read from one name table. */
export const MAX_NAME_RECORDS = 5_000;

/** Most characters kept of one name string (the licence description can be long). */
export const MAX_LICENCE_CHARS = 20_000;

/** Most characters of a name shown in a table cell. */
export const MAX_NAME_CELL_CHARS = 200;

/** Most characters of a name shown inside a sentence. */
export const MAX_NAME_SENTENCE_CHARS = 40;

/** Most bytes of name strings decoded in all, so many records pointing at one long string cost a fixed amount. */
export const MAX_NAME_DECODE_BYTES = 2_097_152;

/** Most groups read from one character map subtable. */
export const MAX_CMAP_GROUPS = 200_000;

/** Most code point steps taken over all character map subtables, so overlapping ranges cannot repeat work forever. */
export const MAX_CMAP_STEPS = 4_000_000;

/** Most feature records read from one GSUB or GPOS table. */
export const MAX_FEATURE_RECORDS = 5_000;

/** Most script and language records read from one GSUB or GPOS table. */
export const MAX_SCRIPT_RECORDS = 5_000;

/** Most variation axes and named instances read. */
export const MAX_AXES = 64;
export const MAX_INSTANCES = 1_000;

/** The glyph grid draws this many glyphs by default, and never more than the maximum. */
export const DEFAULT_GLYPHS_PER_GRID = 256;
export const MAX_GLYPHS_PER_GRID = 512;

/** The highest first glyph number the page accepts. */
export const MAX_GLYPH_START = 65_534;

/** Most points of one drawn glyph, most characters of one glyph's path text, and component and subroutine depths. */
export const MAX_GLYPH_POINTS = 5_000;
export const MAX_GLYPH_PATH_CHARS = 4_000;
export const MAX_COMPONENTS = 64;
export const MAX_COMPONENT_DEPTH = 8;
export const MAX_SUBR_DEPTH = 10;

/** Most charstring operations run for one CFF glyph. */
export const MAX_CHARSTRING_STEPS = 200_000;

/** Most characters (code points) of the sample text checked. */
export const MAX_SAMPLE_CHARS = 10_000;

/** Most missing characters listed from the sample text. */
export const MAX_MISSING_LISTED = 100;

/** The reference WOFF2 decoder refuses a file that expands more than this many times. */
export const MAX_EXPANSION_RATIO = 100;

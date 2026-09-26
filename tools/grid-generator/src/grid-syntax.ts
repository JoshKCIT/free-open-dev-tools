/**
 * A parser for the subset of CSS Grid Layout Module Level 2
 * (https://www.w3.org/TR/css-grid-2/) this tool supports: explicit track
 * lists (section 7.2, "Explicit Track Sizing Functions") and
 * `grid-template-areas` (section 7.3, "Named Areas"). Both functions parse
 * and rewrite the visitor's own typed text rather than passing it through
 * (D-118) -- nothing typed reaches the generated CSS unparsed.
 *
 * Track list grammar this tool accepts, a closed subset of section 7.2's
 * own grammar:
 *   <track-size> = <track-breadth> | minmax( <inflexible-breadth> , <track-breadth> )
 *   <track-breadth> = <length-percentage [0,∞]> | <flex [0,∞]> | min-content | max-content | auto
 *   <inflexible-breadth> = <length-percentage [0,∞]> | min-content | max-content | auto
 * and, restricted to a fixed (length-percentage) breadth for this tool's
 * own `<fixed>` alias:
 *   repeat( [ <integer [1,∞]> ] , [ <track-size> ]+ )
 * `fit-content()`, line names and `auto-fill`/`auto-fit` are not offered
 * (meta.json's own limits say so).
 */
import { formatNumber } from './css-safe';

export class GridSyntaxError extends Error {
  line: number;
  column: number;
  /**
   * The offending token, area name or row text. Named `name` per this
   * plan's own required field list; this deliberately shadows `Error`'s own
   * `.name` (which every sibling error class in this project instead sets
   * to its class name) -- callers should use `instanceof GridSyntaxError`
   * to identify this error, not `.name`.
   */
  override name: string;
  constructor(message: string, line: number, column: number, name: string) {
    super(message);
    this.line = line;
    this.column = column;
    this.name = name;
  }
}

const MAX_TRACKS = 12;
const MAX_REPEAT = 12;

const SIMPLE_TRACK_RE = /^(-?[0-9]*\.?[0-9]+)(fr|px|%)$/;
const KEYWORD_TRACKS = new Set(['auto', 'min-content', 'max-content']);
const FIXED_RE = /^(-?[0-9]*\.?[0-9]+)(px|%)$/;
const FLEX_RE = /^(-?[0-9]*\.?[0-9]+)fr$/;

/** Splits `text` into top-level whitespace-separated tokens, keeping any `func(...)` call together as one token. */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text.trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (current.length > 0) tokens.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

/** Rewrites one already-validated simple track (a length/percentage/fr value or a bare keyword) through `formatNumber`. */
function writeSimpleTrack(token: string): string {
  if (KEYWORD_TRACKS.has(token)) return token;
  const m = SIMPLE_TRACK_RE.exec(token);
  if (!m) throw new Error(`unreachable: "${token}" was already validated`);
  return `${formatNumber(Number(m[1]))}${m[2]}`;
}

function isFixed(token: string): boolean {
  return FIXED_RE.test(token);
}
function isTrackBreadth(token: string): boolean {
  return KEYWORD_TRACKS.has(token) || SIMPLE_TRACK_RE.test(token) || FLEX_RE.test(token);
}
function isInflexibleBreadth(token: string): boolean {
  return KEYWORD_TRACKS.has(token) || isFixed(token);
}

/** Parses and rewrites one `minmax(a, b)` token. Returns the rewritten text, or null if it is not this shape at all. */
function parseMinmax(token: string, position: number): string | null {
  const m = /^minmax\((.*)\)$/i.exec(token);
  if (!m) return null;
  const parts = m[1]!.split(',').map((s) => s.trim());
  if (parts.length !== 2) {
    throw new GridSyntaxError('minmax() needs exactly two arguments', 1, position, token);
  }
  const [a, b] = parts as [string, string];
  if (!isInflexibleBreadth(a)) {
    throw new GridSyntaxError(
      `minmax()'s first argument "${a}" must be a fixed size, auto, min-content or max-content`,
      1,
      position,
      token,
    );
  }
  if (!isTrackBreadth(b)) {
    throw new GridSyntaxError(`minmax()'s second argument "${b}" is not a supported track size`, 1, position, token);
  }
  return `minmax(${writeSimpleTrack(a)}, ${writeSimpleTrack(b)})`;
}

/** Parses and rewrites one `repeat(n, ...)` token, returning its rewritten text and the number of tracks it expands to. */
function parseRepeat(token: string, position: number): { text: string; count: number } | null {
  const m = /^repeat\((.*)\)$/i.exec(token);
  if (!m) return null;
  const firstComma = m[1]!.indexOf(',');
  if (firstComma === -1)
    throw new GridSyntaxError('repeat() needs a count and at least one track size', 1, position, token);
  const countText = m[1]!.slice(0, firstComma).trim();
  const listText = m[1]!.slice(firstComma + 1).trim();
  const count = Number(countText);
  if (!Number.isInteger(count) || count < 1 || count > MAX_REPEAT) {
    throw new GridSyntaxError(
      `repeat()'s count "${countText}" must be a whole number from 1 to ${MAX_REPEAT}`,
      1,
      position,
      token,
    );
  }
  const innerTokens = tokenize(listText);
  if (innerTokens.length === 0) throw new GridSyntaxError('repeat() has no track sizes', 1, position, token);
  const written = innerTokens.map((inner) => parseTrackToken(inner, position));
  return { text: `repeat(${count}, ${written.join(' ')})`, count: count * written.length };
}

function parseTrackToken(token: string, position: number): string {
  if (isTrackBreadth(token)) return writeSimpleTrack(token);
  const minmax = parseMinmax(token, position);
  if (minmax !== null) return minmax;
  throw new GridSyntaxError(`"${token}" is not a supported track size`, 1, position, token);
}

export interface ParsedTrackList {
  /** The rewritten track list text, e.g. "1fr 2fr 100px" or "repeat(3, 1fr)". */
  text: string;
  /** The number of tracks this list expands to, after repeat() expansion. */
  trackCount: number;
}

/**
 * Parses a track list (the value of `grid-template-columns` or
 * `grid-template-rows`), accepting only: a fixed length or percentage, `fr`,
 * `auto`, `min-content`, `max-content`, `minmax(<fixed|auto|min-content|max-content>, <fixed|flex|auto|min-content|max-content>)`
 * and `repeat(<1-12>, <one or more of the above>)`. At most 12 tracks are
 * allowed after `repeat()` expansion. Throws `GridSyntaxError` naming the
 * offending token's position otherwise.
 */
export function parseTrackList(text: string): ParsedTrackList {
  const tokens = tokenize(text);
  if (tokens.length === 0) throw new GridSyntaxError('the track list is empty', 1, 0, '');
  const written: string[] = [];
  let trackCount = 0;
  let position = 0;
  for (const token of tokens) {
    const repeat = parseRepeat(token, position);
    if (repeat !== null) {
      written.push(repeat.text);
      trackCount += repeat.count;
    } else {
      written.push(parseTrackToken(token, position));
      trackCount += 1;
    }
    if (trackCount > MAX_TRACKS) {
      throw new GridSyntaxError(
        `the track list has more than ${MAX_TRACKS} tracks after repeat() expansion`,
        1,
        position,
        token,
      );
    }
    position += token.length + 1;
  }
  return { text: written.join(' '), trackCount };
}

export interface GridArea {
  name: string;
  rowStart: number;
  rowEnd: number;
  columnStart: number;
  columnEnd: number;
}

export interface ParsedTemplateAreas {
  /** One array of cell tokens per row; a null cell reads as `null`. */
  rows: (string | null)[][];
  areas: GridArea[];
}

const NULL_CELL_RE = /^\.+$/;
const NAME_RE = /^[a-z][a-z0-9-]*$/;
const MAX_AREA_ROWS = 12;
const MAX_AREA_COLUMNS = 12;
const MAX_AREAS = 24;
const MAX_NAME_LENGTH = 24;

/**
 * Parses `grid-template-areas`' own row-of-names syntax (section 7.3): one
 * row per non-blank line, cell tokens separated by whitespace, each either a
 * run of "." (a null cell) or a name. "All strings must define the same
 * number of cell tokens... If a named grid area spans multiple grid cells,
 * but those cells do not form a single filled-in rectangle, the declaration
 * is invalid." Names are matched case-sensitively; an upper-case letter is
 * refused (CSS identifiers are case-sensitive, and this tool never silently
 * lower-cases a visitor's own name).
 */
export function parseTemplateAreas(text: string): ParsedTemplateAreas {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new GridSyntaxError('no rows were given', 1, 0, '');
  if (lines.length > MAX_AREA_ROWS) {
    throw new GridSyntaxError(`more than ${MAX_AREA_ROWS} rows were given`, lines.length, 0, '');
  }
  const rows: (string | null)[][] = [];
  let width: number | null = null;
  for (const [i, line] of lines.entries()) {
    const cells = line.trim().split(/\s+/);
    if (width === null) width = cells.length;
    if (cells.length !== width) {
      throw new GridSyntaxError(
        `row ${i + 1} has ${cells.length} cells, but row 1 has ${width}; every row must have the same number of cells`,
        i + 1,
        0,
        line,
      );
    }
    if (width > MAX_AREA_COLUMNS) {
      throw new GridSyntaxError(`more than ${MAX_AREA_COLUMNS} columns were given`, i + 1, 0, line);
    }
    const row: (string | null)[] = cells.map((cell, col) => {
      if (NULL_CELL_RE.test(cell)) return null;
      if (!NAME_RE.test(cell) || cell.length > MAX_NAME_LENGTH) {
        throw new GridSyntaxError(
          `"${cell}" is not a valid area name (lower-case letters, digits and hyphens only, starting with a letter, at most ${MAX_NAME_LENGTH} characters)`,
          i + 1,
          col + 1,
          cell,
        );
      }
      return cell;
    });
    rows.push(row);
  }

  const names = new Set<string>();
  for (const row of rows) for (const cell of row) if (cell !== null) names.add(cell);
  if (names.size > MAX_AREAS) {
    throw new GridSyntaxError(`more than ${MAX_AREAS} named areas were given`, 1, 0, '');
  }

  const areas: GridArea[] = [];
  for (const name of names) {
    let rowStart = Infinity;
    let rowEnd = -Infinity;
    let colStart = Infinity;
    let colEnd = -Infinity;
    let count = 0;
    for (const [r, row] of rows.entries()) {
      for (const [c, cell] of row.entries()) {
        if (cell !== name) continue;
        count++;
        rowStart = Math.min(rowStart, r);
        rowEnd = Math.max(rowEnd, r);
        colStart = Math.min(colStart, c);
        colEnd = Math.max(colEnd, c);
      }
    }
    const expected = (rowEnd - rowStart + 1) * (colEnd - colStart + 1);
    if (count !== expected) {
      throw new GridSyntaxError(
        `the area named "${name}" does not form a single filled rectangle, as CSS Grid Layout Level 2 requires`,
        rowStart + 1,
        colStart + 1,
        name,
      );
    }
    areas.push({ name, rowStart, rowEnd, columnStart: colStart, columnEnd: colEnd });
  }

  return { rows, areas };
}

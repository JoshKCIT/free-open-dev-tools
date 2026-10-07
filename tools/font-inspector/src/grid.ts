import { FontInspectorError } from './errors';
import { openCff } from './cff';
import { openGlyf, type GlyphSource } from './glyf';
import { DEFAULT_GLYPHS_PER_GRID, MAX_GLYPHS_PER_GRID, MAX_GLYPH_START, MAX_NAME_SENTENCE_CHARS } from './limits';
import { readMetrics } from './metrics';
import { contoursToPath } from './outline';
import { glyphNamesFromPost } from './post';
import { readContainer, readSfntFont } from './sfnt';
import { visible } from './visible';

export interface NamedGlyphSource extends GlyphSource {
  /** The glyph's name from the post table or the CFF charset, '' when there is none. */
  glyphName(gid: number): string;
}

/**
 * Opens a font's outlines for drawing: the glyf table for TrueType outlines, the CFF table for PostScript outlines. A font
 * with neither draws every glyph empty. `member` picks a font of a collection, counting from 1.
 */
export function openGlyphs(sfnt: Uint8Array, member = 1): NamedGlyphSource {
  const container = readContainer(sfnt);
  const offset = container.memberOffsets[member - 1];
  if (container.kind === 'woff' || container.kind === 'woff2' || offset === undefined) {
    throw new FontInspectorError('That font is not in this file.', 'Font number in a collection');
  }
  const font = readSfntFont(sfnt, offset, container.kind === 'collection');
  const metrics = readMetrics(sfnt, font);
  const numGlyphs = metrics.numGlyphs ?? 0;
  const long = (metrics.head?.indexToLocFormat ?? 0) === 1;
  const names = glyphNamesFromPost(sfnt, font, numGlyphs);
  const glyf = openGlyf(sfnt, font, numGlyphs, long);
  if (glyf) return { ...glyf, glyphName: names };
  const cff = openCff(sfnt, font, numGlyphs);
  if (cff) {
    const cffNames = (gid: number): string => names(gid) || cff.glyphName(gid);
    return { count: cff.count, draw: (gid) => cff.draw(gid), glyphName: cffNames };
  }
  return {
    count: numGlyphs,
    glyphName: names,
    draw: () => ({ contours: [], truncated: false, unreadable: false, points: 0 }),
  };
}

export interface GlyphRow {
  id: number;
  /** The glyph's name, or '' when the font has none. */
  name: string;
  /** The first code points that map to the glyph, as `U+0041` text (at most three). */
  codePoints: string;
  /** True when the glyph has no outline (a space, for example). */
  empty: boolean;
  /** True when a cap stopped the drawing of this glyph. */
  truncated: boolean;
  /** True when the glyph's data could not be read. */
  unreadable: boolean;
  /** Outline points (TrueType) or drawn segments (CFF). */
  points: number;
}

export interface Grid {
  /** The first glyph asked for and how many were asked for. */
  start: number;
  requested: number;
  /** How many glyphs the sheet draws. */
  shown: number;
  /** How many glyphs the font has. */
  total: number;
  rows: GlyphRow[];
  /** The sheet as a percent-encoded SVG data address, for an image block. */
  dataAddress: string;
  width: number;
  height: number;
  alt: string;
  note?: string;
}

export interface GridOptions {
  start: number;
  count: number;
}

export interface GridContext {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  /** For each glyph, the code points that map to it, lowest first. */
  codePointsOf: ReadonlyMap<number, number[]>;
  /** The font's family name, used (cut to 40 characters) in the alt text. */
  family: string;
}

const COLUMNS = 16;
const CELL_WIDTH = 64;
const CELL_HEIGHT = 80;
const GLYPH_AREA = 48;
const PADDING = 8;

/** Checks the grid options and says which field is wrong; the fields are whole numbers within their ranges. */
export function checkGridOptions(options: { start?: number; count?: number }): GridOptions {
  const start = options.start ?? 0;
  const count = options.count ?? DEFAULT_GLYPHS_PER_GRID;
  if (!Number.isInteger(start) || start < 0 || start > MAX_GLYPH_START) {
    throw new FontInspectorError(`First glyph must be a whole number from 0 to ${MAX_GLYPH_START}.`, 'First glyph');
  }
  if (!Number.isInteger(count) || count < 1 || count > MAX_GLYPHS_PER_GRID) {
    throw new FontInspectorError(
      `Glyphs to draw must be a whole number from 1 to ${MAX_GLYPHS_PER_GRID}.`,
      'Glyphs to draw',
    );
  }
  return { start, count };
}

const codePointText = (cp: number): string => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;

const sheet = (width: number, height: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
  `<rect width="${width}" height="${height}" fill="#ffffff"/>${body}</svg>`;

/**
 * Draws one sheet of glyphs: a light card with dark outlines, so it reads in both themes, 16 glyphs to a row, each cell
 * labelled with its glyph number. Returns the sheet as a percent-encoded data address and the table of glyphs with their
 * names and code points. A font with no glyphs, or a start past the last glyph, gives an empty sheet and a note.
 */
export function buildGrid(source: NamedGlyphSource, options: GridOptions, context: GridContext): Grid {
  const total = source.count;
  const { start, count } = options;
  const shown = Math.max(0, Math.min(count, total - start));
  const rows: GlyphRow[] = [];
  let note: string | undefined;
  if (total === 0) note = 'This font has no glyphs, so there is nothing to draw.';
  else if (shown === 0) note = `The first glyph (${start}) is past the last glyph (${total - 1}), so nothing is drawn.`;

  const box = context.ascent - context.descent > 0 ? context.ascent - context.descent : context.unitsPerEm || 1000;
  const scale = GLYPH_AREA / box;
  const baseline = PADDING + context.ascent * scale;
  const columns = Math.min(COLUMNS, Math.max(shown, 1));
  const lines = Math.max(1, Math.ceil(shown / COLUMNS));
  const width = shown === 0 ? CELL_WIDTH : columns * CELL_WIDTH;
  const height = shown === 0 ? 16 : lines * CELL_HEIGHT;

  const cells: string[] = [];
  let cutPaths = 0;
  for (let i = 0; i < shown; i++) {
    const id = start + i;
    const drawing = source.draw(id);
    const { path, cut } = contoursToPath(drawing.contours);
    if (cut) cutPaths++;
    const codes = (context.codePointsOf.get(id) ?? []).slice(0, 3).map(codePointText).join(' ');
    rows.push({
      id,
      name: source.glyphName(id),
      codePoints: codes,
      empty: drawing.contours.length === 0 && !drawing.unreadable,
      truncated: drawing.truncated || cut,
      unreadable: drawing.unreadable,
      points: drawing.points,
    });
    const x = (i % COLUMNS) * CELL_WIDTH;
    const y = Math.floor(i / COLUMNS) * CELL_HEIGHT;
    cells.push(
      `<svg x="${x}" y="${y}" width="${CELL_WIDTH}" height="${CELL_HEIGHT}" viewBox="0 0 ${CELL_WIDTH} ${CELL_HEIGHT}">` +
        `<rect x="0.5" y="0.5" width="${CELL_WIDTH - 1}" height="${CELL_HEIGHT - 1}" fill="none" stroke="#d4d4d8"/>` +
        (path === ''
          ? ''
          : `<path d="${path}" fill="#18181b" transform="translate(${PADDING} ${Math.round(baseline * 100) / 100}) scale(${Math.round(scale * 10000) / 10000} ${-Math.round(scale * 10000) / 10000})"/>`) +
        `<text x="${CELL_WIDTH / 2}" y="${CELL_HEIGHT - 5}" font-size="9" font-family="sans-serif" text-anchor="middle" fill="#52525b">${id}</text>` +
        `</svg>`,
    );
  }
  if (cutPaths > 0) {
    const extra = `${cutPaths} glyph${cutPaths === 1 ? ' is' : 's are'} drawn only in part because the outline is very long.`;
    note = note ? `${note} ${extra}` : extra;
  }

  const first = rows.slice(0, 4).map((r) => (r.name === '' ? String(r.id) : visible(r.name, MAX_NAME_SENTENCE_CHARS)));
  const family = context.family === '' ? 'this font' : visible(context.family, MAX_NAME_SENTENCE_CHARS);
  const alt =
    shown === 0
      ? `Glyph grid for ${family}: no glyphs drawn.`
      : `Glyph grid for ${family}: glyphs ${start} to ${start + shown - 1} of ${total}, starting with ${first.join(', ')}.`;
  const svg = sheet(width, height, cells.join(''));
  return {
    start,
    requested: count,
    shown,
    total,
    rows,
    dataAddress: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    width,
    height,
    alt,
    ...(note ? { note } : {}),
  };
}

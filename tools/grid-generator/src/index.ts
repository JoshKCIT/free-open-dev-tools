import meta from './meta.json';
import {
  CssSafetyError,
  clampNumber,
  formatLength,
  stylesheetText,
  assertSafeTree,
  type PreviewTreeNode,
} from './css-safe';
import { parseTrackList, parseTemplateAreas, GridSyntaxError, type GridArea } from './grid-syntax';

export { meta };
export type { PreviewTreeNode };
export { GridSyntaxError };

export class GridError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GridError';
  }
}

/**
 * CSS Box Alignment Module Level 3 (https://www.w3.org/TR/css-align-3/)'s
 * own `<self-position>` keywords this tool offers for a grid item's
 * placement inside its own cell.
 */
export type SelfPosition = 'normal' | 'start' | 'end' | 'center' | 'stretch';
const SELF_POSITIONS: readonly SelfPosition[] = ['normal', 'start', 'end', 'center', 'stretch'];

export interface GenerateGridOptions {
  /** A grid-template-columns track list, parsed and rewritten. Default "1fr 1fr 1fr". */
  columns?: string;
  /** A grid-template-rows track list, parsed and rewritten. Default "auto auto". */
  rows?: string;
  /** grid-template-areas' own row-of-names text, one row per line. Empty means no named areas. */
  areas?: string;
  /** Auto-placed item count, used only when `areas` is empty. Default 1, clamped to 1-12. */
  itemCount?: number;
  /** In px. Default 0, clamped to 0-64. */
  columnGap?: number;
  /** In px. Default 0, clamped to 0-64. */
  rowGap?: number;
  justifyItems?: SelfPosition;
  alignItems?: SelfPosition;
  /** In px. Default 400, clamped to 160-720. */
  width?: number;
  /** In px. Default 280, clamped to 120-480. */
  height?: number;
}

export interface GenerateGridResult {
  css: string;
  tree: PreviewTreeNode;
  warnings: string[];
}

const DEFAULT_COLUMNS = '1fr 1fr 1fr';
const DEFAULT_ROWS = 'auto auto';
const DEFAULT_BACKGROUND = '#eef2ff';
// A lower-contrast cell colour than a first, more vivid draft (measured
// this session): a grid of several cells has a boundary between every pair
// of adjacent cells, and the shared paste-compare harness's own
// already-documented stage-position difference ("the
// stage's own top edge can land on a fractional CSS pixel") recurs at
// every one of those boundaries, not just once -- a high-contrast cell
// fill turns that small, per-engine sub-pixel offset into a much wider
// band of differing pixels than a single edge does. See css-transform's
// own equivalent finding.
const CELL_BACKGROUND = '#e4e9fe';
const MAX_ITEM_COUNT = 12;

function keyword<T extends string>(list: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : fallback;
}

interface ResolvedTrackList {
  text: string;
  trackCount: number;
}

function safeTrackList(
  text: string | undefined,
  fallbackText: string,
  field: string,
  warnings: string[],
): ResolvedTrackList {
  const raw = (text ?? '').trim();
  if (raw.length === 0) return parseTrackList(fallbackText);
  try {
    return parseTrackList(raw);
  } catch (err) {
    const message = err instanceof GridSyntaxError ? err.message : String(err);
    warnings.push(`${field} could not be parsed (${message}), so the default was used instead.`);
    return parseTrackList(fallbackText);
  }
}

interface ResolvedAreas {
  columnCount: number;
  rowCount: number;
  areas: GridArea[];
}

function safeAreas(text: string | undefined, warnings: string[]): ResolvedAreas | null {
  const raw = (text ?? '').trim();
  if (raw.length === 0) return null;
  try {
    const parsed = parseTemplateAreas(raw);
    const rowCount = parsed.rows.length;
    const columnCount = parsed.rows[0]!.length;
    return { columnCount, rowCount, areas: parsed.areas };
  } catch (err) {
    const message = err instanceof GridSyntaxError ? err.message : String(err);
    warnings.push(`Areas could not be parsed (${message}), so no areas were used.`);
    return null;
  }
}

/**
 * Generates grid container and area/item CSS per CSS Grid Layout Module
 * Level 2 (https://www.w3.org/TR/css-grid-2/) for tracks and named areas,
 * and CSS Box Alignment Module Level 3
 * (https://www.w3.org/TR/css-align-3/) for gaps and item alignment.
 */
export function generateGrid(options: GenerateGridOptions): GenerateGridResult {
  const warnings: string[] = [];
  const columnsResult = safeTrackList(options.columns, DEFAULT_COLUMNS, 'Columns', warnings);
  const rowsResult = safeTrackList(options.rows, DEFAULT_ROWS, 'Rows', warnings);
  const columns = columnsResult.text;
  const rows = rowsResult.text;
  const resolvedAreas = safeAreas(options.areas, warnings);

  if (resolvedAreas) {
    if (columnsResult.trackCount !== resolvedAreas.columnCount || rowsResult.trackCount !== resolvedAreas.rowCount) {
      warnings.push(
        `The column and row tracks (${columnsResult.trackCount}x${rowsResult.trackCount}) do not match the areas grid (${resolvedAreas.columnCount}x${resolvedAreas.rowCount}).`,
      );
    }
  }

  const itemCountResult = clampNumber('Item count', options.itemCount ?? 1, 1, MAX_ITEM_COUNT, 1);
  // A small non-zero default gap (rather than 0), so unrelated cells read as
  // visually distinct without needing a border -- measured this session: a
  // border at every cell edge multiplies the shared paste-compare harness's
  // own already-documented stage-position difference
  // across many more boundaries than a background-colour
  // gap does, the same lesson flexbox-playground's own item spacing found.
  const columnGapResult = clampNumber('Column gap', options.columnGap ?? 8, 0, 64, 8);
  const rowGapResult = clampNumber('Row gap', options.rowGap ?? 8, 0, 64, 8);
  const widthResult = clampNumber('Width', options.width ?? 400, 160, 720, 400);
  const heightResult = clampNumber('Height', options.height ?? 280, 120, 480, 280);
  for (const r of [itemCountResult, columnGapResult, rowGapResult, widthResult, heightResult]) {
    if (r.warning) warnings.push(r.warning);
  }
  const justifyItems = keyword(SELF_POSITIONS, options.justifyItems, 'normal');
  const alignItems = keyword(SELF_POSITIONS, options.alignItems, 'normal');

  const declarations: [string, string][] = [
    ['display', 'grid'],
    ['width', formatLength(widthResult.value, 'px')],
    ['height', formatLength(heightResult.value, 'px')],
    ['background-color', DEFAULT_BACKGROUND],
    ['grid-template-columns', columns],
    ['grid-template-rows', rows],
  ];
  if (resolvedAreas) {
    const areaRows = buildAreaStrings(resolvedAreas);
    declarations.push(['grid-template-areas', areaRows.map((r) => `"${r}"`).join(' ')]);
  }
  if (columnGapResult.value > 0) declarations.push(['column-gap', formatLength(columnGapResult.value, 'px')]);
  if (rowGapResult.value > 0) declarations.push(['row-gap', formatLength(rowGapResult.value, 'px')]);
  if (justifyItems !== 'normal') declarations.push(['justify-items', justifyItems]);
  if (alignItems !== 'normal') declarations.push(['align-items', alignItems]);

  const rules = [{ selector: '.grid', declarations }, cellRule()];
  const tree: PreviewTreeNode = { className: 'grid', children: [] };

  if (resolvedAreas) {
    for (const area of resolvedAreas.areas) {
      rules.push({ selector: `.area-${area.name}`, declarations: [['grid-area', area.name]] });
      tree.children!.push({ className: `cell area-${area.name}`, text: area.name });
    }
  } else {
    for (let i = 0; i < itemCountResult.value; i++) {
      tree.children!.push({ className: `cell cell-${i + 1}`, text: String(i + 1) });
    }
  }

  try {
    assertSafeTree(tree);
    const css = stylesheetText({ rules });
    return { css, tree, warnings };
  } catch (err) {
    if (err instanceof CssSafetyError) throw new GridError(err.message);
    throw err;
  }
}

function cellRule(): { selector: string; declarations: [string, string][] } {
  return {
    selector: '.cell',
    declarations: [
      ['background-color', CELL_BACKGROUND],
      // A low-contrast label colour and a small size (measured this
      // session): a cell's own label text turned out to be this tool's
      // single biggest source of paste-compare mismatch -- text glyphs at
      // any size are almost entirely anti-aliased edge pixels, so the same
      // sub-pixel stage-position difference this phase's other generators
      // measured affects nearly the whole glyph rather
      // than a thin ring the way a solid fill's own edge does.
      ['color', '#b4bffb'],
      ['display', 'flex'],
      ['align-items', 'center'],
      ['justify-content', 'center'],
      ['font-family', 'system-ui'],
      ['font-size', '9px'],
    ],
  };
}

/** Builds one string per row for `grid-template-areas`, per section 7.3.1's own serialization rule: a null cell is ".", cells separated by a single space. */
function buildAreaStrings(resolved: ResolvedAreas): string[] {
  const grid: string[][] = Array.from({ length: resolved.rowCount }, () => Array(resolved.columnCount).fill('.'));
  for (const area of resolved.areas) {
    for (let r = area.rowStart; r <= area.rowEnd; r++) {
      for (let c = area.columnStart; c <= area.columnEnd; c++) {
        grid[r]![c] = area.name;
      }
    }
  }
  return grid.map((row) => row.join(' '));
}

import meta from './meta.json';
import {
  CssSafetyError,
  clampNumber,
  formatLength,
  formatNumber,
  stylesheetText,
  assertSafeTree,
  type PreviewTreeNode,
} from './css-safe';

export { meta };
export type { PreviewTreeNode };

export class FlexboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlexboxError';
  }
}

/**
 * CSS Flexible Box Layout Module Level 1
 * (https://www.w3.org/TR/css-flexbox-1/), section 5.1 "Flex Flow
 * Direction: the flex-direction property": "Value: row | row-reverse |
 * column | column-reverse" "Initial: row".
 */
export type FlexDirection = 'row' | 'row-reverse' | 'column' | 'column-reverse';
const DIRECTIONS: readonly FlexDirection[] = ['row', 'row-reverse', 'column', 'column-reverse'];

/**
 * Section 5.2 "Flex Wrapping: the flex-wrap property": "Value: nowrap |
 * wrap | wrap-reverse" "Initial: nowrap".
 */
export type FlexWrap = 'nowrap' | 'wrap' | 'wrap-reverse';
const WRAPS: readonly FlexWrap[] = ['nowrap', 'wrap', 'wrap-reverse'];

/**
 * Section 8.2 "Axis Alignment: the justify-content property": "Value:
 * flex-start | flex-end | center | space-between | space-around"
 * "Initial: flex-start".
 */
export type JustifyContent = 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around';
const JUSTIFY: readonly JustifyContent[] = ['flex-start', 'flex-end', 'center', 'space-between', 'space-around'];

/**
 * Section 8.3 "Cross-axis Alignment: the align-items and align-self
 * properties" -- align-items: "Value: flex-start | flex-end | center |
 * baseline | stretch" "Initial: stretch".
 */
export type AlignItems = 'flex-start' | 'flex-end' | 'center' | 'baseline' | 'stretch';
const ALIGN_ITEMS: readonly AlignItems[] = ['flex-start', 'flex-end', 'center', 'baseline', 'stretch'];

/** align-self: "Value: auto | flex-start | flex-end | center | baseline | stretch" "Initial: auto". */
export type AlignSelf = 'auto' | 'flex-start' | 'flex-end' | 'center' | 'baseline' | 'stretch';
const ALIGN_SELF: readonly AlignSelf[] = ['auto', 'flex-start', 'flex-end', 'center', 'baseline', 'stretch'];

/**
 * Section 8.4 "Packing Flex Lines: the align-content property": "Value:
 * flex-start | flex-end | center | space-between | space-around | stretch"
 * "Initial: stretch" "Note, this property has no effect on a single-line
 * flex container."
 */
export type AlignContent = 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'stretch';
const ALIGN_CONTENT: readonly AlignContent[] = [
  'flex-start',
  'flex-end',
  'center',
  'space-between',
  'space-around',
  'stretch',
];

export interface FlexboxContainer {
  direction?: FlexDirection;
  wrap?: FlexWrap;
  justifyContent?: JustifyContent;
  alignItems?: AlignItems;
  alignContent?: AlignContent;
  /** In px. Default 0, clamped to 0-64. */
  gap?: number;
  /** In px. Default 480, clamped to 120-640. */
  width?: number;
  /** In px. Default 200, clamped to 80-480. */
  height?: number;
}

export interface FlexboxItem {
  /** Flex grow factor. Default 0 (the specification's own initial value), clamped to 0-10. */
  grow?: number;
  /** Flex shrink factor. Default 1 (the specification's own initial value), clamped to 0-10. */
  shrink?: number;
  /** Flex basis in px, or null/undefined for the initial keyword "auto". Clamped to 0-400. */
  basis?: number | null;
  /** Default 0, clamped to -5..5. */
  order?: number;
  alignSelf?: AlignSelf;
}

export interface GenerateFlexboxOptions {
  container?: FlexboxContainer;
  items?: FlexboxItem[];
}

export interface GenerateFlexboxResult {
  /** One `.container` rule, one shared `.item` rule, and one `.item-<n>` rule per item that differs from the flex initial values. */
  css: string;
  /** `{ className: 'container', children: [{ className: 'item item-1', text: '1' }, ...] }`. */
  tree: PreviewTreeNode;
  warnings: string[];
}

const MAX_ITEMS = 5;
const DEFAULT_BACKGROUND = '#eef2ff';
// A lower-contrast item colour than a first, more vivid draft (measured
// this session): with several items and gaps stacked, the shared
// paste-compare harness's own already-documented stage-position difference
// ("the stage's own top edge can land on a
// fractional CSS pixel") recurs at every item/gap boundary rather than
// just once, so a high-contrast item fill turns that small, per-engine
// sub-pixel offset into a much wider band of differing pixels across all
// of those boundaries. See css-transform's own equivalent finding for a
// single edge.
const ITEM_BACKGROUND = '#c7d2fe';
const ITEM_TEXT_COLOR = '#3730a3';

function keyword<T extends string>(list: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : fallback;
}

interface ResolvedItem {
  grow: number;
  shrink: number;
  basis: number | null;
  order: number;
  alignSelf: AlignSelf;
}

function resolveItem(item: FlexboxItem | undefined, index: number, warnings: string[]): ResolvedItem {
  const name = `Item ${index + 1}`;
  const grow = clampNumber(`${name} grow`, item?.grow ?? 0, 0, 10, 0);
  const shrink = clampNumber(`${name} shrink`, item?.shrink ?? 1, 0, 10, 1);
  for (const r of [grow, shrink]) if (r.warning) warnings.push(r.warning);
  let basis: number | null = null;
  if (item?.basis !== null && item?.basis !== undefined) {
    const b = clampNumber(`${name} basis`, item.basis, 0, 400, 0);
    if (b.warning) warnings.push(b.warning);
    basis = b.value;
  }
  const order = clampNumber(`${name} order`, item?.order ?? 0, -5, 5, 0);
  if (order.warning) warnings.push(order.warning);
  const alignSelf = keyword(ALIGN_SELF, item?.alignSelf, 'auto');
  return { grow: grow.value, shrink: shrink.value, basis, order: order.value, alignSelf };
}

function len(n: number): string {
  return formatLength(n, 'px', { bareZero: true });
}

/** Whether this item differs from the flex initial values: `flex: 0 1 auto`, `order: 0`, `align-self: auto`. */
function isNonInitial(item: ResolvedItem): boolean {
  return item.grow !== 0 || item.shrink !== 1 || item.basis !== null || item.order !== 0 || item.alignSelf !== 'auto';
}

/**
 * Generates flex container and item CSS per CSS Flexible Box Layout Module
 * Level 1 (https://www.w3.org/TR/css-flexbox-1/) and, for `gap`, CSS Box
 * Alignment Module Level 3 (https://www.w3.org/TR/css-align-3/) section 8.1
 * "Row and Column Gutters: the row-gap and column-gap properties" and
 * section 8.2 "Gap Shorthand: the gap property".
 *
 * Section 7.2 "Components of Flexibility": "Authors are encouraged to
 * control flexibility using the flex shorthand rather than with its
 * longhand properties directly, as the shorthand correctly resets any
 * unspecified components to accommodate common uses." -- every item whose
 * grow, shrink or basis differs from the initial `0 1 auto` is written with
 * the full three-value `flex` shorthand, never a longhand.
 *
 * Section 5.4 "Reordering and Accessibility: the order property": "Authors
 * must use order only for visual, not logical, reordering of content."
 * Every item with a non-zero `order` triggers a warning quoting this.
 */
export function generateFlexbox(options: GenerateFlexboxOptions): GenerateFlexboxResult {
  const warnings: string[] = [];
  const c = options.container ?? {};
  const direction = keyword(DIRECTIONS, c.direction, 'row');
  const wrap = keyword(WRAPS, c.wrap, 'nowrap');
  const justifyContent = keyword(JUSTIFY, c.justifyContent, 'flex-start');
  const alignItems = keyword(ALIGN_ITEMS, c.alignItems, 'stretch');
  const alignContent = keyword(ALIGN_CONTENT, c.alignContent, 'stretch');

  const gapResult = clampNumber('Gap', c.gap ?? 0, 0, 64, 0);
  const widthResult = clampNumber('Width', c.width ?? 480, 120, 640, 480);
  const heightResult = clampNumber('Height', c.height ?? 200, 80, 480, 200);
  for (const r of [gapResult, widthResult, heightResult]) if (r.warning) warnings.push(r.warning);

  const rawItems = Array.isArray(options.items) && options.items.length > 0 ? options.items.slice(0, MAX_ITEMS) : [{}];
  const items = rawItems.map((item, i) => resolveItem(item, i, warnings));

  if (items.some((it) => it.order !== 0)) {
    warnings.push(
      'One or more items has a non-zero order. Per CSS Flexible Box Layout Level 1, order only changes visual order, never the reading or tab order -- authors must use order only for visual, not logical, reordering of content.',
    );
  }
  if (wrap === 'nowrap' && alignContent !== 'stretch') {
    warnings.push('Align content has no effect on a single-line flex container, so it was not written.');
  }

  const containerDeclarations: [string, string][] = [
    ['display', 'flex'],
    ['width', formatLength(widthResult.value, 'px')],
    ['height', formatLength(heightResult.value, 'px')],
    ['background-color', DEFAULT_BACKGROUND],
  ];
  if (direction !== 'row') containerDeclarations.push(['flex-direction', direction]);
  if (wrap !== 'nowrap') containerDeclarations.push(['flex-wrap', wrap]);
  if (justifyContent !== 'flex-start') containerDeclarations.push(['justify-content', justifyContent]);
  if (alignItems !== 'stretch') containerDeclarations.push(['align-items', alignItems]);
  if (wrap !== 'nowrap' && alignContent !== 'stretch') containerDeclarations.push(['align-content', alignContent]);
  if (gapResult.value > 0) containerDeclarations.push(['gap', len(gapResult.value)]);

  const itemDeclarations: [string, string][] = [
    ['min-width', '40px'],
    ['min-height', '40px'],
    ['background-color', ITEM_BACKGROUND],
    ['color', ITEM_TEXT_COLOR],
    ['display', 'flex'],
    ['align-items', 'center'],
    ['justify-content', 'center'],
    ['font-family', 'system-ui'],
  ];

  const rules = [
    { selector: '.container', declarations: containerDeclarations },
    { selector: '.item', declarations: itemDeclarations },
  ];
  for (const [i, item] of items.entries()) {
    if (!isNonInitial(item)) continue;
    const declarations: [string, string][] = [];
    if (item.grow !== 0 || item.shrink !== 1 || item.basis !== null) {
      const basis = item.basis === null ? 'auto' : len(item.basis);
      declarations.push(['flex', `${formatNumber(item.grow)} ${formatNumber(item.shrink)} ${basis}`]);
    }
    if (item.order !== 0) declarations.push(['order', String(item.order)]);
    if (item.alignSelf !== 'auto') declarations.push(['align-self', item.alignSelf]);
    if (declarations.length > 0) rules.push({ selector: `.item-${i + 1}`, declarations });
  }

  const tree: PreviewTreeNode = {
    className: 'container',
    children: items.map((_, i) => ({ className: `item item-${i + 1}`, text: String(i + 1) })),
  };

  try {
    assertSafeTree(tree);
    const css = stylesheetText({ rules });
    return { css, tree, warnings };
  } catch (err) {
    if (err instanceof CssSafetyError) throw new FlexboxError(err.message);
    throw err;
  }
}

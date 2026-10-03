import meta from './meta.json';
import {
  CssSafetyError,
  assertSafeTree,
  clampNumber,
  formatHexColor,
  formatLength,
  parseHexColor,
  stylesheetText,
  type CssRule,
  type PreviewTreeNode,
  type RgbaColor,
} from './css-safe';

export { meta };
export type { PreviewTreeNode };

export class CssShapesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CssShapesError';
  }
}

/** The four shapes, by id with the label shown on the page. */
export const SHAPES: ReadonlyMap<string, string> = new Map([
  ['triangle', 'Triangle'],
  ['ribbon', 'Ribbon'],
  ['bubble', 'Speech bubble'],
  ['tooltip', 'Tooltip arrow'],
]);

/** The eight triangle directions, by id with the label shown on the page. */
export const TRIANGLE_DIRECTIONS: ReadonlyMap<string, string> = new Map([
  ['up', 'Up'],
  ['down', 'Down'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['up-left', 'Up left'],
  ['up-right', 'Up right'],
  ['down-left', 'Down left'],
  ['down-right', 'Down right'],
]);

/** The tail or arrow sides each shape accepts, by shape id ('bubble' and 'tooltip'). */
export const TAIL_SIDES: ReadonlyMap<string, readonly string[]> = new Map([
  ['bubble', ['bottom-left', 'bottom-right', 'left', 'right']],
  ['tooltip', ['top', 'bottom', 'left', 'right']],
]);

const METHODS: ReadonlySet<string> = new Set(['border', 'clip-path']);

export interface GenerateShapeOptions {
  /** 'triangle' (default), 'ribbon', 'bubble' or 'tooltip'. */
  shape?: string;
  /** A triangle direction. Read for triangles only. Default 'up'. */
  direction?: string;
  /** 'border' (default) or 'clip-path'. Read for triangles only. */
  method?: string;
  /** A bubble tail or tooltip arrow side. Read for those two shapes only. Default 'bottom-left' or 'bottom'. */
  tail?: string;
  /** Width in pixels, clamped to 8 to 400. Default 160. */
  width?: number;
  /** Height in pixels, clamped to 8 to 400. Default 80. */
  height?: number;
  /** The triangle's colour, or the text colour of a ribbon, bubble or tooltip. A 3, 4, 6 or 8 digit hex colour. */
  colour?: string;
  /** The fill of a ribbon, bubble or tooltip and its tail. Not read for a triangle. */
  background?: string;
  /** One line of text for a ribbon, bubble or tooltip, at most 200 characters. Never reaches the CSS. */
  text?: string;
}

export interface GenerateShapeResult {
  /** The stylesheet, written by the canonical stylesheet writer. */
  css: string;
  /** The element tree the CSS styles: class names and text only. */
  tree: PreviewTreeNode;
  /** The tree as HTML, with the text escaped. Every class the CSS styles is in it. */
  markup: string;
  warnings: string[];
}

const DEFAULT_COLOUR = '#1d4ed8';
const DEFAULT_BACKGROUND = '#dbeafe';
const MIN_SIZE = 8;
const MAX_SIZE = 400;
const MAX_TEXT = 200;
const BUBBLE_TAIL = 16;
const BUBBLE_TAIL_OFFSET = 20;
const TOOLTIP_ARROW = 10;
const SURROUND = 24;

type Declarations = [string, string][];

function colourOf(value: string | undefined, fallback: string, label: string): RgbaColor {
  try {
    return parseHexColor(value ?? fallback, label);
  } catch (err) {
    if (err instanceof CssSafetyError) {
      throw new CssShapesError(`${label} is not a valid hexadecimal colour: use 3, 4, 6 or 8 digits after a #.`);
    }
    throw err;
  }
}

/**
 * For a page whose colour box can hold any typed text: the value when it is a 3, 4, 6 or 8 digit hex colour, otherwise
 * the fallback with a warning that names the field and never repeats what was typed.
 */
export function colourOrDefault(
  value: string,
  fallback: string,
  label: string,
): { colour: string; warning: string | null } {
  try {
    parseHexColor(value, label);
    return { colour: value, warning: null };
  } catch (err) {
    if (err instanceof CssSafetyError) {
      return {
        colour: fallback,
        warning: `${label} was not a valid hexadecimal colour, so ${fallback} was used instead.`,
      };
    }
    throw err;
  }
}

function choose(value: string | undefined, allowed: ReadonlySet<string>, fallback: string, label: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new CssShapesError(`${label} is not one of the choices on offer.`);
  }
  return value;
}

/** True for a control character or a character that only changes text direction or spacing. */
function isHidden(cp: number): boolean {
  return (
    cp <= 31 ||
    (cp >= 127 && cp <= 159) ||
    (cp >= 8203 && cp <= 8207) ||
    cp === 8232 ||
    cp === 8233 ||
    (cp >= 8234 && cp <= 8238) ||
    (cp >= 8288 && cp <= 8292) ||
    (cp >= 8294 && cp <= 8303) ||
    cp === 65279
  );
}

/** The text with control and direction characters taken out, cut to 200 characters without splitting a pair. */
function cleanText(raw: string | undefined, warnings: string[]): string {
  if (typeof raw !== 'string' || raw.length === 0) return '';
  let out = '';
  let removed = false;
  let cut = false;
  for (const ch of raw) {
    const cp = ch.codePointAt(0) as number;
    if (isHidden(cp)) {
      removed = true;
      continue;
    }
    if (out.length + ch.length > MAX_TEXT) {
      cut = true;
      break;
    }
    out += ch;
  }
  if (removed) warnings.push('Control and text direction characters were removed from the text.');
  if (cut) warnings.push(`The text was longer than ${MAX_TEXT} characters, so the first ${MAX_TEXT} were used.`);
  return out;
}

function escapeHtml(text: string): string {
  let out = '';
  for (const ch of text) {
    if (ch === '&') out += '&amp;';
    else if (ch === '<') out += '&lt;';
    else if (ch === '>') out += '&gt;';
    else if (ch === '"') out += '&quot;';
    else if (ch === "'") out += '&#39;';
    else out += ch;
  }
  return out;
}

function markupOf(node: PreviewTreeNode, depth: number): string {
  const pad = '  '.repeat(depth);
  const open = `<div class="${node.className}">${escapeHtml(node.text ?? '')}`;
  const children = node.children ?? [];
  if (children.length === 0) return `${pad}${open}</div>`;
  const inner = children.map((child) => markupOf(child, depth + 1)).join('\n');
  return `${pad}${open}\n${inner}\n${pad}</div>`;
}

function px(n: number): string {
  return formatLength(n, 'px', { bareZero: true });
}

const TRANSPARENT = 'transparent';

/** One border side of a border-method triangle: how long it is along each axis, and whether it carries the colour. */
type BorderSpec = {
  side: 'top' | 'right' | 'bottom' | 'left';
  size: 'half-width' | 'half-height' | 'width' | 'height';
  coloured: boolean;
};

const TRIANGLE_BORDERS: ReadonlyMap<string, readonly BorderSpec[]> = new Map([
  [
    'up',
    [
      { side: 'right', size: 'half-width', coloured: false },
      { side: 'bottom', size: 'height', coloured: true },
      { side: 'left', size: 'half-width', coloured: false },
    ],
  ],
  [
    'down',
    [
      { side: 'top', size: 'height', coloured: true },
      { side: 'right', size: 'half-width', coloured: false },
      { side: 'left', size: 'half-width', coloured: false },
    ],
  ],
  [
    'left',
    [
      { side: 'top', size: 'half-height', coloured: false },
      { side: 'right', size: 'width', coloured: true },
      { side: 'bottom', size: 'half-height', coloured: false },
    ],
  ],
  [
    'right',
    [
      { side: 'top', size: 'half-height', coloured: false },
      { side: 'bottom', size: 'half-height', coloured: false },
      { side: 'left', size: 'width', coloured: true },
    ],
  ],
  [
    'up-left',
    [
      { side: 'top', size: 'height', coloured: true },
      { side: 'right', size: 'width', coloured: false },
    ],
  ],
  [
    'up-right',
    [
      { side: 'top', size: 'height', coloured: true },
      { side: 'left', size: 'width', coloured: false },
    ],
  ],
  [
    'down-left',
    [
      { side: 'right', size: 'width', coloured: false },
      { side: 'bottom', size: 'height', coloured: true },
    ],
  ],
  [
    'down-right',
    [
      { side: 'bottom', size: 'height', coloured: true },
      { side: 'left', size: 'width', coloured: false },
    ],
  ],
]);

const TRIANGLE_POLYGONS: ReadonlyMap<string, string> = new Map([
  ['up', 'polygon(50% 0, 100% 100%, 0 100%)'],
  ['down', 'polygon(0 0, 100% 0, 50% 100%)'],
  ['left', 'polygon(100% 0, 100% 100%, 0 50%)'],
  ['right', 'polygon(0 0, 100% 50%, 0 100%)'],
  ['up-left', 'polygon(0 0, 100% 0, 0 100%)'],
  ['up-right', 'polygon(0 0, 100% 0, 100% 100%)'],
  ['down-left', 'polygon(0 0, 100% 100%, 0 100%)'],
  ['down-right', 'polygon(100% 0, 100% 100%, 0 100%)'],
]);

function triangleRule(
  direction: string,
  method: string,
  width: number,
  height: number,
  colour: string,
): { rule: CssRule; tree: PreviewTreeNode } {
  const tree: PreviewTreeNode = { className: 'triangle' };
  if (method === 'clip-path') {
    return {
      tree,
      rule: {
        selector: '.triangle',
        declarations: [
          ['width', px(width)],
          ['height', px(height)],
          ['background-color', colour],
          ['clip-path', TRIANGLE_POLYGONS.get(direction) as string],
        ],
      },
    };
  }
  const declarations: Declarations = [
    ['width', '0'],
    ['height', '0'],
  ];
  const lengths = { 'half-width': width / 2, 'half-height': height / 2, width, height };
  for (const spec of TRIANGLE_BORDERS.get(direction) as readonly BorderSpec[]) {
    declarations.push([
      `border-${spec.side}`,
      `${px(lengths[spec.size])} solid ${spec.coloured ? colour : TRANSPARENT}`,
    ]);
  }
  return { tree, rule: { selector: '.triangle', declarations } };
}

const TEXT_BOX_FONT: Declarations = [
  ['font-family', 'sans-serif'],
  ['font-size', '14px'],
];

function ribbonParts(
  width: number,
  height: number,
  text: string,
  fill: string,
  ink: string,
): { rules: CssRule[]; tree: PreviewTreeNode } {
  const end = Math.floor(Math.min(height / 2, width / 4));
  const body = width - 2 * end;
  const tree: PreviewTreeNode = {
    className: 'ribbon',
    children: [
      { className: 'ribbon-left' },
      text.length > 0 ? { className: 'ribbon-body', text } : { className: 'ribbon-body' },
      { className: 'ribbon-right' },
    ],
  };
  return {
    tree,
    rules: [
      {
        selector: '.ribbon',
        declarations: [
          ['position', 'relative'],
          ['width', px(width)],
          ['height', px(height)],
        ],
      },
      {
        selector: '.ribbon-left',
        declarations: [
          ['position', 'absolute'],
          ['top', '0'],
          ['left', '0'],
          ['width', px(end)],
          ['height', px(height)],
          ['background-color', fill],
          ['clip-path', 'polygon(0 0, 100% 0, 100% 100%, 0 100%, 60% 50%)'],
        ],
      },
      {
        selector: '.ribbon-body',
        declarations: [
          ['position', 'absolute'],
          ['top', '0'],
          ['left', px(end)],
          ['width', px(body)],
          ['height', px(height)],
          ['background-color', fill],
          ['color', ink],
          ...TEXT_BOX_FONT,
          ['line-height', px(height)],
          ['text-align', 'center'],
          ['white-space', 'nowrap'],
          ['overflow', 'hidden'],
        ],
      },
      {
        selector: '.ribbon-right',
        declarations: [
          ['position', 'absolute'],
          ['top', '0'],
          ['right', '0'],
          ['width', px(end)],
          ['height', px(height)],
          ['background-color', fill],
          ['clip-path', 'polygon(0 0, 100% 0, 40% 50%, 100% 100%, 0 100%)'],
        ],
      },
    ],
  };
}

function tailDeclarations(shape: 'bubble' | 'tooltip', side: string, fill: string): Declarations {
  const base: Declarations = [
    ['position', 'absolute'],
    ['width', '0'],
    ['height', '0'],
  ];
  if (shape === 'bubble') {
    const size = px(BUBBLE_TAIL);
    const solid = `${size} solid ${fill}`;
    const clear = `${size} solid ${TRANSPARENT}`;
    const edge = px(BUBBLE_TAIL_OFFSET);
    const out = px(-BUBBLE_TAIL);
    switch (side) {
      case 'bottom-left':
        return [...base, ['left', edge], ['top', '100%'], ['border-top', solid], ['border-right', clear]];
      case 'bottom-right':
        return [...base, ['right', edge], ['top', '100%'], ['border-top', solid], ['border-left', clear]];
      case 'left':
        return [...base, ['left', out], ['top', edge], ['border-right', solid], ['border-top', clear]];
      default:
        return [...base, ['right', out], ['top', edge], ['border-left', solid], ['border-top', clear]];
    }
  }
  const size = px(TOOLTIP_ARROW);
  const solid = `${size} solid ${fill}`;
  const clear = `${size} solid ${TRANSPARENT}`;
  const pull = px(-TOOLTIP_ARROW);
  switch (side) {
    case 'top':
      return [
        ...base,
        ['left', '50%'],
        ['bottom', '100%'],
        ['margin-left', pull],
        ['border-left', clear],
        ['border-right', clear],
        ['border-bottom', solid],
      ];
    case 'bottom':
      return [
        ...base,
        ['left', '50%'],
        ['top', '100%'],
        ['margin-left', pull],
        ['border-left', clear],
        ['border-right', clear],
        ['border-top', solid],
      ];
    case 'left':
      return [
        ...base,
        ['top', '50%'],
        ['right', '100%'],
        ['margin-top', pull],
        ['border-top', clear],
        ['border-bottom', clear],
        ['border-right', solid],
      ];
    default:
      return [
        ...base,
        ['top', '50%'],
        ['left', '100%'],
        ['margin-top', pull],
        ['border-top', clear],
        ['border-bottom', clear],
        ['border-left', solid],
      ];
  }
}

function calloutParts(
  shape: 'bubble' | 'tooltip',
  side: string,
  width: number,
  height: number,
  text: string,
  fill: string,
  ink: string,
): { rules: CssRule[]; tree: PreviewTreeNode } {
  const box = shape === 'bubble' ? 'bubble' : 'tooltip';
  const tail = shape === 'bubble' ? 'bubble-tail' : 'tooltip-arrow';
  const tree: PreviewTreeNode =
    text.length > 0
      ? { className: box, text, children: [{ className: tail }] }
      : { className: box, children: [{ className: tail }] };
  return {
    tree,
    rules: [
      {
        selector: `.${box}`,
        declarations: [
          ['position', 'relative'],
          ['box-sizing', 'border-box'],
          ['display', 'flex'],
          ['align-items', 'center'],
          ['justify-content', 'center'],
          ['width', px(width)],
          ['height', px(height)],
          ['margin', px(SURROUND)],
          ['padding', '8px'],
          ['border-radius', shape === 'bubble' ? '12px' : '6px'],
          ['background-color', fill],
          ['color', ink],
          ...TEXT_BOX_FONT,
          ['text-align', 'center'],
        ],
      },
      { selector: `.${tail}`, declarations: tailDeclarations(shape, side, fill) },
    ],
  };
}

/**
 * Writes the CSS, the element tree and the markup for a triangle, a ribbon, a speech bubble or a tooltip arrow.
 *
 * A triangle by the border method is a box of no size whose borders meet at a corner: where two borders meet, the
 * browser cuts the corner along the diagonal between the outer and the inner corner (CSS Backgrounds and Borders
 * Level 3, "Corner transitions"), so a coloured border beside a transparent one leaves a triangle. By the clip-path
 * method it is a coloured box cut to a polygon (CSS Masking Level 1, basic shapes). Tails, ribbon ends and arrows are
 * child elements, never pseudo-elements, because the canonical stylesheet writer writes class selectors only.
 */
export function generateShape(options: GenerateShapeOptions): GenerateShapeResult {
  const warnings: string[] = [];
  const shape = choose(options.shape, new Set(SHAPES.keys()), 'triangle', 'Shape');

  const widthResult = clampNumber('Width', options.width as number, MIN_SIZE, MAX_SIZE, 160);
  const heightResult = clampNumber('Height', options.height as number, MIN_SIZE, MAX_SIZE, 80);
  if (options.width === undefined) widthResult.warning = null;
  if (options.height === undefined) heightResult.warning = null;
  if (widthResult.warning) warnings.push(widthResult.warning);
  if (heightResult.warning) warnings.push(heightResult.warning);
  const width = widthResult.value;
  const height = heightResult.value;

  const colour = colourOf(options.colour, DEFAULT_COLOUR, 'Colour');

  let rules: CssRule[];
  let tree: PreviewTreeNode;

  if (shape === 'triangle') {
    const direction = choose(options.direction, new Set(TRIANGLE_DIRECTIONS.keys()), 'up', 'Direction');
    const method = choose(options.method, METHODS, 'border', 'Method');
    const built = triangleRule(direction, method, width, height, formatHexColor(colour));
    rules = [built.rule];
    tree = built.tree;
  } else {
    const fill = formatHexColor(colourOf(options.background, DEFAULT_BACKGROUND, 'Background'));
    const ink = formatHexColor(colour);
    const text = cleanText(options.text, warnings);
    if (shape === 'ribbon') {
      const built = ribbonParts(width, height, text, fill, ink);
      rules = built.rules;
      tree = built.tree;
    } else {
      const kind = shape === 'bubble' ? 'bubble' : 'tooltip';
      const sides = TAIL_SIDES.get(kind) as readonly string[];
      const side = choose(options.tail, new Set(sides), kind === 'bubble' ? 'bottom-left' : 'bottom', 'Tail');
      const built = calloutParts(kind, side, width, height, text, fill, ink);
      rules = built.rules;
      tree = built.tree;
    }
  }

  try {
    assertSafeTree(tree);
    const css = stylesheetText({ rules });
    return { css, tree, markup: markupOf(tree, 0), warnings };
  } catch (err) {
    if (err instanceof CssSafetyError) throw new CssShapesError(err.message);
    throw err;
  }
}

/**
 * Core utility families of Tailwind CSS 4 (the pinned version this folder
 * tests against, D-76): resolves a class name to the plain CSS declarations
 * Tailwind's own compiler would give it, with every theme variable resolved
 * to its value and every internal `--tw-*` custom property resolved to its
 * registered initial value (or dropped, when the class only ever sets one
 * and never reads it back). `test/oracle.test.ts` proves every candidate in
 * `SUPPORTED_CANDIDATES` against the real, pinned `tailwindcss` package.
 *
 * Not converted: variants (`hover:`, `md:`, `dark:`), arbitrary values
 * (`p-[3px]`), plugins and user configuration or `@theme` overrides,
 * `space-*`, `divide-*`, shadows, rings, transforms, transitions and
 * animations. A class this module does not recognise resolves to `null`.
 */
import { THEME, type ColorKey } from './theme';

export type Declarations = Record<string, string>;

// ---------------------------------------------------------------------------
// Numeric helpers
// ---------------------------------------------------------------------------

/**
 * Spacing steps this tool accepts, as Tailwind CSS 4 itself computes them:
 * `calc(var(--spacing) * <number>)`, quarter-step numbers from 0 to 96
 * (confirmed directly against the pinned compiler this session: `p-2.25` and
 * `p-2.75` both compile). `0` alone compiles to the literal `0px`, never a
 * `calc()` — also confirmed directly. This tool's own accepted range (0 to
 * 96 in quarter steps) is a closed design choice for a finite,
 * fully-testable candidate set; Tailwind's real compiler accepts any decimal.
 */
const SPACING_RE = /^(\d{1,3})(?:\.(0|25|5|75))?$/;

/** True for a token this tool accepts as a quarter-step spacing number (0 to 96). */
export function isSpacingStep(token: string): boolean {
  const m = SPACING_RE.exec(token);
  if (!m) return false;
  const whole = Number(m[1]);
  const frac = m[2] ? Number(m[2]) / 100 : 0;
  const value = whole + frac;
  return value >= 0 && value <= 96;
}

/** Formats a rem number the way this tool folds `calc(<length> * <number>)`: no trailing zeros, no unit on a bare 0. */
function formatRem(value: number): string {
  const rounded = Math.round(value * 10000) / 10000;
  const fixed = rounded.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return `${fixed}rem`;
}

/**
 * Folds `calc(var(--spacing) * <n>)` to a single resolved length, the way
 * the task requires: `--spacing` is `0.25rem` (an exact power-of-two
 * fraction), and every accepted step is itself a multiple of a quarter, so
 * the product is always an exact multiple of 1/16 rem -- representable
 * exactly in IEEE-754 double precision, so plain multiplication never drifts.
 */
function spacingLength(token: string, negative: boolean): string | undefined {
  if (!isSpacingStep(token)) return undefined;
  if (token === 'px') return negative ? '-1px' : '1px';
  const value = Number(token);
  if (value === 0) return '0px';
  const rem = value * 0.25;
  return (negative ? -rem : rem) < 0 ? `-${formatRem(rem)}` : formatRem(rem);
}

/** `px` is handled by `spacingLength` directly; this parses the `px` spacing keyword too. */
function spacingOrPx(token: string, negative: boolean): string | undefined {
  if (token === 'px') return negative ? '-1px' : '1px';
  return spacingLength(token, negative);
}

const FRACTIONS = new Set([
  '1/2',
  '1/3',
  '2/3',
  '1/4',
  '2/4',
  '3/4',
  '1/5',
  '2/5',
  '3/5',
  '4/5',
  '1/6',
  '2/6',
  '3/6',
  '4/6',
  '5/6',
  '1/12',
  '2/12',
  '3/12',
  '4/12',
  '5/12',
  '6/12',
  '7/12',
  '8/12',
  '9/12',
  '10/12',
  '11/12',
]);

/** Tailwind CSS 4's own fraction output: `calc(<a> / <b> * 100%)`, unreduced. */
function fractionValue(token: string): string | undefined {
  if (!FRACTIONS.has(token)) return undefined;
  const [a, b] = token.split('/');
  return `calc(${a} / ${b} * 100%)`;
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

function resolveColorToken(token: string): string | undefined {
  if (token === 'transparent') return 'transparent';
  if (token === 'current') return 'currentcolor';
  if (token === 'inherit') return 'inherit';
  if (Object.prototype.hasOwnProperty.call(THEME.color, token)) return THEME.color[token as ColorKey];
  return undefined;
}

/** Opacity steps this tool accepts: 0 to 100 in steps of 5, matching the pinned compiler's own `/<opacity>` modifier. */
export function isOpacityStep(token: string): boolean {
  if (!/^\d{1,3}$/.test(token)) return false;
  const n = Number(token);
  return n >= 0 && n <= 100 && n % 5 === 0;
}

/**
 * Resolves a `<color>` or `<color>/<opacity>` value. At opacity 100 (or no
 * modifier) the pinned compiler emits the plain resolved colour with no
 * `color-mix()` at all -- confirmed directly this session (`bg-black/100`
 * compiles to the same declaration as bare `bg-black`). Below 100 it emits
 * two declarations for a resolvable colour (an `in srgb` fallback, then an
 * `in oklab` version inside `@supports (color: color-mix(in lab, red,
 * red))`) and only the `in oklab` version for a colour that cannot be
 * resolved at build time (`current`, `transparent`, `inherit`); either way
 * the later declaration for the same property wins in every browser that
 * runs this page, so this tool always emits the modern `in oklab` form.
 */
function colorWithOpacity(colorToken: string, opacityToken: string | undefined): string | undefined {
  const base = resolveColorToken(colorToken);
  if (base === undefined) return undefined;
  if (opacityToken === undefined) return base;
  if (!isOpacityStep(opacityToken)) return undefined;
  const opacity = Number(opacityToken);
  if (opacity === 100) return base;
  return `color-mix(in oklab, ${base} ${opacity}%, transparent)`;
}

/** Splits `<token>` or `<token>/<opacity>` and resolves the colour. */
function parseColorValue(rest: string): string | undefined {
  const slash = rest.indexOf('/');
  if (slash === -1) return colorWithOpacity(rest, undefined);
  return colorWithOpacity(rest.slice(0, slash), rest.slice(slash + 1));
}

// ---------------------------------------------------------------------------
// Family: spacing (padding, margin, gap)
// ---------------------------------------------------------------------------

const SPACING_PROPS: [prefix: string, negatable: boolean, props: string[]][] = [
  ['px', false, ['padding-inline']],
  ['py', false, ['padding-block']],
  ['pt', false, ['padding-top']],
  ['pr', false, ['padding-right']],
  ['pb', false, ['padding-bottom']],
  ['pl', false, ['padding-left']],
  ['ps', false, ['padding-inline-start']],
  ['pe', false, ['padding-inline-end']],
  ['p', false, ['padding']],
  ['mx', true, ['margin-inline']],
  ['my', true, ['margin-block']],
  ['mt', true, ['margin-top']],
  ['mr', true, ['margin-right']],
  ['mb', true, ['margin-bottom']],
  ['ml', true, ['margin-left']],
  ['ms', true, ['margin-inline-start']],
  ['me', true, ['margin-inline-end']],
  ['m', true, ['margin']],
  ['gap-x', false, ['column-gap']],
  ['gap-y', false, ['row-gap']],
  ['gap', false, ['gap']],
];
SPACING_PROPS.sort((a, b) => b[0].length - a[0].length);

function matchSpacing(candidate: string): Declarations | undefined {
  let negative = false;
  let rest = candidate;
  if (rest.startsWith('-')) {
    negative = true;
    rest = rest.slice(1);
  }
  for (const [prefix, negatable, props] of SPACING_PROPS) {
    if (rest === prefix || !rest.startsWith(prefix + '-')) continue;
    const valueToken = rest === prefix ? '' : rest.slice(prefix.length + 1);
    if (valueToken === '') continue;
    if (negative && !negatable) return undefined;
    // 'm' is a prefix of 'mx'/'my'/... too, so only accept the exact family this prefix names.
    if (prefix !== rest.slice(0, prefix.length)) continue;
    const value = valueToken === 'auto' && prefix.startsWith('m') ? 'auto' : spacingOrPx(valueToken, negative);
    if (value === undefined) continue;
    const out: Declarations = {};
    for (const p of props) out[p] = value;
    return out;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Family: sizing (width, height, size, min/max)
// ---------------------------------------------------------------------------

interface SizingOptions {
  axis: 'w' | 'h';
  allowAuto: boolean;
  allowMinMaxFit: boolean;
  allowNone: boolean;
  allowContainer: boolean;
}

function sizingValue(token: string, opts: SizingOptions): string | undefined {
  if (token === 'auto') return opts.allowAuto ? 'auto' : undefined;
  if (token === 'full') return '100%';
  if (token === 'screen') return opts.axis === 'w' ? '100vw' : '100vh';
  if (token === 'min') return opts.allowMinMaxFit ? 'min-content' : undefined;
  if (token === 'max') return opts.allowMinMaxFit ? 'max-content' : undefined;
  if (token === 'fit') return opts.allowMinMaxFit ? 'fit-content' : undefined;
  if (token === 'none') return opts.allowNone ? 'none' : undefined;
  if (opts.allowContainer && Object.prototype.hasOwnProperty.call(THEME.container, token)) {
    return THEME.container[token as keyof typeof THEME.container];
  }
  const fraction = fractionValue(token);
  if (fraction !== undefined) return fraction;
  return spacingOrPx(token, false);
}

const SIZING_PROPS: [prefix: string, cssProp: string | string[], opts: SizingOptions][] = [
  [
    'min-w',
    'min-width',
    { axis: 'w', allowAuto: false, allowMinMaxFit: true, allowNone: false, allowContainer: false },
  ],
  [
    'min-h',
    'min-height',
    { axis: 'h', allowAuto: false, allowMinMaxFit: true, allowNone: false, allowContainer: false },
  ],
  ['max-w', 'max-width', { axis: 'w', allowAuto: false, allowMinMaxFit: true, allowNone: true, allowContainer: true }],
  [
    'max-h',
    'max-height',
    { axis: 'h', allowAuto: false, allowMinMaxFit: true, allowNone: true, allowContainer: false },
  ],
  ['w', 'width', { axis: 'w', allowAuto: true, allowMinMaxFit: true, allowNone: false, allowContainer: false }],
  ['h', 'height', { axis: 'h', allowAuto: true, allowMinMaxFit: true, allowNone: false, allowContainer: false }],
  [
    'size',
    ['width', 'height'],
    { axis: 'w', allowAuto: true, allowMinMaxFit: true, allowNone: false, allowContainer: false },
  ],
];
SIZING_PROPS.sort((a, b) => (b[0] as string).length - (a[0] as string).length);

function matchSizing(candidate: string): Declarations | undefined {
  for (const [prefix, cssProp, opts] of SIZING_PROPS) {
    if (!candidate.startsWith(prefix + '-')) continue;
    const token = candidate.slice(prefix.length + 1);
    if (token === '') continue;
    const value = sizingValue(token, opts);
    if (value === undefined) continue;
    const props = Array.isArray(cssProp) ? cssProp : [cssProp];
    const out: Declarations = {};
    for (const p of props) out[p] = value;
    return out;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Family: colour (text, background, border + sides, fill, stroke)
// ---------------------------------------------------------------------------

const BORDER_SIDE_COLOR_PROP: Record<string, string> = {
  border: 'border-color',
  'border-t': 'border-top-color',
  'border-r': 'border-right-color',
  'border-b': 'border-bottom-color',
  'border-l': 'border-left-color',
  'border-x': 'border-inline-color',
  'border-y': 'border-block-color',
};
const BORDER_COLOR_PREFIXES = Object.keys(BORDER_SIDE_COLOR_PROP).sort((a, b) => b.length - a.length);

function matchColor(candidate: string): Declarations | undefined {
  if (candidate.startsWith('bg-')) {
    const value = parseColorValue(candidate.slice(3));
    return value === undefined ? undefined : { 'background-color': value };
  }
  if (candidate.startsWith('text-')) {
    const value = parseColorValue(candidate.slice(5));
    return value === undefined ? undefined : { color: value };
  }
  if (candidate.startsWith('fill-')) {
    const value = parseColorValue(candidate.slice(5));
    return value === undefined ? undefined : { fill: value };
  }
  if (candidate.startsWith('stroke-')) {
    const value = parseColorValue(candidate.slice(7));
    return value === undefined ? undefined : { stroke: value };
  }
  for (const prefix of BORDER_COLOR_PREFIXES) {
    if (!candidate.startsWith(prefix + '-')) continue;
    const rest = candidate.slice(prefix.length + 1);
    // border width/style share this same prefix set; only claim it here when
    // the remainder is a colour token, never a bare number or style keyword.
    if (/^\d/.test(rest) || BORDER_STYLE_KEYWORDS.has(rest.split('/')[0] ?? '')) return undefined;
    const value = parseColorValue(rest);
    if (value === undefined) return undefined;
    return { [BORDER_SIDE_COLOR_PROP[prefix]!]: value };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Family: typography
// ---------------------------------------------------------------------------

const TEXT_ALIGN: Record<string, string> = {
  center: 'center',
  left: 'left',
  right: 'right',
  justify: 'justify',
  start: 'start',
  end: 'end',
};

const TEXT_TRANSFORM: Record<string, string> = {
  uppercase: 'uppercase',
  lowercase: 'lowercase',
  capitalize: 'capitalize',
  'normal-case': 'none',
};

const TEXT_DECORATION: Record<string, string> = {
  underline: 'underline',
  'line-through': 'line-through',
  'no-underline': 'none',
};

function matchTypography(candidate: string): Declarations | undefined {
  if (candidate.startsWith('text-')) {
    const rest = candidate.slice(5);
    if (Object.prototype.hasOwnProperty.call(THEME.text, rest)) {
      const size = THEME.text[rest as keyof typeof THEME.text];
      return { 'font-size': size.fontSize, 'line-height': size.lineHeight };
    }
    if (rest in TEXT_ALIGN) return { 'text-align': TEXT_ALIGN[rest]! };
  }
  if (candidate.startsWith('font-')) {
    const rest = candidate.slice(5);
    if (Object.prototype.hasOwnProperty.call(THEME.fontWeight, rest)) {
      return { 'font-weight': THEME.fontWeight[rest as keyof typeof THEME.fontWeight] };
    }
    if (Object.prototype.hasOwnProperty.call(THEME.fontFamily, rest)) {
      return { 'font-family': THEME.fontFamily[rest as keyof typeof THEME.fontFamily] };
    }
  }
  if (candidate.startsWith('tracking-')) {
    const rest = candidate.slice(9);
    if (Object.prototype.hasOwnProperty.call(THEME.tracking, rest)) {
      return { 'letter-spacing': THEME.tracking[rest as keyof typeof THEME.tracking] };
    }
  }
  if (candidate.startsWith('leading-')) {
    const rest = candidate.slice(8);
    if (Object.prototype.hasOwnProperty.call(THEME.leading, rest)) {
      return { 'line-height': THEME.leading[rest as keyof typeof THEME.leading] };
    }
  }
  if (candidate === 'italic') return { 'font-style': 'italic' };
  if (candidate === 'not-italic') return { 'font-style': 'normal' };
  if (candidate in TEXT_TRANSFORM) return { 'text-transform': TEXT_TRANSFORM[candidate]! };
  if (candidate in TEXT_DECORATION) return { 'text-decoration-line': TEXT_DECORATION[candidate]! };
  if (candidate === 'truncate') return { overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' };
  return undefined;
}

// ---------------------------------------------------------------------------
// Family: flex and grid
// ---------------------------------------------------------------------------

const DISPLAY_VALUES: Record<string, string> = {
  block: 'block',
  'inline-block': 'inline-block',
  inline: 'inline',
  hidden: 'none',
  'flow-root': 'flow-root',
  flex: 'flex',
  'inline-flex': 'inline-flex',
  grid: 'grid',
  'inline-grid': 'inline-grid',
};

const FLEX_DIRECTION: Record<string, string> = {
  'flex-row': 'row',
  'flex-row-reverse': 'row-reverse',
  'flex-col': 'column',
  'flex-col-reverse': 'column-reverse',
};

const FLEX_WRAP: Record<string, string> = {
  'flex-wrap': 'wrap',
  'flex-nowrap': 'nowrap',
  'flex-wrap-reverse': 'wrap-reverse',
};

const FLEX_SHORTHAND: Record<string, string> = {
  'flex-1': '1',
  'flex-auto': 'auto',
  'flex-initial': '0 auto',
  'flex-none': 'none',
};

const ITEMS: Record<string, string> = {
  'items-start': 'flex-start',
  'items-end': 'flex-end',
  'items-center': 'center',
  'items-baseline': 'baseline',
  'items-stretch': 'stretch',
};

const JUSTIFY: Record<string, string> = {
  'justify-start': 'flex-start',
  'justify-end': 'flex-end',
  'justify-center': 'center',
  'justify-between': 'space-between',
  'justify-around': 'space-around',
  'justify-evenly': 'space-evenly',
};

const CONTENT: Record<string, string> = {
  'content-start': 'flex-start',
  'content-end': 'flex-end',
  'content-center': 'center',
  'content-between': 'space-between',
  'content-around': 'space-around',
  'content-evenly': 'space-evenly',
  'content-baseline': 'baseline',
  'content-stretch': 'stretch',
};

const SELF: Record<string, string> = {
  'self-auto': 'auto',
  'self-start': 'flex-start',
  'self-end': 'flex-end',
  'self-center': 'center',
  'self-baseline': 'baseline',
  'self-stretch': 'stretch',
};

const ORDER_KEYWORDS: Record<string, string> = { first: '-9999', last: '9999', none: '0' };
const GRID_FLOW: Record<string, string> = {
  'grid-flow-row': 'row',
  'grid-flow-col': 'column',
  'grid-flow-dense': 'dense',
  'grid-flow-row-dense': 'row dense',
  'grid-flow-col-dense': 'column dense',
};

/** This tool's own closed range for the numbered grid/order utilities (a design choice, not a theme value). */
const MAX_GRID_LINE = 13;
const MAX_GRID_TRACK = 12;
const MAX_ORDER = 12;

function integerInRange(token: string, max: number): number | undefined {
  if (!/^\d{1,3}$/.test(token)) return undefined;
  const n = Number(token);
  return n >= 1 && n <= max ? n : undefined;
}

function matchFlexGrid(candidate: string): Declarations | undefined {
  if (candidate in DISPLAY_VALUES) return { display: DISPLAY_VALUES[candidate]! };
  if (candidate in FLEX_DIRECTION) return { 'flex-direction': FLEX_DIRECTION[candidate]! };
  if (candidate in FLEX_WRAP) return { 'flex-wrap': FLEX_WRAP[candidate]! };
  if (candidate in FLEX_SHORTHAND) return { flex: FLEX_SHORTHAND[candidate]! };
  if (candidate === 'grow') return { 'flex-grow': '1' };
  if (candidate === 'shrink') return { 'flex-shrink': '1' };
  if (candidate in ITEMS) return { 'align-items': ITEMS[candidate]! };
  if (candidate in JUSTIFY) return { 'justify-content': JUSTIFY[candidate]! };
  if (candidate in CONTENT) return { 'align-content': CONTENT[candidate]! };
  if (candidate in SELF) return { 'align-self': SELF[candidate]! };
  if (candidate in GRID_FLOW) return { 'grid-auto-flow': GRID_FLOW[candidate]! };

  if (candidate.startsWith('basis-')) {
    const token = candidate.slice(6);
    const value =
      token === 'auto' ? 'auto' : token === 'full' ? '100%' : (fractionValue(token) ?? spacingOrPx(token, false));
    return value === undefined ? undefined : { 'flex-basis': value };
  }
  if (candidate.startsWith('order-')) {
    const token = candidate.slice(6);
    if (token in ORDER_KEYWORDS) return { order: ORDER_KEYWORDS[token]! };
    const n = integerInRange(token, MAX_ORDER);
    return n === undefined ? undefined : { order: String(n) };
  }
  if (candidate.startsWith('grid-cols-')) {
    const n = integerInRange(candidate.slice(10), MAX_GRID_TRACK);
    return n === undefined ? undefined : { 'grid-template-columns': `repeat(${n}, minmax(0, 1fr))` };
  }
  if (candidate.startsWith('grid-rows-')) {
    const n = integerInRange(candidate.slice(10), MAX_GRID_TRACK);
    return n === undefined ? undefined : { 'grid-template-rows': `repeat(${n}, minmax(0, 1fr))` };
  }
  if (candidate.startsWith('col-span-')) {
    const token = candidate.slice(9);
    if (token === 'full') return { 'grid-column': '1 / -1' };
    const n = integerInRange(token, MAX_GRID_TRACK);
    return n === undefined ? undefined : { 'grid-column': `span ${n} / span ${n}` };
  }
  if (candidate.startsWith('row-span-')) {
    const token = candidate.slice(9);
    if (token === 'full') return { 'grid-row': '1 / -1' };
    const n = integerInRange(token, MAX_GRID_TRACK);
    return n === undefined ? undefined : { 'grid-row': `span ${n} / span ${n}` };
  }
  if (candidate.startsWith('col-start-')) {
    const token = candidate.slice(10);
    if (token === 'auto') return { 'grid-column-start': 'auto' };
    const n = integerInRange(token, MAX_GRID_LINE);
    return n === undefined ? undefined : { 'grid-column-start': String(n) };
  }
  if (candidate.startsWith('col-end-')) {
    const token = candidate.slice(8);
    if (token === 'auto') return { 'grid-column-end': 'auto' };
    const n = integerInRange(token, MAX_GRID_LINE);
    return n === undefined ? undefined : { 'grid-column-end': String(n) };
  }
  if (candidate.startsWith('row-start-')) {
    const token = candidate.slice(10);
    if (token === 'auto') return { 'grid-row-start': 'auto' };
    const n = integerInRange(token, MAX_GRID_LINE);
    return n === undefined ? undefined : { 'grid-row-start': String(n) };
  }
  if (candidate.startsWith('row-end-')) {
    const token = candidate.slice(8);
    if (token === 'auto') return { 'grid-row-end': 'auto' };
    const n = integerInRange(token, MAX_GRID_LINE);
    return n === undefined ? undefined : { 'grid-row-end': String(n) };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Family: borders (width, style, sides, radius and corners)
// ---------------------------------------------------------------------------

const BORDER_STYLE_KEYWORDS = new Set(['solid', 'dashed', 'dotted', 'double', 'hidden', 'none']);

const BORDER_SIDE_PROPS: Record<string, { style: string; width: string }> = {
  border: { style: 'border-style', width: 'border-width' },
  'border-t': { style: 'border-top-style', width: 'border-top-width' },
  'border-r': { style: 'border-right-style', width: 'border-right-width' },
  'border-b': { style: 'border-bottom-style', width: 'border-bottom-width' },
  'border-l': { style: 'border-left-style', width: 'border-left-width' },
  'border-x': { style: 'border-inline-style', width: 'border-inline-width' },
  'border-y': { style: 'border-block-style', width: 'border-block-width' },
};
const BORDER_SIDE_PREFIXES = Object.keys(BORDER_SIDE_PROPS).sort((a, b) => b.length - a.length);

/** This tool's own closed range for a bare `border-<n>` width (a design choice; the pinned compiler accepts any non-negative integer). */
const MAX_BORDER_WIDTH = 12;

const RADIUS_CORNERS: Record<string, string[]> = {
  '': ['border-radius'],
  t: ['border-top-left-radius', 'border-top-right-radius'],
  r: ['border-top-right-radius', 'border-bottom-right-radius'],
  b: ['border-bottom-right-radius', 'border-bottom-left-radius'],
  l: ['border-top-left-radius', 'border-bottom-left-radius'],
  tl: ['border-top-left-radius'],
  tr: ['border-top-right-radius'],
  br: ['border-bottom-right-radius'],
  bl: ['border-bottom-left-radius'],
};
const RADIUS_SIDE_KEYS = Object.keys(RADIUS_CORNERS).filter((k) => k !== '');

/** `rounded` (bare) uses Tailwind's deprecated `--radius` alias, `0.25rem` -- transcribed from `theme.css`'s own `@theme default inline reference` block. */
const RADIUS_DEFAULT = '0.25rem';

function radiusValue(token: string): string | undefined {
  if (token === '') return RADIUS_DEFAULT;
  if (token === 'full') return 'calc(infinity * 1px)';
  if (token === 'none') return '0';
  if (Object.prototype.hasOwnProperty.call(THEME.radius, token)) {
    return THEME.radius[token as keyof typeof THEME.radius];
  }
  return undefined;
}

function matchBorders(candidate: string): Declarations | undefined {
  if (candidate.startsWith('rounded')) {
    const rest = candidate.slice('rounded'.length);
    if (rest === '') return { 'border-radius': RADIUS_DEFAULT };
    if (rest.startsWith('-')) {
      const token = rest.slice(1);
      const dash = token.indexOf('-');
      const maybeSide = dash === -1 ? token : token.slice(0, dash);
      if (RADIUS_SIDE_KEYS.includes(maybeSide)) {
        const sizeToken = dash === -1 ? '' : token.slice(dash + 1);
        const value = radiusValue(sizeToken);
        if (value === undefined) return undefined;
        const out: Declarations = {};
        for (const prop of RADIUS_CORNERS[maybeSide]!) out[prop] = value;
        return out;
      }
      const value = radiusValue(token);
      return value === undefined ? undefined : { 'border-radius': value };
    }
  }

  for (const prefix of BORDER_SIDE_PREFIXES) {
    if (candidate !== prefix && !candidate.startsWith(prefix + '-')) continue;
    const rest = candidate === prefix ? '' : candidate.slice(prefix.length + 1);
    const { style, width } = BORDER_SIDE_PROPS[prefix]!;
    if (rest === '') return { [style]: 'solid', [width]: '1px' };
    // A style keyword (`border-dashed`, `border-hidden`, ...) exists only on
    // the bare `border` prefix, never on a side (`border-t-dashed` is not a
    // real Tailwind class -- confirmed directly against the pinned compiler
    // this session, which compiles it to nothing).
    if (prefix === 'border' && BORDER_STYLE_KEYWORDS.has(rest)) return { [style]: rest };
    const n = /^\d{1,3}$/.test(rest) ? Number(rest) : undefined;
    if (n !== undefined && n >= 0 && n <= MAX_BORDER_WIDTH) return { [style]: 'solid', [width]: `${n}px` };
    return undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const MATCHERS: ((candidate: string) => Declarations | undefined)[] = [
  matchFlexGrid,
  matchTypography,
  matchColor,
  matchBorders,
  matchSizing,
  matchSpacing,
];

/** Resolves a single class name to plain CSS declarations, or `null` when this tool does not convert it. */
export function resolveClass(candidate: string): Declarations | null {
  for (const matcher of MATCHERS) {
    const result = matcher(candidate);
    if (result !== undefined) return result;
  }
  return null;
}

// ---------------------------------------------------------------------------
// SUPPORTED_CANDIDATES
// ---------------------------------------------------------------------------

function quarterSteps(max: number): string[] {
  const out: string[] = [];
  for (let i = 0; i <= max * 4; i++) {
    const n = i / 4;
    out.push(Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ''));
  }
  return out;
}
const SPACING_STEPS = quarterSteps(96);

function buildSpacingCandidates(): string[] {
  const out: string[] = [];
  for (const [prefix, negatable] of SPACING_PROPS) {
    for (const step of SPACING_STEPS) {
      out.push(`${prefix}-${step}`);
      if (negatable && step !== '0') out.push(`-${prefix}-${step}`);
    }
    out.push(`${prefix}-px`);
    if (negatable) out.push(`-${prefix}-px`);
  }
  for (const prefix of ['m', 'mx', 'my', 'mt', 'mr', 'mb', 'ml', 'ms', 'me']) out.push(`${prefix}-auto`);
  return out;
}

const ALL_COLOR_TOKENS: string[] = [...Object.keys(THEME.color), 'transparent', 'current', 'inherit'];
const OPACITY_STEPS: string[] = Array.from({ length: 21 }, (_, i) => String(i * 5));

function buildColorCandidates(): string[] {
  const out: string[] = [];
  const properties = ['bg', 'text', 'fill', 'stroke', ...BORDER_COLOR_PREFIXES];
  for (const prefix of properties) {
    for (const color of ALL_COLOR_TOKENS) out.push(`${prefix}-${color}`);
  }
  // The `/<opacity>` sweep is enumerated in full for `bg-*` (the documented
  // example this task names); other colour-accepting families exercise
  // opacity through targeted assertions in the test file rather than the
  // full cross product, which would multiply the candidate set several
  // times over for no gain in what the oracle actually proves (resolveClass
  // computes the modifier identically regardless of which property it is
  // attached to -- see `colorWithOpacity` above).
  for (const color of Object.keys(THEME.color)) {
    for (const step of OPACITY_STEPS) out.push(`bg-${color}/${step}`);
  }
  return out;
}

function buildSizingCandidates(): string[] {
  const out: string[] = [];
  const keywordsByPrefix: Record<string, string[]> = {
    w: ['auto', 'full', 'screen', 'min', 'max', 'fit', 'px', '0'],
    h: ['auto', 'full', 'screen', 'min', 'max', 'fit', 'px', '0'],
    size: ['auto', 'full', 'min', 'max', 'fit', 'px', '0'],
    'min-w': ['full', 'screen', 'min', 'max', 'fit', 'px', '0'],
    'min-h': ['full', 'screen', 'min', 'max', 'fit', 'px', '0'],
    'max-w': ['full', 'screen', 'none', 'min', 'max', 'fit', 'px', '0'],
    'max-h': ['full', 'screen', 'none', 'min', 'max', 'fit', 'px', '0'],
  };
  for (const [prefix, keywords] of Object.entries(keywordsByPrefix)) {
    for (const kw of keywords) out.push(`${prefix}-${kw}`);
    for (const step of [1, 2, 4, 8, 16, 32, 64, 96]) out.push(`${prefix}-${step}`);
    for (const fraction of FRACTIONS) out.push(`${prefix}-${fraction}`);
  }
  for (const key of Object.keys(THEME.container)) out.push(`max-w-${key}`);
  return out;
}

function buildTypographyCandidates(): string[] {
  const out: string[] = [];
  for (const key of Object.keys(THEME.text)) out.push(`text-${key}`);
  for (const key of Object.keys(THEME.fontWeight)) out.push(`font-${key}`);
  for (const key of Object.keys(THEME.fontFamily)) out.push(`font-${key}`);
  for (const key of Object.keys(THEME.tracking)) out.push(`tracking-${key}`);
  for (const key of Object.keys(THEME.leading)) out.push(`leading-${key}`);
  out.push(
    ...Object.keys(TEXT_ALIGN).map((k) => `text-${k}`),
    'italic',
    'not-italic',
    ...Object.keys(TEXT_TRANSFORM),
    ...Object.keys(TEXT_DECORATION),
    'truncate',
  );
  return out;
}

function buildFlexGridCandidates(): string[] {
  const out: string[] = [
    ...Object.keys(DISPLAY_VALUES),
    ...Object.keys(FLEX_DIRECTION),
    ...Object.keys(FLEX_WRAP),
    ...Object.keys(FLEX_SHORTHAND),
    'grow',
    'shrink',
    ...Object.keys(ITEMS),
    ...Object.keys(JUSTIFY),
    ...Object.keys(CONTENT),
    ...Object.keys(SELF),
    ...Object.keys(GRID_FLOW),
    'order-first',
    'order-last',
    'order-none',
  ];
  for (let n = 1; n <= MAX_ORDER; n++) out.push(`order-${n}`);
  for (let n = 1; n <= MAX_GRID_TRACK; n++)
    out.push(`grid-cols-${n}`, `grid-rows-${n}`, `col-span-${n}`, `row-span-${n}`);
  out.push('col-span-full', 'row-span-full', 'col-start-auto', 'col-end-auto', 'row-start-auto', 'row-end-auto');
  for (let n = 1; n <= MAX_GRID_LINE; n++) out.push(`col-start-${n}`, `col-end-${n}`, `row-start-${n}`, `row-end-${n}`);
  for (const step of ['0', 'px', ...SPACING_STEPS.filter((s) => Number(s) <= 16)]) out.push(`basis-${step}`);
  out.push('basis-auto', 'basis-full');
  for (const fraction of FRACTIONS) out.push(`basis-${fraction}`);
  return out;
}

function buildBorderCandidates(): string[] {
  const out: string[] = [];
  for (const style of BORDER_STYLE_KEYWORDS) out.push(`border-${style}`);
  for (const prefix of BORDER_SIDE_PREFIXES) {
    out.push(prefix);
    for (let n = 0; n <= MAX_BORDER_WIDTH; n++) out.push(`${prefix}-${n}`);
  }
  out.push('rounded', 'rounded-full', 'rounded-none');
  for (const size of Object.keys(THEME.radius)) out.push(`rounded-${size}`);
  for (const side of RADIUS_SIDE_KEYS) {
    out.push(`rounded-${side}`, `rounded-${side}-full`, `rounded-${side}-none`);
    for (const size of Object.keys(THEME.radius)) out.push(`rounded-${side}-${size}`);
  }
  return out;
}

export const SUPPORTED_CANDIDATES: string[] = [
  ...buildSpacingCandidates(),
  ...buildColorCandidates(),
  ...buildSizingCandidates(),
  ...buildTypographyCandidates(),
  ...buildFlexGridCandidates(),
  ...buildBorderCandidates(),
];

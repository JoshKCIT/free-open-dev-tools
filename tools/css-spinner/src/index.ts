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
  type KeyframesRule,
  type PreviewTreeNode,
  type RgbaColor,
} from './css-safe';

export { meta };
export type { PreviewTreeNode };

export class CssSpinnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CssSpinnerError';
  }
}

/** The six kinds of spinner, by id with the label shown on the page. */
export const SPINNER_TYPES: ReadonlyMap<string, string> = new Map([
  ['ring', 'Ring'],
  ['dual-ring', 'Dual ring'],
  ['dots', 'Dots'],
  ['bars', 'Bars'],
  ['pulse', 'Pulse'],
  ['ripple', 'Ripple'],
]);

export interface GenerateSpinnerOptions {
  /** 'ring' (default), 'dual-ring', 'dots', 'bars', 'pulse' or 'ripple'. */
  type?: string;
  /** Size in pixels, clamped to 16 to 256. Default 48. */
  size?: number;
  /** A 3, 4, 6 or 8 digit hex colour. Default #1d4ed8. */
  colour?: string;
  /**
   * Seconds for one turn or one beat, clamped to 0.2 to 5 (a pulse to 0.4 to 5 and a ripple to 0.7 to 5, so neither
   * fades more than three times a second). Default 1.
   */
  speed?: number;
}

export interface GenerateSpinnerResult {
  /** The stylesheet, written by the canonical stylesheet writer: rules, keyframes and the reduced-motion rule. */
  css: string;
  /** The element tree the CSS styles: class names only. */
  tree: PreviewTreeNode;
  /** The tree as HTML, with role status and a label on the first element. */
  markup: string;
  warnings: string[];
}

const DEFAULT_COLOUR = '#1d4ed8';
const MIN_SIZE = 16;
const MAX_SIZE = 256;
const MIN_SPEED = 0.2;
/**
 * The shortest turn of the kinds that fade out and start again, so no kind flashes more than three times a second: a
 * pulse fades once a turn (1 / 0.4 = 2.5 a second) and a ripple twice a turn, two rings half a turn apart (2 / 0.7 =
 * 2.9 a second).
 */
const MIN_SPEED_FADING = new Map<string, number>([
  ['pulse', 0.4],
  ['ripple', 0.7],
]);
const MAX_SPEED = 5;

type Declarations = [string, string][];

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

function colourOf(value: string | undefined): RgbaColor {
  try {
    return parseHexColor(value ?? DEFAULT_COLOUR, 'Colour');
  } catch (err) {
    if (err instanceof CssSafetyError) {
      throw new CssSpinnerError('Colour is not a valid hexadecimal colour: use 3, 4, 6 or 8 digits after a #.');
    }
    throw err;
  }
}

function px(n: number): string {
  return formatLength(n, 'px', { bareZero: true });
}

function secs(n: number): string {
  return formatLength(n, 's');
}

/** The properties every animated class carries; the delay of a numbered child comes separately. */
function animation(name: string, speed: number, timing: string): Declarations {
  return [
    ['animation-name', name],
    ['animation-duration', secs(speed)],
    ['animation-timing-function', timing],
    ['animation-iteration-count', 'infinite'],
  ];
}

/** A numbered child: its classes and the delay that staggers it. */
function numbered(base: string, count: number, gap: number): { nodes: PreviewTreeNode[]; rules: CssRule[] } {
  const nodes: PreviewTreeNode[] = [];
  const rules: CssRule[] = [];
  for (let i = 1; i <= count; i++) {
    nodes.push({ className: `${base} ${base}-${i}` });
    rules.push({ selector: `.${base}-${i}`, declarations: [['animation-delay', secs((i - 1) * gap)]] });
  }
  return { nodes, rules };
}

function frame(selector: string, scale: string, opacity?: string): { selector: string; declarations: Declarations } {
  const declarations: Declarations = [['transform', scale]];
  if (opacity !== undefined) declarations.push(['opacity', opacity]);
  return { selector, declarations };
}

interface Built {
  rules: CssRule[];
  keyframes: KeyframesRule;
  reduced: CssRule[];
  tree: PreviewTreeNode;
}

function build(type: string, size: number, speed: number, colour: RgbaColor): Built {
  const solid = formatHexColor(colour);
  const track = formatHexColor({ ...colour, alpha: colour.alpha * 0.2 });
  const box: Declarations = [
    ['width', px(size)],
    ['height', px(size)],
  ];
  const stop: CssRule = { selector: '.spinner', declarations: [['animation', 'none']] };

  if (type === 'ring' || type === 'dual-ring') {
    const border = px(Math.max(2, Math.round(size / 10)));
    const look: Declarations =
      type === 'ring'
        ? [
            ['border', `${border} solid ${track}`],
            ['border-top-color', solid],
          ]
        : [
            ['border', `${border} solid ${solid}`],
            ['border-left-color', 'transparent'],
            ['border-right-color', 'transparent'],
          ];
    return {
      tree: { className: 'spinner' },
      rules: [
        {
          selector: '.spinner',
          declarations: [
            ['box-sizing', 'border-box'],
            ...box,
            ...look,
            ['border-radius', '50%'],
            ...animation('spin', speed, 'linear'),
          ],
        },
      ],
      keyframes: {
        name: 'spin',
        frames: [frame('from', 'rotate(0deg)'), frame('to', 'rotate(360deg)')],
      },
      reduced: [stop],
    };
  }

  if (type === 'dots') {
    const dot = Math.floor(size / 4);
    const kids = numbered('dot', 3, speed / 6);
    return {
      tree: { className: 'spinner', children: kids.nodes },
      rules: [
        {
          selector: '.spinner',
          declarations: [
            ['display', 'flex'],
            ['align-items', 'center'],
            ['justify-content', 'space-between'],
            ['width', px(size)],
            ['height', px(dot)],
          ],
        },
        {
          selector: '.dot',
          declarations: [
            ['width', px(dot)],
            ['height', px(dot)],
            ['border-radius', '50%'],
            ['background-color', solid],
            ...animation('bounce', speed, 'ease-in-out'),
          ],
        },
        ...kids.rules,
      ],
      keyframes: {
        name: 'bounce',
        frames: [frame('0%', 'scale(0.4)', '0.4'), frame('50%', 'scale(1)', '1'), frame('100%', 'scale(0.4)', '0.4')],
      },
      reduced: [{ selector: '.dot', declarations: [['animation', 'none']] }],
    };
  }

  if (type === 'bars') {
    const bar = Math.floor(size / 7);
    const kids = numbered('bar', 4, speed / 8);
    return {
      tree: { className: 'spinner', children: kids.nodes },
      rules: [
        {
          selector: '.spinner',
          declarations: [['display', 'flex'], ['align-items', 'center'], ['justify-content', 'space-between'], ...box],
        },
        {
          selector: '.bar',
          declarations: [
            ['width', px(bar)],
            ['height', '100%'],
            ['background-color', solid],
            ...animation('stretch', speed, 'ease-in-out'),
          ],
        },
        ...kids.rules,
      ],
      keyframes: {
        name: 'stretch',
        frames: [
          { selector: '0%', declarations: [['transform', 'scaley(0.3)']] },
          { selector: '50%', declarations: [['transform', 'scaley(1)']] },
          { selector: '100%', declarations: [['transform', 'scaley(0.3)']] },
        ],
      },
      reduced: [{ selector: '.bar', declarations: [['animation', 'none']] }],
    };
  }

  if (type === 'pulse') {
    return {
      tree: { className: 'spinner' },
      rules: [
        {
          selector: '.spinner',
          declarations: [
            ...box,
            ['border-radius', '50%'],
            ['background-color', solid],
            ...animation('pulse', speed, 'ease-out'),
          ],
        },
      ],
      keyframes: { name: 'pulse', frames: [frame('from', 'scale(0.2)', '1'), frame('to', 'scale(1)', '0')] },
      reduced: [stop],
    };
  }

  // Ripple: two rings that grow and fade, half a turn apart.
  const border = px(Math.max(2, Math.round(size / 16)));
  const kids = numbered('ring', 2, speed / 2);
  return {
    tree: { className: 'spinner', children: kids.nodes },
    rules: [
      { selector: '.spinner', declarations: [['position', 'relative'], ...box] },
      {
        selector: '.ring',
        declarations: [
          ['position', 'absolute'],
          ['top', '0'],
          ['left', '0'],
          ['box-sizing', 'border-box'],
          ...box,
          ['border', `${border} solid ${solid}`],
          ['border-radius', '50%'],
          ['opacity', '0'],
          ...animation('ripple', speed, 'ease-out'),
        ],
      },
      ...kids.rules,
    ],
    keyframes: { name: 'ripple', frames: [frame('from', 'scale(0.1)', '1'), frame('to', 'scale(1)', '0')] },
    reduced: [
      {
        selector: '.ring',
        declarations: [
          ['animation', 'none'],
          ['opacity', '0.6'],
        ],
      },
    ],
  };
}

function markupOf(node: PreviewTreeNode, depth: number, attributes: string): string {
  const pad = '  '.repeat(depth);
  const open = `<div class="${node.className}"${attributes}>`;
  const children = node.children ?? [];
  if (children.length === 0) return `${pad}${open}</div>`;
  const inner = children.map((child) => markupOf(child, depth + 1, '')).join('\n');
  return `${pad}${open}\n${inner}\n${pad}</div>`;
}

/**
 * Writes the CSS, the element tree and the markup for one pure-CSS spinner, per CSS Animations Level 1
 * (https://www.w3.org/TR/css-animations-1/). The animation is written as separate properties, never the shorthand,
 * so a keyframes name can never be read as a keyword. The reduced-motion rule is the exact media query of Media
 * Queries Level 5 (https://www.w3.org/TR/mediaqueries-5/), written by the canonical stylesheet writer, and it sets
 * animation to none on every animated class. Dots, bars and ripples are child elements with numbered classes,
 * because the writer writes class selectors only.
 */
export function generateSpinner(options: GenerateSpinnerOptions): GenerateSpinnerResult {
  const warnings: string[] = [];
  let type = 'ring';
  if (options.type !== undefined) {
    if (typeof options.type !== 'string' || !SPINNER_TYPES.has(options.type)) {
      throw new CssSpinnerError('Kind is not one of the choices on offer.');
    }
    type = options.type;
  }

  const sizeResult = clampNumber('Size', options.size as number, MIN_SIZE, MAX_SIZE, 48);
  const speedResult = clampNumber(
    'Speed',
    options.speed as number,
    MIN_SPEED_FADING.get(type) ?? MIN_SPEED,
    MAX_SPEED,
    1,
  );
  if (options.size === undefined) sizeResult.warning = null;
  if (options.speed === undefined) speedResult.warning = null;
  if (sizeResult.warning) warnings.push(sizeResult.warning);
  if (speedResult.warning) warnings.push(speedResult.warning);

  const colour = colourOf(options.colour);
  const built = build(type, sizeResult.value, speedResult.value, colour);

  try {
    assertSafeTree(built.tree);
    const css = stylesheetText({ rules: built.rules, keyframes: [built.keyframes], reducedMotion: built.reduced });
    const markup = markupOf(built.tree, 0, ' role="status" aria-label="Loading"');
    return { css, tree: built.tree, markup, warnings };
  } catch (err) {
    if (err instanceof CssSafetyError) throw new CssSpinnerError(err.message);
    throw err;
  }
}

import meta from './meta.json';
import {
  CssSafetyError,
  clampNumber,
  formatLength,
  formatNumber,
  parseHexColor,
  formatHexColor,
  stylesheetText,
  assertSafeTree,
  type PreviewTreeNode,
  type RgbaColor,
  type CssRule,
} from './css-safe';

export { meta };
export type { PreviewTreeNode };

export class AnimationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnimationError';
  }
}

/**
 * CSS Easing Functions Level 1 (https://www.w3.org/TR/css-easing-1/),
 * section 2.1 "Keyword easing functions": the cubic-bezier easing function's
 * own keyword forms, plus "linear" (the identity easing function). Two
 * further easing "modes" -- 'cubic-bezier' and 'steps' -- are selected the
 * same way but carry their own extra fields (`bezier`, `steps`/`stepPosition`)
 * rather than being members of this keyword list.
 */
export const EASING_KEYWORDS: readonly string[] = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'];

/**
 * CSS Easing Functions Level 1, section 2.3 "Step easing functions":
 * "<step-position> = jump-start | jump-end | jump-none | jump-both | start | end".
 * "If <step-position> is omitted, jump-end is assumed."
 */
const STEP_POSITIONS: readonly string[] = ['jump-start', 'jump-end', 'jump-none', 'jump-both', 'start', 'end'];

/**
 * CSS Animations Level 1 (https://www.w3.org/TR/css-animations-1/), section
 * 3.6 "The animation-direction property": "Value: [ normal | reverse |
 * alternate | alternate-reverse ]#" "Initial: normal".
 */
const DIRECTIONS: readonly string[] = ['normal', 'reverse', 'alternate', 'alternate-reverse'];

/**
 * Section 3.9 "The animation-fill-mode property": "Value: [ none | forwards
 * | backwards | both ]#" "Initial: none".
 */
const FILL_MODES: readonly string[] = ['none', 'forwards', 'backwards', 'both'];

/**
 * Section 3.7 "The animation-play-state property": "Value: [ running |
 * paused ]#" "Initial: running".
 */
const PLAY_STATES: readonly string[] = ['running', 'paused'];

/** The four properties a hover transition may animate. */
const TRANSITION_PROPERTIES: readonly string[] = ['transform', 'opacity', 'background-color', 'all'];

/**
 * CSS Animations Level 1, the <keyframes-name> grammar
 * (`<keyframes-name> = <custom-ident> | <string>`) minus the CSS-wide
 * keywords and `none`, and within this project's own class-name-shaped
 * identifier limits (a lower-case letter then lower-case letters, digits or
 * hyphens, at most 40 characters) -- the same identifier shape
 * `css-safe.ts`'s own `stylesheetText` enforces as a final safety net.
 */
const KEYFRAME_NAME_RE = /^[a-z][a-z0-9-]*$/;
const CSS_WIDE_KEYWORDS_LOCAL = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer', 'none']);
const DEFAULT_NAME = 'slide-in';

function validKeyframeName(name: string | undefined, warnings: string[]): string {
  const candidate = (name ?? '').trim();
  if (
    candidate.length > 0 &&
    candidate.length <= 40 &&
    KEYFRAME_NAME_RE.test(candidate) &&
    !CSS_WIDE_KEYWORDS_LOCAL.has(candidate)
  ) {
    return candidate;
  }
  warnings.push(
    `The keyframes name was not a usable identifier (CSS Animations Level 1's own <keyframes-name> grammar excludes the CSS-wide keywords and "none"), so "${DEFAULT_NAME}" was used instead.`,
  );
  return DEFAULT_NAME;
}

export interface AnimationFrame {
  /** Position along the animation, in percent. 0-100. */
  at: number;
  /** Horizontal movement in px. Default 0, clamped -200..200. */
  x?: number;
  /** Vertical movement in px. Default 0, clamped -200..200. */
  y?: number;
  /** Rotation in degrees. Default 0, clamped -720..720. */
  rotate?: number;
  /** Scale factor. Default 1, clamped 0..4. */
  scale?: number;
  /** Opacity in percent. Default 100, clamped 0..100. */
  opacity?: number;
}

export interface BezierControlPoints {
  /** Clamped 0..1, per CSS Easing Functions Level 1: "The x coordinates of P1 and P2 are restricted to the range [0, 1]." */
  x1: number;
  /** Clamped -2..3 (this tool's own practical ceiling; the specification places no bound on the y coordinates). */
  y1: number;
  x2: number;
  y2: number;
}

export interface AnimationTiming {
  /** In ms. Default 600, clamped 0..20000. */
  duration?: number;
  /** A keyword from EASING_KEYWORDS, or 'cubic-bezier' or 'steps'. Default 'ease'. */
  easing?: string;
  bezier?: BezierControlPoints;
  /** Number of steps, 1..100. */
  steps?: number;
  /** One of STEP_POSITIONS. Default 'jump-end' (CSS Easing Functions Level 1's own default when omitted). */
  stepPosition?: string;
  /** In ms. Default 0, clamped -10000..10000. */
  delay?: number;
  /** Default 1, clamped 0..100. Ignored when infinite is true. */
  iterations?: number;
  /** Writes "infinite" instead of the iteration count. */
  infinite?: boolean;
  /** One of DIRECTIONS. Default 'normal'. */
  direction?: string;
  /** One of FILL_MODES. Default 'none'. */
  fillMode?: string;
  /** One of PLAY_STATES. Default 'running'. */
  playState?: string;
}

export interface AnimationTransition {
  /** One of TRANSITION_PROPERTIES. Default 'transform'. */
  property?: string;
  /** Target horizontal movement in px on hover. Default 0, clamped -200..200. */
  x?: number;
  /** Target vertical movement in px on hover. Default 0, clamped -200..200. */
  y?: number;
  /** Target scale on hover. Default 1, clamped 0..4. */
  scale?: number;
  /** Target opacity in percent on hover. Default 100, clamped 0..100. */
  opacity?: number;
  /** Target background colour on hover, as a 3/4/6/8-digit hex colour. */
  color?: string;
}

export interface GenerateAnimationOptions {
  /** 'keyframes' or 'transition'. Default 'keyframes'. */
  mode?: 'keyframes' | 'transition';
  /** The @keyframes name. Default 'slide-in' (also the fallback for an invalid name). */
  name?: string;
  /** Two to four frames, in keyframes mode. */
  frames?: AnimationFrame[];
  timing?: AnimationTiming;
  /** The hover target state, in transition mode. */
  transition?: AnimationTransition;
  /** Adds a reduced-motion rule turning the motion off. Default true. */
  reducedMotion?: boolean;
  /** Preview box width in px. Default 160, clamped 40-240. */
  width?: number;
  /** Preview box height in px. Default 160, clamped 40-240. */
  height?: number;
  /** Preview box background, as a 3/4/6/8-digit hex colour. Default '#2563eb'. */
  background?: string;
}

export interface GenerateAnimationResult {
  /** The @keyframes rule (keyframes mode only), the .box rule (and .box:hover in transition mode), and the reduced-motion media rule. */
  css: string;
  /** The element tree the CSS styles: one box, no children. */
  tree: PreviewTreeNode;
  warnings: string[];
}

const MAX_FRAMES = 4;
const MIN_FRAMES = 2;
const DEFAULT_BACKGROUND = '#2563eb';
const DEFAULT_FRAMES: Required<Pick<AnimationFrame, 'at' | 'x' | 'y' | 'rotate' | 'scale' | 'opacity'>>[] = [
  { at: 0, x: 0, y: 0, rotate: 0, scale: 1, opacity: 100 },
  { at: 100, x: 100, y: 0, rotate: 0, scale: 1, opacity: 0 },
];

function safeColor(text: string | undefined, field: string, fallback: string, warnings: string[]): RgbaColor {
  try {
    return parseHexColor(text ?? fallback, field);
  } catch {
    warnings.push(`${field} was not a valid hex colour, so the default was used instead.`);
    return parseHexColor(fallback);
  }
}

function keyword(list: readonly string[], value: unknown, fallback: string): string {
  return typeof value === 'string' && list.includes(value) ? value : fallback;
}

interface ResolvedTiming {
  durationMs: number;
  easingValue: string;
  delayMs: number;
  iterationsValue: string;
  direction: string;
  fillMode: string;
  playState: string;
}

/**
 * Resolves the shared timing fields into the CSS values every mode needs.
 * `easingValue` is a full CSS value (a keyword, a `cubic-bezier(...)` call or
 * a `steps(...)` call), never a bare mode name.
 */
function resolveTiming(timing: AnimationTiming | undefined, warnings: string[]): ResolvedTiming {
  const t = timing ?? {};
  const duration = clampNumber('Duration', t.duration ?? 600, 0, 20000, 600);
  const delay = clampNumber('Delay', t.delay ?? 0, -10000, 10000, 0);
  const iterations = clampNumber('Iterations', t.iterations ?? 1, 0, 100, 1);
  for (const r of [duration, delay, iterations]) if (r.warning) warnings.push(r.warning);

  const easingMode = typeof t.easing === 'string' ? t.easing : 'ease';
  let easingValue: string;
  if (easingMode === 'cubic-bezier') {
    const b = t.bezier ?? { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 };
    // CSS Easing Functions Level 1, section 2.2: "The x coordinates of P1
    // and P2 are restricted to the range [0, 1]." The y coordinates carry
    // no specification bound; -2..3 is this tool's own practical ceiling.
    const x1 = clampNumber('Bezier x1', b.x1, 0, 1, 0.25);
    const y1 = clampNumber('Bezier y1', b.y1, -2, 3, 0.1);
    const x2 = clampNumber('Bezier x2', b.x2, 0, 1, 0.25);
    const y2 = clampNumber('Bezier y2', b.y2, -2, 3, 1);
    for (const r of [x1, y1, x2, y2]) if (r.warning) warnings.push(r.warning);
    easingValue = `cubic-bezier(${formatNumber(x1.value)}, ${formatNumber(y1.value)}, ${formatNumber(x2.value)}, ${formatNumber(y2.value)})`;
  } else if (easingMode === 'steps') {
    const count = clampNumber('Step count', t.steps ?? 4, 1, 100, 4);
    if (count.warning) warnings.push(count.warning);
    const position = STEP_POSITIONS.includes(t.stepPosition ?? '') ? t.stepPosition! : 'jump-end';
    easingValue = `steps(${Math.round(count.value)}, ${position})`;
  } else {
    easingValue = EASING_KEYWORDS.includes(easingMode) ? easingMode : 'ease';
  }

  const direction = keyword(DIRECTIONS, t.direction, 'normal');
  const fillMode = keyword(FILL_MODES, t.fillMode, 'none');
  const playState = keyword(PLAY_STATES, t.playState, 'running');
  const iterationsValue = t.infinite ? 'infinite' : formatNumber(iterations.value);

  return {
    durationMs: duration.value,
    easingValue,
    delayMs: delay.value,
    iterationsValue,
    direction,
    fillMode,
    playState,
  };
}

interface ResolvedFrame {
  at: number;
  x: number;
  y: number;
  rotate: number;
  scale: number;
  opacity: number;
}

function resolveFrames(frames: AnimationFrame[] | undefined, warnings: string[]): ResolvedFrame[] {
  const raw = Array.isArray(frames) && frames.length >= MIN_FRAMES ? frames.slice(0, MAX_FRAMES) : DEFAULT_FRAMES;
  const resolved: ResolvedFrame[] = raw.map((f, i) => {
    const name = `Frame ${i + 1}`;
    // Rounded to a whole percent: css-safe.ts's own keyframe-selector
    // grammar (shared by every CSS generator) is "from | to | a 1-3 digit
    // percentage", which excludes a fractional percentage such as "33.3%".
    const atRaw = clampNumber(`${name} position`, f.at, 0, 100, i === 0 ? 0 : 100);
    const at = { value: Math.round(atRaw.value), warning: atRaw.warning };
    const x = clampNumber(`${name} horizontal movement`, f.x ?? 0, -200, 200, 0);
    const y = clampNumber(`${name} vertical movement`, f.y ?? 0, -200, 200, 0);
    const rotate = clampNumber(`${name} rotation`, f.rotate ?? 0, -720, 720, 0);
    const scale = clampNumber(`${name} scale`, f.scale ?? 1, 0, 4, 1);
    const opacity = clampNumber(`${name} opacity`, f.opacity ?? 100, 0, 100, 100);
    for (const r of [at, x, y, rotate, scale, opacity]) if (r.warning) warnings.push(r.warning);
    return { at: at.value, x: x.value, y: y.value, rotate: rotate.value, scale: scale.value, opacity: opacity.value };
  });
  resolved.sort((a, b) => a.at - b.at);
  // Duplicates refused with a warning: two keyframe selectors at the same
  // percentage would silently overwrite each other in a real browser, so
  // a later duplicate is nudged forward instead of being written twice.
  for (let i = 1; i < resolved.length; i++) {
    if (resolved[i]!.at <= resolved[i - 1]!.at) {
      const bumped = Math.min(100, resolved[i - 1]!.at + 1);
      warnings.push(`Frame ${i + 1}'s position duplicated an earlier frame's, so it was moved to ${bumped}%.`);
      resolved[i]!.at = bumped;
    }
  }
  return resolved;
}

function frameTransform(f: ResolvedFrame): string {
  // CSS Values and Units Level 4 allows a bare "0" only for <length> (px
  // here), never for <angle> (deg) or <time> (ms/s) -- rotate(0) alone is
  // not valid CSS, so the angle keeps its unit even at zero.
  return `translate(${formatLength(f.x, 'px', { bareZero: true })}, ${formatLength(f.y, 'px', { bareZero: true })}) rotate(${formatLength(f.rotate, 'deg')}) scale(${formatNumber(f.scale)})`;
}

/**
 * Generates a `@keyframes` animation or a hover transition (and the whole
 * `.box`/`.box:hover` rules around it), per CSS Animations Level 1
 * (https://www.w3.org/TR/css-animations-1/), CSS Transitions Level 1
 * (https://www.w3.org/TR/css-transitions-1/), CSS Easing Functions Level 1
 * (https://www.w3.org/TR/css-easing-1/) and, for the reduced-motion rule,
 * Media Queries Level 5 (https://www.w3.org/TR/mediaqueries-5/) section 12.1.
 * CSS Color Module Level 4 (https://www.w3.org/TR/css-color-4/) section 5.2
 * governs every hex colour written.
 */
export function generateAnimation(options: GenerateAnimationOptions): GenerateAnimationResult {
  const warnings: string[] = [];
  const mode = options.mode === 'transition' ? 'transition' : 'keyframes';
  const reducedMotion = options.reducedMotion !== false;

  const widthResult = clampNumber('Width', options.width ?? 160, 40, 240, 160);
  const heightResult = clampNumber('Height', options.height ?? 160, 40, 240, 160);
  if (widthResult.warning) warnings.push(widthResult.warning);
  if (heightResult.warning) warnings.push(heightResult.warning);
  const width = widthResult.value;
  const height = heightResult.value;

  const background = safeColor(options.background, 'Background colour', DEFAULT_BACKGROUND, warnings);

  const timing = resolveTiming(options.timing, warnings);

  const rules: CssRule[] = [];
  const boxDeclarations: [string, string][] = [
    ['width', formatLength(width, 'px')],
    ['height', formatLength(height, 'px')],
    ['background-color', formatHexColor(background)],
  ];

  if (mode === 'keyframes') {
    const name = validKeyframeName(options.name, warnings);
    const frames = resolveFrames(options.frames, warnings);

    // "The element rule writes the animation longhands, never the
    // shorthand, because the shorthand can read a name that equals a
    // keyword as the keyword." CSS Animations Level 1, section 3.10: "Note
    // that order is also important within each animation definition for
    // distinguishing <keyframes-name> values from other keywords. When
    // parsing, keywords that are valid for properties other than
    // animation-name whose values were not found earlier in the shorthand
    // must be accepted for those properties rather than for animation-name."
    boxDeclarations.push(
      ['animation-name', name],
      ['animation-duration', formatLength(timing.durationMs, 'ms')],
      ['animation-timing-function', timing.easingValue],
      ['animation-delay', formatLength(timing.delayMs, 'ms')],
      ['animation-iteration-count', timing.iterationsValue],
      ['animation-direction', timing.direction],
      ['animation-fill-mode', timing.fillMode],
      ['animation-play-state', timing.playState],
    );
    rules.push({ selector: '.box', declarations: boxDeclarations });

    const kfFrames = frames.map((f) => ({
      selector: formatLength(f.at, '%'),
      declarations: [
        ['transform', frameTransform(f)],
        ['opacity', formatNumber(f.opacity / 100, 3)],
      ] as [string, string][],
    }));

    const tree: PreviewTreeNode = { className: 'box' };
    try {
      assertSafeTree(tree);
      const css = stylesheetText({
        rules,
        keyframes: [{ name, frames: kfFrames }],
        reducedMotion: reducedMotion
          ? [
              {
                selector: '.box',
                declarations: [
                  ['animation', 'none'],
                  ['transition', 'none'],
                ],
              },
            ]
          : [],
      });
      return { css, tree, warnings };
    } catch (err) {
      if (err instanceof CssSafetyError) throw new AnimationError(err.message);
      throw err;
    }
  }

  // Transition mode.
  const property = keyword(TRANSITION_PROPERTIES, options.transition?.property, 'transform');
  boxDeclarations.push(
    ['transition-property', property],
    ['transition-duration', formatLength(timing.durationMs, 'ms')],
    ['transition-timing-function', timing.easingValue],
    ['transition-delay', formatLength(timing.delayMs, 'ms')],
  );
  rules.push({ selector: '.box', declarations: boxDeclarations });

  const t = options.transition ?? {};
  const hx = clampNumber('Hover horizontal movement', t.x ?? 0, -200, 200, 0);
  const hy = clampNumber('Hover vertical movement', t.y ?? 0, -200, 200, 0);
  const hscale = clampNumber('Hover scale', t.scale ?? 1, 0, 4, 1);
  const hopacity = clampNumber('Hover opacity', t.opacity ?? 100, 0, 100, 100);
  for (const r of [hx, hy, hscale, hopacity]) if (r.warning) warnings.push(r.warning);
  const hoverColor = safeColor(t.color, 'Hover colour', DEFAULT_BACKGROUND, warnings);

  rules.push({
    selector: '.box:hover',
    declarations: [
      [
        'transform',
        `translate(${formatLength(hx.value, 'px', { bareZero: true })}, ${formatLength(hy.value, 'px', { bareZero: true })}) scale(${formatNumber(hscale.value)})`,
      ],
      ['opacity', formatNumber(hopacity.value / 100, 3)],
      ['background-color', formatHexColor(hoverColor)],
    ],
  });

  const tree: PreviewTreeNode = { className: 'box' };
  try {
    assertSafeTree(tree);
    const css = stylesheetText({
      rules,
      reducedMotion: reducedMotion
        ? [
            {
              selector: '.box',
              declarations: [
                ['animation', 'none'],
                ['transition', 'none'],
              ],
            },
          ]
        : [],
    });
    return { css, tree, warnings };
  } catch (err) {
    if (err instanceof CssSafetyError) throw new AnimationError(err.message);
    throw err;
  }
}

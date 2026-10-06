/**
 * Canonical CSS safety writer (D-118). Copied byte for byte into every phase
 * 8 tool that builds CSS text for the live preview, and proven identical to
 * this file by each copy's own SNIPPETS-IDENTICAL check. Never edit a copy
 * on its own: fix this file, then re-copy it everywhere it lives.
 *
 * The rule this file exists to enforce: CSS this project generates from a
 * visitor's field values must never load a resource and must never let text
 * escape the declaration, rule or stylesheet it was written into. This
 * matters because the live preview the CSS is applied to (CssPreview.tsx)
 * runs on the unsandboxed page. The page's own content security policy
 * refuses the request a resource-loading value would fire the moment the
 * stylesheet is adopted, but that policy is only a second layer: this file
 * is what keeps such a value out of the stylesheet in the first place.
 *
 * CSS Syntax Level 3 (https://www.w3.org/TR/css-syntax-3/), section 2.1
 * "Escaping": "CSS escape sequences start with a backslash (\), and
 * continue with: Any Unicode code point that is not a hex digit or a
 * newline. The escape sequence is replaced by that code point. Or one to
 * six hex digits, followed by an optional whitespace." A backslash is
 * refused outright below because an escape sequence could smuggle a
 * character past a plain text scan.
 *
 * The same document's comment grammar (section 4, "comment") is a slash
 * followed by a star, then anything but a star followed by a slash, then a
 * star followed by a slash. A stored value containing a slash-star sequence
 * is refused below for the same reason: it could close a comment early or
 * open one that swallows the rest of the stylesheet, changing what the
 * browser actually parses.
 *
 * CSS Color Module Level 4 (https://www.w3.org/TR/css-color-4/), section
 * 5.2 "The RGB Hexadecimal Notations: #RRGGBB": "The syntax of a
 * <hex-color> is a <hash-token> token whose value consists of 3, 4, 6, or 8
 * hexadecimal digits... the case of the letters doesn't matter." This is
 * the grammar `parseHexColor` below accepts.
 */

export class CssSafetyError extends Error {
  field: string;
  reason: string;
  constructor(field: string, reason: string) {
    super(`${field}: ${reason}`);
    this.name = 'CssSafetyError';
    this.field = field;
    this.reason = reason;
  }
}

/**
 * CSS function names a generator may write, lower case. Every other name
 * directly before a "(" is refused, which is what shuts out every
 * resource-loading function (a resource reference, an image set, a cross
 * fade, an element reference) without needing a denylist that could miss
 * one.
 */
export const ALLOWED_FUNCTIONS: readonly string[] = [
  // Colour functions.
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color',
  // Gradient functions.
  'linear-gradient',
  'radial-gradient',
  'conic-gradient',
  'repeating-linear-gradient',
  'repeating-radial-gradient',
  'repeating-conic-gradient',
  // Maths functions.
  'calc',
  'clamp',
  'min',
  'max',
  // Filter functions.
  'blur',
  'brightness',
  'contrast',
  'drop-shadow',
  'grayscale',
  'hue-rotate',
  'invert',
  'opacity',
  'saturate',
  'sepia',
  // Transform functions.
  'translate',
  'translatex',
  'translatey',
  'rotate',
  'scale',
  'scalex',
  'scaley',
  'skew',
  'skewx',
  'skewy',
  'matrix',
  'perspective',
  // Basic shapes.
  'polygon',
  'circle',
  'ellipse',
  'inset',
  // Easing functions.
  'cubic-bezier',
  'steps',
  // Grid functions.
  'repeat',
  'minmax',
  'fit-content',
];

const ALLOWED_FUNCTION_SET = new Set(ALLOWED_FUNCTIONS);

const PROPERTY_RE = /^-?[a-z]+(?:-[a-z]+)*$/;
const VALUE_CHAR_RE = /^[A-Za-z0-9 #%.,()/+\-_"]*$/;
const FUNCTION_NAME_RE = /([A-Za-z-]+)\(/g;
const QUOTED_STRING_RE = /"([^"]*)"/g;
const QUOTED_STRING_CONTENT_RE = /^[A-Za-z0-9.\-_ ]*$/;
const CLASS_NAME_RE = /^[a-z][a-z0-9-]*$/;
const SELECTOR_RE = /^(?:\.[a-z][a-z0-9-]*)+(?::hover)?$/;
const KEYFRAME_NAME_RE = /^[a-z][a-z0-9-]*$/;
const CSS_WIDE_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer', 'none']);
const KEYFRAME_SELECTOR_RE = /^(from|to|(\d{1,3})%)$/;

function parenthesesBalance(value: string): boolean {
  let depth = 0;
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/**
 * Throws unless `property` is an optional leading hyphen then lower-case
 * words joined by single hyphens, `value` is non-empty, at most 2,000
 * characters, made only of ASCII letters, digits, space, #, %, ., comma,
 * parentheses, /, +, -, underscore and double quotes, with balanced
 * parentheses, every function name in `ALLOWED_FUNCTIONS`, and every
 * double-quoted string holding only letters, digits, ., -, underscore and
 * spaces.
 */
export function assertSafeValue(property: string, value: string): void {
  if (!PROPERTY_RE.test(property)) {
    throw new CssSafetyError(property, 'property name is not a valid lower-case CSS identifier');
  }
  if (value.length === 0) throw new CssSafetyError(property, 'value is empty');
  if (value.length > 2000) throw new CssSafetyError(property, 'value is longer than 2,000 characters');
  if (!VALUE_CHAR_RE.test(value)) {
    throw new CssSafetyError(property, 'value contains a character outside the allowed set');
  }
  if (!parenthesesBalance(value)) {
    throw new CssSafetyError(property, 'value has unbalanced parentheses');
  }
  FUNCTION_NAME_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FUNCTION_NAME_RE.exec(value))) {
    const name = match[1]!.toLowerCase();
    if (!ALLOWED_FUNCTION_SET.has(name)) {
      throw new CssSafetyError(property, `function "${name}" is not on the allowed list`);
    }
  }
  QUOTED_STRING_RE.lastIndex = 0;
  while ((match = QUOTED_STRING_RE.exec(value))) {
    if (!QUOTED_STRING_CONTENT_RE.test(match[1]!)) {
      throw new CssSafetyError(property, 'a quoted string holds a character outside the allowed set');
    }
  }
}

/**
 * Throws unless `selector` is one or more class selectors, optionally
 * ending in `:hover`. Keyframe selectors (`from`, `to`, a percentage) are
 * checked separately by `stylesheetText`.
 */
export function assertSafeSelector(selector: string): void {
  if (!SELECTOR_RE.test(selector)) {
    throw new CssSafetyError('selector', `"${selector}" is not a class-only selector`);
  }
}

export interface PreviewTreeNode {
  /** One or more space-separated class names. */
  className: string;
  text?: string;
  children?: PreviewTreeNode[];
}

function countNodes(node: PreviewTreeNode): number {
  let count = 1;
  for (const child of node.children ?? []) count += countNodes(child);
  return count;
}

function checkTreeNode(node: PreviewTreeNode, depth: number, seen: { count: number }): void {
  seen.count++;
  if (seen.count > 32) throw new CssSafetyError('tree', 'more than 32 nodes');
  const names = node.className.split(' ');
  if (names.length === 0 || names.some((n) => n.length === 0)) {
    throw new CssSafetyError('tree', 'className has an empty class name');
  }
  for (const name of names) {
    if (!CLASS_NAME_RE.test(name)) {
      throw new CssSafetyError('tree', `class name "${name}" is not a valid class name`);
    }
  }
  if (node.text !== undefined && node.text.length > 200) {
    throw new CssSafetyError('tree', 'text is longer than 200 characters');
  }
  if (node.children && node.children.length > 0) {
    if (depth >= 2) throw new CssSafetyError('tree', 'more than two levels of children');
    for (const child of node.children) checkTreeNode(child, depth + 1, seen);
  }
}

/**
 * Throws unless every node's `className` is one or more class names
 * separated by single spaces, every node's own text is at most 200
 * characters, the tree is at most two levels of children deep, and the
 * tree has at most 32 nodes in total.
 */
export function assertSafeTree(node: PreviewTreeNode): void {
  checkTreeNode(node, 0, { count: 0 });
  void countNodes; // retained for callers that want a node count directly
}

/**
 * Rounds half away from zero to `maxDecimals`, trims trailing zeros and the
 * decimal point, and never writes an exponent or a negative zero. Throws on
 * a non-finite number.
 */
export function formatNumber(n: number, maxDecimals = 3): string {
  if (!Number.isFinite(n)) throw new CssSafetyError('number', 'value is not finite');
  const factor = 10 ** maxDecimals;
  const negative = n < 0;
  // Rounds half away from zero by working in scaled integer space, then
  // builds the decimal string manually from a BigInt -- never through
  // Number.prototype.toFixed/toString, both of which switch to exponential
  // notation once the magnitude reaches 1e21 (ECMA-262 21.1.3.3, 6.1.6.1.20).
  const scaledAbs = Math.floor(Math.abs(n) * factor + 0.5);
  let digits = BigInt(scaledAbs).toString();
  if (digits.length <= maxDecimals) digits = digits.padStart(maxDecimals + 1, '0');
  const splitAt = digits.length - maxDecimals;
  const intPart = maxDecimals > 0 ? digits.slice(0, splitAt) : digits;
  const fracPart = maxDecimals > 0 ? digits.slice(splitAt).replace(/0+$/, '') : '';
  let text = fracPart.length > 0 ? `${intPart}.${fracPart}` : intPart;
  if (/^0+$/.test(text)) text = '0';
  else if (negative) text = `-${text}`;
  return text;
}

export type LengthUnit = 'px' | '%' | 'em' | 'rem' | 'vw' | 'vh' | 'deg' | 'turn' | 's' | 'ms' | 'fr';

const LENGTH_UNITS: readonly LengthUnit[] = ['px', '%', 'em', 'rem', 'vw', 'vh', 'deg', 'turn', 's', 'ms', 'fr'];

/**
 * Appends `unit` (from a closed list) to `formatNumber(n)`. When
 * `bareZero` is true and the formatted number is exactly "0", the unit is
 * omitted -- CSS itself allows a bare zero length in most contexts, and
 * some callers want that shorter form.
 */
export function formatLength(n: number, unit: LengthUnit, opts?: { bareZero?: boolean }): string {
  if (!LENGTH_UNITS.includes(unit)) throw new CssSafetyError('unit', `"${unit}" is not on the allowed list`);
  const num = formatNumber(n);
  if (opts?.bareZero && num === '0') return '0';
  return `${num}${unit}`;
}

export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Accepts a `#` followed by 3, 4, 6 or 8 hex digits, case-insensitively, as
 * CSS Color Module Level 4 section 5.2 defines. Returns 0-255 channels and
 * alpha 0-1. Throws `CssSafetyError` otherwise; the message names the
 * field, never the text, so an error can never echo a hostile value back.
 */
export function parseHexColor(text: string, field = 'color'): RgbaColor {
  const trimmed = text.trim();
  const match = HEX_COLOR_RE.exec(trimmed);
  if (!match) throw new CssSafetyError(field, 'is not a valid 3, 4, 6 or 8 digit hex colour');
  const digits = match[1]!;
  const hex2 = (h: string): number => parseInt(h.length === 1 ? h + h : h, 16);
  if (digits.length === 3 || digits.length === 4) {
    const r = hex2(digits[0]!);
    const g = hex2(digits[1]!);
    const b = hex2(digits[2]!);
    const alpha = digits.length === 4 ? hex2(digits[3]!) / 255 : 1;
    return { r, g, b, alpha };
  }
  const r = hex2(digits.slice(0, 2));
  const g = hex2(digits.slice(2, 4));
  const b = hex2(digits.slice(4, 6));
  const alpha = digits.length === 8 ? hex2(digits.slice(6, 8)) / 255 : 1;
  return { r, g, b, alpha };
}

function hex2Digits(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0');
}

/** Writes a lower-case `#rrggbb`, or `#rrggbbaa` when alpha is below 1. */
export function formatHexColor(color: RgbaColor): string {
  const base = `#${hex2Digits(color.r)}${hex2Digits(color.g)}${hex2Digits(color.b)}`;
  if (color.alpha >= 1) return base;
  return `${base}${hex2Digits(color.alpha * 255)}`;
}

export interface ClampResult {
  value: number;
  warning: string | null;
}

/**
 * A non-finite or non-number value becomes `fallback`; an out-of-range
 * value becomes the nearest bound. Either way `warning` names the field and
 * the value that was used instead.
 */
export function clampNumber(field: string, value: number, min: number, max: number, fallback: number): ClampResult {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { value: fallback, warning: `${field} was not a usable number, so ${fallback} was used instead.` };
  }
  if (value < min) return { value: min, warning: `${field} was below its minimum of ${min}, so ${min} was used.` };
  if (value > max) return { value: max, warning: `${field} was above its maximum of ${max}, so ${max} was used.` };
  return { value, warning: null };
}

export interface CssRule {
  selector: string;
  declarations: [string, string][];
}

export interface KeyframeFrame {
  selector: string;
  declarations: [string, string][];
}

export interface KeyframesRule {
  name: string;
  frames: KeyframeFrame[];
}

export interface StyleSheet {
  rules: CssRule[];
  keyframes?: KeyframesRule[];
  reducedMotion?: CssRule[];
}

function writeDeclarations(declarations: [string, string][]): string {
  return declarations
    .map(([property, value]) => {
      assertSafeValue(property, value);
      return `  ${property}: ${value};`;
    })
    .join('\n');
}

function writeRule(rule: CssRule): string {
  assertSafeSelector(rule.selector);
  return `${rule.selector} {\n${writeDeclarations(rule.declarations)}\n}`;
}

function writeKeyframes(kf: KeyframesRule): string {
  if (!KEYFRAME_NAME_RE.test(kf.name) || kf.name.length > 40 || CSS_WIDE_KEYWORDS.has(kf.name)) {
    throw new CssSafetyError('keyframes', `"${kf.name}" is not a valid keyframes name`);
  }
  const frames = kf.frames
    .map((frame) => {
      if (!KEYFRAME_SELECTOR_RE.test(frame.selector)) {
        throw new CssSafetyError('keyframes', `"${frame.selector}" is not "from", "to" or a percentage`);
      }
      const pctMatch = /^(\d{1,3})%$/.exec(frame.selector);
      if (pctMatch && Number(pctMatch[1]) > 100) {
        throw new CssSafetyError('keyframes', `"${frame.selector}" is above 100%`);
      }
      return `  ${frame.selector} {\n${writeDeclarations(frame.declarations)
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n')}\n  }`;
    })
    .join('\n');
  return `@keyframes ${kf.name} {\n${frames}\n}`;
}

/**
 * Writes every rule, checks every selector, property and value on the way,
 * then rescans the finished text with `findUnsafeCss` and throws if it
 * returns a reason -- so a bug in this writer itself cannot ship CSS that
 * looks safe piece by piece but is not safe as a whole.
 */
export function stylesheetText(sheet: StyleSheet): string {
  const parts: string[] = [];
  for (const rule of sheet.rules) parts.push(writeRule(rule));
  for (const kf of sheet.keyframes ?? []) parts.push(writeKeyframes(kf));
  const reducedMotion = sheet.reducedMotion ?? [];
  if (reducedMotion.length > 0) {
    const inner = reducedMotion.map((r) => writeRule(r)).join('\n\n');
    parts.push(`@media (prefers-reduced-motion: reduce) {\n${inner}\n}`);
  }
  const text = parts.join('\n\n');
  const reason = findUnsafeCss(text);
  if (reason) throw new CssSafetyError('stylesheet', reason);
  return text;
}

const REDUCED_MOTION_PRELUDE = '@media (prefers-reduced-motion: reduce) {';

/**
 * A whole-text scanner used both by the writer above (as a final check) and
 * as the test oracle every hostile-value test compares against. Returns a
 * reason string for a backslash, a slash-star sequence, a less-than sign,
 * an exclamation mark, a single quote or backtick, any at-rule other than
 * `@keyframes` or the exact reduced-motion media prelude, or any name
 * directly before "(" that is not in `ALLOWED_FUNCTIONS`. Otherwise null.
 */
export function findUnsafeCss(text: string): string | null {
  if (text.includes('\\')) return 'contains a backslash';
  if (text.includes('/*')) return 'contains a comment opener';
  if (text.includes('<')) return 'contains a less-than sign';
  if (text.includes('!')) return 'contains an exclamation mark';
  if (text.includes("'") || text.includes('`')) return 'contains a single quote or backtick';

  const atRuleRe = /@([a-zA-Z-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = atRuleRe.exec(text))) {
    const name = m[1]!.toLowerCase();
    if (name === 'keyframes') continue;
    if (name === 'media') {
      const start = m.index;
      if (text.slice(start, start + REDUCED_MOTION_PRELUDE.length) === REDUCED_MOTION_PRELUDE) continue;
      return 'contains an @media rule other than the reduced-motion prelude';
    }
    return `contains an at-rule other than @keyframes or the reduced-motion prelude (@${name})`;
  }

  const fnRe = /([A-Za-z-]+)\(/g;
  while ((m = fnRe.exec(text))) {
    const name = m[1]!.toLowerCase();
    if (!ALLOWED_FUNCTION_SET.has(name)) return `contains a function not on the allowed list (${name})`;
  }

  return null;
}

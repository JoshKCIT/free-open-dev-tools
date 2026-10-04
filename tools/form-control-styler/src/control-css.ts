import { CssSafetyError, assertSafeValue, findUnsafeCss } from './css-safe';

/**
 * A small CSS writer for form controls, with closed lists for everything it writes.
 *
 * The canonical stylesheet writer in css-safe.ts refuses :focus-visible, :checked and pseudo-elements by design, and a
 * styled control needs all three (CSS Selectors Level 4, https://www.w3.org/TR/selectors-4/; the HTML Living Standard's
 * form controls, https://html.spec.whatwg.org/multipage/input.html). This writer therefore accepts only the class names
 * listed below, each followed by at most one pseudo-class and one pseudo-element from closed lists, only properties on a
 * closed list, and values that pass the canonical value check (no address function, no backslash, no quote other than a
 * double quote, no character outside a small set). Every finished text is scanned again by findUnsafeControlCss.
 */

/** The class names a rule may start with. The surface is the box the controls sit on. */
export const ALLOWED_SELECTORS: readonly string[] = [
  '.fc-surface',
  '.fc-button',
  '.fc-switch',
  '.fc-check',
  '.fc-radio',
  '.fc-range',
];

/** The pseudo-classes a rule may carry, in the order their rules are written. */
export const ALLOWED_PSEUDO_CLASSES: readonly string[] = [
  ':hover',
  ':focus-visible',
  ':active',
  ':checked',
  ':disabled',
];

/** The pseudo-elements a rule may end with, in the order their rules are written. */
export const ALLOWED_PSEUDO_ELEMENTS: readonly string[] = [
  '::before',
  '::-webkit-slider-runnable-track',
  '::-moz-range-track',
  '::-webkit-slider-thumb',
  '::-moz-range-thumb',
];

/** The properties a control rule may set. */
export const ALLOWED_PROPERTIES: readonly string[] = [
  'accent-color',
  'appearance',
  'background-color',
  'border',
  'border-color',
  'border-radius',
  'border-style',
  'border-width',
  'box-shadow',
  'color',
  'content',
  'cursor',
  'font-family',
  'font-size',
  'font-weight',
  'height',
  'left',
  'line-height',
  'margin',
  'margin-top',
  'opacity',
  'outline',
  'outline-offset',
  'padding',
  'position',
  'top',
  'transform',
  'transition',
  'vertical-align',
  'width',
];

const PROPERTY_SET: ReadonlySet<string> = new Set(ALLOWED_PROPERTIES);
const REDUCED_MOTION_PRELUDE = '@media (prefers-reduced-motion: reduce) {';
const REDUCED_MOTION_HEAD = '@media (prefers-reduced-motion: reduce)';

export interface ControlRule {
  selector: string;
  declarations: [string, string][];
}

export interface ControlSheet {
  rules: ControlRule[];
  /** Rules written inside the reduced-motion block, after every other rule. */
  reducedMotion?: ControlRule[];
}

interface ParsedSelector {
  base: string;
  state: number;
  element: number;
}

/** Splits a selector into its class, pseudo-class and pseudo-element, or returns null for anything else. */
function parseSelector(selector: string): ParsedSelector | null {
  let base = '';
  for (const name of ALLOWED_SELECTORS) {
    if (selector.startsWith(name) && (selector.length === name.length || selector.charAt(name.length) === ':')) {
      base = name;
      break;
    }
  }
  if (base === '') return null;
  let rest = selector.slice(base.length);
  let state = 0;
  if (rest.startsWith(':') && !rest.startsWith('::')) {
    const found = ALLOWED_PSEUDO_CLASSES.findIndex(
      (name) => rest.startsWith(name) && (rest.length === name.length || rest.charAt(name.length) === ':'),
    );
    if (found < 0) return null;
    state = found + 1;
    rest = rest.slice(ALLOWED_PSEUDO_CLASSES[found]!.length);
  }
  let element = 0;
  if (rest !== '') {
    const found = ALLOWED_PSEUDO_ELEMENTS.indexOf(rest);
    if (found < 0) return null;
    element = found + 1;
  }
  return { base, state, element };
}

/** One declaration: a property on the list and a value that passes the canonical check. Returns a reason or null. */
function declarationProblem(property: string, value: string): string | null {
  if (!PROPERTY_SET.has(property)) return `the property ${property} is not on the allowed list`;
  if (property === 'content' && value !== '""') return 'content may only be an empty string';
  try {
    assertSafeValue(property, value);
  } catch (err) {
    if (err instanceof CssSafetyError) return err.message;
    throw err;
  }
  return null;
}

/** The index of a rule's place in the fixed order: state, then pseudo-element, then the selector itself. */
function compareRules(a: ControlRule, b: ControlRule): number {
  const pa = parseSelector(a.selector)!;
  const pb = parseSelector(b.selector)!;
  if (pa.state !== pb.state) return pa.state - pb.state;
  if (pa.element !== pb.element) return pa.element - pb.element;
  if (a.selector === b.selector) return 0;
  return a.selector < b.selector ? -1 : 1;
}

function writeRule(rule: ControlRule): string {
  if (parseSelector(rule.selector) === null) {
    throw new CssSafetyError('selector', `"${rule.selector}" is not a selector this writer may write`);
  }
  if (rule.declarations.length === 0) throw new CssSafetyError('selector', 'a rule has no declarations');
  const lines = rule.declarations.map(([property, value]) => {
    const problem = declarationProblem(property, value);
    if (problem !== null) throw new CssSafetyError(property, problem);
    return `  ${property}: ${value};`;
  });
  return `${rule.selector} {\n${lines.join('\n')}\n}`;
}

function sorted(rules: readonly ControlRule[]): ControlRule[] {
  for (const rule of rules) {
    if (parseSelector(rule.selector) === null) {
      throw new CssSafetyError('selector', `"${rule.selector}" is not a selector this writer may write`);
    }
  }
  return rules
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) => compareRules(a.rule, b.rule) || a.index - b.index)
    .map((entry) => entry.rule);
}

/**
 * Writes the rules in a fixed order whatever order they were given in: rules with no state first (the class itself, then
 * its pseudo-elements), then hover, focus-visible, active, checked and disabled, then one reduced-motion block. Every
 * selector, property and value is checked on the way, and the finished text is scanned again.
 */
export function controlCss(sheet: ControlSheet): string {
  const parts = sorted(sheet.rules).map(writeRule);
  const reduced = sorted(sheet.reducedMotion ?? []);
  if (reduced.length > 0) {
    parts.push(`${REDUCED_MOTION_PRELUDE}\n${reduced.map(writeRule).join('\n\n')}\n}`);
  }
  const text = parts.join('\n\n');
  const reason = findUnsafeControlCss(text);
  if (reason !== null) throw new CssSafetyError('stylesheet', reason);
  return text;
}

/** The declarations of one rule body, split at semicolons. Returns a reason or null. */
function bodyProblem(body: string): string | null {
  for (const part of body.split(';')) {
    const text = part.trim();
    if (text === '') continue;
    const colon = text.indexOf(':');
    if (colon <= 0) return 'a declaration has no property and value';
    const problem = declarationProblem(text.slice(0, colon).trim(), text.slice(colon + 1).trim());
    if (problem !== null) return problem;
  }
  return null;
}

/**
 * A whole-text scanner for control CSS. Returns a reason for anything this writer would not write: the canonical scan's
 * findings (a backslash, a comment opener, a less-than sign, an exclamation mark, a single quote, an at-rule other than
 * the exact reduced-motion prelude, a function not on the canonical allowed list), a resource function, an import, a
 * script expression, a selector that is not one of the allowed classes with an allowed pseudo-class and pseudo-element, a
 * property not on the list, a value outside the canonical character set, and text that is not a rule. Otherwise null.
 */
export function findUnsafeControlCss(text: string): string | null {
  const canonical = findUnsafeCss(text);
  if (canonical !== null) return canonical;
  const compact = text.toLowerCase().replace(/\s+/g, '');
  for (const token of ['url(', '@import', 'expression(', 'image-set(', 'behavior:', '-moz-binding:']) {
    if (compact.includes(token)) return `contains ${token}`;
  }

  const kinds: ('media' | 'rule')[] = [];
  let buffer = '';
  for (const ch of text) {
    if (ch === '{') {
      const head = buffer.trim();
      const parent = kinds[kinds.length - 1];
      if (parent === 'rule') return 'a rule is nested inside a rule';
      if (head === REDUCED_MOTION_HEAD) {
        if (parent !== undefined) return 'the reduced-motion block is not at the top';
        kinds.push('media');
      } else {
        if (parseSelector(head) === null) return 'contains a selector that is not an allowed one';
        kinds.push('rule');
      }
      buffer = '';
    } else if (ch === '}') {
      const kind = kinds.pop();
      if (kind === undefined) return 'has a closing brace with nothing open';
      if (kind === 'rule') {
        const problem = bodyProblem(buffer);
        if (problem !== null) return problem;
      } else if (buffer.trim() !== '') {
        return 'the reduced-motion block holds text that is not a rule';
      }
      buffer = '';
    } else {
      buffer += ch;
    }
  }
  if (kinds.length > 0) return 'has a rule that is not closed';
  if (buffer.trim() !== '') return 'has text that is not a rule';
  return null;
}

/**
 * Selectors Level 4 specificity, with the parts that contribute to it and
 * an ordering from strongest to weakest.
 *
 * Pure text in, pure data out: no DOM, no network, no storage, no timer.
 * Parsing is `tokenizer.ts`'s job; this file only walks the parsed tree and
 * sums A (ids), B (classes, attributes, pseudo-classes) and C (types,
 * pseudo-elements), exactly as Selectors Level 4's own "Calculating a
 * selector's specificity" section defines:
 *
 *   "count the number of ID selectors in the selector (= A)
 *    count the number of class selectors, attributes selectors, and
 *    pseudo-classes in the selector (= B)
 *    count the number of type selectors and pseudo-elements in the
 *    selector (= C)
 *    ignore the universal selector"
 *   -- https://www.w3.org/TR/selectors-4/#specificity-rules
 *
 * `:is()`, `:not()` and `:has()` are replaced by the specificity of their
 * most specific argument; `:where()` is replaced by zero; `:nth-child()`
 * and `:nth-last-child()` count as one pseudo-class plus the most specific
 * selector in their own `of` clause, if any -- all quoted verbatim from the
 * same section in `test/index.test.ts`.
 */
import { parseSelectorList, SelectorSyntaxError, type ParsedSelector, type SimpleSelectorPart } from './tokenizer';
import meta from './meta.json';

export { meta };
export { parseSelectorList, SelectorSyntaxError };
export type { ParsedSelector };

/** The whole selector-list textarea is refused above this many characters, before any parsing, to avoid pathological input freezing the tab. */
export const MAX_INPUT_LENGTH = 100_000;

export class CssSpecificityError extends Error {
  readonly line: number;
  readonly column: number;
  constructor(message: string, line: number, column: number) {
    super(message);
    this.name = 'CssSpecificityError';
    this.line = line;
    this.column = column;
  }
}

/** [A, B, C] as Selectors Level 4 defines them: ids, then classes/attributes/pseudo-classes, then types/pseudo-elements. */
export type Specificity = [number, number, number];

export interface SpecificityPart {
  /** The exact source text of the contributing part, e.g. "#foo", ".bar", "::before", ":not(FOO)". */
  text: string;
  /** A short, human-readable label: "id selector", "class selector", "pseudo-class", and so on. */
  kind: string;
  /** What this part alone adds to the running [A, B, C] total. */
  adds: Specificity;
}

export interface SpecificitySelectorResult {
  text: string;
  specificity: Specificity;
  parts: SpecificityPart[];
}

export interface SpecificityReport {
  /** Every selector across every non-blank line, ordered strongest first (see `compareSpecificity`). */
  selectors: SpecificitySelectorResult[];
  warnings: string[];
}

const KIND_LABELS: Record<SimpleSelectorPart['kind'], string> = {
  type: 'type selector',
  universal: 'universal selector',
  id: 'id selector',
  class: 'class selector',
  attribute: 'attribute selector',
  'pseudo-class': 'pseudo-class',
  'pseudo-element': 'pseudo-element',
};

function zero(): Specificity {
  return [0, 0, 0];
}

function addInto(target: Specificity, delta: Specificity): void {
  target[0] += delta[0];
  target[1] += delta[1];
  target[2] += delta[2];
}

/**
 * Compares two specificities as Selectors Level 4 defines: "the
 * specificity with a larger A value is more specific; if the two A values
 * are tied, then ... B ... then ... C". Positive means `x` is more
 * specific than `y`, negative the reverse, zero means equal.
 */
export function compareSpecificity(x: Specificity, y: Specificity): number {
  if (x[0] !== y[0]) return x[0] - y[0];
  if (x[1] !== y[1]) return x[1] - y[1];
  return x[2] - y[2];
}

function mostSpecific(list: ParsedSelector[] | undefined): Specificity {
  if (!list || list.length === 0) return zero();
  let best = zero();
  for (const sel of list) {
    const spec = specificityOfSelector(sel);
    if (compareSpecificity(spec, best) > 0) best = spec;
  }
  return best;
}

/** What one simple-selector part alone adds to [A, B, C]. Does not include a `:not()`/`:is()`/`:has()`/`:where()`/nth-child part's own pseudo-class count when it is itself replaced (`:where()`) -- see the per-kind handling below. */
function addsOfPart(part: SimpleSelectorPart): Specificity {
  switch (part.kind) {
    case 'universal':
      return zero();
    case 'type':
      return [0, 0, 1];
    case 'id':
      return [1, 0, 0];
    case 'class':
    case 'attribute':
      return [0, 1, 0];
    case 'pseudo-element':
      return [0, 0, 1];
    case 'pseudo-class': {
      if (part.selectorListPseudo === 'where') return zero();
      if (part.selectorListPseudo === 'is' || part.selectorListPseudo === 'not' || part.selectorListPseudo === 'has') {
        return mostSpecific(part.argument);
      }
      if (part.nthPseudo === 'nth-child' || part.nthPseudo === 'nth-last-child') {
        const own: Specificity = [0, 1, 0];
        const fromOf = mostSpecific(part.argument);
        return [own[0] + fromOf[0], own[1] + fromOf[1], own[2] + fromOf[2]];
      }
      return [0, 1, 0];
    }
    default:
      return zero();
  }
}

function partsOfCompound(parts: SimpleSelectorPart[]): SpecificityPart[] {
  return parts.map((part) => ({ text: part.text, kind: KIND_LABELS[part.kind], adds: addsOfPart(part) }));
}

export function specificityOfSelector(selector: ParsedSelector): Specificity {
  const total = zero();
  for (const segment of selector.segments) {
    for (const part of segment.compound.parts) addInto(total, addsOfPart(part));
  }
  return total;
}

function partsOfSelector(selector: ParsedSelector): SpecificityPart[] {
  const parts: SpecificityPart[] = [];
  for (const segment of selector.segments) parts.push(...partsOfCompound(segment.compound.parts));
  return parts;
}

/**
 * Computes the Selectors Level 4 specificity of every selector across every
 * non-blank line of `text` (one selector list per line; a line's own
 * selectors are comma-separated), ordered strongest first. Throws
 * `CssSpecificityError` -- carrying the offending line and column -- on the
 * first selector it cannot parse, and on input over `MAX_INPUT_LENGTH`.
 */
export function computeSpecificity(text: string): SpecificityReport {
  if (text.length > MAX_INPUT_LENGTH) {
    throw new CssSpecificityError(
      `This is over ${MAX_INPUT_LENGTH.toLocaleString('en-US')} characters; refused rather than risk freezing the tab.`,
      1,
      1,
    );
  }

  const lines = text.split('\n');
  const parsedSelectors: ParsedSelector[] = [];

  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li] ?? '';
    if (raw.trim() === '') continue;
    try {
      parsedSelectors.push(...parseSelectorList(raw, { line: li + 1 }));
    } catch (err) {
      if (err instanceof SelectorSyntaxError) {
        throw new CssSpecificityError(err.message, err.line, err.column);
      }
      throw err;
    }
  }

  const selectors: SpecificitySelectorResult[] = parsedSelectors.map((sel) => ({
    text: sel.text,
    specificity: specificityOfSelector(sel),
    parts: partsOfSelector(sel),
  }));

  selectors.sort((a, b) => compareSpecificity(b.specificity, a.specificity));

  return { selectors, warnings: [] };
}

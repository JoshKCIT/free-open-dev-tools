import { it, expect, vi } from 'vitest';
import * as csstree from 'css-tree';
import { computeSpecificity, compareSpecificity, CssSpecificityError, MAX_INPUT_LENGTH } from '../src/index';
import { MAX_NESTING_DEPTH } from '../src/tokenizer';

/**
 * Every specificity rule asserted below is quoted from Selectors Level 4's
 * own "Calculating a selector's specificity" section, fetched this session:
 *
 *   https://www.w3.org/TR/selectors-4/#specificity-rules
 *
 *   "count the number of ID selectors in the selector (= A)
 *    count the number of class selectors, attributes selectors, and
 *    pseudo-classes in the selector (= B)
 *    count the number of type selectors and pseudo-elements in the
 *    selector (= C)
 *    ignore the universal selector"
 *
 *   "The specificity of an :is(), :not(), or :has() pseudo-class is
 *    replaced by the specificity of the most specific complex selector in
 *    its selector list argument. Analogously, the specificity of an
 *    :nth-child() or :nth-last-child() selector is the specificity of the
 *    pseudo-class itself (counting as one pseudo-class selector) plus the
 *    specificity of the most specific complex selector in its selector
 *    list argument (if any). The specificity of a :where() pseudo-class is
 *    replaced by zero."
 *
 *   Worked examples from the same section:
 *     :is(em, #foo) has a specificity of (1,0,0)
 *     .qux:where(em, #foo#bar#baz) has a specificity of (0,1,0)
 *     :nth-child(even of li, .item) has a specificity of (0,2,0)
 *     :not(em, strong#foo) has a specificity of (1,0,1)
 *
 *   "Specificities are compared by comparing the three components in
 *    order: the specificity with a larger A value is more specific; if the
 *    two A values are tied, then the specificity with a larger B value is
 *    more specific; if the two B values are also tied, then the
 *    specificity with a larger C value is more specific; if all the values
 *    are tied, the two specificities are equal."
 *
 *   The example table:
 *     *                    a=0 b=0 c=0
 *     LI                   a=0 b=0 c=1
 *     UL LI                a=0 b=0 c=2
 *     UL OL+LI             a=0 b=0 c=3
 *     H1 + *[REL=up]       a=0 b=1 c=1
 *     UL OL LI.red         a=0 b=1 c=3
 *     LI.red.level         a=0 b=2 c=1
 *     #x34y                a=1 b=0 c=0
 *     #s12:not(FOO)        a=1 b=0 c=1
 *     .foo :is(.bar, #baz) a=1 b=1 c=0
 *
 * CSS Cascading and Inheritance Level 5's own cascade sort order, used only
 * for this tool's "limits" caveat that specificity is one step among six,
 * quoted from https://www.w3.org/TR/css-cascade-5/#cascade-sort (fetched
 * this session): "Origin and Importance ... Context ... Element-Attached
 * Styles ... Layers ... Specificity ... Order of Appearance."
 */

function firstSpecificity(text: string): [number, number, number] {
  const report = computeSpecificity(text);
  expect(report.selectors.length).toBeGreaterThan(0);
  return report.selectors[0]!.specificity;
}

it('the Selectors Level 4 specificity examples give the specificity the specification states', () => {
  const cases: [string, [number, number, number]][] = [
    ['*', [0, 0, 0]],
    ['LI', [0, 0, 1]],
    ['UL LI', [0, 0, 2]],
    ['UL OL+LI', [0, 0, 3]],
    ['H1 + *[REL=up]', [0, 1, 1]],
    ['UL OL LI.red', [0, 1, 3]],
    ['LI.red.level', [0, 2, 1]],
    ['#x34y', [1, 0, 0]],
    ['#s12:not(FOO)', [1, 0, 1]],
    ['.foo :is(.bar, #baz)', [1, 1, 0]],
  ];
  for (const [selector, expected] of cases) {
    expect(firstSpecificity(selector), selector).toEqual(expected);
  }
});

it('is, not and has take the specificity of their most specific argument and where contributes zero', () => {
  expect(firstSpecificity(':is(em, #foo)')).toEqual([1, 0, 0]);
  expect(firstSpecificity('.qux:where(em, #foo#bar#baz)')).toEqual([0, 1, 0]);
  expect(firstSpecificity(':not(em, strong#foo)')).toEqual([1, 0, 1]);
  expect(firstSpecificity(':where(#a) .b')).toEqual([0, 1, 0]);
  expect(firstSpecificity(':has(> img, #x)')).toEqual([1, 0, 0]);
  // Nested :is() inside :not() keeps replacing, never adding its own count.
  expect(firstSpecificity(':not(:is(#a, .b))')).toEqual([1, 0, 0]);
});

it('nth-child and nth-last-child with an of clause add the most specific selector in the clause to one pseudo-class', () => {
  expect(firstSpecificity(':nth-child(even of li, .item)')).toEqual([0, 2, 0]);
  expect(firstSpecificity('li:nth-child(2n+1 of .important)')).toEqual([0, 2, 1]);
  // No "of" clause: the pseudo-class still counts as one pseudo-class on its own.
  expect(firstSpecificity(':nth-child(2n+1)')).toEqual([0, 1, 0]);
  expect(firstSpecificity(':nth-last-child(odd of .item, #x)')).toEqual([1, 1, 0]);
});

it('legacy single-colon pseudo-elements count as pseudo-elements', () => {
  expect(firstSpecificity('a::before')).toEqual([0, 0, 2]);
  expect(firstSpecificity('a:before')).toEqual([0, 0, 2]);
  expect(firstSpecificity('a::after')).toEqual([0, 0, 2]);
  expect(firstSpecificity('a:first-line')).toEqual([0, 0, 2]);
  expect(firstSpecificity('a:first-letter')).toEqual([0, 0, 2]);
  // A non-legacy single-colon name is a pseudo-class, not a pseudo-element.
  expect(firstSpecificity('a:hover')).toEqual([0, 1, 1]);
});

it('the universal selector, combinators and namespace prefixes contribute nothing', () => {
  expect(firstSpecificity('*')).toEqual([0, 0, 0]);
  expect(firstSpecificity('*.foo')).toEqual([0, 1, 0]);
  expect(firstSpecificity('svg|rect')).toEqual([0, 0, 1]);
  expect(firstSpecificity('svg|*')).toEqual([0, 0, 0]);
  expect(firstSpecificity('|div')).toEqual([0, 0, 1]);
  expect(firstSpecificity('*|*')).toEqual([0, 0, 0]);
  expect(firstSpecificity('div > p')).toEqual([0, 0, 2]);
  expect(firstSpecificity('div + p')).toEqual([0, 0, 2]);
  expect(firstSpecificity('div ~ p')).toEqual([0, 0, 2]);
  expect(firstSpecificity('div || col')).toEqual([0, 0, 2]);
});

/**
 * A second, independently written specificity calculator over css-tree
 * 3.2.1's own selector-list AST (not this package's tokenizer or its
 * code), confirmed directly against the installed AST shape (TypeSelector,
 * IdSelector, ClassSelector, AttributeSelector, PseudoClassSelector,
 * PseudoElementSelector, and the Nth node's own "selector" field for the
 * "of" clause) before this test was written.
 */
function isUniversalTypeName(name: string): boolean {
  return name === '*' || name.endsWith('|*');
}

interface CssTreeChildNode {
  type: string;
  name?: string;
  children?: CssTreeChildNode[] | null;
  nth?: { type: string };
  selector?: CssTreeSelectorList | null;
}
interface CssTreeSelectorNode {
  type: 'Selector';
  children: CssTreeChildNode[];
}
interface CssTreeSelectorList {
  type: 'SelectorList';
  children: CssTreeSelectorNode[];
}

function oracleCompare(x: [number, number, number], y: [number, number, number]): number {
  if (x[0] !== y[0]) return x[0] - y[0];
  if (x[1] !== y[1]) return x[1] - y[1];
  return x[2] - y[2];
}

function oracleMostSpecific(list: CssTreeSelectorList | null | undefined): [number, number, number] {
  if (!list) return [0, 0, 0];
  let best: [number, number, number] = [0, 0, 0];
  for (const sel of list.children) {
    const spec = oracleSpecificityOfSelector(sel);
    if (oracleCompare(spec, best) > 0) best = spec;
  }
  return best;
}

function oracleSpecificityOfSelector(selector: CssTreeSelectorNode): [number, number, number] {
  let a = 0;
  let b = 0;
  let c = 0;
  for (const child of selector.children) {
    switch (child.type) {
      case 'TypeSelector':
        if (!isUniversalTypeName(child.name ?? '')) c++;
        break;
      case 'IdSelector':
        a++;
        break;
      case 'ClassSelector':
      case 'AttributeSelector':
        b++;
        break;
      case 'PseudoElementSelector':
        c++;
        break;
      case 'PseudoClassSelector': {
        const nameLower = (child.name ?? '').toLowerCase();
        if (
          nameLower === 'before' ||
          nameLower === 'after' ||
          nameLower === 'first-line' ||
          nameLower === 'first-letter'
        ) {
          c++;
          break;
        }
        if (nameLower === 'where') break;
        if (nameLower === 'is' || nameLower === 'not' || nameLower === 'has' || nameLower === 'matches') {
          const inner = (child.children?.[0] as unknown as CssTreeSelectorList | undefined) ?? null;
          const [ma, mb, mc] = oracleMostSpecific(inner);
          a += ma;
          b += mb;
          c += mc;
          break;
        }
        if (nameLower === 'nth-child' || nameLower === 'nth-last-child') {
          b++;
          const nth = child.children?.[0];
          const ofList = (nth?.selector as unknown as CssTreeSelectorList | undefined) ?? null;
          const [ma, mb, mc] = oracleMostSpecific(ofList);
          a += ma;
          b += mb;
          c += mc;
          break;
        }
        b++;
        break;
      }
      default:
        break; // Combinator, WhiteSpace, NestingSelector: contribute nothing.
    }
  }
  return [a, b, c];
}

function oracleSpecificity(text: string): [number, number, number] {
  const ast = csstree.toPlainObject(csstree.parse(text, { context: 'selectorList' })) as unknown as CssTreeSelectorList;
  return oracleMostSpecific(ast);
}

/** mulberry32: a small, deterministic seeded PRNG, so the 500 selectors below are the same on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TYPE_NAMES = ['div', 'span', 'a', 'li', 'p', 'section', 'my-custom'];
const CLASS_NAMES = ['foo', 'bar', 'baz', 'active', 'item', 'red'];
const ID_NAMES = ['a1', 'header', 'main', 'x'];
const ATTR_OPS = ['', '=', '~=', '|=', '^=', '$=', '*='];
const SIMPLE_PSEUDO_CLASSES = [':hover', ':focus', ':first-child', ':last-child', ':lang(en)'];
const COMBINATORS = [' ', ' > ', ' + ', ' ~ '];
const NTH_EXPRESSIONS = ['2n+1', '2n', '3n+2', 'odd', 'even', '1'];

function randomSimpleSelector(rand: () => number): string {
  const choice = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]!;
  let out = '';
  if (rand() < 0.7) out += choice(TYPE_NAMES);
  const classCount = Math.floor(rand() * 3);
  for (let i = 0; i < classCount; i++) out += `.${choice(CLASS_NAMES)}`;
  if (rand() < 0.4) out += `#${choice(ID_NAMES)}`;
  if (rand() < 0.3) {
    const op = choice(ATTR_OPS);
    out += op === '' ? `[${choice(['href', 'data-x', 'title'])}]` : `[${choice(['href', 'data-x', 'title'])}${op}val]`;
  }
  if (rand() < 0.5) out += choice(SIMPLE_PSEUDO_CLASSES);
  if (rand() < 0.15) {
    const inner = choice(CLASS_NAMES);
    out += choice([`:not(.${inner})`, `:is(.${inner}, #${choice(ID_NAMES)})`, `:where(.${inner})`]);
  }
  if (rand() < 0.15) {
    const nth = choice(NTH_EXPRESSIONS);
    const withOf = rand() < 0.5 ? ` of .${choice(CLASS_NAMES)}` : '';
    out += `:${choice(['nth-child', 'nth-last-child'])}(${nth}${withOf})`;
  }
  if (rand() < 0.2) out += choice([':before', '::after', '::marker']);
  if (out === '') out = choice(TYPE_NAMES);
  return out;
}

function randomComplexSelector(rand: () => number): string {
  const choice = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]!;
  const parts = [randomSimpleSelector(rand)];
  const extra = Math.floor(rand() * 3);
  for (let i = 0; i < extra; i++) parts.push(choice(COMBINATORS), randomSimpleSelector(rand));
  return parts.join('');
}

it('specificity agrees with an independent calculation over the css-tree selector parser for 500 seeded selectors', () => {
  const rand = mulberry32(20260926);
  let checked = 0;
  for (let i = 0; i < 500; i++) {
    const text = randomComplexSelector(rand);
    let ours: [number, number, number];
    try {
      ours = firstSpecificity(text);
    } catch {
      continue; // A random string this tool refuses is not part of this differential.
    }
    let theirs: [number, number, number];
    try {
      theirs = oracleSpecificity(text);
    } catch {
      continue; // Likewise, skip anything css-tree itself refuses.
    }
    expect(ours, text).toEqual(theirs);
    checked++;
  }
  expect(checked).toBeGreaterThan(400);
});

it('an invalid selector is refused with its line and column', () => {
  expect(() => computeSpecificity('a:is(')).toThrow(CssSpecificityError);
  try {
    computeSpecificity('a:is(');
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(CssSpecificityError);
    const e = err as CssSpecificityError;
    expect(e.line).toBe(1);
    expect(e.column).toBeGreaterThan(0);
  }

  try {
    computeSpecificity('..b');
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(CssSpecificityError);
    const e = err as CssSpecificityError;
    expect(e.line).toBe(1);
    expect(e.column).toBeGreaterThan(0);
  }

  // A later line's own error reports that line's number, not line 1.
  try {
    computeSpecificity('.ok\na:is(');
    expect.unreachable();
  } catch (err) {
    expect((err as CssSpecificityError).line).toBe(2);
  }
});

it('selectors are ordered by comparing A, then B, then C', () => {
  const report = computeSpecificity('#a, .b, c');
  expect(report.selectors.map((s) => s.specificity)).toEqual([
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]);
  expect(report.selectors.map((s) => s.text)).toEqual(['#a', '.b', 'c']);

  // compareSpecificity itself, directly: A beats B beats C, in that order.
  expect(compareSpecificity([1, 0, 0], [0, 100, 100])).toBeGreaterThan(0);
  expect(compareSpecificity([0, 1, 0], [0, 0, 100])).toBeGreaterThan(0);
  expect(compareSpecificity([0, 0, 1], [0, 0, 0])).toBeGreaterThan(0);
  expect(compareSpecificity([1, 2, 3], [1, 2, 3])).toBe(0);
});

it('input over the size limit or nested past 32 levels is refused rather than risk freezing the tab', () => {
  const tooLong = 'a'.repeat(MAX_INPUT_LENGTH + 1);
  const startedAt = Date.now();
  expect(() => computeSpecificity(tooLong)).toThrow(CssSpecificityError);
  expect(Date.now() - startedAt).toBeLessThan(1000);

  // Exactly at the limit is accepted; the limit itself refuses, not "at or over" a smaller bound.
  const atLimit = `${'.a '.repeat(Math.floor(MAX_INPUT_LENGTH / 3) - 1)}b`;
  expect(atLimit.length).toBeLessThanOrEqual(MAX_INPUT_LENGTH);
  expect(() => computeSpecificity(atLimit)).not.toThrow();

  let nested = '.deep';
  for (let i = 0; i < MAX_NESTING_DEPTH + 1; i++) nested = `:is(${nested})`;
  const nestingStartedAt = Date.now();
  expect(() => computeSpecificity(nested)).toThrow(CssSpecificityError);
  expect(Date.now() - nestingStartedAt).toBeLessThan(1000);

  let atNestingLimit = '.deep';
  for (let i = 0; i < MAX_NESTING_DEPTH; i++) atNestingLimit = `:is(${atNestingLimit})`;
  expect(() => computeSpecificity(atNestingLimit)).not.toThrow();
});

it('nothing is written to the console while scoring', () => {
  const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );
  try {
    computeSpecificity('#a, .b:not(.c):is(.d, #e), div > p::before, li:nth-child(2n+1 of .item)');
    try {
      computeSpecificity('a:is(');
    } catch {
      // Expected: the point is that even a refusal never touches the console.
    }
  } finally {
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  }
});

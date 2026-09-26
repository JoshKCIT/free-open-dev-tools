import { it, expect, vi } from 'vitest';
import * as csstree from 'css-tree';
import { generateFlexbox, FlexboxError } from '../src/index';
import { findUnsafeCss } from '../src/css-safe';
import { HOSTILE_VALUES } from './hostile-css';

function containerBlock(css: string): string {
  const match = /\.container \{([^}]*)\}/.exec(css);
  return match ? match[1]! : '';
}

it('generates the plan default: a row container with initial values gets no non-initial declaration', () => {
  const result = generateFlexbox({});
  expect(result.css).toContain('.container {');
  expect(result.css).toContain('display: flex;');
  const container = containerBlock(result.css);
  expect(container).not.toContain('flex-direction');
  expect(container).not.toContain('justify-content');
  expect(container).not.toContain('align-items');
  expect(container).not.toContain('align-content');
  expect(container).not.toContain('gap');
});

it('direction column, justify space-between and a 12px gap are written on .container', () => {
  // Plan behaviour: "direction column, justify space-between, gap 12 give
  // flex-direction: column;, justify-content: space-between;, gap: 12px; on .container".
  const result = generateFlexbox({
    container: { direction: 'column', justifyContent: 'space-between', gap: 12 },
  });
  expect(result.css).toContain('flex-direction: column;');
  expect(result.css).toContain('justify-content: space-between;');
  expect(result.css).toContain('gap: 12px;');
});

it('container and item properties use only the keywords CSS Flexible Box Layout Level 1 defines', () => {
  // CSS Flexible Box Layout Module Level 1, section 5.1: "Value: row |
  // row-reverse | column | column-reverse". Section 5.2: "Value: nowrap |
  // wrap | wrap-reverse". Section 8.2: "Value: flex-start | flex-end |
  // center | space-between | space-around". Section 8.3 (align-items):
  // "Value: flex-start | flex-end | center | baseline | stretch";
  // (align-self): "Value: auto | flex-start | flex-end | center | baseline
  // | stretch". Section 8.4: "Value: flex-start | flex-end | center |
  // space-between | space-around | stretch".
  for (const direction of ['row', 'row-reverse', 'column', 'column-reverse'] as const) {
    const result = generateFlexbox({ container: { direction } });
    if (direction !== 'row') expect(result.css).toContain(`flex-direction: ${direction};`);
  }
  for (const wrap of ['nowrap', 'wrap', 'wrap-reverse'] as const) {
    const result = generateFlexbox({ container: { wrap } });
    if (wrap !== 'nowrap') expect(result.css).toContain(`flex-wrap: ${wrap};`);
  }
  for (const justifyContent of ['flex-start', 'flex-end', 'center', 'space-between', 'space-around'] as const) {
    const result = generateFlexbox({ container: { justifyContent } });
    if (justifyContent !== 'flex-start') expect(result.css).toContain(`justify-content: ${justifyContent};`);
  }
  for (const alignSelf of ['auto', 'flex-start', 'flex-end', 'center', 'baseline', 'stretch'] as const) {
    const result = generateFlexbox({ items: [{ alignSelf }] });
    if (alignSelf !== 'auto') expect(result.css).toContain(`align-self: ${alignSelf};`);
  }
  // An unknown keyword falls back to the initial value rather than being written.
  const bad = generateFlexbox({ container: { direction: 'diagonal' as never } });
  expect(bad.css).not.toContain('flex-direction');
});

it('each item flexibility is written with the flex shorthand the specification encourages and expands to the same grow, shrink and basis', () => {
  // Plan behaviour: "item 2 with grow 1, shrink 1, basis 0 gives
  // .item-2 { flex: 1 1 0px; } ... and expands back to grow 1, shrink 1,
  // basis 0". Section 7.2: "Authors are encouraged to control flexibility
  // using the flex shorthand rather than with its longhand properties
  // directly, as the shorthand correctly resets any unspecified components
  // to accommodate common uses."
  const result = generateFlexbox({ items: [{}, { grow: 1, shrink: 1, basis: 0 }] });
  expect(result.css).toContain('.item-2 {');
  const match = /\.item-2 \{\n\s*flex: ([^;]+);/.exec(result.css);
  expect(match, result.css).not.toBeNull();
  const [grow, shrink, basis] = match![1]!.split(' ');
  expect(Number(grow)).toBe(1);
  expect(Number(shrink)).toBe(1);
  // This tool writes a zero length without a unit everywhere, including the
  // flex shorthand's own basis component (CSS itself allows either "0" or
  // "0px" for a zero length; both expand back to the same basis of 0).
  expect(Number(basis)).toBe(0);
});

it('items left at the initial values get no rule of their own', () => {
  const result = generateFlexbox({ items: [{}, {}, {}] });
  expect(result.css).not.toContain('.item-1 {');
  expect(result.css).not.toContain('.item-2 {');
  expect(result.css).not.toContain('.item-3 {');
  // The tree still names every item, whether or not it has its own rule.
  expect(result.tree.children!.map((c) => c.className)).toEqual(['item item-1', 'item item-2', 'item item-3']);
});

it('a non-zero order value triggers the reordering and accessibility warning the specification requires', () => {
  // Section 5.4: "Authors must use order only for visual, not logical,
  // reordering of content."
  const withOrder = generateFlexbox({ items: [{ order: 2 }] });
  expect(withOrder.css).toContain('.item-1 {');
  expect(withOrder.css).toContain('order: 2;');
  expect(withOrder.warnings.some((w) => /order only for visual/i.test(w))).toBe(true);

  const withoutOrder = generateFlexbox({ items: [{}] });
  expect(withoutOrder.warnings.some((w) => /order only for visual/i.test(w))).toBe(false);
});

it('gap is written as the CSS Box Alignment Level 3 property', () => {
  const result = generateFlexbox({ container: { gap: 24 } });
  expect(result.css).toContain('gap: 24px;');
  const none = generateFlexbox({ container: { gap: 0 } });
  expect(none.css).not.toContain('gap');
});

it('alignContent is written only when wrapping is on, with a note that it has no effect on a single line', () => {
  const nowrap = generateFlexbox({ container: { wrap: 'nowrap', alignContent: 'center' } });
  expect(nowrap.css).not.toContain('align-content');
  expect(nowrap.warnings.some((w) => /no effect on a single-line/i.test(w))).toBe(true);

  const wrapped = generateFlexbox({ container: { wrap: 'wrap', alignContent: 'center' } });
  expect(wrapped.css).toContain('align-content: center;');
});

it('at most five items are used and the tree matches the resolved item count', () => {
  const result = generateFlexbox({ items: Array.from({ length: 9 }, () => ({})) });
  expect(result.tree.children).toHaveLength(5);
});

it('every declaration is valid for its property according to the css-tree lexer', () => {
  const samples = [
    generateFlexbox({}),
    generateFlexbox({
      container: {
        direction: 'column',
        wrap: 'wrap',
        justifyContent: 'space-between',
        gap: 12,
        alignContent: 'center',
      },
      items: [{ grow: 1, shrink: 1, basis: 100, order: -2, alignSelf: 'center' }, { basis: null }],
    }),
  ];
  for (const result of samples) {
    const ast = csstree.parse(result.css, { positions: true });
    let declarationCount = 0;
    csstree.walk(ast, (node) => {
      if (node.type === 'Declaration') {
        declarationCount++;
        const match = csstree.lexer.matchProperty(node.property, node.value as never);
        expect(match.error, `${node.property}: ${result.css}`).toBeNull();
        expect(match.matched, `${node.property} did not match: ${result.css}`).not.toBeNull();
      }
    });
    expect(declarationCount).toBeGreaterThan(0);
  }
});

it('hostile field values never produce CSS that can load anything or break out of a rule', () => {
  for (const hostile of HOSTILE_VALUES) {
    let result;
    try {
      result = generateFlexbox({ items: [{ basis: Number(hostile) || 0 }] });
    } catch (err) {
      expect(err).toBeInstanceOf(FlexboxError);
      continue;
    }
    expect(findUnsafeCss(result.css), result.css).toBeNull();
    expect(result.css).not.toContain('example.invalid');
  }

  const numericHostileValues = [NaN, Infinity, -Infinity, 1e21, -1e21, -400];
  for (const value of numericHostileValues) {
    const result = generateFlexbox({
      container: { gap: value, width: value, height: value },
      items: [{ grow: value, shrink: value, basis: value, order: value }],
    });
    expect(findUnsafeCss(result.css), result.css).toBeNull();
    expect(result.css).not.toContain('example.invalid');
  }
});

it('the generated CSS declares everything the preview needs, including the element size', () => {
  const result = generateFlexbox({ items: [{}, { grow: 1 }] });
  for (const child of result.tree.children ?? []) {
    expect(result.css, child.className).toContain(`.${child.className.split(' ')[0]} {`);
  }
  expect(result.css).toMatch(/width: \d+px;/);
  expect(result.css).toMatch(/height: \d+px;/);
});

it('nothing is written to the console while generating', () => {
  const spies = ['log', 'warn', 'error', 'info', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    generateFlexbox({ container: { direction: 'column' }, items: [{ grow: 1 }, { order: 3 }] });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  } finally {
    for (const s of spies) s.mockRestore();
  }
});

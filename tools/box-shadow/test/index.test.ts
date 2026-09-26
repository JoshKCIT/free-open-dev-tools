import { it, expect, vi } from 'vitest';
import * as csstree from 'css-tree';
import { generateBoxShadow, BoxShadowError, type BoxShadowLayer } from '../src/index';
import { findUnsafeCss } from '../src/css-safe';
import { HOSTILE_VALUES } from './hostile-css';

function layer(overrides: Partial<BoxShadowLayer> = {}): BoxShadowLayer {
  return { x: 0, y: 4, blur: 12, spread: 0, color: '#000000', opacity: 30, inset: false, ...overrides };
}

interface ShadowGroup {
  /** Numeric parts (offsets, blur, spread) in the order css-tree emits them, ignoring colour. */
  nums: number[];
  inset: boolean;
}

/**
 * Parses a `box-shadow` value into one group per comma-separated shadow,
 * reading only the top-level tokens css-tree's value parser returns (a
 * colour written as a function, such as `rgba(...)`, is a single `Function`
 * node at this level and is never descended into) -- so this never confuses
 * a colour function's own internal numbers with the shadow's own lengths.
 */
function shadowGroups(value: string): ShadowGroup[] {
  const ast = csstree.parse(value, { context: 'value' }) as csstree.Value;
  const groups: ShadowGroup[] = [];
  let current: ShadowGroup = { nums: [], inset: false };
  for (const node of ast.children.toArray()) {
    if (node.type === 'Operator' && node.value === ',') {
      groups.push(current);
      current = { nums: [], inset: false };
    } else if (node.type === 'Dimension' || node.type === 'Number') {
      current.nums.push(Number(node.value));
    } else if (node.type === 'Identifier' && node.name.toLowerCase() === 'inset') {
      current.inset = true;
    }
  }
  groups.push(current);
  return groups;
}

it('the CSS Backgrounds and Borders Level 3 box shadow example is produced from its own values', () => {
  // CSS Backgrounds and Borders Level 3, section 6.1 "Drop Shadows: the
  // box-shadow property", quoted directly from the fetched specification's
  // own worked example: "box-shadow: 64px 64px 12px 40px rgba(0,0,0,0.4),
  // 12px 12px 0px 8px rgba(0,0,0,0.4) inset;"
  const SPEC_EXAMPLE = '64px 64px 12px 40px rgba(0,0,0,0.4), 12px 12px 0px 8px rgba(0,0,0,0.4) inset';
  const result = generateBoxShadow({
    layers: [
      layer({ x: 64, y: 64, blur: 12, spread: 40, opacity: 40, inset: false }),
      layer({ x: 12, y: 12, blur: 0, spread: 8, opacity: 40, inset: true }),
    ],
  });
  expect(shadowGroups(result.value)).toEqual(shadowGroups(SPEC_EXAMPLE));
});

it('layers are written in order and the first layer is painted on top as the specification states', () => {
  // "The property accepts ... a comma-separated list of shadows, ordered
  // front to back" -- the order the layers were supplied in is the order
  // they are written, which is also the visual painting order.
  const result = generateBoxShadow({
    layers: [layer({ x: 1, y: 1, color: '#111111' }), layer({ x: 2, y: 2, color: '#222222' })],
  });
  const [first, second] = result.value.split(', ');
  expect(first).toContain('1px 1px');
  expect(first).toContain('#111111');
  expect(second).toContain('2px 2px');
  expect(second).toContain('#222222');
});

it('a negative blur is clamped to zero and inset and spread are written as the box shadow grammar allows', () => {
  const result = generateBoxShadow({ layers: [layer({ blur: -20, spread: -10, inset: true })] });
  expect(shadowGroups(result.value)[0]!.nums).toContain(0); // blur clamped to zero
  expect(shadowGroups(result.value)[0]!.nums).toContain(-10); // spread may be negative
  expect(shadowGroups(result.value)[0]!.inset).toBe(true);
  expect(result.warnings.some((w) => /blur/i.test(w))).toBe(true);
});

it('a colour and opacity become an eight digit hash colour', () => {
  // "one layer at offset 0 and 4, blur 12, spread 0, colour #000000 at 30
  // percent opacity gives box-shadow: 0 4px 12px 0 #0000004d;"
  const result = generateBoxShadow({ layers: [layer({ x: 0, y: 4, blur: 12, spread: 0, opacity: 30 })] });
  expect(result.value).toBe('0 4px 12px 0 #0000004d');
  expect(result.css).toContain('box-shadow: 0 4px 12px 0 #0000004d;');
});

it('every declaration is valid for its property according to the css-tree lexer', () => {
  const samples = [
    generateBoxShadow({ layers: [layer()] }),
    generateBoxShadow({
      layers: [
        layer({ x: 64, y: 64, blur: 12, spread: 40, opacity: 40 }),
        layer({ x: 12, y: 12, blur: 0, spread: 8, opacity: 40, inset: true }),
      ],
    }),
    generateBoxShadow({
      layers: [layer({ x: -20, y: -20, blur: -5, spread: -10, color: '#2563eb', opacity: 100, inset: true })],
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
    expect(declarationCount).toBe(5); // width, height, background-color, border-radius, box-shadow
  }
});

it('hostile field values never produce CSS that can load anything or break out of a rule', () => {
  for (const hostile of HOSTILE_VALUES) {
    for (const build of [
      () => generateBoxShadow({ layers: [layer()], background: hostile }),
      () => generateBoxShadow({ layers: [layer({ color: hostile })] }),
    ]) {
      let result;
      try {
        result = build();
      } catch (err) {
        expect(err).toBeInstanceOf(BoxShadowError);
        continue;
      }
      expect(findUnsafeCss(result.css), result.css).toBeNull();
      expect(result.css).not.toContain('example.invalid');
      expect(result.css).not.toContain('url(');
    }
  }

  const numericHostileValues = [NaN, Infinity, -Infinity, 1e21, -1e21, -400];
  for (const value of numericHostileValues) {
    const result = generateBoxShadow({
      layers: [{ x: value, y: value, blur: value, spread: value, color: '#000000', opacity: value, inset: false }],
      width: value,
      height: value,
      radius: value,
    });
    expect(findUnsafeCss(result.css), result.css).toBeNull();
    expect(result.css).not.toContain('example.invalid');
  }
});

it('the generated CSS declares everything the preview needs, including the element size', () => {
  const result = generateBoxShadow({ layers: [layer()] });
  expect(result.tree.className).toBe('box');
  expect(result.css).toContain('.box {');
  expect(result.css).toMatch(/width: \d+px;/);
  expect(result.css).toMatch(/height: \d+px;/);
  expect(result.css).toContain('box-shadow:');
});

it('nothing is written to the console while generating', () => {
  const spies = ['log', 'warn', 'error', 'info', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    generateBoxShadow({ layers: [layer()] });
    generateBoxShadow({ layers: [layer({ color: 'not-a-colour' })] });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  } finally {
    for (const s of spies) s.mockRestore();
  }
});

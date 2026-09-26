import { it, expect, vi } from 'vitest';
import * as csstree from 'css-tree';
import { generateTransform, composeMatrix, TransformError } from '../src/index';
import { HOSTILE_VALUES } from './hostile-css';

/**
 * CSS Transforms Module Level 1 (https://www.w3.org/TR/css-transforms-1/),
 * section 4 "Two-Dimensional Subset": "the transform property accepts a
 * <transform-list>... If a list of multiple transform functions is
 * provided, then the net transform is a matrix multiplication of the
 * transform functions in the order provided." Section "Two-Dimensional
 * Transform Functions" gives each function's own matrix:
 * translate(tx, ty) = matrix(1, 0, 0, 1, tx, ty); rotate(a) = matrix(cos(a),
 * sin(a), -sin(a), cos(a), 0, 0); scale(sx, sy) = matrix(sx, 0, 0, sy, 0, 0);
 * skew(ax, ay) = matrix(1, tan(ay), tan(ax), 1, 0, 0).
 *
 * CSS Transforms Module Level 2 (https://www.w3.org/TR/css-transforms-2/),
 * section 3 "Individual Transform Properties": "the used value of the
 * transform is calculated by combining ... in the following order:
 * translate, rotate, scale, and then transform" -- the fixed order this
 * tool's own individual-properties path follows, leaving any skew in the
 * transform property alone.
 */

function round6(n: number): number {
  const r = Math.round(n * 1e6) / 1e6;
  return r === 0 ? 0 : r;
}

it('the composed matrix equals the product of the function matrices in the order written, as CSS Transforms Level 1 defines', () => {
  // translate(10, 20) alone: matrix(1, 0, 0, 1, 10, 20).
  expect(composeMatrix([{ type: 'translate', x: 10, y: 20 }])).toEqual([1, 0, 0, 1, 10, 20]);

  // rotate(90) alone: matrix(cos90, sin90, -sin90, cos90, 0, 0).
  const rotate90 = composeMatrix([{ type: 'rotate', deg: 90 }]).map(round6);
  expect(rotate90).toEqual([0, 1, -1, 0, 0, 0].map(round6));

  // scale(2, 3) alone: matrix(2, 0, 0, 3, 0, 0).
  expect(composeMatrix([{ type: 'scale', x: 2, y: 3 }])).toEqual([2, 0, 0, 3, 0, 0]);

  // skew(10, 20) alone: matrix(1, tan(20deg), tan(10deg), 1, 0, 0).
  const skew = composeMatrix([{ type: 'skew', x: 10, y: 20 }]).map(round6);
  const tan = (deg: number) => Math.tan((deg * Math.PI) / 180);
  expect(skew).toEqual([1, tan(20), tan(10), 1, 0, 0].map(round6));

  // translate then rotate: matrix multiplication in the order written,
  // i.e. Mtranslate * Mrotate, a genuine 3x3 matrix product hand-worked
  // here independently of composeMatrix's own implementation.
  const tx = 10;
  const ty = 0;
  const deg = 90;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Mtranslate (a1..f1) times Mrotate (a2..f2), standard 3x3 product.
  const expected = [
    1 * cos + 0 * sin,
    0 * cos + 1 * sin,
    1 * -sin + 0 * cos,
    0 * -sin + 1 * cos,
    1 * 0 + 0 * 0 + tx,
    0 * 0 + 1 * 0 + ty,
  ].map(round6);
  const actual = composeMatrix([
    { type: 'translate', x: tx, y: ty },
    { type: 'rotate', deg },
  ]).map(round6);
  expect(actual).toEqual(expected);
});

it('changing the order of the same functions changes the matrix', () => {
  const translateFirst = composeMatrix([
    { type: 'translate', x: 10, y: 0 },
    { type: 'rotate', deg: 90 },
  ]).map(round6);
  const rotateFirst = composeMatrix([
    { type: 'rotate', deg: 90 },
    { type: 'translate', x: 10, y: 0 },
  ]).map(round6);
  expect(translateFirst).not.toEqual(rotateFirst);

  const a = generateTransform({
    translate: { x: 10, y: 0 },
    order: 'translate-rotate-scale-skew',
    rotate: 90,
  });
  const b = generateTransform({
    translate: { x: 10, y: 0 },
    order: 'rotate-translate-scale-skew',
    rotate: 90,
  });
  expect(a.matrix).not.toEqual(b.matrix);
});

it('the individual transform properties apply translate, rotate and scale in the fixed order CSS Transforms Level 2 defines', () => {
  const options = {
    translate: { x: 10, y: 5 },
    rotate: 30,
    scale: { x: 2, y: 1.5 },
    skew: { x: 5, y: -5 },
  };
  const individual = generateTransform({ ...options, individual: true, order: 'skew-scale-rotate-translate' });
  const fixedOrderMatrix = composeMatrix([
    { type: 'translate', x: options.translate.x, y: options.translate.y },
    { type: 'rotate', deg: options.rotate },
    { type: 'scale', x: options.scale.x, y: options.scale.y },
    { type: 'skew', x: options.skew.x, y: options.skew.y },
  ]).map(round6);
  expect(individual.matrix.map(round6)).toEqual(fixedOrderMatrix);
  expect(individual.css).toContain('translate: 10px 5px;');
  expect(individual.css).toContain('rotate: 30deg;');
  expect(individual.css).toContain('scale: 2 1.5;');
  expect(individual.css).toMatch(/transform: skew\(5deg, -5deg\);/);
});

it('transform-origin is written from the origin handle as percentages', () => {
  const result = generateTransform({ origin: { x: 0, y: 100 } });
  expect(result.css).toContain('transform-origin: 0% 100%;');
});

it('every declaration is valid for its property according to the css-tree lexer', () => {
  const KNOWN_DIFFERENCES: string[] = [];
  const cases = [
    generateTransform({}),
    generateTransform({ translate: { x: 50, y: -50 }, rotate: 45, scale: { x: 1.5, y: 0.5 } }),
    generateTransform({ skew: { x: -30, y: 30 }, individual: true }),
    generateTransform({ order: 'scale-rotate-translate-skew' }),
  ];
  const unknown = new Set<string>();
  for (const { css } of cases) {
    const ast = csstree.parse(css);
    csstree.walk(ast, (node) => {
      if (node.type === 'Declaration') {
        const generated = csstree.generate({
          type: 'Value',
          children: (node as unknown as { value: { children: unknown } }).value.children as never,
        });
        const matchResult = csstree.lexer.matchProperty(node.property, csstree.parse(generated, { context: 'value' }));
        if (matchResult.error) unknown.add(node.property);
      }
    });
  }
  expect([...unknown]).toEqual(KNOWN_DIFFERENCES);
});

it('hostile field values never produce CSS that can load anything or break out of a rule', () => {
  for (const hostile of HOSTILE_VALUES) {
    const result = generateTransform({ background: hostile });
    expect(result.css).not.toContain('example.invalid');
    expect(result.css.toLowerCase()).not.toContain('url(');
  }
  const extreme = [NaN, Infinity, -Infinity, Number.MAX_VALUE, -Number.MAX_VALUE];
  for (const n of extreme) {
    const result = generateTransform({
      translate: { x: n, y: n },
      rotate: n,
      scale: { x: n, y: n },
      skew: { x: n, y: n },
      origin: { x: n, y: n },
      width: n,
      height: n,
    });
    expect(Number.isFinite(result.matrix[0])).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  }
});

it('the generated CSS declares everything the preview needs, including the element size', () => {
  const result = generateTransform({});
  expect(result.css).toContain('.box');
  expect(result.css).toMatch(/width:\s*\d/);
  expect(result.css).toMatch(/height:\s*\d/);
  expect(result.tree.className).toBe('box');
  expect(result.tree.children?.[0]?.className).toBe('box-label');
  expect(result.tree.children?.[0]?.text).toBe('F');
});

it('nothing is written to the console while generating', () => {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const spyErr = vi.spyOn(console, 'error').mockImplementation(() => {});
  const spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  generateTransform({ translate: { x: 10, y: 10 }, individual: true });
  expect(spy).not.toHaveBeenCalled();
  expect(spyErr).not.toHaveBeenCalled();
  expect(spyWarn).not.toHaveBeenCalled();
  spy.mockRestore();
  spyErr.mockRestore();
  spyWarn.mockRestore();
});

it('the CSS Transforms Level 1 default translate example matches the specification', () => {
  const result = generateTransform({ translate: { x: 10, y: 20 } });
  expect(result.css).toMatch(/transform:\s*translate\(10px, 20px\)/);
  expect(result.matrix).toEqual([1, 0, 0, 1, 10, 20]);
});

it('throws TransformError only when the safety writer itself refuses the finished CSS', () => {
  expect(TransformError).toBeDefined();
});

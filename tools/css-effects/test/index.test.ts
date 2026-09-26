import { it, expect, vi } from 'vitest';
import * as csstree from 'css-tree';
import { generateEffect, mixTowards, EffectsError } from '../src/index';
import { findUnsafeCss } from '../src/css-safe';
import { HOSTILE_VALUES } from './hostile-css';

it('glass writes a translucent background, a backdrop blur and saturation, and the webkit-prefixed copy, as Filter Effects Level 2 defines backdrop-filter', () => {
  // The plan's own literal vector: "glass with blur 12, saturation 160,
  // white tint at 20 percent gives a translucent background-color of
  // #ffffff33, backdrop-filter: blur(12px) saturate(160%); and the same
  // value under the webkit prefix."
  const result = generateEffect({
    mode: 'glass',
    glass: { blur: 12, saturation: 160, tint: '#ffffff', tintOpacity: 20 },
  });
  expect(result.css).toContain('background-color: #ffffff33;');
  expect(result.css).toContain('backdrop-filter: blur(12px) saturate(160%);');
  expect(result.css).toContain('-webkit-backdrop-filter: blur(12px) saturate(160%);');
  expect(result.backdrop).toBe('pattern');
  expect(result.contrastRatio).toBeNull();
  expect(result.warnings).toEqual([]);
});

it('soft UI light and dark shadows are the base colour mixed toward white and black by the stated amount', () => {
  // The plan's own literal vector: "soft UI on base #e0e5ec with intensity
  // 15 gives a light shadow mixed 15 percent toward white and a dark shadow
  // mixed 15 percent toward black, per sRGB channel, rounded to the nearest
  // integer."
  const result = generateEffect({ mode: 'soft', soft: { base: '#e0e5ec', intensity: 15, shape: 'flat' } });
  expect(result.css).toContain('#e5e9ef'); // light shadow colour
  expect(result.css).toContain('#bec3c9'); // dark shadow colour
  expect(result.css).toContain('background-color: #e0e5ec;'); // flat shape keeps the base as a solid fill

  // mixTowards is exported and usable directly.
  expect(mixTowards({ r: 0, g: 0, b: 0, alpha: 1 }, 'white', 50)).toEqual({ r: 128, g: 128, b: 128, alpha: 1 });
  expect(mixTowards({ r: 255, g: 255, b: 255, alpha: 1 }, 'black', 50)).toEqual({ r: 128, g: 128, b: 128, alpha: 1 });
  expect(mixTowards({ r: 100, g: 100, b: 100, alpha: 1 }, 'white', 0)).toEqual({ r: 100, g: 100, b: 100, alpha: 1 });
});

it('the four soft UI shapes write their documented background and shadow forms, with inset shadows for pressed', () => {
  const flat = generateEffect({ mode: 'soft', soft: { shape: 'flat' } });
  expect(flat.css).toMatch(/background-color: #[0-9a-f]{6};/);
  expect(flat.css).not.toContain('inset');

  const pressed = generateEffect({ mode: 'soft', soft: { shape: 'pressed' } });
  expect(pressed.css).toMatch(/box-shadow:[^;]*inset[^;]*inset;/);

  const convex = generateEffect({ mode: 'soft', soft: { shape: 'convex', base: '#e0e5ec', intensity: 15 } });
  expect(convex.css).toContain('background-image: linear-gradient(145deg, #e5e9ef, #bec3c9);');
  expect(convex.css).not.toContain('inset');

  const concave = generateEffect({ mode: 'soft', soft: { shape: 'concave', base: '#e0e5ec', intensity: 15 } });
  expect(concave.css).toContain('background-image: linear-gradient(145deg, #bec3c9, #e5e9ef);');
  expect(concave.css).not.toContain('inset');

  // An unknown shape falls back to flat rather than being rejected outright.
  const fallback = generateEffect({ mode: 'soft', soft: { shape: 'wobbly' as never } });
  expect(fallback.css).toMatch(/background-color: #[0-9a-f]{6};/);
});

it('a soft UI edge below the WCAG 2.2 non-text contrast ratio of 3 to 1 is warned about', () => {
  // The plan's own literal vector's own ratio is well under 3:1.
  const low = generateEffect({ mode: 'soft', soft: { base: '#e0e5ec', intensity: 15 } });
  expect(low.contrastRatio).not.toBeNull();
  expect(low.contrastRatio!).toBeLessThan(3);
  expect(low.warnings.some((w) => /1\.4\.11/.test(w) && /3:1/.test(w))).toBe(true);

  // A high-contrast base and the maximum intensity clears the ratio.
  const high = generateEffect({ mode: 'soft', soft: { base: '#ffffff', intensity: 50 } });
  expect(high.contrastRatio!).toBeGreaterThanOrEqual(3);
  expect(high.warnings.some((w) => /1\.4\.11/.test(w))).toBe(false);
});

it('every declaration is valid for its property according to the css-tree lexer', () => {
  const samples = [
    generateEffect({ mode: 'glass', glass: { blur: 12, saturation: 160, tint: '#ffffff', tintOpacity: 20 } }),
    generateEffect({ mode: 'glass', glass: { blur: 0, saturation: 100, borderOpacity: 0, rounding: 0 } }),
    generateEffect({ mode: 'soft', soft: { shape: 'flat', base: '#e0e5ec' } }),
    generateEffect({ mode: 'soft', soft: { shape: 'convex', base: '#e0e5ec' } }),
    generateEffect({ mode: 'soft', soft: { shape: 'concave', base: '#e0e5ec' } }),
    generateEffect({ mode: 'soft', soft: { shape: 'pressed', base: '#e0e5ec' } }),
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
    let glass;
    try {
      glass = generateEffect({ mode: 'glass', glass: { tint: hostile } });
    } catch (err) {
      expect(err).toBeInstanceOf(EffectsError);
      glass = undefined;
    }
    if (glass) {
      expect(findUnsafeCss(glass.css), glass.css).toBeNull();
      expect(glass.css).not.toContain('example.invalid');
      expect(glass.css).not.toContain('url(');
    }

    let soft;
    try {
      soft = generateEffect({ mode: 'soft', soft: { base: hostile } });
    } catch (err) {
      expect(err).toBeInstanceOf(EffectsError);
      soft = undefined;
    }
    if (soft) {
      expect(findUnsafeCss(soft.css), soft.css).toBeNull();
      expect(soft.css).not.toContain('example.invalid');
      expect(soft.css).not.toContain('url(');
    }
  }

  const numericHostileValues = [NaN, Infinity, -Infinity, 1e21, -1e21, -400];
  for (const value of numericHostileValues) {
    const glass = generateEffect({
      mode: 'glass',
      glass: { blur: value, saturation: value, tintOpacity: value, borderOpacity: value, rounding: value },
      width: value,
      height: value,
    });
    expect(findUnsafeCss(glass.css), glass.css).toBeNull();
    const soft = generateEffect({
      mode: 'soft',
      soft: { distance: value, blur: value, intensity: value, rounding: value },
      width: value,
      height: value,
    });
    expect(findUnsafeCss(soft.css), soft.css).toBeNull();
  }
});

it('the generated CSS declares everything the preview needs, including the element size', () => {
  const glass = generateEffect({ mode: 'glass' });
  expect(glass.tree.className).toBe('glass');
  expect(glass.css).toContain('.glass {');
  expect(glass.css).toMatch(/width: \d+px;/);
  expect(glass.css).toMatch(/height: \d+px;/);

  const soft = generateEffect({ mode: 'soft' });
  expect(soft.tree.className).toBe('scene');
  expect(soft.tree.children?.[0]?.className).toBe('soft');
  expect(soft.css).toContain('.scene {');
  expect(soft.css).toContain('.soft {');
});

it('nothing is written to the console while generating', () => {
  const spies = ['log', 'warn', 'error', 'info', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    generateEffect({ mode: 'glass', glass: { blur: 12, saturation: 160 } });
    generateEffect({ mode: 'soft', soft: { base: 'not-a-colour', shape: 'pressed' } });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  } finally {
    for (const s of spies) s.mockRestore();
  }
});

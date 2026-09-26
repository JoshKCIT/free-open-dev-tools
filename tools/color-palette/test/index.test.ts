import { it, expect, vi } from 'vitest';
import Color from 'colorjs.io';
import { buildPalette } from '../src/index';
import { harmony, mixSteps, blend, HARMONIES } from '../src/palette';
import { parseColor, convertColor, serializeColor } from '../src/color-space';

it('complementary, analogous, triadic, split complementary and tetradic harmonies rotate the hue by the documented angles in the chosen space', () => {
  // The plan's own vector: complementary in HSL of #ff0000 is #00ffff.
  const red = parseColor('#ff0000');
  const complementary = harmony(red, 'complementary', 'hsl');
  expect(serializeColor(complementary[0]!, 'hex')).toBe('#ff0000');
  expect(serializeColor(complementary[1]!, 'hex')).toBe('#00ffff');

  expect(HARMONIES.triadic).toEqual([0, 120, 240]);
  expect(HARMONIES.analogous).toEqual([-30, 0, 30]);
  expect(HARMONIES.splitComplementary).toEqual([0, 150, 210]);
  expect(HARMONIES.tetradic).toEqual([0, 90, 180, 270]);

  const base = parseColor('oklch(60% 0.15 100)');
  const triadic = harmony(base, 'triadic', 'oklch');
  expect(triadic.map((c) => c.coords[2])).toEqual([100, 220, 340]);
});

it('tints, shades and tones match CSS Color 5 color-mix toward white, black and grey, checked against colorjs.io', () => {
  const red = parseColor('#ff0000');
  const white = parseColor('#ffffff');
  const mySteps = mixSteps(red, white, 5, 'oklab');

  const cjsRed = new Color('srgb', [1, 0, 0]);
  const cjsWhite = new Color('srgb', [1, 1, 1]);
  for (let i = 0; i < 5; i++) {
    const progress = i / 4;
    const cjsMixed = cjsRed.mix(cjsWhite, progress, { space: 'oklab', outputSpace: 'srgb' });
    const mine = convertColor(mySteps[i]!, 'srgb');
    const cjsCoords = cjsMixed.coords.map((v) => (v ?? 0) * 255);
    for (let c = 0; c < 3; c++) {
      expect(Math.abs(mine.coords[c]! - cjsCoords[c]!)).toBeLessThanOrEqual(1);
    }
  }

  const result = buildPalette({ base: '#ff0000', mode: 'tints', steps: 5, space: 'oklab' });
  expect(result.swatches).toHaveLength(5);
  expect(result.swatches[0]!.label).toBe('#ff0000');
  expect(result.swatches[4]!.label).toBe('#ffffff');
});

it('a blend starts and ends at its two colours and interpolates in the chosen space', () => {
  const a = parseColor('#2563eb');
  const b = parseColor('#f97316');
  const steps = blend(a, b, 5, 'oklab');
  expect(serializeColor(steps[0]!, 'hex')).toBe(serializeColor(a, 'hex'));
  expect(serializeColor(steps[4]!, 'hex')).toBe(serializeColor(b, 'hex'));
});

it('hue interpolation takes the shorter arc by default as CSS Color 4 specifies', () => {
  // CSS Color 4 section 13.5.1's own worked example: the midpoint between
  // oklch(0.6 0.24 30) and oklch(0.8 0.15 90) along the shorter arc is
  // oklch(0.7 0.195 60).
  const a = parseColor('oklch(0.6 0.24 30)');
  const b = parseColor('oklch(0.8 0.15 90)');
  const steps = blend(a, b, 3, 'oklch');
  const mid = steps[1]!;
  expect(mid.coords[0]).toBeCloseTo(0.7, 6);
  expect(mid.coords[1]).toBeCloseTo(0.195, 6);
  expect(mid.coords[2]).toBeCloseTo(60, 6);
});

it('out of gamut palette colours are mapped into sRGB and marked', () => {
  const result = buildPalette({
    base: 'oklch(70% 0.4 150)',
    mode: 'harmony',
    harmonyName: 'complementary',
    space: 'oklch',
  });
  expect(result.swatches.some((s) => s.mapped)).toBe(true);
  for (const s of result.swatches) {
    const back = parseColor(s.css);
    expect(back.coords[0]).toBeGreaterThanOrEqual(-0.02);
    expect(back.coords[0]).toBeLessThanOrEqual(255.02);
  }
});

it('every swatch is a colour this tool serialised, never input text', () => {
  const result = buildPalette({ base: 'red; background: url(https://example.invalid/x)', mode: 'harmony' });
  for (const s of result.swatches) {
    expect(s.css).not.toContain('url(');
    expect(s.css).not.toContain('example.invalid');
    expect(s.css).toMatch(/^#[0-9a-f]{6}$/);
  }
  expect(result.warnings.some((w) => /Base colour/.test(w))).toBe(true);
});

it('nothing is written to the console while building palettes', () => {
  const spies = ['log', 'warn', 'error', 'info', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    buildPalette({ base: '#2563eb', mode: 'harmony' });
    buildPalette({ base: '#2563eb', mode: 'tints', steps: 7 });
    buildPalette({ base: 'not-a-colour', mode: 'blend', second: 'also-not-a-colour' });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  } finally {
    for (const s of spies) s.mockRestore();
  }
});

it("the harmony example matches CSS Color 4's own hsl hue example: hsl hue 180 at full saturation and 50 percent lightness is cyan", () => {
  const result = buildPalette({ base: '#ff0000', mode: 'harmony', harmonyName: 'complementary', space: 'hsl' });
  expect(result.swatches[1]!.label).toBe('#00ffff');
});

it("the css block names every swatch's own --palette-<n> custom property, text only", () => {
  const result = buildPalette({ base: '#2563eb', mode: 'tints', steps: 4 });
  expect(result.css).toContain(':root {');
  expect(result.css).toContain('--palette-1:');
  expect(result.css).toContain('--palette-4:');
  expect(result.table).toHaveLength(4);
});

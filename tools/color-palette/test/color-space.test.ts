import { describe, it, expect } from 'vitest';
import {
  ColorError,
  FORMATS,
  parseColor,
  convertColor,
  serializeColor,
  inSrgbGamut,
  gamutMapToSrgb,
  type Color,
} from '../src/color-space';

/**
 * A deterministic PRNG hand-ported from `tools/mock-data/src/index.ts`
 * (mulberry32), used only to generate this test's own random colours --
 * never imported across tool packages (D-02).
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

it('every CSS Color 4 syntax for the supported functions is parsed, including legacy comma syntax, percentages, none and alpha', () => {
  // CSS Color 4 section 5.1's own legacy/modern rgb() grammar.
  const modern = parseColor('rgb(51 102 255)');
  const legacyComma = parseColor('rgb(51, 102, 255)');
  const legacyAlpha = parseColor('rgba(51,102,255,1)');
  const modernAlpha = parseColor('rgb(51 102 255 / 1)');
  for (const c of [modern, legacyComma, legacyAlpha, modernAlpha]) {
    expect(c.space).toBe('srgb');
    expect(c.coords[0]).toBeCloseTo(51, 6);
    expect(c.coords[1]).toBeCloseTo(102, 6);
    expect(c.coords[2]).toBeCloseTo(255, 6);
    expect(c.alpha).toBeCloseTo(1, 6);
  }
  expect(parseColor('rgb(20% 40% 100%)').coords[0]).toBeCloseTo(51, 0);

  // "hsl(none 50% 50%)" parses with hue missing (CSS Color 4 section 4.2:
  // a missing component behaves as a zero value for conversion).
  const hueMissing = parseColor('hsl(none 50% 50%)');
  expect(hueMissing.missing[0]).toBe(true);
  expect(hueMissing.coords[0]).toBe(0);

  // hwb() (no legacy form), lab()/lch()/oklab()/oklch() (percentage and
  // number forms, per their own percent-reference-range tables), and
  // device-cmyk() (CSS Color 5 section 6, legacy and modern).
  expect(parseColor('hwb(150 20% 10%)').space).toBe('hwb');
  expect(parseColor('lab(50% 40 30)').coords[0]).toBeCloseTo(50, 6);
  expect(parseColor('lab(50 40 30)').coords[0]).toBeCloseTo(50, 6);
  expect(parseColor('lch(50% 40 30deg)').coords[2]).toBeCloseTo(30, 6);
  expect(parseColor('lch(50% 40 0.5turn)').coords[2]).toBeCloseTo(180, 6);
  expect(parseColor('oklab(70% 0.1 -0.1)').coords[0]).toBeCloseTo(0.7, 6);
  expect(parseColor('oklch(70% 0.1 30)').coords[0]).toBeCloseTo(0.7, 6);
  expect(parseColor('device-cmyk(0, 81%, 81%, 30%)').coords[1]).toBeCloseTo(0.81, 6);
  expect(parseColor('device-cmyk(0 81% 81% 30%)').coords[1]).toBeCloseTo(0.81, 6);

  // Alpha after "/" or as the legacy fourth argument.
  expect(parseColor('hsl(150 50% 50% / 50%)').alpha).toBeCloseTo(0.5, 6);
  expect(parseColor('hsl(150, 50%, 50%, 0.5)').alpha).toBeCloseTo(0.5, 6);
});

it('the CSS Color 4 worked examples convert to the values the specification states', () => {
  // CSS Color 4 section 8, "For example, hwb(150 20% 10%) is the same
  // color as hsl(150 77.78% 55%) and rgb(20% 90% 55%)."
  const hwb = parseColor('hwb(150 20% 10%)');
  const asHsl = convertColor(hwb, 'hsl');
  expect(asHsl.coords[0]).toBeCloseTo(150, 6);
  expect(asHsl.coords[1]).toBeCloseTo(77.78, 1);
  expect(asHsl.coords[2]).toBeCloseTo(55, 1);
  const asRgb = convertColor(hwb, 'srgb');
  expect(asRgb.coords[0]).toBeCloseTo(0.2 * 255, 0);
  expect(asRgb.coords[1]).toBeCloseTo(0.9 * 255, 0);
  expect(asRgb.coords[2]).toBeCloseTo(0.55 * 255, 0);

  // CSS Color 4 section 11.1: "these different syntactic forms are all the
  // same color: oklch(65% 0.15 270) / lab(57.9% 11.4 -53.7) / ... / #6c88ea".
  const oklch = parseColor('oklch(65% 0.15 270)');
  const asLab = convertColor(oklch, 'lab');
  expect(asLab.coords[0]).toBeCloseTo(57.9, 0);
  expect(asLab.coords[1]).toBeCloseTo(11.4, 0);
  expect(asLab.coords[2]).toBeCloseTo(-53.7, 0);
  expect(serializeColor(oklch, 'hex')).toBe('#6c88ea');

  // CSS Color 5 section 6: "with no @color-profile, the following colors
  // are equivalent, using the naive conversion: device-cmyk(0 81% 81% 30%);
  // rgb(178 34 34); firebrick."
  // The spec's own worked example rounds 178.5 down to 178; this tool's
  // rounding convention (round half away from zero) gives 179 for the same
  // exact fraction -- a one-step-of-255 rounding-direction difference, not
  // a formula error (D-120's own stated tolerance for anything through
  // rounded RGB).
  const cmyk = parseColor('device-cmyk(0 81% 81% 30%)');
  const asRgb2 = convertColor(cmyk, 'srgb');
  expect(Math.abs(Math.round(asRgb2.coords[0]!) - 178)).toBeLessThanOrEqual(1);
  expect(Math.round(asRgb2.coords[1]!)).toBe(34);
  expect(Math.round(asRgb2.coords[2]!)).toBe(34);
});

it('the Oklab reference values from its published definition are reproduced', () => {
  // Björn Ottosson's own published direct linear-sRGB -> LMS -> OKLab
  // matrices (bottosson.github.io/posts/oklab/, fetched and quoted
  // directly), an independent route from the XYZ-pivoted one
  // color-space.ts implements (matching the CSS Color 4 sample code) --
  // reproduced here only to cross-check the two routes agree, never
  // imported into src/.
  function directLinearSrgbToOklab(r: number, g: number, b: number): [number, number, number] {
    const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
    const l_ = Math.cbrt(l);
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);
    return [
      0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
      1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
      0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
    ];
  }

  const rand = mulberry32(0xbabb1e);
  for (let i = 0; i < 50; i++) {
    const r = rand();
    const g = rand();
    const b = rand();
    const [L, a, bb] = directLinearSrgbToOklab(r, g, b);
    const srgb255: Color = {
      space: 'srgb',
      coords: [
        r <= 0.0031308 ? r * 12.92 * 255 : (1.055 * r ** (1 / 2.4) - 0.055) * 255,
        g <= 0.0031308 ? g * 12.92 * 255 : (1.055 * g ** (1 / 2.4) - 0.055) * 255,
        b <= 0.0031308 ? b * 12.92 * 255 : (1.055 * b ** (1 / 2.4) - 0.055) * 255,
      ],
      alpha: 1,
      missing: [false, false, false],
    };
    const oklab = convertColor(srgb255, 'oklab');
    expect(oklab.coords[0]).toBeCloseTo(L, 4);
    expect(oklab.coords[1]).toBeCloseTo(a, 4);
    expect(oklab.coords[2]).toBeCloseTo(bb, 4);
  }
});

it('a colour round trips through every supported format within the stated tolerance', () => {
  // D-120: float-to-float conversions (through sRGB) round trip within
  // 1e-6 per component; anything through 8-bit HEX or rounded RGB is
  // within one step of 255 per channel; naive CMYK round trips RGB -> CMYK
  // -> RGB within one step of 255.
  const floatFormats = ['hsl', 'hwb', 'lab', 'lch', 'oklab', 'oklch'] as const;
  const rand = mulberry32(0x5eed01);
  for (let i = 0; i < 200; i++) {
    const original: Color = {
      space: 'srgb',
      coords: [rand() * 255, rand() * 255, rand() * 255],
      alpha: 1,
      missing: [false, false, false],
    };
    for (const format of floatFormats) {
      const converted = convertColor(original, format);
      const back = convertColor(converted, 'srgb');
      expect(back.coords[0], `${format} r`).toBeCloseTo(original.coords[0]!, 4);
      expect(back.coords[1], `${format} g`).toBeCloseTo(original.coords[1]!, 4);
      expect(back.coords[2], `${format} b`).toBeCloseTo(original.coords[2]!, 4);
    }
  }

  // HEX / rounded RGB: within one step of 255 (rounding to 8 bits).
  for (let i = 0; i < 200; i++) {
    const original: Color = {
      space: 'srgb',
      coords: [rand() * 255, rand() * 255, rand() * 255],
      alpha: 1,
      missing: [false, false, false],
    };
    const hex = serializeColor(original, 'hex');
    const back = convertColor(parseColor(hex), 'srgb');
    for (let c = 0; c < 3; c++) {
      expect(Math.abs(back.coords[c]! - original.coords[c]!)).toBeLessThanOrEqual(1);
    }
  }

  // Naive CMYK round trips RGB -> CMYK -> RGB within one step of 255.
  for (let i = 0; i < 200; i++) {
    const original: Color = {
      space: 'srgb',
      coords: [rand() * 255, rand() * 255, rand() * 255],
      alpha: 1,
      missing: [false, false, false],
    };
    const cmyk = convertColor(original, 'cmyk');
    const back = convertColor(cmyk, 'srgb');
    for (let c = 0; c < 3; c++) {
      expect(Math.abs(back.coords[c]! - original.coords[c]!)).toBeLessThanOrEqual(1);
    }
  }
});

it('an out of gamut colour is reported and mapped into sRGB by the CSS Color 4 gamut mapping algorithm', () => {
  // The plan's own vector: oklch(70% 0.4 150) is out of sRGB gamut.
  const outOfGamut = parseColor('oklch(70% 0.4 150)');
  expect(inSrgbGamut(outOfGamut)).toBe(false);
  const mapped = gamutMapToSrgb(outOfGamut);
  expect(mapped.space).toBe('srgb');
  expect(inSrgbGamut(mapped)).toBe(true);

  // A colour already inside the gamut is returned unchanged (within
  // rounding), never darkened or desaturated.
  const inGamut = parseColor('#3366ff');
  expect(inSrgbGamut(inGamut)).toBe(true);
  const mappedInGamut = gamutMapToSrgb(inGamut);
  expect(mappedInGamut.coords[0]).toBeCloseTo(0x33, 0);
  expect(mappedInGamut.coords[1]).toBeCloseTo(0x66, 0);
  expect(mappedInGamut.coords[2]).toBeCloseTo(0xff, 0);
});

it('device-cmyk converts with the naive formula CSS Color 5 defines and round trips within one step of 255', () => {
  // CSS Color 5 section 6.1's own formulas, worked by hand for black:
  // device-cmyk(0 0 0 100%) is pure black.
  const black = convertColor(parseColor('device-cmyk(0% 0% 0% 100%)'), 'srgb');
  expect(black.coords[0]).toBeCloseTo(0, 6);
  expect(black.coords[1]).toBeCloseTo(0, 6);
  expect(black.coords[2]).toBeCloseTo(0, 6);
  // device-cmyk(0 0 0 0) is pure white.
  const white = convertColor(parseColor('device-cmyk(0% 0% 0% 0%)'), 'srgb');
  expect(white.coords[0]).toBeCloseTo(255, 6);
  expect(white.coords[1]).toBeCloseTo(255, 6);
  expect(white.coords[2]).toBeCloseTo(255, 6);

  const rand = mulberry32(0xc4901);
  for (let i = 0; i < 200; i++) {
    const original: Color = {
      space: 'srgb',
      coords: [rand() * 255, rand() * 255, rand() * 255],
      alpha: 1,
      missing: [false, false, false],
    };
    const cmyk = convertColor(original, 'cmyk');
    for (const v of cmyk.coords) {
      expect(v).toBeGreaterThanOrEqual(-1e-9);
      expect(v).toBeLessThanOrEqual(1 + 1e-9);
    }
    const back = convertColor(cmyk, 'srgb');
    for (let c = 0; c < 3; c++) {
      expect(Math.abs(back.coords[c]! - original.coords[c]!)).toBeLessThanOrEqual(1);
    }
  }
});

it('malformed colour text is refused with a named error that does not repeat the text', () => {
  const cases = ['lab(50% 40 30', 'rgb(1 2)', '', '   ', '#12', '#1234567', 'not-a-colour()', 'hsl(1 2 3 4 5)'];
  for (const text of cases) {
    let threw = false;
    try {
      parseColor(text);
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(ColorError);
      expect((err as ColorError).message).not.toContain(text.trim() || '<<never>>');
    }
    expect(threw, `"${text}" should have been refused`).toBe(true);
  }
  // Named colours are not accepted (stated in this tool's own `limits`).
  expect(() => parseColor('red')).toThrow(ColorError);
});

describe('FORMATS', () => {
  it('lists exactly the nine supported formats', () => {
    expect(FORMATS).toEqual(['hex', 'rgb', 'hsl', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'cmyk']);
  });
});

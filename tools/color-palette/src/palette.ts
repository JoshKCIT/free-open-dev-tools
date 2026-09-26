/**
 * Harmonies, tints, shades, tones and blends built on the canonical colour
 * core (color-space.ts), mixed with CSS Color Module Level 5's own
 * color-mix() semantics (https://www.w3.org/TR/css-color-5/#color-mix) --
 * premultiplied alpha, percentage handling, and CSS Color Module Level 4's
 * own hue interpolation (https://www.w3.org/TR/css-color-4/#hue-interpolation),
 * "shorter" arc by default. Every colour returned here is gamut-mapped for
 * display and serialised through the core's own serialiser -- never a
 * hand-built string.
 */

import { convertColor, gamutMapToSrgb, inSrgbGamut, type Color, type ColorSpace } from './color-space';

/** Colour spaces a mix or a hue rotation may be carried out in. */
export type MixSpace = 'oklab' | 'oklch' | 'srgb';
export type HarmonySpace = 'oklch' | 'hsl';

/**
 * Common design-usage harmony names and their hue offsets in degrees, added
 * to the base colour's own hue. These names follow common design usage, not
 * a published standard (stated as such in this tool's own `limits`).
 */
export const HARMONIES = {
  complementary: [0, 180],
  analogous: [-30, 0, 30],
  triadic: [0, 120, 240],
  splitComplementary: [0, 150, 210],
  tetradic: [0, 90, 180, 270],
} as const satisfies Record<string, readonly number[]>;

export type HarmonyName = keyof typeof HARMONIES;

function hueIndexFor(space: HarmonySpace | MixSpace): number {
  return space === 'oklch' ? 2 : space === 'hsl' ? 0 : -1;
}

/**
 * Rotates `base`'s hue by `name`'s own offsets, in `space` (OKLCH or HSL),
 * keeping the other components unchanged. Returns one colour per offset, in
 * the same colour space, not gamut-mapped (the caller gamut-maps for
 * display).
 */
export function harmony(base: Color, name: HarmonyName, space: HarmonySpace): Color[] {
  const c = convertColor(base, space);
  const hi = hueIndexFor(space);
  return HARMONIES[name].map((offset) => {
    const coords = [...c.coords];
    coords[hi] = (((coords[hi]! + offset) % 360) + 360) % 360;
    return { space, coords, alpha: c.alpha, missing: coords.map(() => false) };
  });
}

/**
 * CSS Color 4 section 13.5.1 "shorter": "Angles are adjusted so that θ2 - θ1
 * ∈ [-180, 180]." Returns the two angles adjusted so a direct linear
 * interpolation between them takes the shorter arc.
 */
function shorterHueFixup(h1: number, h2: number): [number, number] {
  let a = h1;
  let b = h2;
  const diff = b - a;
  if (diff > 180) a += 360;
  else if (diff < -180) b += 360;
  return [a, b];
}

/**
 * Mixes `colorA` and `colorB` in `space` at `progress` (0 = all A, 1 = all
 * B), following CSS Color 5's color-mix() algorithm for a plain two-colour
 * mix: premultiplied-alpha linear interpolation of every non-hue component,
 * the "shorter" hue arc for a polar space (OKLCH), un-premultiplied at the
 * end.
 */
function mixColors(colorA: Color, colorB: Color, progress: number, space: MixSpace): Color {
  const a = convertColor(colorA, space);
  const b = convertColor(colorB, space);
  const hi = hueIndexFor(space);
  const aCoords = [...a.coords];
  const bCoords = [...b.coords];
  if (hi >= 0) {
    const [h1, h2] = shorterHueFixup(aCoords[hi]!, bCoords[hi]!);
    aCoords[hi] = h1;
    bCoords[hi] = h2;
  }
  const alpha = a.alpha + (b.alpha - a.alpha) * progress;
  const mixed = aCoords.map((av, i) => {
    if (i === hi) {
      const h = av + (bCoords[i]! - av) * progress;
      return ((h % 360) + 360) % 360;
    }
    // Premultiply, interpolate, un-premultiply.
    const aPre = av * a.alpha;
    const bPre = bCoords[i]! * b.alpha;
    const mixedPre = aPre + (bPre - aPre) * progress;
    return alpha > 0 ? mixedPre / alpha : 0;
  });
  return { space, coords: mixed, alpha, missing: mixed.map(() => false) };
}

/**
 * `steps` colours (3 to 12) evenly mixed from `base` (progress 0) to
 * `target` (progress 1), in `space`. Used for tints (target white), shades
 * (target black) and tones (target a mid grey).
 */
export function mixSteps(base: Color, target: Color, steps: number, space: MixSpace): Color[] {
  const n = Math.max(3, Math.min(12, Math.round(steps)));
  const result: Color[] = [];
  for (let i = 0; i < n; i++) {
    result.push(mixColors(base, target, i / (n - 1), space));
  }
  return result;
}

/** `steps` colours evenly mixed from `a` to `b`, in `space`. Same mixing rule as `mixSteps`, for an arbitrary pair. */
export function blend(a: Color, b: Color, steps: number, space: MixSpace): Color[] {
  return mixSteps(a, b, steps, space);
}

/** Gamut-maps `color` into sRGB for display, leaving an already-in-gamut colour unchanged (within rounding). */
export function forDisplay(color: Color): { color: Color; mapped: boolean } {
  const mapped = !inSrgbGamut(color);
  return { color: mapped ? gamutMapToSrgb(color) : convertColor(color, 'srgb'), mapped };
}

export type { Color, ColorSpace };

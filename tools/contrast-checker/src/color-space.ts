/**
 * Canonical colour core (D-113, D-120). Copied byte for byte into
 * `contrast-checker` and `color-palette` (BI), and proven identical to this
 * file by each copy's own SNIPPETS-IDENTICAL check. Never edit a copy on its
 * own: fix this file, then re-copy it everywhere it lives.
 *
 * Implements CSS Color Module Level 4
 * (https://www.w3.org/TR/css-color-4/): the hex, rgb(), hsl(), hwb(), lab(),
 * lch(), oklab() and oklch() syntaxes (including legacy comma syntax where
 * the specification allows it, `none`, and percentage reference ranges);
 * CSS Color Module Level 5 (https://www.w3.org/TR/css-color-5/) section 6's
 * `device-cmyk()` and its naive conversion algorithm; and Björn Ottosson's
 * published Oklab definition (https://bottosson.github.io/posts/oklab/).
 *
 * Every space-to-space conversion routes through linear sRGB or CIE XYZ, the
 * same way the CSS Color 4 sample code at
 * https://github.com/w3c/csswg-drafts/blob/main/css-color-4/conversions.js
 * does (vendored, test-only, at `test/fixtures/csswg-color-4/`, never
 * imported here) -- `MATRICES` below holds the same matrices that file
 * defines, named the way it names them, and a test compares them digit for
 * digit against the vendored copy. Cube roots use `Math.cbrt`, which is
 * defined for negative arguments (unlike `Math.pow(x, 1/3)`), matching the
 * pinned file's own choice and avoiding the sign-related bug CSS Color 4's
 * OKLab conversion could otherwise hit on out-of-gamut colours.
 *
 * Naive device CMYK (CSS Color 5 section 6.1) is not calibrated against any
 * ICC profile: it is a simple, documented, everyday conversion, not a
 * colorimetric one, named as such in `limits` wherever this core is used.
 */

export class ColorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ColorError';
  }
}

/** Every colour text format this core parses and serialises. */
export type ColorFormat = 'hex' | 'rgb' | 'hsl' | 'hwb' | 'lab' | 'lch' | 'oklab' | 'oklch' | 'cmyk';

export const FORMATS: readonly ColorFormat[] = ['hex', 'rgb', 'hsl', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'cmyk'];

/** The colour spaces a parsed or converted colour can live in. `'srgb'` covers both hex and rgb() text. */
export type ColorSpace = 'srgb' | 'hsl' | 'hwb' | 'lab' | 'lch' | 'oklab' | 'oklch' | 'cmyk';

/**
 * A parsed or converted colour. `coords` holds three components (four for
 * `cmyk`) in the same numeric scale a plain CSS number would use for that
 * component (sRGB channels 0-255, hue in degrees, HSL/HWB/Lab-L/LCH-L as
 * 0-100, Oklab/OKLCH-L as 0-1, CMYK components as 0-1); `missing` flags a
 * component the text wrote as `none`, which CSS Color 4 says "behaves as a
 * zero value... for all other purposes" (including conversion) -- so a
 * missing component's own `coords` entry is already 0.
 */
export interface Color {
  space: ColorSpace;
  coords: number[];
  alpha: number;
  missing: boolean[];
}

/**
 * Every matrix and white point the CSS Color 4 sample code defines for the
 * conversions this core performs, named after that file's own function
 * names (a test extracts the numbers from the vendored file and compares
 * them to these, digit for digit).
 */
export const MATRICES = {
  // Standard white points, defined by 4-figure CIE x,y chromaticities.
  D50: [0.3457 / 0.3585, 1.0, (1.0 - 0.3457 - 0.3585) / 0.3585],
  D65: [0.3127 / 0.329, 1.0, (1.0 - 0.3127 - 0.329) / 0.329],
  // lin_sRGB_to_XYZ / XYZ_to_lin_sRGB.
  lin_sRGB_to_XYZ: [
    [506752 / 1228815, 87881 / 245763, 12673 / 70218],
    [87098 / 409605, 175762 / 245763, 12673 / 175545],
    [7918 / 409605, 87881 / 737289, 1001167 / 1053270],
  ],
  XYZ_to_lin_sRGB: [
    [12831 / 3959, -329 / 214, -1974 / 3959],
    [-851781 / 878810, 1648619 / 878810, 36519 / 878810],
    [705 / 12673, -2585 / 12673, 705 / 667],
  ],
  // D65_to_D50 / D50_to_D65 (Bradford chromatic adaptation).
  D65_to_D50: [
    [1.0479297925449969, 0.022946870601609652, -0.05019226628920524],
    [0.02962780877005599, 0.9904344267538799, -0.017073799063418826],
    [-0.009243040646204504, 0.015055191490298152, 0.7518742814281371],
  ],
  D50_to_D65: [
    [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
    [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
    [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
  ],
  // XYZ_to_OKLab's own two matrices (XYZ -> LMS, then LMS' -> OKLab).
  XYZ_to_OKLab_XYZtoLMS: [
    [0.819022437996703, 0.3619062600528904, -0.1288737815209879],
    [0.0329836539323885, 0.9292868615863434, 0.0361446663506424],
    [0.0481771893596242, 0.2642395317527308, 0.6335478284694309],
  ],
  XYZ_to_OKLab_LMStoOKLab: [
    [0.210454268309314, 0.7936177747023054, -0.0040720430116193],
    [1.9779985324311684, -2.4285922420485799, 0.450593709617411],
    [0.0259040424655478, 0.7827717124575296, -0.8086757549230774],
  ],
  // OKLab_to_XYZ's own two matrices (OKLab -> LMS', then LMS -> XYZ).
  OKLab_to_XYZ_OKLabtoLMS: [
    [1.0, 0.3963377773761749, 0.2158037573099136],
    [1.0, -0.1055613458156586, -0.0638541728258133],
    [1.0, -0.0894841775298119, -1.2914855480194092],
  ],
  OKLab_to_XYZ_LMStoXYZ: [
    [1.2268798758459243, -0.5578149944602171, 0.2813910456659647],
    [-0.0405757452148008, 1.112286803280317, -0.0717110580655164],
    [-0.0763729366746601, -0.4214933324022432, 1.5869240198367816],
  ],
} as const;

function multiplyMatrix(m: readonly (readonly number[])[], v: readonly number[]): number[] {
  return m.map((row) => row.reduce((sum, coeff, i) => sum + coeff * v[i]!, 0));
}

// --- sRGB companding (CSS Color 4 section 4.4's own transfer function, the
// same one the vendored sample code's lin_sRGB/gam_sRGB implement) ---------

function srgbCompandedToLinear(v: number): number {
  const sign = v < 0 ? -1 : 1;
  const abs = Math.abs(v);
  return abs <= 0.04045 ? v / 12.92 : sign * Math.pow((abs + 0.055) / 1.055, 2.4);
}
function srgbLinearToCompanded(v: number): number {
  const sign = v < 0 ? -1 : 1;
  const abs = Math.abs(v);
  return abs > 0.0031308 ? sign * (1.055 * Math.pow(abs, 1 / 2.4) - 0.055) : 12.92 * v;
}

/** sRGB 0-255 (companded) -> linear sRGB 0-1. */
function srgb255ToLinear(rgb: readonly number[]): number[] {
  return rgb.map((c) => srgbCompandedToLinear(c / 255));
}
/** Linear sRGB 0-1 -> sRGB 0-255 (companded). */
function linearToSrgb255(rgb: readonly number[]): number[] {
  return rgb.map((c) => srgbLinearToCompanded(c) * 255);
}

function linearSrgbToXyzD65(rgb: readonly number[]): number[] {
  return multiplyMatrix(MATRICES.lin_sRGB_to_XYZ, rgb);
}
function xyzD65ToLinearSrgb(xyz: readonly number[]): number[] {
  return multiplyMatrix(MATRICES.XYZ_to_lin_sRGB, xyz);
}
function xyzD65ToD50(xyz: readonly number[]): number[] {
  return multiplyMatrix(MATRICES.D65_to_D50, xyz);
}
function xyzD50ToD65(xyz: readonly number[]): number[] {
  return multiplyMatrix(MATRICES.D50_to_D65, xyz);
}

// --- CIE Lab / LCH (D50), per CSS Color 4 section 9's own definitions ----

function xyzD50ToLab(xyz: readonly number[]): number[] {
  const epsilon = 216 / 24389;
  const kappa = 24389 / 27;
  const white = MATRICES.D50;
  const xyzScaled = xyz.map((v, i) => v / white[i]!);
  const f = xyzScaled.map((v) => (v > epsilon ? Math.cbrt(v) : (kappa * v + 16) / 116));
  return [116 * f[1]! - 16, 500 * (f[0]! - f[1]!), 200 * (f[1]! - f[2]!)];
}
function labToXyzD50(lab: readonly number[]): number[] {
  const kappa = 24389 / 27;
  const epsilon = 216 / 24389;
  const white = MATRICES.D50;
  const f1 = (lab[0]! + 16) / 116;
  const f0 = lab[1]! / 500 + f1;
  const f2 = f1 - lab[2]! / 200;
  const xyz = [
    Math.pow(f0, 3) > epsilon ? Math.pow(f0, 3) : (116 * f0 - 16) / kappa,
    lab[0]! > kappa * epsilon ? Math.pow((lab[0]! + 16) / 116, 3) : lab[0]! / kappa,
    Math.pow(f2, 3) > epsilon ? Math.pow(f2, 3) : (116 * f2 - 16) / kappa,
  ];
  return xyz.map((v, i) => v * white[i]!);
}
function labToLch(lab: readonly number[]): number[] {
  const epsilon = 0.0015;
  const chroma = Math.sqrt(lab[1]! ** 2 + lab[2]! ** 2);
  let hue = (Math.atan2(lab[2]!, lab[1]!) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  if (chroma <= epsilon) hue = 0; // a powerless hue is a missing component, treated as 0 (D-113)
  return [lab[0]!, chroma, hue];
}
function lchToLab(lch: readonly number[]): number[] {
  return [lch[0]!, lch[1]! * Math.cos((lch[2]! * Math.PI) / 180), lch[1]! * Math.sin((lch[2]! * Math.PI) / 180)];
}

// --- OKLab / OKLCH (D65), per Björn Ottosson's published definition ------

function xyzD65ToOklab(xyz: readonly number[]): number[] {
  const lms = multiplyMatrix(MATRICES.XYZ_to_OKLab_XYZtoLMS, xyz);
  return multiplyMatrix(MATRICES.XYZ_to_OKLab_LMStoOKLab, lms.map(Math.cbrt));
}
function oklabToXyzD65(oklab: readonly number[]): number[] {
  const lmsNonlinear = multiplyMatrix(MATRICES.OKLab_to_XYZ_OKLabtoLMS, oklab);
  return multiplyMatrix(
    MATRICES.OKLab_to_XYZ_LMStoXYZ,
    lmsNonlinear.map((c) => c ** 3),
  );
}
function oklabToOklch(oklab: readonly number[]): number[] {
  const epsilon = 0.000004;
  const chroma = Math.sqrt(oklab[1]! ** 2 + oklab[2]! ** 2);
  let hue = (Math.atan2(oklab[2]!, oklab[1]!) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  if (chroma <= epsilon) hue = 0;
  return [oklab[0]!, chroma, hue];
}
function oklchToOklab(oklch: readonly number[]): number[] {
  return [
    oklch[0]!,
    oklch[1]! * Math.cos((oklch[2]! * Math.PI) / 180),
    oklch[1]! * Math.sin((oklch[2]! * Math.PI) / 180),
  ];
}

// --- HSL / HWB, per CSS Color 4 sections 7 and 8's own sample algorithms -

/** CSS Color 4 section 7.1, `hslToRgb`: hue in degrees, sat/light in [0,100], returns sRGB 0-1. */
function hslToSrgbFraction(hue: number, sat: number, light: number): number[] {
  const s = sat / 100;
  const l = light / 100;
  const f = (n: number): number => {
    const k = (n + hue / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}
/** CSS Color 4 section 7.2, `rgbToHsl`: sRGB 0-1 in, [hue 0-360, sat 0-100, light 0-100] out. */
function srgbFractionToHsl(red: number, green: number, blue: number): number[] {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  let hue = 0;
  let sat = 0;
  const light = (min + max) / 2;
  const d = max - min;
  const epsilon = 1 / 100000;
  if (d !== 0) {
    sat = light === 0 || light === 1 ? 0 : (max - light) / Math.min(light, 1 - light);
    if (max === red) hue = (green - blue) / d + (green < blue ? 6 : 0);
    else if (max === green) hue = (blue - red) / d + 2;
    else hue = (red - green) / d + 4;
    hue *= 60;
  }
  if (sat < 0) {
    hue += 180;
    sat = Math.abs(sat);
  }
  if (hue >= 360) hue -= 360;
  if (sat <= epsilon) hue = 0; // powerless hue treated as missing/zero (D-113)
  return [hue, sat * 100, light * 100];
}
/** CSS Color 4 section 8.1, `hwbToRgb`: hue in degrees, white/black in [0,100], returns sRGB 0-1. */
function hwbToSrgbFraction(hue: number, white: number, black: number): number[] {
  const w = white / 100;
  const b = black / 100;
  if (w + b >= 1) {
    const gray = w / (w + b);
    return [gray, gray, gray];
  }
  const rgb = hslToSrgbFraction(hue, 100, 50);
  return rgb.map((c) => c * (1 - w - b) + w);
}
/** CSS Color 4 section 8.2, `rgbToHue` + `rgbToHwb`: sRGB 0-1 in, [hue, white 0-100, black 0-100] out. */
function srgbFractionToHwb(red: number, green: number, blue: number): number[] {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  let hue = 0;
  const d = max - min;
  if (d !== 0) {
    if (max === red) hue = (green - blue) / d + (green < blue ? 6 : 0);
    else if (max === green) hue = (blue - red) / d + 2;
    else hue = (red - green) / d + 4;
    hue *= 60;
  }
  if (hue >= 360) hue -= 360;
  const epsilon = 1 / 100000;
  const white = min;
  const black = 1 - max;
  if (white + black >= 1 - epsilon) hue = 0;
  return [hue, white * 100, black * 100];
}

// --- Naive device CMYK, per CSS Color 5 section 6.1 -----------------------

/** CSS Color 5 section 6.1: naive CMYK (0-1 each) -> sRGB 0-1. */
function cmykToSrgbFraction(c: number, m: number, y: number, k: number): number[] {
  return [1 - Math.min(1, c * (1 - k) + k), 1 - Math.min(1, m * (1 - k) + k), 1 - Math.min(1, y * (1 - k) + k)];
}
/** CSS Color 5 section 6.1: sRGB 0-1 -> naive CMYK (0-1 each). */
function srgbFractionToCmyk(red: number, green: number, blue: number): number[] {
  const k = 1 - Math.max(red, green, blue);
  if (k >= 1) return [0, 0, 0, 1];
  return [(1 - red - k) / (1 - k), (1 - green - k) / (1 - k), (1 - blue - k) / (1 - k), k];
}

// --- Pivot: every space converts through XYZ D65 --------------------------

function toXyzD65(color: Color): number[] {
  switch (color.space) {
    case 'srgb':
      return linearSrgbToXyzD65(srgb255ToLinear(color.coords));
    case 'hsl': {
      const rgb = hslToSrgbFraction(color.coords[0]!, color.coords[1]!, color.coords[2]!);
      return linearSrgbToXyzD65(rgb.map(srgbCompandedToLinear));
    }
    case 'hwb': {
      const rgb = hwbToSrgbFraction(color.coords[0]!, color.coords[1]!, color.coords[2]!);
      return linearSrgbToXyzD65(rgb.map(srgbCompandedToLinear));
    }
    case 'lab':
      return xyzD50ToD65(labToXyzD50(color.coords));
    case 'lch':
      return xyzD50ToD65(labToXyzD50(lchToLab(color.coords)));
    case 'oklab':
      return oklabToXyzD65(color.coords);
    case 'oklch':
      return oklabToXyzD65(oklchToOklab(color.coords));
    case 'cmyk': {
      const rgb = cmykToSrgbFraction(color.coords[0]!, color.coords[1]!, color.coords[2]!, color.coords[3]!);
      return linearSrgbToXyzD65(rgb.map(srgbCompandedToLinear));
    }
  }
}

function fromXyzD65(xyz: number[], space: ColorSpace): number[] {
  switch (space) {
    case 'srgb':
      return linearToSrgb255(xyzD65ToLinearSrgb(xyz));
    case 'hsl': {
      const rgb = xyzD65ToLinearSrgb(xyz).map(srgbLinearToCompanded);
      return srgbFractionToHsl(rgb[0]!, rgb[1]!, rgb[2]!);
    }
    case 'hwb': {
      const rgb = xyzD65ToLinearSrgb(xyz).map(srgbLinearToCompanded);
      return srgbFractionToHwb(rgb[0]!, rgb[1]!, rgb[2]!);
    }
    case 'lab':
      return xyzD50ToLab(xyzD65ToD50(xyz));
    case 'lch':
      return labToLch(xyzD50ToLab(xyzD65ToD50(xyz)));
    case 'oklab':
      return xyzD65ToOklab(xyz);
    case 'oklch':
      return oklabToOklch(xyzD65ToOklab(xyz));
    case 'cmyk': {
      const rgb = xyzD65ToLinearSrgb(xyz).map(srgbLinearToCompanded);
      return srgbFractionToCmyk(rgb[0]!, rgb[1]!, rgb[2]!);
    }
  }
}

/** Converts a colour, in any supported space, to another supported space. Alpha passes through unchanged. */
export function convertColor(color: Color, space: ColorSpace): Color {
  if (color.space === space)
    return { space, coords: [...color.coords], alpha: color.alpha, missing: [...color.missing] };
  const coords = fromXyzD65(toXyzD65(color), space);
  return { space, coords, alpha: color.alpha, missing: coords.map(() => false) };
}

/** The Oklab Euclidean distance between two colours, in any supported space (CSS Color 4 section 20.3). */
export function deltaEOK(a: Color, b: Color): number {
  const oa = a.space === 'oklab' ? a.coords : convertColor(a, 'oklab').coords;
  const ob = b.space === 'oklab' ? b.coords : convertColor(b, 'oklab').coords;
  return Math.sqrt((oa[0]! - ob[0]!) ** 2 + (oa[1]! - ob[1]!) ** 2 + (oa[2]! - ob[2]!) ** 2);
}

/** A small epsilon (in the 0-255 sRGB scale) so floating-point error at the gamut boundary is not reported as out of gamut. */
const SRGB_GAMUT_EPSILON = 0.02;

/** True when `color`, converted to sRGB, falls within the 0-255 range (per channel) on all three channels. */
export function inSrgbGamut(color: Color): boolean {
  const srgb = color.space === 'srgb' ? color : convertColor(color, 'srgb');
  return srgb.coords.every((c) => c >= -SRGB_GAMUT_EPSILON && c <= 255 + SRGB_GAMUT_EPSILON);
}

function clipToSrgb(color: Color): Color {
  const srgb = convertColor(color, 'srgb');
  return { ...srgb, coords: srgb.coords.map((c) => Math.min(255, Math.max(0, c))) };
}

/**
 * Maps `color` into the sRGB gamut following the CSS Color 4 gamut mapping
 * algorithm, "Binary Search Gamut Mapping with Local MINDE"
 * (https://www.w3.org/TR/css-color-4/#css-gamut-mapping-algorithm, section
 * 14.2): constant-lightness, constant-hue chroma reduction in OKLCH,
 * accepting the clipped result once its deltaEOK from the unclipped colour
 * falls under one "just noticeable difference" (JND = 0.02 in OKLCH).
 * Returns a colour already in the `'srgb'` space.
 */
export function gamutMapToSrgb(color: Color): Color {
  const oklch = color.space === 'oklch' ? color : convertColor(color, 'oklch');
  if (oklch.coords[0]! >= 1) {
    return convertColor(
      { space: 'oklab', coords: [1, 0, 0], alpha: color.alpha, missing: [false, false, false] },
      'srgb',
    );
  }
  if (oklch.coords[0]! <= 0) {
    return convertColor(
      { space: 'oklab', coords: [0, 0, 0], alpha: color.alpha, missing: [false, false, false] },
      'srgb',
    );
  }
  if (inSrgbGamut(oklch)) return convertColor(oklch, 'srgb');

  const JND = 0.02;
  const EPSILON = 0.0001;
  let current: Color = { ...oklch, coords: [...oklch.coords] };
  let clipped = clipToSrgb(current);
  let e = deltaEOK(clipped, current);
  if (e < JND) return clipped;

  let min = 0;
  let max = oklch.coords[1]!;
  let minInGamut = true;
  while (max - min > EPSILON) {
    const chroma = (min + max) / 2;
    current = { ...current, coords: [current.coords[0]!, chroma, current.coords[2]!] };
    if (minInGamut && inSrgbGamut(current)) {
      min = chroma;
      continue;
    }
    clipped = clipToSrgb(current);
    e = deltaEOK(clipped, current);
    if (e < JND) {
      if (JND - e < EPSILON) return clipped;
      minInGamut = false;
      min = chroma;
    } else {
      max = chroma;
    }
  }
  return clipped;
}

// --- Parsing ----------------------------------------------------------

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FUNC_RE = /^([a-zA-Z-]+)\(([\s\S]*)\)$/;

function hex2(h: string): number {
  return parseInt(h.length === 1 ? h + h : h, 16);
}

function parseHex(text: string): Color {
  const match = HEX_RE.exec(text);
  if (!match) throw new ColorError('is not a valid 3, 4, 6 or 8 digit hex colour');
  const digits = match[1]!;
  if (digits.length === 3 || digits.length === 4) {
    const r = hex2(digits[0]!);
    const g = hex2(digits[1]!);
    const b = hex2(digits[2]!);
    const alpha = digits.length === 4 ? hex2(digits[3]!) / 255 : 1;
    return { space: 'srgb', coords: [r, g, b], alpha, missing: [false, false, false] };
  }
  const r = hex2(digits.slice(0, 2));
  const g = hex2(digits.slice(2, 4));
  const b = hex2(digits.slice(4, 6));
  const alpha = digits.length === 8 ? hex2(digits.slice(6, 8)) / 255 : 1;
  return { space: 'srgb', coords: [r, g, b], alpha, missing: [false, false, false] };
}

interface SplitArgs {
  tokens: string[];
  alphaToken: string | null;
  legacy: boolean;
}

function splitArgs(inner: string, expectedCount: number): SplitArgs {
  const raw = inner.trim();
  if (raw.length === 0) throw new ColorError('colour function has no arguments');
  if (raw.includes(',')) {
    const parts = raw.split(',').map((s) => s.trim());
    if (parts.length === expectedCount) return { tokens: parts, alphaToken: null, legacy: true };
    if (parts.length === expectedCount + 1) {
      return { tokens: parts.slice(0, expectedCount), alphaToken: parts[expectedCount]!, legacy: true };
    }
    throw new ColorError(`expected ${expectedCount} or ${expectedCount + 1} comma-separated values`);
  }
  const slashIdx = raw.indexOf('/');
  const main = slashIdx === -1 ? raw : raw.slice(0, slashIdx);
  const alphaToken = slashIdx === -1 ? null : raw.slice(slashIdx + 1).trim();
  const tokens = main.trim().split(/\s+/).filter(Boolean);
  if (tokens.length !== expectedCount) throw new ColorError(`expected ${expectedCount} space-separated values`);
  return { tokens, alphaToken, legacy: false };
}

interface ParsedComponent {
  value: number;
  missing: boolean;
}

function parseComponent(token: string, percentScale: number): ParsedComponent {
  if (token === 'none') return { value: 0, missing: true };
  if (token.endsWith('%')) {
    const n = Number(token.slice(0, -1));
    if (!Number.isFinite(n)) throw new ColorError(`"${token}" is not a valid percentage`);
    return { value: (n / 100) * percentScale, missing: false };
  }
  const n = Number(token);
  if (!Number.isFinite(n)) throw new ColorError(`"${token}" is not a valid number`);
  return { value: n, missing: false };
}

const HUE_RE = /^(-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?)(deg|grad|rad|turn)?$/i;

function parseHueComponent(token: string): ParsedComponent {
  if (token === 'none') return { value: 0, missing: true };
  const match = HUE_RE.exec(token);
  if (!match) throw new ColorError(`"${token}" is not a valid hue`);
  let n = Number(match[1]);
  const unit = (match[2] ?? 'deg').toLowerCase();
  if (unit === 'grad') n *= 0.9;
  else if (unit === 'rad') n = (n * 180) / Math.PI;
  else if (unit === 'turn') n *= 360;
  n = ((n % 360) + 360) % 360;
  return { value: n, missing: false };
}

function parseAlphaComponent(token: string | null): ParsedComponent {
  if (token === null) return { value: 1, missing: false };
  return parseComponent(token, 1);
}

function parseRgb(inner: string): Color {
  const { tokens, alphaToken } = splitArgs(inner, 3);
  const parts = tokens.map((t) => parseComponent(t, 255));
  const alpha = parseAlphaComponent(alphaToken);
  return {
    space: 'srgb',
    coords: parts.map((p) => p.value),
    alpha: alpha.value,
    missing: [...parts.map((p) => p.missing), alpha.missing].slice(0, 3),
  };
}

function parseHsl(inner: string): Color {
  const { tokens, alphaToken } = splitArgs(inner, 3);
  const hue = parseHueComponent(tokens[0]!);
  const sat = parseComponent(tokens[1]!, 100);
  const light = parseComponent(tokens[2]!, 100);
  const alpha = parseAlphaComponent(alphaToken);
  return {
    space: 'hsl',
    coords: [hue.value, sat.value, light.value],
    alpha: alpha.value,
    missing: [hue.missing, sat.missing, light.missing],
  };
}

function parseHwb(inner: string): Color {
  const { tokens, alphaToken } = splitArgs(inner, 3);
  const hue = parseHueComponent(tokens[0]!);
  const white = parseComponent(tokens[1]!, 100);
  const black = parseComponent(tokens[2]!, 100);
  const alpha = parseAlphaComponent(alphaToken);
  return {
    space: 'hwb',
    coords: [hue.value, white.value, black.value],
    alpha: alpha.value,
    missing: [hue.missing, white.missing, black.missing],
  };
}

function parseLab(inner: string): Color {
  const { tokens, alphaToken } = splitArgs(inner, 3);
  const l = parseComponent(tokens[0]!, 100);
  const a = parseComponent(tokens[1]!, 125);
  const b = parseComponent(tokens[2]!, 125);
  const alpha = parseAlphaComponent(alphaToken);
  return {
    space: 'lab',
    coords: [l.value, a.value, b.value],
    alpha: alpha.value,
    missing: [l.missing, a.missing, b.missing],
  };
}

function parseLch(inner: string): Color {
  const { tokens, alphaToken } = splitArgs(inner, 3);
  const l = parseComponent(tokens[0]!, 100);
  const c = parseComponent(tokens[1]!, 150);
  const h = parseHueComponent(tokens[2]!);
  const alpha = parseAlphaComponent(alphaToken);
  return {
    space: 'lch',
    coords: [l.value, c.value, h.value],
    alpha: alpha.value,
    missing: [l.missing, c.missing, h.missing],
  };
}

function parseOklab(inner: string): Color {
  const { tokens, alphaToken } = splitArgs(inner, 3);
  const l = parseComponent(tokens[0]!, 1);
  const a = parseComponent(tokens[1]!, 0.4);
  const b = parseComponent(tokens[2]!, 0.4);
  const alpha = parseAlphaComponent(alphaToken);
  return {
    space: 'oklab',
    coords: [l.value, a.value, b.value],
    alpha: alpha.value,
    missing: [l.missing, a.missing, b.missing],
  };
}

function parseOklch(inner: string): Color {
  const { tokens, alphaToken } = splitArgs(inner, 3);
  const l = parseComponent(tokens[0]!, 1);
  const c = parseComponent(tokens[1]!, 0.4);
  const h = parseHueComponent(tokens[2]!);
  const alpha = parseAlphaComponent(alphaToken);
  return {
    space: 'oklch',
    coords: [l.value, c.value, h.value],
    alpha: alpha.value,
    missing: [l.missing, c.missing, h.missing],
  };
}

function parseCmyk(inner: string): Color {
  const { tokens, alphaToken } = splitArgs(inner, 4);
  const parts = tokens.map((t) => parseComponent(t, 1));
  const alpha = parseAlphaComponent(alphaToken);
  return {
    space: 'cmyk',
    coords: parts.map((p) => p.value),
    alpha: alpha.value,
    missing: parts.map((p) => p.missing),
  };
}

/**
 * Parses CSS Color 4's hex, rgb(), hsl(), hwb(), lab(), lch(), oklab() and
 * oklch() syntaxes (legacy comma syntax where the specification allows it,
 * `none`, percentages, hue units) and CSS Color 5's `device-cmyk()`.
 * Anything else -- including named colours -- is refused, per this tool's
 * own stated `limits`. Throws `ColorError` naming the problem, never
 * repeating the input text.
 */
export function parseColor(text: string): Color {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new ColorError('colour text is empty');
  if (trimmed.startsWith('#')) return parseHex(trimmed);
  const match = FUNC_RE.exec(trimmed);
  if (!match) throw new ColorError('is not a recognised hex or function colour syntax');
  const name = match[1]!.toLowerCase();
  const inner = match[2]!;
  switch (name) {
    case 'rgb':
    case 'rgba':
      return parseRgb(inner);
    case 'hsl':
    case 'hsla':
      return parseHsl(inner);
    case 'hwb':
      return parseHwb(inner);
    case 'lab':
      return parseLab(inner);
    case 'lch':
      return parseLch(inner);
    case 'oklab':
      return parseOklab(inner);
    case 'oklch':
      return parseOklch(inner);
    case 'device-cmyk':
      return parseCmyk(inner);
    default:
      throw new ColorError(`"${name}" is not a supported colour function`);
  }
}

// --- Serialising --------------------------------------------------------

function fmt(n: number, decimals: number): string {
  if (!Number.isFinite(n)) return '0';
  const factor = 10 ** decimals;
  let v = Math.round(n * factor) / factor;
  if (Object.is(v, -0)) v = 0;
  let s = v.toFixed(Math.max(0, decimals));
  if (decimals > 0 && s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '' || s === '-' ? '0' : s;
}

export interface SerializeOptions {
  /** Decimal places for non-8-bit components. Default 3. */
  precision?: number;
  /** Use the legacy comma syntax for formats that define one (rgb, hsl, device-cmyk). Default false. */
  legacy?: boolean;
}

function hex2Digits(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0');
}

function serializeHex(color: Color): string {
  const srgb = color.space === 'srgb' ? color : convertColor(color, 'srgb');
  const base = `#${hex2Digits(srgb.coords[0]!)}${hex2Digits(srgb.coords[1]!)}${hex2Digits(srgb.coords[2]!)}`;
  return srgb.alpha >= 1 ? base : `${base}${hex2Digits(srgb.alpha * 255)}`;
}

function serializeRgb(color: Color, opts: Required<SerializeOptions>): string {
  const srgb = color.space === 'srgb' ? color : convertColor(color, 'srgb');
  const [r, g, b] = srgb.coords.map((c) => fmt(Math.round(c), 0));
  if (opts.legacy) {
    return srgb.alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgb(${r}, ${g}, ${b}, ${fmt(srgb.alpha, opts.precision)})`;
  }
  return srgb.alpha >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${fmt(srgb.alpha, opts.precision)})`;
}

function serializeHslLike(color: Color, name: 'hsl' | 'hwb', opts: Required<SerializeOptions>): string {
  const c = color.space === name ? color : convertColor(color, name);
  const h = fmt(c.coords[0]!, opts.precision);
  const s = fmt(c.coords[1]!, opts.precision);
  const l = fmt(c.coords[2]!, opts.precision);
  if (name === 'hwb') {
    return c.alpha >= 1 ? `hwb(${h} ${s}% ${l}%)` : `hwb(${h} ${s}% ${l}% / ${fmt(c.alpha, opts.precision)})`;
  }
  if (opts.legacy) {
    return c.alpha >= 1 ? `hsl(${h}, ${s}%, ${l}%)` : `hsl(${h}, ${s}%, ${l}%, ${fmt(c.alpha, opts.precision)})`;
  }
  return c.alpha >= 1 ? `hsl(${h} ${s}% ${l}%)` : `hsl(${h} ${s}% ${l}% / ${fmt(c.alpha, opts.precision)})`;
}

function serializeLabLike(color: Color, name: 'lab' | 'lch', opts: Required<SerializeOptions>): string {
  const c = color.space === name ? color : convertColor(color, name);
  const l = `${fmt(c.coords[0]!, opts.precision)}%`;
  const second = fmt(c.coords[1]!, opts.precision);
  const third = name === 'lab' ? fmt(c.coords[2]!, opts.precision) : fmt(c.coords[2]!, opts.precision);
  return c.alpha >= 1
    ? `${name}(${l} ${second} ${third})`
    : `${name}(${l} ${second} ${third} / ${fmt(c.alpha, opts.precision)})`;
}

function serializeOklabLike(color: Color, name: 'oklab' | 'oklch', opts: Required<SerializeOptions>): string {
  const c = color.space === name ? color : convertColor(color, name);
  const l = fmt(c.coords[0]!, opts.precision);
  const second = fmt(c.coords[1]!, opts.precision);
  const third = fmt(c.coords[2]!, opts.precision);
  return c.alpha >= 1
    ? `${name}(${l} ${second} ${third})`
    : `${name}(${l} ${second} ${third} / ${fmt(c.alpha, opts.precision)})`;
}

function serializeCmyk(color: Color, opts: Required<SerializeOptions>): string {
  const c = color.space === 'cmyk' ? color : convertColor(color, 'cmyk');
  const pct = c.coords.map((v) => `${fmt(v * 100, opts.precision)}%`);
  if (opts.legacy) {
    const nums = c.coords.map((v) => fmt(v, opts.precision));
    return `device-cmyk(${nums.join(', ')})`;
  }
  return c.alpha >= 1
    ? `device-cmyk(${pct.join(' ')})`
    : `device-cmyk(${pct.join(' ')} / ${fmt(c.alpha, opts.precision)})`;
}

/**
 * Writes `color` (converted first if needed) as `format` text. `precision`
 * controls decimal places for non-8-bit components (default 3); `legacy`
 * requests the comma syntax for the formats that define one (rgb, hsl,
 * device-cmyk) -- hwb, lab, lch, oklab and oklch have no legacy form and
 * ignore the flag.
 */
export function serializeColor(color: Color, format: ColorFormat, options?: SerializeOptions): string {
  const opts: Required<SerializeOptions> = { precision: options?.precision ?? 3, legacy: options?.legacy ?? false };
  switch (format) {
    case 'hex':
      return serializeHex(color);
    case 'rgb':
      return serializeRgb(color, opts);
    case 'hsl':
      return serializeHslLike(color, 'hsl', opts);
    case 'hwb':
      return serializeHslLike(color, 'hwb', opts);
    case 'lab':
      return serializeLabLike(color, 'lab', opts);
    case 'lch':
      return serializeLabLike(color, 'lch', opts);
    case 'oklab':
      return serializeOklabLike(color, 'oklab', opts);
    case 'oklch':
      return serializeOklabLike(color, 'oklch', opts);
    case 'cmyk':
      return serializeCmyk(color, opts);
  }
}

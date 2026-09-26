import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it, expect, vi } from 'vitest';
import { converter } from 'culori';
import ColorJs from 'colorjs.io';
import { convertAll, ColorConverterError, FORMATS } from '../src/index';
import { parseColor, convertColor, gamutMapToSrgb, inSrgbGamut, MATRICES, type Color } from '../src/color-space';
import { readUpstreamShas, gitBlobShaOfFile } from './upstream';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures', 'csswg-color-4');

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

// --- Matrix extraction from the vendored CSS Color 4 sample code ----------

function extractFunctionBody(src: string, fnName: string): string {
  const marker = `function ${fnName}(`;
  const start = src.indexOf(marker);
  if (start === -1) throw new Error(`function ${fnName} was not found in the vendored sample code`);
  const braceStart = src.indexOf('{', start);
  let depth = 0;
  let i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return src.slice(braceStart, i + 1);
}

function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Evaluates a numeric arithmetic expression from the trusted, fetched, pinned vendored spec text. Test-only. */
function evalExpr(expr: string): number {
  return Function(`"use strict"; return (${expr});`)() as number;
}

/** Every 3x3 `[ [a,b,c], [d,e,f], [g,h,i] ]` matrix literal found, in source order, each row evaluated to numbers. */
function extractMatrices3x3(body: string): number[][][] {
  const re = /\[\s*\[([^\]]*)\]\s*,\s*\[([^\]]*)\]\s*,\s*\[([^\]]*)\]\s*,?\s*\]/g;
  const out: number[][][] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    out.push([
      splitTopLevel(m[1]!).map(evalExpr),
      splitTopLevel(m[2]!).map(evalExpr),
      splitTopLevel(m[3]!).map(evalExpr),
    ]);
  }
  return out;
}

function extractWhitePoint(src: string, name: string): number[] {
  const re = new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`);
  const m = re.exec(src);
  if (!m) throw new Error(`white point ${name} was not found in the vendored sample code`);
  return splitTopLevel(m[1]!).map(evalExpr);
}

function expectMatrixClose(actual: readonly (readonly number[])[], expected: number[][], label: string): void {
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      expect(actual[r]![c], `${label}[${r}][${c}]`).toBeCloseTo(expected[r]![c]!, 9);
    }
  }
}

it('the conversion matrices are exactly the ones in the CSS Color 4 sample code at the pinned commit', () => {
  const src = readFileSync(join(fixturesDir, 'conversions.js'), 'utf8');

  const d50 = extractWhitePoint(src, 'D50');
  const d65 = extractWhitePoint(src, 'D65');
  d50.forEach((v, i) => expect(v, `D50[${i}]`).toBeCloseTo(MATRICES.D50[i]!, 9));
  d65.forEach((v, i) => expect(v, `D65[${i}]`).toBeCloseTo(MATRICES.D65[i]!, 9));

  const linToXyz = extractMatrices3x3(extractFunctionBody(src, 'lin_sRGB_to_XYZ'));
  expect(linToXyz).toHaveLength(1);
  expectMatrixClose(linToXyz[0]!, MATRICES.lin_sRGB_to_XYZ as unknown as number[][], 'lin_sRGB_to_XYZ');

  const xyzToLin = extractMatrices3x3(extractFunctionBody(src, 'XYZ_to_lin_sRGB'));
  expect(xyzToLin).toHaveLength(1);
  expectMatrixClose(xyzToLin[0]!, MATRICES.XYZ_to_lin_sRGB as unknown as number[][], 'XYZ_to_lin_sRGB');

  const d65to50 = extractMatrices3x3(extractFunctionBody(src, 'D65_to_D50'));
  expect(d65to50).toHaveLength(1);
  expectMatrixClose(d65to50[0]!, MATRICES.D65_to_D50 as unknown as number[][], 'D65_to_D50');

  const d50to65 = extractMatrices3x3(extractFunctionBody(src, 'D50_to_D65'));
  expect(d50to65).toHaveLength(1);
  expectMatrixClose(d50to65[0]!, MATRICES.D50_to_D65 as unknown as number[][], 'D50_to_D65');

  const xyzToOklab = extractMatrices3x3(extractFunctionBody(src, 'XYZ_to_OKLab'));
  expect(xyzToOklab).toHaveLength(2);
  expectMatrixClose(xyzToOklab[0]!, MATRICES.XYZ_to_OKLab_XYZtoLMS as unknown as number[][], 'XYZ_to_OKLab XYZtoLMS');
  expectMatrixClose(
    xyzToOklab[1]!,
    MATRICES.XYZ_to_OKLab_LMStoOKLab as unknown as number[][],
    'XYZ_to_OKLab LMStoOKLab',
  );

  const oklabToXyz = extractMatrices3x3(extractFunctionBody(src, 'OKLab_to_XYZ'));
  expect(oklabToXyz).toHaveLength(2);
  // The sample code declares LMStoXYZ first, then OKLabtoLMS.
  expectMatrixClose(oklabToXyz[0]!, MATRICES.OKLab_to_XYZ_LMStoXYZ as unknown as number[][], 'OKLab_to_XYZ LMStoXYZ');
  expectMatrixClose(
    oklabToXyz[1]!,
    MATRICES.OKLab_to_XYZ_OKLabtoLMS as unknown as number[][],
    'OKLab_to_XYZ OKLabtoLMS',
  );
});

it('conversions agree with culori and colorjs.io within the stated tolerance over 1000 seeded colours', () => {
  const toOklab = converter('oklab');
  const toLab = converter('lab');
  const toHsl = converter('hsl');
  const toHwb = converter('hwb');
  const rand = mulberry32(0xc01072);
  const TOLERANCE = 1e-3;

  for (let i = 0; i < 1000; i++) {
    const srgb255 = [rand() * 255, rand() * 255, rand() * 255] as [number, number, number];
    const srgbColor: Color = { space: 'srgb', coords: srgb255, alpha: 1, missing: [false, false, false] };
    const culoriRgb = { mode: 'rgb' as const, r: srgb255[0] / 255, g: srgb255[1] / 255, b: srgb255[2] / 255 };
    const cjs = new ColorJs('srgb', [srgb255[0] / 255, srgb255[1] / 255, srgb255[2] / 255]);

    const oklab = convertColor(srgbColor, 'oklab');
    const culoriOklab = toOklab(culoriRgb);
    expect(Math.abs(oklab.coords[0]! - culoriOklab.l)).toBeLessThan(TOLERANCE);
    expect(Math.abs(oklab.coords[1]! - culoriOklab.a)).toBeLessThan(TOLERANCE);
    expect(Math.abs(oklab.coords[2]! - culoriOklab.b)).toBeLessThan(TOLERANCE);

    const lab = convertColor(srgbColor, 'lab');
    const culoriLab = toLab(culoriRgb);
    expect(Math.abs(lab.coords[0]! - culoriLab.l)).toBeLessThan(TOLERANCE * 100);
    expect(Math.abs(lab.coords[1]! - culoriLab.a)).toBeLessThan(TOLERANCE * 100);
    expect(Math.abs(lab.coords[2]! - culoriLab.b)).toBeLessThan(TOLERANCE * 100);

    const hsl = convertColor(srgbColor, 'hsl');
    const culoriHsl = toHsl(culoriRgb);
    if (culoriHsl.h !== undefined && !Number.isNaN(culoriHsl.h)) {
      const culoriHue = culoriHsl.h;
      const dh = Math.min(Math.abs(hsl.coords[0]! - culoriHue), 360 - Math.abs(hsl.coords[0]! - culoriHue));
      expect(dh).toBeLessThan(1);
    }
    expect(Math.abs(hsl.coords[1]! - culoriHsl.s * 100)).toBeLessThan(0.5);
    expect(Math.abs(hsl.coords[2]! - culoriHsl.l * 100)).toBeLessThan(0.5);

    const hwb = convertColor(srgbColor, 'hwb');
    const culoriHwb = toHwb(culoriRgb);
    expect(Math.abs(hwb.coords[1]! - culoriHwb.w * 100)).toBeLessThan(0.5);
    expect(Math.abs(hwb.coords[2]! - culoriHwb.b * 100)).toBeLessThan(0.5);

    const cjsOklab = cjs.to('oklab').coords;
    expect(Math.abs(oklab.coords[0]! - cjsOklab[0]!)).toBeLessThan(TOLERANCE);
    expect(Math.abs(oklab.coords[1]! - cjsOklab[1]!)).toBeLessThan(TOLERANCE);
    expect(Math.abs(oklab.coords[2]! - cjsOklab[2]!)).toBeLessThan(TOLERANCE);
  }
});

it('gamut mapping agrees with the colorjs.io css method within one step of 255', () => {
  const rand = mulberry32(0x9a2011);
  let tested = 0;
  for (let i = 0; i < 300 && tested < 100; i++) {
    // Sample OKLCH colours likely to be out of gamut: high chroma.
    const l = rand();
    const c = 0.2 + rand() * 0.3;
    const h = rand() * 360;
    const color: Color = { space: 'oklch', coords: [l, c, h], alpha: 1, missing: [false, false, false] };
    if (inSrgbGamut(color)) continue;
    tested++;
    const mapped = gamutMapToSrgb(color);
    const cjs = new ColorJs('oklch', [l, c, h]);
    const cjsMapped = cjs
      .toGamut({ space: 'srgb', method: 'css' })
      .to('srgb')
      .coords.map((v) => (v ?? 0) * 255);
    expect(Math.abs(mapped.coords[0]! - cjsMapped[0]!)).toBeLessThanOrEqual(1);
    expect(Math.abs(mapped.coords[1]! - cjsMapped[1]!)).toBeLessThanOrEqual(1);
    expect(Math.abs(mapped.coords[2]! - cjsMapped[2]!)).toBeLessThanOrEqual(1);
  }
  expect(tested).toBeGreaterThan(10);
});

it('every format of one input parses back to the same colour', () => {
  const original = parseColor('#3366ff');
  for (const format of FORMATS) {
    const result = convertAll('#3366ff');
    const entry = result.formats.find((f) => f.format === format)!;
    const reparsed = parseColor(entry.value);
    const back = convertColor(reparsed, 'srgb');
    const originalSrgb = convertColor(original, 'srgb');
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(back.coords[i]! - originalSrgb.coords[i]!), `${format}: ${entry.value}`).toBeLessThanOrEqual(1);
    }
  }
});

it('every vendored upstream file matches the git blob SHA recorded in UPSTREAM.md', () => {
  const upstreamMd = readFileSync(join(fixturesDir, 'UPSTREAM.md'), 'utf8');
  const entries = readUpstreamShas(upstreamMd);
  expect(entries.length).toBeGreaterThan(0);
  for (const entry of entries) {
    const path = join(here, '..', entry.path);
    expect(gitBlobShaOfFile(path), entry.path).toBe(entry.sha);
  }
});

it('nothing is written to the console while converting', () => {
  const spies = ['log', 'warn', 'error', 'info', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    convertAll('#3366ff');
    convertAll('oklch(70% 0.4 150)');
    convertAll('not a colour at all');
  } catch {
    // Expected for the last, invalid input; the assertion below is what matters.
  } finally {
    for (const s of spies) {
      expect(s).not.toHaveBeenCalled();
      s.mockRestore();
    }
  }
});

it('throws ColorConverterError, not a generic error, on malformed input', () => {
  expect(() => convertAll('not a colour at all')).toThrow(ColorConverterError);
});

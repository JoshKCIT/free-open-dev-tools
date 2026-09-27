/**
 * Turns a QR matrix into pixel buffers a decoder can read, independent of
 * this package's own svg.ts/png.ts renderers -- so a decode test proves
 * `generateQr`'s own `modules` output, not a renderer's fidelity to it.
 */
import type { Matrix } from '../src/svg';

export interface Raster {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel -- what jsQR expects. */
  rgba: Uint8ClampedArray;
  /** One byte of luminance per pixel -- what ZXing's RGBLuminanceSource expects. */
  luminance: Uint8ClampedArray;
}

export function rasterizeMatrix(matrix: Matrix, marginModules: number, scale: number): Raster {
  const total = matrix.size + marginModules * 2;
  const width = total * scale;
  const height = width;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const luminance = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / scale) - marginModules;
    for (let x = 0; x < width; x++) {
      const col = Math.floor(x / scale) - marginModules;
      const dark =
        row >= 0 && row < matrix.size && col >= 0 && col < matrix.size && matrix.modules[row * matrix.size + col] === 1;
      const value = dark ? 0 : 255;
      const idx = y * width + x;
      luminance[idx] = value;
      const o = idx * 4;
      rgba[o] = value;
      rgba[o + 1] = value;
      rgba[o + 2] = value;
      rgba[o + 3] = 255;
    }
  }
  return { width, height, rgba, luminance };
}

/** A small hand-ported mulberry32 PRNG (same algorithm this project already
 * uses in other tools, e.g. tools/mock-data), so the 200-seeded-payload
 * test is reproducible without a runtime dependency. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

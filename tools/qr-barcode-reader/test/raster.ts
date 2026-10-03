/**
 * Turns a square module matrix into pixel buffers a decoder can read, independent of any renderer this repository
 * ships -- so a read-back test proves the matrix the writer produced, not a renderer's fidelity to it. A matrix is a
 * `size` and a row-major list of 0 and 1 values (1 is a dark module).
 */
export interface Matrix {
  size: number;
  modules: ArrayLike<number>;
}

export interface Raster {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel -- what the reading engine and jsQR expect. */
  rgba: Uint8ClampedArray;
  /** One byte of luminance per pixel -- what the ZXing library's luminance source expects. */
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

/** A small hand-ported mulberry32 PRNG, so seeded payloads and degradations are reproducible without a dependency. */
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

/**
 * Rasterises an SVG written as a list of `<rect x=".." y="0" width=".." height=".." fill="#rrggbb"/>` bars at an integer
 * scale into a picture of `rows` pixel rows, with the quiet zones already baked into the SVG's own coordinates -- so a
 * read-back test proves the rendered SVG, not just the bar and space string behind it. A full-size background rectangle
 * without an `x` attribute is white and is not drawn.
 */
export function rasterizeBarsSvg(svg: string, scale = 3, rows = 30): Raster {
  const widthMatch = /<svg[^>]*width="(\d+)"/.exec(svg);
  if (!widthMatch) throw new Error('no width found in svg');
  const svgWidth = Number(widthMatch[1]);
  const width = svgWidth * scale;
  const height = rows;
  const luminance = new Uint8ClampedArray(width * height).fill(255);

  const rectRe =
    /<rect x="(-?\d+(?:\.\d+)?)" y="0" width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)" fill="(#[0-9a-fA-F]{6})"\/>/g;
  let m: RegExpExecArray | null;
  while ((m = rectRe.exec(svg))) {
    const x = Math.round(Number(m[1]) * scale);
    const w = Math.round(Number(m[2]) * scale);
    for (let row = 0; row < height; row++) {
      for (let col = Math.max(0, x); col < Math.min(width, x + w); col++) {
        luminance[row * width + col] = 0;
      }
    }
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < luminance.length; i++) {
    const o = i * 4;
    rgba[o] = luminance[i]!;
    rgba[o + 1] = luminance[i]!;
    rgba[o + 2] = luminance[i]!;
    rgba[o + 3] = 255;
  }
  return { width, height, rgba, luminance };
}

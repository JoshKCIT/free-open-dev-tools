/**
 * Rasterises this package's own SVG `<rect>` bar list (never the raw module
 * string) at an integer scale into a luminance buffer of 30 rows, with the
 * quiet zones already baked into the SVG's own coordinates -- so a decode
 * test proves the rendered SVG, not just the internal bar/space string.
 */
export interface Raster {
  width: number;
  height: number;
  luminance: Uint8ClampedArray;
}

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
  return { width, height, luminance };
}

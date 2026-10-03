import { it, expect } from 'vitest';
import { svgSize, MAX_SVG_PIXELS, SvgSizeError } from '../src/svg-size';

/**
 * Top-level `it(...)` calls only. The expected sizes are worked by hand from
 * CSS Values and Units Level 4 (absolute units: 1in = 96px = 72pt = 6pc =
 * 25.4mm = 2.54cm) and from the way a browser sizes an SVG shown as an image
 * (width and height, else the viewBox, else 300 by 150).
 */

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const svg = (attrs: string): string => `<svg ${NS} ${attrs}></svg>`;

it('SVG size comes from width and height in CSS absolute units, then the viewBox, then 300 by 150, and is refused over 40000000 pixels', () => {
  expect(MAX_SVG_PIXELS).toBe(40_000_000);
  const size = (attrs: string): [number, number] => {
    const s = svgSize(svg(attrs));
    return [s.width, s.height];
  };

  // Width and height, unitless and in px.
  expect(size('width="100" height="50"')).toEqual([100, 50]);
  expect(size('width="100px" height="50px"')).toEqual([100, 50]);
  expect(size("width='64' height='32'")).toEqual([64, 32]);
  expect(size('width=" 20 " height="10"')).toEqual([20, 10]);
  expect(size('width="1.5e1" height="+10.0"')).toEqual([15, 10]);
  expect(size('width=".5e2" height="5."')).toEqual([50, 5]);

  // Absolute units: 1in = 96, 72pt = 96, 6pc = 96, 25.4mm = 96, 2.54cm = 96.
  expect(size('width="1in" height="1in"')).toEqual([96, 96]);
  expect(size('width="72pt" height="36pt"')).toEqual([96, 48]);
  expect(size('width="6pc" height="3pc"')).toEqual([96, 48]);
  expect(size('width="25.4mm" height="12.7mm"')).toEqual([96, 48]);
  expect(size('width="2.54cm" height="1.27cm"')).toEqual([96, 48]);
  expect(size('width="10mm" height="10mm"')).toEqual([38, 38]); // 37.795 rounds to 38
  expect(size('width="2IN" height="1In"')).toEqual([192, 96]); // units are not case sensitive

  // Percentages, relative units and junk are missing values: the viewBox size, then 300 by 150.
  expect(size('width="100%" height="100%" viewBox="0 0 40 20"')).toEqual([40, 20]);
  expect(size('width="2em" height="3ex" viewBox="0 0 40 20"')).toEqual([40, 20]);
  expect(size('viewBox="0 0 40 20"')).toEqual([40, 20]);
  expect(size('viewBox="-5,-5,60,30"')).toEqual([60, 30]);
  expect(size('viewBox="0 0 12.4 7.6"')).toEqual([12, 8]);
  expect(size('')).toEqual([300, 150]);
  expect(size('width="100%" height="100%"')).toEqual([300, 150]);
  expect(size('width="abc" height="-4" viewBox="0 0 0 5"')).toEqual([300, 150]); // zero and negative sizes are not sizes

  // One side given: the other follows the viewBox ratio, or falls back to the default side.
  expect(size('width="80" viewBox="0 0 40 20"')).toEqual([80, 40]);
  expect(size('height="30" viewBox="0 0 40 20"')).toEqual([60, 30]);
  expect(size('width="80"')).toEqual([80, 150]);
  expect(size('height="30"')).toEqual([300, 30]);

  // Only the first element's own attributes count, never a nested svg or a similar name.
  const nested = `<?xml version="1.0"?><!-- c --><svg ${NS} viewBox="0 0 8 4"><svg width="999" height="999"><rect width="9999"/></svg></svg>`;
  expect(svgSize(nested)).toEqual({ width: 8, height: 4 });
  expect(svgSize(`<svg ${NS} data-width="500" stroke-width="7" height="20" width="10"/>`)).toEqual({
    width: 10,
    height: 20,
  });
  expect(svgSize(`<svg:svg xmlns:svg="http://www.w3.org/2000/svg" width="12" height="6"/>`)).toEqual({
    width: 12,
    height: 6,
  });
  expect(svgSize(`<svg ${NS} width="__proto__" height="constructor"/>`)).toEqual({ width: 300, height: 150 });

  // The limit is on the pixel count: exactly 40,000,000 is allowed, one more is refused before any drawing.
  expect(size('width="8000" height="5000"')).toEqual([8000, 5000]);
  for (const attrs of [
    'width="10000" height="5000"',
    'width="8000" height="5001"',
    'width="1000000" height="1000000"',
    'width="1e300" height="1e300"',
    'width="5in" height="5in" viewBox="0 0 1 1"',
  ]) {
    let caught: unknown;
    try {
      svgSize(svg(attrs));
    } catch (err) {
      caught = err;
    }
    // 5in by 5in is 480 by 480 and is fine: only the others are refused.
    if (attrs.startsWith('width="5in"')) expect(caught, attrs).toBeUndefined();
    else {
      expect(caught, attrs).toBeInstanceOf(SvgSizeError);
      expect((caught as Error).message, attrs).toContain('40,000,000');
    }
  }
  // The first element must be an svg element.
  expect(() => svgSize('<html width="10" height="10"/>')).toThrow(SvgSizeError);
  expect(() => svgSize('')).toThrow(SvgSizeError);
  expect(() => svgSize('<svg width="10"')).toThrow(SvgSizeError);
});

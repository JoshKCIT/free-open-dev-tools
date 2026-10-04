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

it('SVG size comes from width and height in CSS absolute units, then the viewBox, then 300 by 150, and is refused over 16777216 pixels', () => {
  expect(MAX_SVG_PIXELS).toBe(16_777_216);
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

  // Percentages, other relative units and junk are missing values: the viewBox size, then 300 by 150.
  expect(size('width="100%" height="100%" viewBox="0 0 40 20"')).toEqual([40, 20]);
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

  // The limit is on the pixel count: exactly 16,777,216 (4096 by 4096) is allowed, one more is refused before any drawing.
  expect(size('width="4096" height="4096"')).toEqual([4096, 4096]);
  expect(size('width="8192" height="2048"')).toEqual([8192, 2048]);
  for (const attrs of [
    'width="10000" height="5000"',
    'width="8000" height="5000"',
    'width="4096" height="4097"',
    'width="16777217" height="1"',
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
      expect((caught as Error).message, attrs).toContain('16,777,216');
    }
  }
  // The first element must be an svg element.
  expect(() => svgSize('<html width="10" height="10"/>')).toThrow(SvgSizeError);
  expect(() => svgSize('')).toThrow(SvgSizeError);
  expect(() => svgSize('<svg width="10"')).toThrow(SvgSizeError);
});

it('SVG size reads em at 16 pixels and ex at 8 pixels, the initial font size a browser uses', () => {
  const size = (attrs: string): [number, number] => {
    const s = svgSize(svg(attrs));
    return [s.width, s.height];
  };
  // 1em is 16 pixels and 1ex is half of that, so a browser draws width="10em" height="10em" at 160 by 160 (and the
  // page, which used to call these sizes missing, drew it stretched to 300 by 150).
  expect(size('width="10em" height="10em"')).toEqual([160, 160]);
  expect(size('width="10ex" height="5ex"')).toEqual([80, 40]);
  expect(size('width="2.5em" height="1em"')).toEqual([40, 16]);
  expect(size('width="0.5EM" height="1Ex"')).toEqual([8, 8]);
  expect(size('width="2em" height="3ex" viewBox="0 0 40 20"')).toEqual([32, 24]);
  // One side given: the other follows the viewBox ratio, or falls back to the default side.
  expect(size('width="10em" viewBox="0 0 40 20"')).toEqual([160, 80]);
  expect(size('height="10ex" viewBox="0 0 40 20"')).toEqual([160, 80]);
  expect(size('width="10em"')).toEqual([160, 150]);
  // Mixed with the absolute units.
  expect(size('width="1em" height="12pt"')).toEqual([16, 16]);
  // Other relative units and words that only end like these are still missing values.
  expect(size('width="10rem" height="10rem"')).toEqual([300, 150]);
  expect(size('width="10vw" height="10vh" viewBox="0 0 8 4"')).toEqual([8, 4]);
  expect(size('width="1xem" height="1 em"')).toEqual([300, 150]);
  expect(size('width="-3em" height="0em"')).toEqual([300, 150]);
  // The size limit applies to the converted size: 1100em is 17,600 pixels, and 17,600 by 1,000 is over the limit.
  expect(() => svgSize(svg('width="1100em" height="62.5em"'))).toThrow(SvgSizeError);
  expect(svgSize(svg('width="256em" height="256em"'))).toEqual({ width: 4096, height: 4096 });
});

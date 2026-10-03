import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { compareImages, ImageCompareError, padPixels, planCompare, shareText } from '../src/index';
import { decodeRgbaPng } from './png-decode';
import { PIXELMATCH_1A_PNG_BASE64, PIXELMATCH_1B_PNG_BASE64 } from './fixtures/pixelmatch-vectors';

/**
 * Top-level `it(...)` calls, never nested in `describe(...)`: the project's verify scripts match required titles by
 * exact full name.
 *
 * Expected values come from pixelmatch's documented semantics (its README at the tag v7.2.0 and the two papers it
 * cites), worked out by hand in the comments from the YIQ formula, from its published test vectors, and from integer
 * arithmetic -- never from this package's own output. The package under test calls pixelmatch, so a test that took
 * the count pixelmatch returns for its own input as the answer would prove nothing.
 *
 * pixelmatch's colour difference for two opaque colours (Kotsarenko and Ramos 2010, as the source at 7.2.0 writes it):
 *   dr, dg, db = the channel differences
 *   y = dr * 0.29889531 + dg * 0.58662247 + db * 0.11448223
 *   i = dr * 0.59597799 - dg * 0.27417610 - db * 0.32180189
 *   q = dr * 0.21147017 - dg * 0.52261711 + db * 0.31114694
 *   delta = 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q
 * and a pixel counts when delta > maxDelta, where maxDelta = 35215 * threshold * threshold.
 */

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const px = (r: number, g: number, b: number, a = 255) => new Uint8ClampedArray([r, g, b, a]);

/** The same formula written again here from the coefficients, for opaque colours only: a second implementation. */
function yiqDelta(a: number[], b: number[]): number {
  const dr = a[0]! - b[0]!;
  const dg = a[1]! - b[1]!;
  const db = a[2]! - b[2]!;
  const y = dr * 0.29889531 + dg * 0.58662247 + db * 0.11448223;
  const i = dr * 0.59597799 - dg * 0.2741761 - db * 0.32180189;
  const q = dr * 0.21147017 - dg * 0.52261711 + db * 0.31114694;
  return 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q;
}

function count(a: Uint8ClampedArray, b: Uint8ClampedArray, threshold: number): number {
  return compareImages(a, b, 1, 1, { threshold, includeAA: false }).differing;
}

it('pixelmatch threshold boundaries match its documented YIQ semantics one step either side', () => {
  // Black against white: y = -255 * (0.29889531 + 0.58662247 + 0.11448223) = -255.0000026, i and q are 0 (their
  // coefficients sum to 0), so delta = 0.5053 * 255.0000026^2 = 32857.13.
  //   threshold 0.9659: maxDelta = 35215 * 0.9659^2 = 32854.29  -> 32857.13 > 32854.29, counts
  //   threshold 0.966:  maxDelta = 35215 * 0.966^2  = 32861.09  -> 32857.13 < 32861.09, does not count
  expect(count(px(0, 0, 0), px(255, 255, 255), 0.9659)).toBe(1);
  expect(count(px(0, 0, 0), px(255, 255, 255), 0.966)).toBe(0);

  // Gray 100 against gray 110: y = -10 * 1.00000001, delta = 0.5053 * 100.0000002 = 50.53.
  //   threshold 0.0378: maxDelta = 35215 * 0.0378^2 = 50.3166 -> 50.53 > 50.3166, counts
  //   threshold 0.0379: maxDelta = 35215 * 0.0379^2 = 50.5832 -> 50.53 < 50.5832, does not count
  expect(count(px(100, 100, 100), px(110, 110, 110), 0.0378)).toBe(1);
  expect(count(px(100, 100, 100), px(110, 110, 110), 0.0379)).toBe(0);

  // Gray 128 against gray 129: delta = 0.5053 * 1.00000002 = 0.5053.
  //   threshold 0.0037: maxDelta = 35215 * 0.0037^2 = 0.48209 -> 0.5053 > 0.48209, counts
  //   threshold 0.0038: maxDelta = 35215 * 0.0038^2 = 0.50850 -> 0.5053 < 0.50850, does not count
  expect(count(px(128, 128, 128), px(129, 129, 129), 0.0037)).toBe(1);
  expect(count(px(128, 128, 128), px(129, 129, 129), 0.0038)).toBe(0);

  // At the default 0.1, maxDelta = 35215 * 0.01 = 352.15.
  //   gray 100 against 126 (difference 26): delta = 0.5053 * 26.0000003^2 = 341.58 < 352.15, does not count
  //   gray 100 against 127 (difference 27): delta = 0.5053 * 27.0000003^2 = 368.36 > 352.15, counts
  expect(count(px(100, 100, 100), px(126, 126, 126), 0.1)).toBe(0);
  expect(count(px(100, 100, 100), px(127, 127, 127), 0.1)).toBe(1);

  // The second implementation above agrees with each hand worked delta, and with the count at both edges.
  expect(yiqDelta([0, 0, 0], [255, 255, 255])).toBeCloseTo(32857.13, 2);
  expect(yiqDelta([100, 100, 100], [110, 110, 110])).toBeCloseTo(50.53, 2);
  expect(yiqDelta([128, 128, 128], [129, 129, 129])).toBeCloseTo(0.5053, 4);
  expect(yiqDelta([100, 100, 100], [126, 126, 126])).toBeCloseTo(341.58, 2);
  expect(yiqDelta([100, 100, 100], [127, 127, 127])).toBeCloseTo(368.36, 2);
  const colours: number[][] = [
    [0, 0, 0],
    [255, 255, 255],
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [12, 200, 90],
    [200, 12, 90],
    [100, 100, 100],
    [130, 120, 110],
  ];
  for (const c1 of colours) {
    for (const c2 of colours) {
      if (c1 === c2) continue;
      for (const threshold of [0, 0.05, 0.1, 0.3, 0.5, 0.9, 1]) {
        const expected = yiqDelta(c1, c2) > 35215 * threshold * threshold ? 1 : 0;
        expect(count(px(c1[0]!, c1[1]!, c1[2]!), px(c2[0]!, c2[1]!, c2[2]!), threshold)).toBe(expected);
      }
    }
  }

  // The two ends of the scale: at 1 even black against white (32857.13 < 35215) does not count; at 0 any step does.
  expect(count(px(0, 0, 0), px(255, 255, 255), 1)).toBe(0);
  expect(count(px(128, 128, 128), px(129, 129, 129), 0)).toBe(1);
});

it('identical images give no differing pixels and a gray difference image', () => {
  // Two 2 by 2 images of black, white, gray 100 and black. The README says matching pixels are drawn as a gray blended
  // with white at alpha 0.1: value = 255 + (luma - 255) * 0.1, rounded as a clamped byte rounds (half to even).
  //   black: 255 + (0 - 255) * 0.1 = 229.5 -> 230 (the tie goes to the even byte)
  //   white: 255 + (255 - 255) * 0.1 = 255
  //   gray 100: luma = 100.000001, 255 + (100.000001 - 255) * 0.1 = 239.5000001 -> 240
  const a = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 100, 100, 100, 255, 0, 0, 0, 255]);
  const b = new Uint8ClampedArray(a);
  const result = compareImages(a, b, 2, 2, { threshold: 0.1, includeAA: false });
  expect(result.differing).toBe(0);
  expect(result.total).toBe(4);
  expect(Array.from(result.diff)).toEqual([
    230, 230, 230, 255, 255, 255, 255, 255, 240, 240, 240, 255, 230, 230, 230, 255,
  ]);
  // Even a threshold of 0 finds nothing in identical images.
  expect(compareImages(a, b, 2, 2, { threshold: 0, includeAA: true }).differing).toBe(0);
});

it('a differing pixel is drawn red and the rest are faded gray', () => {
  // Three pixels in a row: white, black against white, white. The middle one differs by far more than any threshold
  // below 0.9; the outer ones are identical and drawn as white (255) blended with itself.
  const a = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
  const b = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
  const result = compareImages(a, b, 3, 1, { threshold: 0.1, includeAA: false });
  expect(result.differing).toBe(1);
  expect(result.total).toBe(3);
  expect(Array.from(result.diff)).toEqual([255, 255, 255, 255, 255, 0, 0, 255, 255, 255, 255, 255]);
});

/** The reference for the share: hundredths of a percent, rounded half up, with BigInt so no float is involved. */
function hundredths(differing: number, total: number): bigint {
  return (2n * BigInt(differing) * 10000n + BigInt(total)) / (2n * BigInt(total));
}

function reference(differing: number, total: number): string {
  const h = hundredths(differing, total);
  if (differing > 0 && h === 0n) return 'less than 0.01 %';
  if (differing < total && h === 10000n) return 'more than 99.99 %';
  const whole = h / 100n;
  const frac = (h % 100n).toString().padStart(2, '0');
  return `${whole}.${frac} %`;
}

it('the share is exact in integers, rounded half up to two decimals, and never reads 0.00 or 100.00 when it is not', () => {
  // Hand worked: 1 of 3 is 33.333...% -> 33.33; 1 of 8 is 12.5% exactly -> 12.50.
  expect(shareText(1, 3)).toBe('33.33 %');
  expect(shareText(1, 8)).toBe('12.50 %');
  expect(shareText(7, 200)).toBe('3.50 %');
  expect(shareText(2, 3)).toBe('66.67 %');
  // Half up, not half even: 5 of 20,000 is exactly 0.025 % = 2.5 hundredths -> 0.03 (half even would give 0.02);
  // 1 of 20,000 is 0.005 % = 0.5 hundredths -> 0.01; 3 of 20,000 is 1.5 hundredths -> 0.02.
  expect(shareText(5, 20000)).toBe('0.03 %');
  expect(shareText(1, 20000)).toBe('0.01 %');
  expect(shareText(3, 20000)).toBe('0.02 %');
  // A value just under a half rounds down: 4,999 of 100,000,000 is 0.004999 % = 0.4999 hundredths -> less than 0.01.
  expect(shareText(4999, 100_000_000)).toBe('less than 0.01 %');
  // The two ends: some difference never reads 0.00, some match never reads 100.00.
  expect(shareText(1, 1_000_000)).toBe('less than 0.01 %');
  expect(shareText(999_999, 1_000_000)).toBe('more than 99.99 %');
  expect(shareText(0, 1_000_000)).toBe('0.00 %');
  expect(shareText(1_000_000, 1_000_000)).toBe('100.00 %');
  expect(shareText(0, 1)).toBe('0.00 %');
  expect(shareText(1, 1)).toBe('100.00 %');
  // 15,999,999 of 16,000,000 is 99.9999938 % -> rounds to 100.00 but a pixel matches: more than 99.99 %.
  expect(shareText(15_999_999, 16_000_000)).toBe('more than 99.99 %');
  expect(shareText(16_000_000, 16_000_000)).toBe('100.00 %');
  // Exactly 99.99 % is shown as it is: 9,999 of 10,000.
  expect(shareText(9999, 10000)).toBe('99.99 %');
  expect(shareText(1, 10000)).toBe('0.01 %');
  // A total that is not a positive whole number is refused, never turned into NaN.
  expect(() => shareText(0, 0)).toThrow(ImageCompareError);
  expect(() => shareText(5, 3)).toThrow(ImageCompareError);
  expect(() => shareText(-1, 3)).toThrow(ImageCompareError);
  expect(() => shareText(1.5, 3)).toThrow(ImageCompareError);

  // The same answers as an exact reference over many pairs (seeded, so the same every run), including every sum of
  // the form k * total / 20,000 that lands exactly on a half.
  let seed = 0x2545f491;
  const next = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let n = 0; n < 4000; n++) {
    const total = 1 + Math.floor(next() * 16_000_000);
    const differing = Math.floor(next() * (total + 1));
    expect(shareText(differing, total)).toBe(reference(differing, total));
  }
  for (let k = 1; k < 200; k++) {
    expect(shareText(k, 20000)).toBe(reference(k, 20000));
  }
});

it('images of different sizes are refused by default and padded with transparent pixels when asked', () => {
  // The default refuses and names both sizes.
  let message = '';
  try {
    planCompare({ width: 16, height: 16 }, { width: 16, height: 8 }, 'refuse');
  } catch (err) {
    expect(err).toBeInstanceOf(ImageCompareError);
    message = (err as Error).message;
  }
  expect(message).toContain('16 by 16');
  expect(message).toContain('16 by 8');
  // Equal sizes are never padded, in either mode.
  expect(planCompare({ width: 16, height: 16 }, { width: 16, height: 16 }, 'refuse')).toEqual({
    width: 16,
    height: 16,
    padded: false,
  });
  expect(planCompare({ width: 16, height: 16 }, { width: 16, height: 16 }, 'pad')).toEqual({
    width: 16,
    height: 16,
    padded: false,
  });
  // Padding takes the larger width and the larger height, so two images each smaller in one direction both grow.
  expect(planCompare({ width: 16, height: 16 }, { width: 16, height: 8 }, 'pad')).toEqual({
    width: 16,
    height: 16,
    padded: true,
  });
  expect(planCompare({ width: 20, height: 10 }, { width: 12, height: 20 }, 'pad')).toEqual({
    width: 20,
    height: 20,
    padded: true,
  });
  // Padding never makes a picture past the 16,000,000 pixel limit: 16,000 by 1 and 1 by 16,000 would need 256,000,000.
  expect(() => planCompare({ width: 16000, height: 1 }, { width: 1, height: 16000 }, 'pad')).toThrow(/16,000,000/);
  expect(() => planCompare({ width: 0, height: 1 }, { width: 1, height: 1 }, 'pad')).toThrow(ImageCompareError);

  // The padded copy: the source sits at the top left and the new area is transparent black (0, 0, 0, 0).
  const src = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255]);
  const padded = padPixels(src, 2, 2, 3, 4);
  expect(padded.length).toBe(3 * 4 * 4);
  const at = (x: number, y: number) => Array.from(padded.subarray((y * 3 + x) * 4, (y * 3 + x) * 4 + 4));
  expect(at(0, 0)).toEqual([1, 2, 3, 255]);
  expect(at(1, 0)).toEqual([4, 5, 6, 255]);
  expect(at(0, 1)).toEqual([7, 8, 9, 255]);
  expect(at(1, 1)).toEqual([10, 11, 12, 255]);
  for (const [x, y] of [
    [2, 0],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
    [0, 3],
    [1, 3],
    [2, 3],
  ] as const) {
    expect(at(x, y)).toEqual([0, 0, 0, 0]);
  }
  // The source is not changed, and a padded copy is a whole array of its own (no subarray at an odd offset).
  expect(Array.from(src)).toEqual([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255]);
  expect(padded.byteOffset).toBe(0);
  expect(padded.buffer.byteLength).toBe(padded.length);
  // A target smaller than the source, or a source of the wrong length, is refused.
  expect(() => padPixels(src, 2, 2, 1, 2)).toThrow(ImageCompareError);
  expect(() => padPixels(src, 2, 3, 3, 4)).toThrow(ImageCompareError);

  // A 4 by 2 opaque white image against the same image padded from 4 by 1 differs exactly in the 4 padded pixels.
  // pixelmatch blends a semi-transparent pixel against a checkerboard background (its checkerboard option,
  // on by default; index.d.ts at 7.2.0), so white (255, 255, 255, 255) against transparent black (0, 0, 0, 0) at byte offsets
  // 16, 20, 24 and 28 has the channel differences (207, 48, 207), (207, 207, 48), (207, 207, 48), (207, 48, 207) and
  // a delta of 8455.0, 19272.9, 19272.9 and 8455.0: each above maxDelta 352.15 at 0.1 and below 35215 (the most the
  // metric can reach), so all 4 count at 0.1 and none counts at 1.
  const white = new Uint8ClampedArray(4 * 2 * 4).fill(255);
  const oneRow = new Uint8ClampedArray(4 * 1 * 4).fill(255);
  const grown = padPixels(oneRow, 4, 1, 4, 2);
  const result = compareImages(white, grown, 4, 2, { threshold: 0.1, includeAA: false });
  expect(result.differing).toBe(4);
  expect(result.total).toBe(8);
  expect(compareImages(white, grown, 4, 2, { threshold: 1, includeAA: false }).differing).toBe(0);
});

it('anti-aliased pixels are skipped unless counting them is chosen', () => {
  // pixelmatch's detector (V. Vysniauskas 2009, as its source documents it): a differing pixel is anti-aliasing when
  // it has no more than 2 equal neighbours, has both a darker and a brighter neighbour, and the darkest or brightest
  // neighbour has 3 or more equal siblings in both images.
  //
  // A 5 by 5 image: columns 0 and 1 black, column 2 gray 128 (the soft edge), columns 3 and 4 white. The second
  // image is the same except the centre pixel (2, 2) is gray 60.
  //  - The centre differs by 68: delta = 0.5053 * 68.0000008^2 = 2336.5, above maxDelta 352.15 at 0.1.
  //  - Its 8 neighbours in the first image: 3 black (brighter than the centre by 128), 2 gray 128 (equal, so 2 equal
  //    neighbours, not more than 2) and 3 white (darker by 127). Both a darker and a brighter neighbour exist.
  //  - The darkest neighbour is the white pixel at (3, 1); in both images it has 5 or more white neighbours (>= 3).
  //  So the pixel is anti-aliasing: skipped by default (drawn yellow, 255, 255, 0), counted with includeAA.
  const size = 5;
  const black = [0, 0, 0, 255];
  const gray = [128, 128, 128, 255];
  const white = [255, 255, 255, 255];
  const first = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      first.set(x < 2 ? black : x === 2 ? gray : white, (y * size + x) * 4);
    }
  }
  const second = new Uint8ClampedArray(first);
  second.set([60, 60, 60, 255], (2 * size + 2) * 4);

  const skipped = compareImages(first, second, size, size, { threshold: 0.1, includeAA: false });
  expect(skipped.differing).toBe(0);
  expect(Array.from(skipped.diff.subarray((2 * size + 2) * 4, (2 * size + 2) * 4 + 4))).toEqual([255, 255, 0, 255]);

  const counted = compareImages(first, second, size, size, { threshold: 0.1, includeAA: true });
  expect(counted.differing).toBe(1);
  expect(Array.from(counted.diff.subarray((2 * size + 2) * 4, (2 * size + 2) * 4 + 4))).toEqual([255, 0, 0, 255]);

  // The control: the same change in the middle of a flat gray image is a real difference, not anti-aliasing (all 8
  // neighbours are equal, more than 2), so it counts with and without the option.
  const flat = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) flat.set(gray, i * 4);
  const flatChanged = new Uint8ClampedArray(flat);
  flatChanged.set([60, 60, 60, 255], (2 * size + 2) * 4);
  expect(compareImages(flat, flatChanged, size, size, { threshold: 0.1, includeAA: false }).differing).toBe(1);
  expect(compareImages(flat, flatChanged, size, size, { threshold: 0.1, includeAA: true }).differing).toBe(1);
});

it('pixelmatch published vectors: its own test images 1a and 1b differ in 143 pixels at 0.05 and 106 at 0.1', () => {
  // pixelmatch's test suite at v7.2.0, test/test.js: diffTest('1a', '1b', '1diff', { threshold: 0.05 }, 143) and
  // diffTest('1a', '1b', '1diffdefaultthreshold', { threshold: undefined }, 106). Anti-aliased pixels are skipped.
  const a = decodeRgbaPng(Uint8Array.from(Buffer.from(PIXELMATCH_1A_PNG_BASE64, 'base64')));
  const b = decodeRgbaPng(Uint8Array.from(Buffer.from(PIXELMATCH_1B_PNG_BASE64, 'base64')));
  expect([a.width, a.height, b.width, b.height]).toEqual([512, 256, 512, 256]);
  expect(compareImages(a.data, b.data, 512, 256, { threshold: 0.05, includeAA: false }).differing).toBe(143);
  expect(compareImages(a.data, b.data, 512, 256, { threshold: 0.1, includeAA: false }).differing).toBe(106);
  expect(compareImages(a.data, a.data, 512, 256, { threshold: 0, includeAA: false }).differing).toBe(0);
});

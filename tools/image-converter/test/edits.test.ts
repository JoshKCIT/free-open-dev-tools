import { it, expect, vi } from 'vitest';
import {
  planConversion,
  planSvgConversion,
  replanForDecoded,
  ImageConverterError,
  type ConvertOptions,
} from '../src/index';
import { planEdits, ImageEditError, ROTATIONS, FLIPS, type ImageEdits } from '../src/edits';
import { planSize } from '../src/sizing';
import { scanSvg } from '../src/svg-guard';
import { svgSize } from '../src/svg-size';

/**
 * Top-level `it(...)` calls, never nested in `describe(...)` (the verify
 * scripts match required titles by exact equality).
 *
 * The model below is written here from the plain definition of the three
 * edits (crop, then a clockwise quarter turn, then a mirror) as arrays of
 * pixel names. It never calls the code under test to decide what is right.
 */

const W = 7;
const H = 5;

type Crop = { x: number; y: number; width: number; height: number };

function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function minimalPng(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    0,
    0,
    0,
    13,
    0x49,
    0x48,
    0x44,
    0x52,
    ...u32be(width),
    ...u32be(height),
    8,
    6,
    0,
    0,
    0,
  ]);
}

/** The smallest header the sniffer reads as a JPEG of the given stored size (what the file says before any orientation is applied). */
function minimalJpeg(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
  ]);
}

/** Every pixel is named by where it started: "column,row" in the 7 by 5 source. */
function modelCrop(c: Crop): string[][] {
  const rows: string[][] = [];
  for (let y = 0; y < c.height; y++) {
    const row: string[] = [];
    for (let x = 0; x < c.width; x++) row.push(`${c.x + x},${c.y + y}`);
    rows.push(row);
  }
  return rows;
}

function modelQuarterTurn(grid: string[][]): string[][] {
  const h = grid.length;
  const w = grid[0]!.length;
  const out: string[][] = [];
  for (let y = 0; y < w; y++) {
    const row: string[] = [];
    for (let x = 0; x < h; x++) row.push(grid[h - 1 - x]![y]!);
    out.push(row);
  }
  return out;
}

function modelEdit(c: Crop, rotate: number, flip: string): string[][] {
  let g = modelCrop(c);
  for (let k = 0; k < rotate / 90; k++) g = modelQuarterTurn(g);
  if (flip === 'horizontal' || flip === 'both') g = g.map((r) => r.slice().reverse());
  if (flip === 'vertical' || flip === 'both') g = g.slice().reverse();
  return g;
}

it('planEdits with no edits keeps the plan the converter made before', () => {
  const none = planEdits(W, H, { rotate: 0, flip: 'none' });
  expect(none).toEqual({
    source: { x: 0, y: 0, width: W, height: H },
    width: W,
    height: H,
    transform: [1, 0, 0, 1, 0, 0],
    identity: true,
  });
  // A crop that is the whole image is no edit either.
  expect(planEdits(W, H, { crop: { x: 0, y: 0, width: W, height: H }, rotate: 0, flip: 'none' }).identity).toBe(true);
  // Anything that changes a pixel is an edit.
  expect(planEdits(W, H, { crop: { x: 0, y: 0, width: W - 1, height: H }, rotate: 0, flip: 'none' }).identity).toBe(
    false,
  );
  expect(planEdits(W, H, { rotate: 90, flip: 'none' }).identity).toBe(false);
  expect(planEdits(W, H, { rotate: 0, flip: 'vertical' }).identity).toBe(false);

  const base: ConvertOptions = {
    format: 'png',
    quality: 85,
    background: '#ffffff',
    resize: { mode: 'percent', percent: 50 },
  };
  const bytes = minimalPng(100, 60);
  const before = planConversion(bytes, 'a.png', base);
  expect(before.targetWidth).toBe(50);
  expect(before.targetHeight).toBe(30);
  expect(planConversion(bytes, 'a.png', { ...base, edits: undefined })).toEqual(before);
  expect(planConversion(bytes, 'a.png', { ...base, edits: { rotate: 0, flip: 'none' } })).toEqual(before);
  expect(ROTATIONS).toEqual([0, 90, 180, 270]);
  expect(FLIPS).toEqual(['none', 'horizontal', 'vertical', 'both']);
});

it('crop, rotate and flip give the pixel model for 96 combinations on a 7 by 5 image', () => {
  const crops: (Crop | undefined)[] = [
    undefined,
    { x: 1, y: 1, width: 4, height: 3 },
    { x: 2, y: 0, width: 5, height: 5 },
  ];
  let combos = 0;
  for (const crop of crops) {
    for (const rotate of ROTATIONS) {
      for (const flip of FLIPS) {
        for (const resize of ['none', 'percent'] as const) {
          combos++;
          const c = crop ?? { x: 0, y: 0, width: W, height: H };
          const edits: ImageEdits = crop ? { crop, rotate, flip } : { rotate, flip };
          const plan = planEdits(W, H, edits);
          const expected = modelEdit(c, rotate, flip);
          const label = JSON.stringify({ crop, rotate, flip });

          expect(plan.source, label).toEqual(c);
          expect(plan.height, label).toBe(expected.length);
          expect(plan.width, label).toBe(expected[0]!.length);
          for (const n of plan.transform) expect(Number.isInteger(n), label).toBe(true);

          // Send every source pixel's centre through the transform and see where it lands.
          const [a, b, cc, d, e, f] = plan.transform;
          const landed: (string | undefined)[][] = Array.from({ length: plan.height }, () =>
            new Array<string | undefined>(plan.width).fill(undefined),
          );
          for (let y = 0; y < c.height; y++) {
            for (let x = 0; x < c.width; x++) {
              const u = a * (x + 0.5) + cc * (y + 0.5) + e;
              const v = b * (x + 0.5) + d * (y + 0.5) + f;
              const ox = Math.floor(u);
              const oy = Math.floor(v);
              expect(ox >= 0 && ox < plan.width && oy >= 0 && oy < plan.height, label).toBe(true);
              expect(landed[oy]![ox], label).toBeUndefined();
              landed[oy]![ox] = `${c.x + x},${c.y + y}`;
            }
          }
          expect(landed, label).toEqual(expected);

          // The resize step measures against the edited size: 'none' keeps it, 200 percent doubles it.
          const sized = planSize(
            { width: plan.width, height: plan.height },
            resize === 'none' ? { mode: 'none' } : { mode: 'percent', percent: 200 },
          );
          const factor = resize === 'none' ? 1 : 2;
          expect([sized.width, sized.height], label).toEqual([plan.width * factor, plan.height * factor]);
        }
      }
    }
  }
  expect(combos).toBe(96);
});

it('a crop outside the upright image, with a zero side or a negative corner is refused naming the size', () => {
  const bad: Crop[] = [
    { x: 5, y: 0, width: 4, height: 2 },
    { x: 0, y: 4, width: 2, height: 2 },
    { x: 0, y: 0, width: 8, height: 5 },
    { x: 0, y: 0, width: 0, height: 3 },
    { x: 0, y: 0, width: 3, height: 0 },
    { x: -1, y: 0, width: 3, height: 3 },
    { x: 0, y: -2, width: 3, height: 3 },
    { x: 0, y: 0, width: -3, height: 3 },
    { x: 0.5, y: 0, width: 3, height: 3 },
    { x: 0, y: 0, width: Number.NaN, height: 3 },
    { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 3 },
    { x: 0, y: 0, width: 1e12, height: 1e12 },
  ];
  for (const crop of bad) {
    let caught: unknown;
    try {
      planEdits(W, H, { crop, rotate: 0, flip: 'none' });
    } catch (err) {
      caught = err;
    }
    expect(caught, JSON.stringify(crop)).toBeInstanceOf(ImageEditError);
    expect((caught as Error).message, JSON.stringify(crop)).toContain('7 by 5');
  }
  // The edge cases that are allowed: a one pixel crop in each corner.
  for (const [x, y] of [
    [0, 0],
    [6, 0],
    [0, 4],
    [6, 4],
  ] as const) {
    expect(planEdits(W, H, { crop: { x, y, width: 1, height: 1 }, rotate: 0, flip: 'none' }).width).toBe(1);
  }
  // Rotations and flips outside the lists are refused, never replaced.
  expect(() => planEdits(W, H, { rotate: 45 as never, flip: 'none' })).toThrow(ImageEditError);
  expect(() => planEdits(W, H, { rotate: 0, flip: 'diagonal' as never })).toThrow(ImageEditError);
  expect(() => planEdits(W, H, { rotate: 0, flip: '__proto__' as never })).toThrow(ImageEditError);
  expect(() => planEdits(0, H, { rotate: 0, flip: 'none' })).toThrow(ImageEditError);
  // The crop is checked against the upright size even when the file stores it turned.
  const stored = minimalJpeg(6000, 4000);
  const options: ConvertOptions = {
    format: 'png',
    quality: 85,
    background: '#ffffff',
    resize: { mode: 'none' },
    edits: { crop: { x: 0, y: 0, width: 3000, height: 5000 }, rotate: 0, flip: 'none' },
  };
  // 3000 by 5000 fits the 4000 by 6000 upright picture a turned JPEG gives, not the stored 6000 by 4000.
  expect(planConversion(stored, 'a.jpg', options).targetWidth).toBe(3000);
  expect(() => planConversion(minimalPng(6000, 4000), 'a.png', options)).toThrow(ImageEditError);
});

it('resize modes measure against the cropped and rotated size', () => {
  const bytes = minimalPng(100, 60);
  const crop = { x: 10, y: 10, width: 40, height: 20 };
  const edits: ImageEdits = { crop, rotate: 90, flip: 'horizontal' };
  const options = (resize: ConvertOptions['resize']): ConvertOptions => ({
    format: 'png',
    quality: 85,
    background: '#ffffff',
    resize,
    edits,
  });

  // 40 by 20 turned a quarter is 20 by 40.
  const none = planConversion(bytes, 'a.png', options({ mode: 'none' }));
  expect([none.targetWidth, none.targetHeight]).toEqual([20, 40]);
  expect([none.sourceWidth, none.sourceHeight]).toEqual([100, 60]);

  const percent = planConversion(bytes, 'a.png', options({ mode: 'percent', percent: 50 }));
  expect([percent.targetWidth, percent.targetHeight]).toEqual([10, 20]);

  // Fit inside 10 by 10: scale = min(10 / 20, 10 / 40) = 0.25, never enlarged.
  const fit = planConversion(bytes, 'a.png', options({ mode: 'fit', width: 10, height: 10 }));
  expect([fit.targetWidth, fit.targetHeight]).toEqual([5, 10]);
  const noEnlarge = planConversion(bytes, 'a.png', options({ mode: 'fit', width: 800, height: 800 }));
  expect([noEnlarge.targetWidth, noEnlarge.targetHeight]).toEqual([20, 40]);
  const enlarge = planConversion(bytes, 'a.png', options({ mode: 'fit', width: 80, height: 80, enlarge: true }));
  expect([enlarge.targetWidth, enlarge.targetHeight]).toEqual([40, 80]);

  // Exact with a locked aspect ratio uses the edited ratio: 30 wide gives 60 tall.
  const exact = planConversion(bytes, 'a.png', options({ mode: 'exact', width: 30, height: 999, keepAspect: true }));
  expect([exact.targetWidth, exact.targetHeight]).toEqual([30, 60]);

  // The too-large refusal measures the edited size too: 8000 by 6000 is 48,000,000 pixels, over the limit, until it is cropped.
  const huge = minimalPng(8000, 6000);
  expect(() => planConversion(huge, 'a.png', { ...options({ mode: 'none' }), edits: undefined })).toThrow(
    ImageConverterError,
  );
  expect(() =>
    planConversion(huge, 'a.png', { ...options({ mode: 'none' }), edits: { rotate: 270, flip: 'none' } }),
  ).toThrow(ImageConverterError);
  const cropped = planConversion(huge, 'a.png', {
    ...options({ mode: 'none' }),
    edits: { crop: { x: 0, y: 0, width: 100, height: 100 }, rotate: 0, flip: 'none' },
  });
  expect([cropped.targetWidth, cropped.targetHeight]).toEqual([100, 100]);
});

it('an SVG is planned the same way: its own size, then the edits, then the resize, with the same output limit', () => {
  const natural = svgSize('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"></svg>');
  const plan = planSvgConversion(natural, 'a.svg', {
    format: 'jpeg',
    quality: 150,
    background: 'nope',
    resize: { mode: 'percent', percent: 50 },
    edits: { rotate: 90, flip: 'none' },
  });
  expect([plan.sourceWidth, plan.sourceHeight]).toEqual([40, 20]);
  expect([plan.editedWidth, plan.editedHeight]).toEqual([20, 40]);
  expect([plan.targetWidth, plan.targetHeight]).toEqual([10, 20]);
  expect(plan.mediaType).toBe('image/jpeg');
  expect(plan.qualityFraction).toBe(1);
  expect(plan.background).toBe('#ffffff');
  expect(plan.edits?.identity).toBe(false);
  expect(plan.warnings.some((w) => w.includes("'quality'"))).toBe(true);
  expect(plan.warnings.some((w) => w.includes("'background'"))).toBe(true);

  const plain = planSvgConversion(natural, 'a.svg', {
    format: 'png',
    quality: 85,
    background: '#ffffff',
    resize: { mode: 'none' },
  });
  expect(plain.edits).toBeUndefined();
  expect([plain.editedWidth, plain.editedHeight, plain.targetWidth, plain.targetHeight]).toEqual([40, 20, 40, 20]);

  // The 40,000,000 pixel output limit applies to the SVG path as to every other.
  expect(() =>
    planSvgConversion(natural, 'a.svg', {
      format: 'png',
      quality: 85,
      background: '#ffffff',
      resize: { mode: 'percent', percent: 1000 },
    }),
  ).not.toThrow();
  expect(() =>
    planSvgConversion({ width: 8000, height: 5000 }, 'a.svg', {
      format: 'png',
      quality: 85,
      background: '#ffffff',
      resize: { mode: 'percent', percent: 101 },
    }),
  ).toThrow(ImageConverterError);
});

it('nothing is written to the console while planning edits or checking an SVG', () => {
  const spies = (['log', 'warn', 'error'] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
  try {
    planEdits(W, H, { crop: { x: 1, y: 1, width: 3, height: 3 }, rotate: 270, flip: 'both' });
    try {
      planEdits(W, H, { crop: { x: 9, y: 9, width: 3, height: 3 }, rotate: 0, flip: 'none' });
    } catch {
      // expected refusal; the point is console silence
    }
    scanSvg('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>');
    try {
      scanSvg('<svg><script>x</script></svg>');
    } catch {
      // expected refusal
    }
    svgSize('<svg width="4" height="4"/>');
  } finally {
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  }
});

it('crop, rotate and flip are refused when the edited picture, before any resize, is over the output pixel limit', () => {
  const options = (resize: ConvertOptions['resize'], edits?: ImageEdits): ConvertOptions => ({
    format: 'png',
    quality: 85,
    background: '#ffffff',
    resize,
    ...(edits ? { edits } : {}),
  });
  const tenPercent = { mode: 'percent', percent: 10 } as const;
  const refusal = (width: number, height: number): string =>
    `Could not convert 'a.png': the cropped, rotated or flipped picture would be ${width} by ${height} pixels before it is resized, above this browser's own 40,000,000-pixel limit. Crop it to a smaller area first.`;

  // A picture of 100,000,000 pixels, turned and then shrunk to a tenth, would need an edit canvas of the full size.
  const big = minimalPng(10_000, 10_000);
  expect(() => planConversion(big, 'a.png', options(tenPercent, { rotate: 90, flip: 'none' }))).toThrow(
    refusal(10_000, 10_000),
  );
  expect(() => planConversion(big, 'a.png', options(tenPercent, { rotate: 180, flip: 'none' }))).toThrow(
    ImageConverterError,
  );
  expect(() => planConversion(big, 'a.png', options(tenPercent, { rotate: 0, flip: 'horizontal' }))).toThrow(
    ImageConverterError,
  );
  // A crop that is still over the limit is refused, naming the cropped size; one at or under it is accepted.
  const crop = (side: number): ImageEdits => ({
    crop: { x: 0, y: 0, width: side, height: side },
    rotate: 90,
    flip: 'none',
  });
  expect(() => planConversion(big, 'a.png', options(tenPercent, crop(7000)))).toThrow(refusal(7000, 7000));
  expect(planConversion(big, 'a.png', options(tenPercent, crop(6000))).targetWidth).toBe(600);

  // Exactly 40,000,000 pixels is accepted; one more row is not.
  expect(
    planConversion(minimalPng(8000, 5000), 'a.png', options(tenPercent, { rotate: 90, flip: 'none' })).targetWidth,
  ).toBe(500);
  expect(() =>
    planConversion(minimalPng(8000, 5001), 'a.png', options(tenPercent, { rotate: 90, flip: 'none' })),
  ).toThrow(ImageConverterError);

  // A JPEG stored turned a quarter has the same area either way.
  expect(() =>
    planConversion(minimalJpeg(10_000, 10_000), 'a.png', options(tenPercent, { rotate: 90, flip: 'none' })),
  ).toThrow(ImageConverterError);

  // No canvas is made for edits that change nothing, and none for no edits: the resize alone is held to its own limit.
  expect(planConversion(big, 'a.png', options(tenPercent)).targetWidth).toBe(1000);
  expect(planConversion(big, 'a.png', options(tenPercent, { rotate: 0, flip: 'none' })).targetWidth).toBe(1000);
  expect(
    planConversion(
      big,
      'a.png',
      options(tenPercent, { crop: { x: 0, y: 0, width: 10_000, height: 10_000 }, rotate: 0, flip: 'none' }),
    ).targetWidth,
  ).toBe(1000);

  // The plan made again against the decoded picture says the same (a header can differ from the decoded size).
  const small = planConversion(minimalPng(100, 50), 'a.png', options(tenPercent, { rotate: 90, flip: 'none' }));
  expect(() =>
    replanForDecoded(
      small,
      'a.png',
      { width: 10_000, height: 10_000 },
      options(tenPercent, { rotate: 90, flip: 'none' }),
    ),
  ).toThrow(refusal(10_000, 10_000));
  expect(
    replanForDecoded(
      small,
      'a.png',
      { width: 10_000, height: 10_000 },
      options(tenPercent, { rotate: 0, flip: 'none' }),
    ).targetWidth,
  ).toBe(1000);
});

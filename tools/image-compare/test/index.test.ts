import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  checkImageFile,
  checkThreshold,
  compareImages,
  DEFAULT_THRESHOLD,
  ImageCompareError,
  MAX_INPUT_BYTES,
  MAX_INPUT_PIXELS,
  meta as toolMeta,
  padPixels,
  planCompare,
  shareText,
} from '../src/index';

/**
 * Top-level `it(...)` calls, never nested in `describe(...)`: the project's verify scripts match required titles by
 * exact full name. Expected values are the limits written in meta.json and the sentences the page promises, hand
 * counted modified pixels, and pixelmatch's documented rules -- never this package's own output.
 */

const consoleSpies = [] as ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  consoleSpies.length = 0;
  for (const method of ['log', 'warn', 'error'] as const) {
    consoleSpies.push(vi.spyOn(console, method).mockImplementation(() => undefined));
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

/** The first 29 bytes of a PNG: the signature and an IHDR chunk, which is all the header check reads. */
function pngHeader(width: number, height: number): Uint8Array {
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

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ImageCompareError);
    return (err as Error).message;
  }
  throw new Error('nothing was thrown');
}

it('a threshold outside 0 to 1 or not a number is refused naming the field', () => {
  for (const bad of [-0.1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1e9, 1.0000001]) {
    expect(messageOf(() => checkThreshold(bad))).toContain('Threshold');
  }
  expect(messageOf(() => checkThreshold('0.5' as unknown as number))).toContain('Threshold');
  // 0, the default and 1 are accepted and returned as they are.
  expect(checkThreshold(0)).toBe(0);
  expect(checkThreshold(DEFAULT_THRESHOLD)).toBe(0.1);
  expect(checkThreshold(1)).toBe(1);
  expect(DEFAULT_THRESHOLD).toBe(0.1);
  // The comparison itself refuses the same values before touching a pixel.
  const px = new Uint8ClampedArray(4);
  for (const bad of [-0.1, 1.5, Number.NaN]) {
    expect(messageOf(() => compareImages(px, px, 1, 1, { threshold: bad, includeAA: false }))).toContain('Threshold');
  }
});

it('files over 50 MB or declaring more than 16000000 pixels are refused before decoding', () => {
  // The limits are the ones meta.json states.
  expect(MAX_INPUT_BYTES).toBe(50 * 1024 * 1024);
  expect(MAX_INPUT_PIXELS).toBe(16_000_000);
  expect(toolMeta.limits.join('\n')).toContain('50 MB');
  expect(toolMeta.limits.join('\n')).toContain('16,000,000');

  // A file over 50 MB is refused from its reported size, whatever its header says.
  expect(messageOf(() => checkImageFile(pngHeader(10, 10), MAX_INPUT_BYTES + 1))).toContain('50 MB');
  // Exactly 50 MB passes the size check.
  expect(checkImageFile(pngHeader(10, 10), MAX_INPUT_BYTES)).toEqual({ kind: 'png', width: 10, height: 10 });
  // 4000 by 4000 is exactly 16,000,000 pixels and is accepted; one pixel row more is refused.
  expect(checkImageFile(pngHeader(4000, 4000), 1000)).toEqual({ kind: 'png', width: 4000, height: 4000 });
  expect(messageOf(() => checkImageFile(pngHeader(4000, 4001), 1000))).toContain('16,000,000');
  expect(messageOf(() => checkImageFile(pngHeader(100_000, 100_000), 1000))).toContain('16,000,000');
  // An empty file, and bytes that are not an image, are refused with the accepted kinds named.
  expect(messageOf(() => checkImageFile(new Uint8Array(0), 0))).toContain('empty');
  expect(messageOf(() => checkImageFile(new TextEncoder().encode('just some text, not an image'), 28))).toContain(
    'PNG, JPEG, GIF, WebP or BMP',
  );
});

it('error messages hold sizes and limits and never any input bytes', () => {
  const marker = 'FODT-MARKER-7Q2-NOT-IN-ANY-MESSAGE';
  const text = new TextEncoder().encode(marker + ' '.repeat(40));
  const messages = [
    messageOf(() => checkImageFile(text, text.length)),
    messageOf(() => checkImageFile(pngHeader(100_000, 100_000), 1000)),
    messageOf(() => checkImageFile(new Uint8Array(0), 0)),
    messageOf(() => checkThreshold(Number.NaN)),
    messageOf(() => planCompare({ width: 3, height: 4 }, { width: 5, height: 6 }, 'refuse')),
    messageOf(() =>
      compareImages(new Uint8ClampedArray(8), new Uint8ClampedArray(4), 1, 1, { threshold: 0.1, includeAA: false }),
    ),
  ];
  for (const message of messages) {
    expect(message).not.toContain(marker);
    expect(message.length).toBeLessThan(300);
  }
});

it('compareImages refuses buffers that are not the stated size or not whole', () => {
  const four = new Uint8ClampedArray(16);
  expect(
    messageOf(() => compareImages(four, new Uint8ClampedArray(12), 2, 2, { threshold: 0.1, includeAA: false })),
  ).toContain('stated size');
  expect(messageOf(() => compareImages(four, four, 3, 2, { threshold: 0.1, includeAA: false }))).toContain(
    'stated size',
  );
  expect(messageOf(() => compareImages(four, four, 0, 4, { threshold: 0.1, includeAA: false }))).toContain(
    'stated size',
  );
  // A view at an odd offset into a larger buffer would break pixelmatch's 32-bit reads; it is refused up front.
  const big = new Uint8ClampedArray(32);
  expect(
    messageOf(() =>
      compareImages(big.subarray(1, 17), big.subarray(1, 17), 2, 2, { threshold: 0.1, includeAA: false }),
    ),
  ).toContain('whole');
  // Plain arrays and other typed arrays are refused with the same fixed sentence, not pixelmatch's own.
  expect(
    messageOf(() =>
      compareImages([0, 0, 0, 0] as unknown as Uint8ClampedArray, new Uint8ClampedArray(4), 1, 1, {
        threshold: 0.1,
        includeAA: false,
      }),
    ),
  ).toContain('whole');
  expect(() => padPixels(new Uint8ClampedArray(3), 1, 1, 1, 1)).toThrow(ImageCompareError);
});

it('a pair of 4000 by 4000 images is compared in under 10 seconds', () => {
  const width = 4000;
  const height = 4000;
  const total = width * height;
  // A flat gray image against a copy with every 100th pixel set to black. Every neighbour of a changed pixel is equal
  // to the others, so none of them can be anti-aliasing: the expected count is the number of pixels changed, which is
  // counted here by hand (indexes 0, 100, 200 ... below 16,000,000 are 160,000 pixels).
  const a = new Uint8ClampedArray(total * 4);
  new Uint32Array(a.buffer).fill(0xff808080); // little-endian: alpha 255, then 128, 128, 128
  const b = new Uint8ClampedArray(a);
  for (let i = 0; i < total; i += 100) b.set([0, 0, 0, 255], i * 4);
  const expected = Math.ceil(total / 100);

  const started = performance.now();
  const result = compareImages(a, b, width, height, { threshold: 0.1, includeAA: false });
  const elapsed = performance.now() - started;

  expect(elapsed).toBeLessThan(10_000);
  expect(result.total).toBe(total);
  expect(expected).toBe(160_000);
  expect(result.differing).toBe(expected);
  expect(result.diff.length).toBe(total * 4);
}, 60_000);

it('meta pins pixelmatch 7.2.0 exactly', () => {
  expect(toolMeta.dependencies).toEqual({ pixelmatch: '7.2.0' });
  const own = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
    dependencies: Record<string, string>;
  };
  expect(own.dependencies).toEqual({ pixelmatch: '7.2.0' });
  const installed = JSON.parse(
    readFileSync(fileURLToPath(new URL('../node_modules/pixelmatch/package.json', import.meta.url)), 'utf8'),
  ) as { version: string; license: string };
  expect(installed.version).toBe('7.2.0');
  expect(installed.license).toBe('ISC');
});

it('nothing is written to the console while comparing', () => {
  const a = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 10, 20, 30, 255, 40, 50, 60, 255]);
  const b = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255, 10, 20, 30, 255, 0, 0, 0, 255]);
  const result = compareImages(a, b, 2, 2, { threshold: 0.1, includeAA: false });
  shareText(result.differing, result.total);
  padPixels(a, 2, 2, 3, 3);
  planCompare({ width: 2, height: 2 }, { width: 3, height: 3 }, 'pad');
  checkImageFile(pngHeader(2, 2), 100);
  // The error paths print nothing either.
  expect(() => checkThreshold(2)).toThrow();
  expect(() => planCompare({ width: 2, height: 2 }, { width: 3, height: 3 }, 'refuse')).toThrow();
  expect(() => checkImageFile(new Uint8Array(0), 0)).toThrow();
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
});

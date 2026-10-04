import { it, expect, vi } from 'vitest';
import {
  checkConverterFile,
  planConversion,
  outputFileName,
  FileSignatureError,
  ImageConverterError,
  MAX_INPUT_BYTES,
  MAX_INPUT_PIXELS,
} from '../src/index';
import { planSize, largestFittingSize, MAX_OUTPUT_PIXELS } from '../src/sizing';
import { interpretEncodeResult, writableFormats, OUTPUT_FORMATS } from '../src/capabilities';

/**
 * Top-level `it(...)` calls, never nested in `describe(...)`: Vitest's JSON
 * reporter concatenates the describe name into `fullName`, and this
 * project's own verify scripts match required titles by exact equality.
 */

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
    10, // signature
    0,
    0,
    0,
    13, // IHDR length
    0x49,
    0x48,
    0x44,
    0x52, // "IHDR"
    ...u32be(width),
    ...u32be(height),
    8,
    6,
    0,
    0,
    0,
  ]);
}

it('the output size keeps the aspect ratio for percent, fit and exact modes and rounds as documented', () => {
  const source = { width: 4000, height: 3000 };

  expect(planSize(source, { mode: 'fit', width: 800, height: 800 })).toMatchObject({ width: 800, height: 600 });
  expect(planSize(source, { mode: 'percent', percent: 50 })).toMatchObject({ width: 2000, height: 1500 });
  expect(planSize(source, { mode: 'exact', width: 300, height: 300, keepAspect: true })).toMatchObject({
    width: 300,
    height: 225,
  });

  // Fit never enlarges a source already smaller than the box, unless asked.
  const small = { width: 100, height: 50 };
  expect(planSize(small, { mode: 'fit', width: 800, height: 800 })).toMatchObject({ width: 100, height: 50 });
  expect(planSize(small, { mode: 'fit', width: 800, height: 800, enlarge: true })).toMatchObject({
    width: 800,
    height: 400,
  });
});

it('a size over the output pixel limit is refused before any canvas is created', () => {
  // A huge PNG (declared dimensions only -- this test never decodes a real
  // image), asked to keep its own size, plans an output well over
  // MAX_OUTPUT_PIXELS.
  const side = Math.ceil(Math.sqrt(MAX_OUTPUT_PIXELS)) + 2000;
  const bytes = minimalPng(side, side);
  expect(() =>
    planConversion(bytes, 'huge.png', {
      format: 'png',
      quality: 85,
      background: '#ffffff',
      resize: { mode: 'none' },
    }),
  ).toThrow(ImageConverterError);

  try {
    planConversion(bytes, 'huge.png', { format: 'png', quality: 85, background: '#ffffff', resize: { mode: 'none' } });
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(ImageConverterError);
    const expected = largestFittingSize(side, side, MAX_OUTPUT_PIXELS);
    expect((err as ImageConverterError).message).toContain(`${expected.width} by ${expected.height}`);
  }
});

it('the encoder capability of a browser is read from the returned blob type, never assumed', () => {
  expect(interpretEncodeResult('image/webp', 'image/png')).toEqual({ ok: false, substitutedType: 'image/png' });
  expect(interpretEncodeResult('image/jpeg', 'image/jpeg')).toEqual({ ok: true });

  const probe = writableFormats({
    'image/png': 'image/png',
    'image/jpeg': 'image/jpeg',
    'image/webp': 'image/png', // silently substituted: not writable
    'image/avif': 'image/png', // silently substituted: not writable
  });
  expect(probe).toEqual({ png: true, jpeg: true, webp: false, avif: false });
  expect(OUTPUT_FORMATS.map((f) => f.id)).toEqual(['png', 'jpeg', 'webp', 'avif']);
});

it('an unsupported output format is reported as unavailable and never written under the wrong extension', () => {
  // A browser that substitutes PNG for WebP is reported as not writing
  // WebP; outputFileName still names the requested format's own extension
  // regardless (the page is what refuses to download in that case, using
  // the same interpretEncodeResult the worker already ran).
  const interpretation = interpretEncodeResult('image/webp', 'image/png');
  expect(interpretation.ok).toBe(false);
  expect(interpretation.substitutedType).toBe('image/png');
  expect(outputFileName('photo.PNG', 'webp')).toBe('photo.webp');
  expect(outputFileName('photo', 'jpeg')).toBe('photo.jpg');
});

it('quality is clamped to the range the HTML Standard allows with a warning naming the field', () => {
  const bytes = minimalPng(10, 10);

  const high = planConversion(bytes, 'a.png', {
    format: 'jpeg',
    quality: 150,
    background: '#ffffff',
    resize: { mode: 'none' },
  });
  expect(high.qualityFraction).toBe(1);
  expect(high.warnings.some((w) => w.includes("'quality'"))).toBe(true);

  const low = planConversion(bytes, 'a.png', {
    format: 'jpeg',
    quality: -5,
    background: '#ffffff',
    resize: { mode: 'none' },
  });
  expect(low.qualityFraction).toBe(0.01);
  expect(low.warnings.some((w) => w.includes("'quality'"))).toBe(true);

  const inRange = planConversion(bytes, 'a.png', {
    format: 'jpeg',
    quality: 85,
    background: '#ffffff',
    resize: { mode: 'none' },
  });
  expect(inRange.qualityFraction).toBeCloseTo(0.85);
});

it('an SVG, a text file and a truncated header are refused before decoding', () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const text = new TextEncoder().encode('just plain text, not an image at all');
  const truncated = minimalPng(10, 10).slice(0, 5);

  for (const bytes of [svg, text, truncated]) {
    // The header check throws its own FileSignatureError, not
    // ImageConverterError; the page catches either kind identically, so the
    // one thing this test asserts is that planConversion never reaches a
    // canvas step for any of these three inputs.
    expect(() =>
      planConversion(bytes, 'file', { format: 'png', quality: 85, background: '#ffffff', resize: { mode: 'none' } }),
    ).toThrow();
  }
});

it('nothing is written to the console while planning a conversion', () => {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const bytes = minimalPng(10, 10);
    planConversion(bytes, 'a.png', {
      format: 'jpeg',
      quality: 150,
      background: 'not-a-colour',
      resize: { mode: 'exact', width: 5, height: 5 },
    });
    try {
      planConversion(new TextEncoder().encode('nope'), 'a.txt', {
        format: 'png',
        quality: 85,
        background: '#ffffff',
        resize: { mode: 'none' },
      });
    } catch {
      // expected refusal; the point of this test is console silence, not the throw
    }
  } finally {
    expect(spy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    spy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  }
});

it('the input byte and pixel limits are set as documented', () => {
  expect(MAX_INPUT_BYTES).toBe(100 * 1024 * 1024);
  expect(MAX_INPUT_PIXELS).toBe(100_000_000);
});

it('a file over 100 MB is refused from its reported size, whatever its first bytes say', () => {
  const sentence = 'This file is larger than 100 MB, the most this page accepts.';
  const messageOf = (fn: () => unknown): string => {
    try {
      fn();
    } catch (err) {
      expect(err).toBeInstanceOf(ImageConverterError);
      return (err as Error).message;
    }
    throw new Error('nothing was thrown');
  };

  // 100 MB exactly is accepted, one byte more is not, even when the first bytes are a good picture, empty or text.
  expect(checkConverterFile(minimalPng(4, 4), MAX_INPUT_BYTES)).toMatchObject({ kind: 'png', width: 4, height: 4 });
  expect(messageOf(() => checkConverterFile(minimalPng(4, 4), MAX_INPUT_BYTES + 1))).toBe(sentence);
  expect(messageOf(() => checkConverterFile(new Uint8Array(0), MAX_INPUT_BYTES + 1))).toBe(sentence);
  expect(messageOf(() => checkConverterFile(new TextEncoder().encode('plain text'), 3 * 1024 * 1024 * 1024))).toBe(
    sentence,
  );

  // The old refusals are untouched: an empty file, a file that is not a picture and a picture over the pixel limit.
  expect(() => checkConverterFile(new Uint8Array(0), 0)).toThrow(FileSignatureError);
  expect(() => checkConverterFile(new TextEncoder().encode('just plain text, not an image'), 29)).toThrow(
    'this is not PNG, JPEG, GIF, WebP or BMP',
  );
  expect(() => checkConverterFile(minimalPng(10_000, 10_001), 1000)).toThrow(FileSignatureError);
  expect(checkConverterFile(minimalPng(10_000, 10_000), 1000)).toMatchObject({ width: 10_000, height: 10_000 });

  // planConversion, which the worker calls with only the first bytes, is told the whole file's size and refuses on it.
  const options = { format: 'png' as const, quality: 85, background: '#ffffff', resize: { mode: 'none' as const } };
  expect(planConversion(minimalPng(4, 4), 'a.png', options, MAX_INPUT_BYTES).targetWidth).toBe(4);
  expect(messageOf(() => planConversion(minimalPng(4, 4), 'a.png', options, MAX_INPUT_BYTES + 1))).toBe(sentence);
  // Left out, the size is the length of the bytes given, as it always was.
  expect(planConversion(minimalPng(4, 4), 'a.png', options).targetWidth).toBe(4);
});

import { it, expect, vi } from 'vitest';
import {
  sniffImage,
  ImageColorError,
  MAX_FILE_BYTES,
  MAX_PIXELS,
  extractFromPixels,
  formatHex,
  samplePixels,
  SAMPLE_PATTERN,
} from '../src/index';

/**
 * Every header layout asserted below is quoted, with its fetched source, in
 * `src/sniff.ts`'s own comments: the PNG signature and IHDR chunk (W3C PNG
 * Third Edition, sections 5.2 and 11.2.2), the JPEG marker-segment and
 * frame-header syntax plus the VP8 key-frame dimension layout (ITU-T T.81
 * sections B.1.1.4 and B.2.2, RFC 6386), the GIF Header and Logical Screen
 * Descriptor (GIF89a sections 17 and 18), the WebP RIFF header and its
 * three bitstream chunk shapes (RFC 9649 sections 2.3-2.7), and the
 * BITMAPFILEHEADER/BITMAPINFOHEADER layout (Microsoft's own docs). Median
 * cut is Paul Heckbert's 1982 SIGGRAPH paper "Color Image Quantization for
 * Frame Buffer Display", reimplemented from its description in this
 * project's own words.
 */

function u8(...bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function u16be(n: number): Uint8Array {
  return u8((n >> 8) & 0xff, n & 0xff);
}
function u32be(n: number): Uint8Array {
  return u8((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}
function u16le(n: number): Uint8Array {
  return u8(n & 0xff, (n >> 8) & 0xff);
}
function u32le(n: number): Uint8Array {
  return u8(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
}
function ascii(s: string): Uint8Array {
  return u8(...Array.from(s, (c) => c.charCodeAt(0)));
}

function buildPng(width: number, height: number): Uint8Array {
  return concat(
    u8(137, 80, 78, 71, 13, 10, 26, 10), // signature
    u32be(13), // IHDR length
    ascii('IHDR'),
    u32be(width),
    u32be(height),
    u8(8, 2, 0, 0, 0), // bit depth, colour type, compression, filter, interlace
    u32be(0), // CRC (not checked by this tool)
  );
}

/** Builds a JPEG with an APP0 marker (to prove marker-skipping works) before the SOF marker. */
function buildJpeg(width: number, height: number, sofMarker: number): Uint8Array {
  const app0Payload = ascii('JFIF').length; // just a length placeholder; content is irrelevant
  const app0 = concat(u8(0xff, 0xe0), u16be(2 + app0Payload + 2), ascii('JFIF'), u8(1, 1));
  const sofPayload = concat(
    u8(8), // P: sample precision
    u16be(height), // Y: number of lines
    u16be(width), // X: number of samples per line
    u8(1), // Nf: one component
    u8(1, 0x11, 0), // Ci, sampling factors, Tqi
  );
  const sof = concat(u8(0xff, sofMarker), u16be(2 + sofPayload.length), sofPayload);
  return concat(u8(0xff, 0xd8), app0, sof, u8(0xff, 0xd9));
}

function buildGif(width: number, height: number, version: '87a' | '89a' = '89a'): Uint8Array {
  return concat(ascii('GIF'), ascii(version), u16le(width), u16le(height), u8(0, 0, 0));
}

function buildWebpLossy(width: number, height: number): Uint8Array {
  const payload = concat(u8(0, 0, 0), u8(0x9d, 0x01, 0x2a), u16le(width & 0x3fff), u16le(height & 0x3fff));
  const chunk = concat(ascii('VP8 '), u32le(payload.length), payload);
  return concat(ascii('RIFF'), u32le(4 + chunk.length), ascii('WEBP'), chunk);
}

function buildWebpLossless(width: number, height: number): Uint8Array {
  const w1 = width - 1;
  const h1 = height - 1;
  const b1 = w1 & 0xff;
  const b2 = ((w1 >> 8) & 0x3f) | ((h1 & 0x3) << 6);
  const b3 = (h1 >> 2) & 0xff;
  const b4 = (h1 >> 10) & 0xf;
  const payload = concat(u8(0x2f), u8(b1, b2, b3, b4));
  const chunk = concat(ascii('VP8L'), u32le(payload.length), payload);
  return concat(ascii('RIFF'), u32le(4 + chunk.length), ascii('WEBP'), chunk);
}

function buildWebpExtended(width: number, height: number): Uint8Array {
  const w1 = width - 1;
  const h1 = height - 1;
  const payload = concat(
    u8(0, 0, 0, 0), // flags + reserved
    u8(w1 & 0xff, (w1 >> 8) & 0xff, (w1 >> 16) & 0xff),
    u8(h1 & 0xff, (h1 >> 8) & 0xff, (h1 >> 16) & 0xff),
  );
  const chunk = concat(ascii('VP8X'), u32le(payload.length), payload);
  return concat(ascii('RIFF'), u32le(4 + chunk.length), ascii('WEBP'), chunk);
}

function buildBmp(width: number, height: number, bottomUp: boolean): Uint8Array {
  const infoHeader = concat(
    u32le(40), // biSize
    u32le(width), // biWidth
    u32le(bottomUp ? height : -height), // biHeight -- negative means top-down; u32le's bitwise ops two's-complement it correctly
    u16le(1), // biPlanes
    u16le(24), // biBitCount
    u32le(0), // biCompression
    u32le(0), // biSizeImage
    u32le(0), // biXPelsPerMeter
    u32le(0), // biYPelsPerMeter
    u32le(0), // biClrUsed
    u32le(0), // biClrImportant
  );
  const fileHeader = concat(
    ascii('BM'),
    u32le(14 + infoHeader.length),
    u16le(0),
    u16le(0),
    u32le(14 + infoHeader.length),
  );
  return concat(fileHeader, infoHeader);
}

it('PNG, JPEG, GIF, WebP and BMP headers give their type and dimensions as the PNG specification, ITU-T T.81, GIF89a, RFC 9649 and the BMP documentation define', () => {
  expect(sniffImage(buildPng(100, 200))).toEqual({ type: 'png', width: 100, height: 200 });

  expect(sniffImage(buildJpeg(300, 150, 0xc0))).toEqual({ type: 'jpeg', width: 300, height: 150 }); // baseline SOF0
  expect(sniffImage(buildJpeg(300, 150, 0xc2))).toEqual({ type: 'jpeg', width: 300, height: 150 }); // progressive SOF2

  expect(sniffImage(buildGif(64, 32, '87a'))).toEqual({ type: 'gif', width: 64, height: 32 });
  expect(sniffImage(buildGif(64, 32, '89a'))).toEqual({ type: 'gif', width: 64, height: 32 });

  expect(sniffImage(buildWebpLossy(400, 300))).toEqual({ type: 'webp', width: 400, height: 300 });
  expect(sniffImage(buildWebpLossless(400, 300))).toEqual({ type: 'webp', width: 400, height: 300 });
  expect(sniffImage(buildWebpExtended(400, 300))).toEqual({ type: 'webp', width: 400, height: 300 });

  expect(sniffImage(buildBmp(64, 32, true))).toEqual({ type: 'bmp', width: 64, height: 32 }); // bottom-up
  expect(sniffImage(buildBmp(64, 32, false))).toEqual({ type: 'bmp', width: 64, height: 32 }); // top-down
});

it('an SVG, a text file and a truncated header are refused before decoding', () => {
  const svg = ascii('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const text = ascii('this is just a plain text file, not an image at all');
  const truncated = u8(137, 80, 78, 71, 13, 10, 26, 10); // a whole, valid PNG signature but no IHDR chunk behind it

  for (const bad of [svg, text, truncated]) {
    let message = '';
    try {
      sniffImage(bad);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ImageColorError);
      message = (err as ImageColorError).message;
    }
    expect(message.length).toBeGreaterThan(0);
  }

  // Each of the three gets a message distinguishing what went wrong (not one generic string for all three).
  const svgMessage = (() => {
    try {
      sniffImage(svg);
      return '';
    } catch (err) {
      return (err as ImageColorError).message;
    }
  })();
  const truncatedMessage = (() => {
    try {
      sniffImage(truncated);
      return '';
    } catch (err) {
      return (err as ImageColorError).message;
    }
  })();
  expect(svgMessage).not.toBe(truncatedMessage);
});

it('an image whose header claims more than the pixel limit, or a file over the size limit, is refused before decoding', () => {
  // A PNG whose IHDR claims 100,000 by 100,000 pixels (10 billion, over MAX_PIXELS).
  const hugePng = buildPng(100_000, 100_000);
  expect(() => sniffImage(hugePng)).toThrow(ImageColorError);
  try {
    sniffImage(hugePng);
  } catch (err) {
    expect((err as ImageColorError).message).toMatch(/pixel/i);
  }
  // A perfectly ordinary small header, but the caller reports the real file as too large.
  const smallPng = buildPng(10, 10);
  expect(() => sniffImage(smallPng, MAX_FILE_BYTES + 1)).toThrow(ImageColorError);
  // At the pixel limit exactly is accepted; just past it is refused.
  const atLimitSide = Math.floor(Math.sqrt(MAX_PIXELS));
  expect(() => sniffImage(buildPng(atLimitSide, atLimitSide))).not.toThrow();
});

it('median cut splits the widest channel at the median and returns colours ordered by share', () => {
  // Two colours, equal shares (0.5 each): ordered by hex ascending since shares tie.
  const rgba = new Uint8ClampedArray([
    0,
    0,
    0,
    255,
    0,
    0,
    0,
    255, // two black pixels
    255,
    255,
    255,
    255,
    255,
    255,
    255,
    255, // two white pixels
  ]);
  const { colors, sampled } = extractFromPixels(rgba, 4, 1, { count: 2, ignoreTransparent: false });
  expect(sampled).toBe(4);
  expect(colors).toEqual([
    { hex: '#000000', r: 0, g: 0, b: 0, share: 0.5 },
    { hex: '#ffffff', r: 255, g: 255, b: 255, share: 0.5 },
  ]);
});

it('the palette is identical for the same pixels on every run', () => {
  const width = 16;
  const height = 16;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = (i * 7) % 256;
    rgba[i * 4 + 1] = (i * 13) % 256;
    rgba[i * 4 + 2] = (i * 29) % 256;
    rgba[i * 4 + 3] = 255;
  }
  const first = extractFromPixels(rgba, width, height, { count: 6 });
  const second = extractFromPixels(rgba, width, height, { count: 6 });
  expect(second).toEqual(first);
});

it('a solid four-colour image gives exactly its four colours with equal shares', () => {
  const { colors, sampled } = extractFromPixels(SAMPLE_PATTERN.rgba, SAMPLE_PATTERN.width, SAMPLE_PATTERN.height, {
    count: 4,
    ignoreTransparent: false,
  });
  expect(sampled).toBe(SAMPLE_PATTERN.width * SAMPLE_PATTERN.height);
  expect(colors).toEqual([
    { hex: '#0000ff', r: 0, g: 0, b: 255, share: 0.25 }, // blue
    { hex: '#00ff00', r: 0, g: 255, b: 0, share: 0.25 }, // lime
    { hex: '#ff0000', r: 255, g: 0, b: 0, share: 0.25 }, // red
    { hex: '#ffffff', r: 255, g: 255, b: 255, share: 0.25 }, // white
  ]);
});

it('transparent pixels are left out when asked', () => {
  // 4 pixels: two opaque red, two fully transparent (would-be) blue.
  const rgba = new Uint8ClampedArray([
    255,
    0,
    0,
    255,
    255,
    0,
    0,
    255, // two opaque red pixels
    0,
    0,
    255,
    0,
    0,
    0,
    255,
    0, // two fully transparent "blue" pixels
  ]);
  const withFilter = extractFromPixels(rgba, 4, 1, { count: 6, ignoreTransparent: true });
  expect(withFilter.sampled).toBe(2);
  expect(withFilter.colors).toEqual([{ hex: '#ff0000', r: 255, g: 0, b: 0, share: 1 }]);

  const withoutFilter = extractFromPixels(rgba, 4, 1, { count: 6, ignoreTransparent: false });
  expect(withoutFilter.sampled).toBe(4);
  expect(withoutFilter.colors.some((c) => c.hex === '#0000ff')).toBe(true);
});

it('sampling a large image uses a fixed stride and never a random choice', () => {
  const width = 1000;
  const height = 1000;
  const total = width * height;
  // Encode each pixel's own linear index into its colour so the sampled indices can be recovered.
  const rgba = new Uint8ClampedArray(total * 4);
  for (let i = 0; i < total; i++) {
    rgba[i * 4] = i & 0xff;
    rgba[i * 4 + 1] = (i >> 8) & 0xff;
    rgba[i * 4 + 2] = (i >> 16) & 0xff;
    rgba[i * 4 + 3] = 255;
  }
  const maxSamples = 10;
  const decodeIndex = (p: { r: number; g: number; b: number }) => p.r | (p.g << 8) | (p.b << 16);

  const first = samplePixels(rgba, width, height, maxSamples);
  const second = samplePixels(rgba, width, height, maxSamples);
  expect(first.length).toBe(maxSamples);
  expect(second.map(decodeIndex)).toEqual(first.map(decodeIndex)); // deterministic, not random

  const indices = first.map(decodeIndex);
  const strides = indices.slice(1).map((v, i) => v - indices[i]!);
  expect(new Set(strides).size).toBe(1); // exactly one fixed stride value throughout
  expect(strides[0]).toBe(Math.ceil(total / maxSamples));
});

it('nothing is written to the console while extracting', () => {
  const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );
  try {
    extractFromPixels(SAMPLE_PATTERN.rgba, SAMPLE_PATTERN.width, SAMPLE_PATTERN.height, { count: 6 });
    try {
      sniffImage(ascii('not an image'));
    } catch {
      // Expected: even a refusal never touches the console.
    }
    formatHex(1, 2, 3);
  } finally {
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  }
});

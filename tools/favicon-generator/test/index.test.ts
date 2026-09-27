import { it, expect, vi } from 'vitest';
import { buildIco, readIcoDirectory, FaviconError } from '../src/ico';
import { FAVICON_SET, ICO_SIZES, linkTags, manifestJson, validateTextSource } from '../src/favicon-set';
import { planFavicon } from '../src/index';

/**
 * Top-level `it(...)` calls, never nested in `describe(...)`: Vitest's JSON
 * reporter concatenates the describe name into `fullName`, and this
 * project's own verify scripts match required titles by exact equality.
 */

function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

/** A minimal, header-valid PNG (signature + IHDR only): enough for buildIco's own sniffFile check, which never reads IDAT. */
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

it('the ICO file has the header and directory entries the Microsoft ICO format defines, one PNG image per size', () => {
  const images = [16, 32, 48].map((size) => ({ width: size, height: size, bytes: minimalPng(size, size) }));
  const ico = buildIco(images);

  // ICONDIR: reserved=0, type=1, count=3.
  expect(ico[0]).toBe(0);
  expect(ico[1]).toBe(0);
  expect(ico[2]).toBe(1);
  expect(ico[3]).toBe(0);
  expect(ico[4]).toBe(3);
  expect(ico[5]).toBe(0);

  const entries = readIcoDirectory(ico);
  expect(entries).toHaveLength(3);
  expect(entries.map((e) => e.width)).toEqual([16, 32, 48]);
  expect(entries.map((e) => e.height)).toEqual([16, 32, 48]);

  // Each entry's own bytes, at its own offset, are the exact PNG bytes given.
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const slice = ico.subarray(entry.imageOffset, entry.imageOffset + entry.bytesInResource);
    expect(slice).toEqual(images[i]!.bytes);
    expect(entry.bytesInResource).toBe(images[i]!.bytes.length);
  }
});

it('a 256 pixel entry is written with a width and height of zero as the ICO format defines', () => {
  const images = [{ width: 256, height: 256, bytes: minimalPng(256, 256) }];
  const ico = buildIco(images);
  // The one ICONDIRENTRY starts at byte 6; its width and height bytes are 0 and 0.
  expect(ico[6]).toBe(0);
  expect(ico[7]).toBe(0);

  const entries = readIcoDirectory(ico);
  expect(entries[0]!.width).toBe(256);
  expect(entries[0]!.height).toBe(256);
});

it('the favicon set has the sizes and file names the HTML link, Apple touch icon and web app manifest documents describe', () => {
  const byName = Object.fromEntries(FAVICON_SET.map((e) => [e.name, e]));
  expect(byName['favicon.ico']).toBeDefined();
  expect(byName['favicon-16x16.png']?.size).toBe(16);
  expect(byName['favicon-32x32.png']?.size).toBe(32);
  expect(byName['apple-touch-icon.png']?.size).toBe(180);
  expect(byName['android-chrome-192x192.png']?.size).toBe(192);
  expect(byName['android-chrome-512x512.png']?.size).toBe(512);
  expect(ICO_SIZES).toEqual([16, 32, 48]);
});

it('the link tags and manifest text list every generated file with its size and type and escape the site name', () => {
  const tags = linkTags();
  for (const name of ['favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png']) {
    expect(tags).toContain(name);
  }
  expect(tags).toContain('sizes="180x180"');
  expect(tags).toContain('type="image/png"');

  const manifest = manifestJson({ appName: 'My "site" & co', background: '#ffffff', foreground: '#000000' });
  expect(manifest).toContain('android-chrome-192x192.png');
  expect(manifest).toContain('android-chrome-512x512.png');
  expect(manifest).toContain('"sizes": "192x192"');
  expect(manifest).toContain('"sizes": "512x512"');
  expect(manifest).toContain('"type": "image/png"');
  // A hostile site name (a double quote and an ampersand) comes out
  // JSON-escaped, never breaking the surrounding string.
  expect(() => JSON.parse(manifest)).not.toThrow();
  const parsed = JSON.parse(manifest) as { name: string };
  expect(parsed.name).toBe('My "site" & co');
});

it('text sources take one to three graphemes and emoji sources exactly one', () => {
  expect(() => validateTextSource('text', 'A')).not.toThrow();
  expect(() => validateTextSource('text', 'Ab')).not.toThrow();
  expect(() => validateTextSource('text', 'Abc')).not.toThrow();
  expect(() => validateTextSource('text', 'Abcd')).toThrow(FaviconError);
  expect(() => validateTextSource('text', '')).toThrow(FaviconError);

  // A single emoji (one code point) is exactly one grapheme.
  expect(() => validateTextSource('emoji', '🎉')).not.toThrow();
  // Two separate emoji is two graphemes: refused.
  expect(() => validateTextSource('emoji', '🎉🎊')).toThrow(FaviconError);
  // A family emoji joined by zero-width joiners is one grapheme, even
  // though it is several Unicode code points.
  expect(() => validateTextSource('emoji', '👨‍👩‍👧‍👦')).not.toThrow();
});

it('nothing is written to the console while building the icon set', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    planFavicon({
      source: 'text',
      text: 'Ab',
      emoji: '',
      fit: 'cover',
      shape: 'square',
      foreground: 'not-a-colour',
      background: '#ffffff',
      transparent: false,
      font: 'sans-serif',
      bold: true,
      appName: 'My site',
    });
    buildIco([{ width: 16, height: 16, bytes: minimalPng(16, 16) }]);
    linkTags();
    manifestJson({ appName: 'My site', background: '#ffffff', foreground: '#000000' });
    try {
      validateTextSource('text', 'Too long');
    } catch {
      // expected refusal; the point here is console silence, not the throw
    }
  } finally {
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  }
});

it('planFavicon clamps an invalid colour with a warning naming the field', () => {
  const plan = planFavicon({
    source: 'text',
    text: 'Ab',
    emoji: '',
    fit: 'cover',
    shape: 'square',
    foreground: 'not-a-colour',
    background: '#ffffff',
    transparent: false,
    font: 'sans-serif',
    bold: true,
    appName: 'My site',
  });
  expect(plan.foreground).toBe('#000000');
  expect(plan.warnings.some((w) => w.includes("'foreground'"))).toBe(true);
});

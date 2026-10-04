import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect, it, vi } from 'vitest';
import QRCode from 'qrcode';
import {
  checkImageFile,
  CodeReaderError,
  codeRows,
  MAX_INPUT_BYTES,
  MAX_INPUT_PIXELS,
  meta as toolMeta,
  prepareReader,
  readCodes,
} from '../src/index';
import { MAX_TEXT_SHOWN, toCodeResult, visible } from '../src/results';
import { rasterizeMatrix } from './raster';

/**
 * Top-level `it(...)` calls, never nested in `describe(...)`: Vitest's JSON reporter concatenates the describe name
 * into `fullName`, and this project's verify scripts match required titles by exact equality.
 *
 * Expected values come from the payload each QR code was made from (ISO/IEC 18004 round trip), from the characters the
 * specification of the escape names, and from the limits written in meta.json -- never from this package's own output.
 */

const BS = String.fromCharCode(92);

beforeAll(async () => {
  const bytes = readFileSync(
    fileURLToPath(new URL('../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm', import.meta.url)),
  );
  await prepareReader(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}, 60_000);

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

function qrPixels(text: string, level: 'L' | 'M' | 'Q' | 'H', scale = 4) {
  const qr = QRCode.create(text, { errorCorrectionLevel: level });
  const r = rasterizeMatrix({ size: qr.modules.size, modules: qr.modules.data }, 4, scale);
  return { data: r.rgba, width: r.width, height: r.height };
}

it('a QR code made by the qrcode 1.5.4 library reads back to its exact text at error correction levels L, M, Q and H', async () => {
  const payloads = [
    'FODT-VISION-WORKER',
    'Hello, world',
    'https://example.com/path?a=1&b=two#frag',
    'Gr' + String.fromCodePoint(0xfc, 0xdf) + 'e ' + String.fromCodePoint(0x4e16, 0x754c, 0x1f600),
  ];
  for (const level of ['L', 'M', 'Q', 'H'] as const) {
    for (const payload of payloads) {
      const codes = await readCodes(qrPixels(payload, level));
      expect(codes.length, `${level} ${payload}`).toBe(1);
      expect(codes[0]!.format).toBe('QRCode');
      expect(codes[0]!.label).toBe('QR Code');
      expect(codes[0]!.text).toBe(payload);
      expect(codes[0]!.shown).toBe(payload);
      expect(codes[0]!.truncated).toBe(false);
    }
  }
  const rows = codeRows(await readCodes(qrPixels('FODT-VISION-WORKER', 'M')));
  expect(rows).toEqual([['QR Code', 'FODT-VISION-WORKER', '']]);
}, 60_000);

it('decoded text shows control and bidirectional characters escaped and caps what is shown', () => {
  const rlo = String.fromCodePoint(0x202e);
  const nul = String.fromCodePoint(0);
  const esc = String.fromCodePoint(0x1b);
  expect(visible(`a${rlo}b${nul}c${esc}d`)).toBe(`a${BS}u{202E}b${BS}u{0}c${BS}u{1B}d`);
  // Tab, line feed and ordinary letters stay as they are.
  expect(visible('x\ty\nz')).toBe('x\ty\nz');
  // The other marks the specification of the escape names: DEL, C1, the Arabic letter mark, LRM, RLM, embeddings, isolates.
  const marks = [0x7f, 0x80, 0x9f, 0x61c, 0x200e, 0x200f, 0x202a, 0x202d, 0x2066, 0x2069];
  for (const cp of marks) {
    expect(visible(String.fromCodePoint(cp))).toBe(`${BS}u{${cp.toString(16).toUpperCase()}}`);
  }

  const long = toCodeResult({ format: 'QRCode', text: 'a'.repeat(MAX_TEXT_SHOWN + 904) });
  expect(MAX_TEXT_SHOWN).toBe(4096);
  expect(long.truncated).toBe(true);
  expect(long.shown.length).toBeLessThanOrEqual(MAX_TEXT_SHOWN);
  expect(long.text.length).toBe(MAX_TEXT_SHOWN + 904);
  expect(long.notes.some((n) => n.includes('4096'))).toBe(true);

  const short = toCodeResult({ format: 'QRCode', text: 'short' });
  expect(short.truncated).toBe(false);
  expect(short.notes).toEqual([]);
});

it('an image over 50 MB or declaring more than 50000000 pixels is refused before decoding with a plain message', () => {
  expect(MAX_INPUT_BYTES).toBe(52428800);
  expect(MAX_INPUT_PIXELS).toBe(50000000);

  // Over the byte limit: refused from the reported size, whatever the header says.
  expect(() => checkImageFile(pngHeader(10, 10), 52428801)).toThrow(CodeReaderError);
  expect(() => checkImageFile(pngHeader(10, 10), 52428801)).toThrow(/50 MB/);
  // Exactly the limit is accepted.
  expect(checkImageFile(pngHeader(10, 10), 52428800)).toEqual({ kind: 'png', width: 10, height: 10 });

  // 10000 by 5001 is 50,010,000 pixels: over. 10000 by 5000 is exactly the limit: accepted.
  expect(() => checkImageFile(pngHeader(10000, 5001), 1000)).toThrow(CodeReaderError);
  expect(() => checkImageFile(pngHeader(10000, 5001), 1000)).toThrow(/50,000,000/);
  expect(checkImageFile(pngHeader(10000, 5000), 1000)).toEqual({ kind: 'png', width: 10000, height: 5000 });

  // An empty file is refused in plain words too.
  expect(() => checkImageFile(new Uint8Array(0), 0)).toThrow(/empty/);
});

it('an SVG, a text file and a truncated image header are refused before decoding', () => {
  const marker = 'FODT-MARKER-NOT-IN-MESSAGES';
  const svg = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg"><text>${marker}</text></svg>`);
  const text = new TextEncoder().encode(`just plain text, not an image at all ${marker}`);
  const truncated = pngHeader(10, 10).slice(0, 10);

  for (const bytes of [svg, text, truncated]) {
    let message = '';
    try {
      checkImageFile(bytes, bytes.length);
    } catch (err) {
      expect(err).toBeInstanceOf(CodeReaderError);
      message = (err as Error).message;
    }
    expect(message).not.toBe('');
    expect(message).toContain('PNG, JPEG, GIF, WebP or BMP');
    // A message describes the problem and never carries any content of the file.
    expect(message).not.toContain(marker);
    expect(message).not.toContain('svg');
  }
});

it('meta pins zxing-wasm 3.1.3 exactly and its compiled engine notice names zxing-wasm', () => {
  expect(toolMeta.dependencies).toEqual({ 'zxing-wasm': '3.1.3' });
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
    dependencies: Record<string, string>;
  };
  expect(pkg.dependencies['zxing-wasm']).toBe('3.1.3');

  const notice = toolMeta.bundledData.find((b) => b.name.includes('zxing-wasm'));
  expect(notice).toBeDefined();
  expect(notice!.licence).toBe('Apache-2.0');
  expect(notice!.noticeFile).toBe('src/zxing-cpp-NOTICE.txt');
  const file = fileURLToPath(new URL('../src/zxing-cpp-NOTICE.txt', import.meta.url));
  expect(existsSync(file)).toBe(true);
  expect(readFileSync(file, 'utf8')).toContain('Apache License');
});

it('nothing is written to the console while reading codes', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const found = await readCodes(qrPixels('FODT-VISION-WORKER', 'M'));
    expect(found).toHaveLength(1);
    const blank = { data: new Uint8ClampedArray(64 * 64 * 4).fill(255), width: 64, height: 64 };
    expect(await readCodes(blank)).toEqual([]);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  }
}, 60_000);

/** The 26 bytes of a BMP the header check reads: "BM", the file header, a 40 byte info header size, width, height. */
function bmpHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(26);
  bytes.set([0x42, 0x4d], 0);
  bytes[10] = 54;
  bytes[14] = 40;
  const view = new DataView(bytes.buffer);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  return bytes;
}

it('a BMP or PNG with a negative, zero or unreadable size is refused with a plain size message, not accepted', () => {
  expect(checkImageFile(bmpHeader(10, 10), 1000)).toEqual({ kind: 'bmp', width: 10, height: 10 });
  expect(checkImageFile(bmpHeader(10, -10), 1000)).toEqual({ kind: 'bmp', width: 10, height: 10 });
  for (const header of [
    bmpHeader(-100_000, 100_000),
    bmpHeader(-2_147_483_648, 2_000_000_000),
    bmpHeader(0, 5),
    bmpHeader(5, 0),
    bmpHeader(10, 10).slice(0, 22),
    pngHeader(0, 5),
    pngHeader(5, 0),
  ]) {
    expect(() => checkImageFile(header, 1000)).toThrow(CodeReaderError);
    expect(() => checkImageFile(header, 1000)).toThrow(/size of this image could not be read/);
  }
});

it('invisible format characters are shown as escapes: soft hyphen, zero width marks, line and paragraph separators, word joiners, the byte order mark and tag characters', () => {
  const escaped = [
    0xad, 0x200b, 0x200c, 0x200d, 0x2028, 0x2029, 0x2060, 0x2061, 0x2064, 0xfeff, 0xe0001, 0xe0041, 0xe007f,
  ];
  for (const cp of escaped) {
    expect(visible(`a${String.fromCodePoint(cp)}b`)).toBe(`a${BS}u{${cp.toString(16).toUpperCase()}}b`);
  }
  // A run of tag characters spelling a word is escaped one by one and none is left as itself.
  const tagged = Array.from('hidden', (c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join('');
  expect(visible(tagged)).toBe(
    Array.from('hidden', (c) => `${BS}u{${(0xe0000 + c.charCodeAt(0)).toString(16).toUpperCase()}}`).join(''),
  );
  // Characters next to them in the tables stay as they are: a hyphen, a no-break space, U+2065 (unassigned), a letter, an emoji.
  const kept = [
    '-',
    String.fromCodePoint(0xa0),
    String.fromCodePoint(0x2065),
    'z',
    String.fromCodePoint(0x1f600),
    String.fromCodePoint(0xe0080),
  ];
  for (const text of kept) expect(visible(text)).toBe(text);
});

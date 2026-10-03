import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect, it } from 'vitest';
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from '@zxing/library';
import { prepareReader, readCodes, type ImagePixels } from '../src/index';
import { SYMBOLOGY_LABELS, toCodeResult, visible } from '../src/results';
import { INDEPENDENT_CODES, SCREEN_PHOTOS } from './fixtures/independent-codes';
import { REPOSITORY_BARCODES } from './fixtures/repository-barcodes';
import { rasterizeBarsSvg, rasterizeMatrix } from './raster';

/**
 * Top-level `it(...)` calls, never nested in `describe(...)`: Vitest's JSON reporter concatenates the describe name into
 * `fullName`, and this project's verify scripts match required titles by exact equality.
 *
 * Where every expected value comes from (no test here treats this package's own output, or any other site, as the
 * answer):
 *  - the independent images: the data given to BWIPP (through treepoem 3.29.0 and Ghostscript 10.07.1) and the symbology
 *    asked for; test/fixtures/make-fixtures.py wrote them;
 *  - the symbols this repository writes: the data given to its writer, with the GS1 General Specifications' check digit
 *    and its rule that UPC-A is an EAN-13 symbol with an implied leading zero; the ZXing library 0.21.3 is run on the same
 *    pictures as a second opinion;
 *  - QR codes: the payload each was made from by the qrcode 1.5.4 library (ISO/IEC 18004 round trip), with jsQR as a
 *    second opinion.
 * Second opinion from an independent run of the same engine's own Python build (zxing-cpp 3.1.1), recorded when the
 * fixtures were made, over the 15 independent images: 13 read as written, the Code 93 symbol made without check
 * characters read nothing, and the UPC-E symbol read as the 13 digit expansion 0012345000065.
 */

beforeAll(async () => {
  const bytes = readFileSync(
    fileURLToPath(new URL('../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm', import.meta.url)),
  );
  await prepareReader(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}, 60_000);

/** Decodes a base64 PNG or JPEG to RGBA pixels through a Node canvas, a decoder separate from the reading engine. */
async function pixelsOf(base64: string): Promise<ImagePixels> {
  const image = await loadImage(Buffer.from(base64, 'base64'));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, image.width, image.height).data;
  return {
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    width: image.width,
    height: image.height,
  };
}

/** The two documented exceptions of the independent images, by name, each with the reason. */
const INDEPENDENT_EXCEPTIONS = [
  {
    name: 'code93-no-check',
    reason:
      'A Code 93 symbol is valid only with its two check characters; BWIPP writes them only when asked, so this symbol is not a valid Code 93 symbol and is not read',
  },
  {
    name: 'upce',
    reason:
      'A UPC-E symbol is read as the 13 digit code it expands to (0012345000065), not as the 8 digits written, and a note says so',
  },
];

it('the independent writer images read as their symbology and text, with Code 93 without check characters and UPC-E listed as documented exceptions', async () => {
  expect(INDEPENDENT_CODES).toHaveLength(15);
  const exceptionNames = INDEPENDENT_EXCEPTIONS.map((e) => e.name);
  for (const e of INDEPENDENT_EXCEPTIONS) expect(e.reason.length).toBeGreaterThan(40);
  let read = 0;
  for (const code of INDEPENDENT_CODES) {
    const found = await readCodes(await pixelsOf(code.png));
    if (exceptionNames.includes(code.name)) continue;
    const hit = found.find((r) => r.format === code.format && r.text === code.text);
    expect(
      hit,
      `${code.name} (${code.writtenAs}) read as ${JSON.stringify(found.map((r) => [r.format, r.text]))}`,
    ).toBeDefined();
    read++;
  }
  expect(read).toBe(13);

  // The exceptions, as they actually behave, so a change in the engine shows up here.
  const noCheck = INDEPENDENT_CODES.find((c) => c.name === 'code93-no-check')!;
  expect(await readCodes(await pixelsOf(noCheck.png))).toEqual([]);
  const upce = INDEPENDENT_CODES.find((c) => c.name === 'upce')!;
  const expanded = await readCodes(await pixelsOf(upce.png));
  expect(expanded).toHaveLength(1);
  expect(expanded[0]!.format).toBe('UPCE');
  expect(expanded[0]!.label).toBe('UPC-E');
  expect(expanded[0]!.text).toBe('0012345000065');
  expect(expanded[0]!.notes.some((n) => n.includes('13 digit'))).toBe(true);
}, 60_000);

/** Reads a luminance picture with the ZXing library (0.21.3) for one barcode format, the second opinion. */
function zxingLibraryText(luminance: Uint8ClampedArray, width: number, height: number, format: BarcodeFormat): string {
  const source = new RGBLuminanceSource(luminance, width, height);
  const bitmap = new BinaryBitmap(new HybridBinarizer(source));
  const reader = new MultiFormatReader();
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [format]);
  return reader.decode(bitmap, hints).getText();
}

it('Code 128, EAN-13, EAN-8 and UPC-A symbols written by this repository read back and agree with the ZXing library second opinion', async () => {
  expect(REPOSITORY_BARCODES).toHaveLength(14);
  const libraryFormats: Record<string, BarcodeFormat> = {
    Code128: BarcodeFormat.CODE_128,
    EAN13: BarcodeFormat.EAN_13,
    EAN8: BarcodeFormat.EAN_8,
  };
  for (const symbol of REPOSITORY_BARCODES) {
    const raster = rasterizeBarsSvg(symbol.svg, 3, 30);
    const found = await readCodes({ data: raster.rgba, width: raster.width, height: raster.height });
    expect(found, symbol.name).toHaveLength(1);
    expect(found[0]!.format, symbol.name).toBe(symbol.format);
    expect(found[0]!.text, symbol.name).toBe(symbol.readText);

    // The ZXing library reads the same picture. A UPC-A symbol is an EAN-13 symbol with a leading zero, which the library
    // also reports as 13 digits when it is asked for EAN-13.
    const second = zxingLibraryText(raster.luminance, raster.width, raster.height, libraryFormats[symbol.format]!);
    expect(second, `${symbol.name} (second opinion)`).toBe(symbol.readText);
  }
}, 60_000);

const QR_PAYLOADS: Record<string, string> = {
  hello: 'Hello, world',
  url: 'https://example.com/path?x=1&y=two',
  long: 'The quick brown fox jumps over the lazy dog. '.repeat(8).trim(),
  wifi: 'WIFI:T:WPA;S:MyNet;P:pa55word;;',
  utf8:
    'h' +
    String.fromCodePoint(0xe9) +
    'llo w' +
    String.fromCodePoint(0xf6, 0x72) +
    'ld ' +
    String.fromCodePoint(0x2713, 0x20, 0x65e5, 0x672c, 0x8a9e),
  digits: '01234567890123456789',
  vcard:
    'BEGIN:VCARD' +
    String.fromCharCode(10) +
    'VERSION:3.0' +
    String.fromCharCode(10) +
    'FN:Ada Lovelace' +
    String.fromCharCode(10) +
    'END:VCARD',
};

it('QR codes at four levels and two scales agree with jsQR as a second opinion', async () => {
  let count = 0;
  for (const [key, payload] of Object.entries(QR_PAYLOADS)) {
    for (const level of ['L', 'M', 'Q', 'H'] as const) {
      for (const scale of [3, 8]) {
        const qr = QRCode.create(payload, { errorCorrectionLevel: level });
        const raster = rasterizeMatrix({ size: qr.modules.size, modules: qr.modules.data }, 4, scale);
        const label = `${key} ${level} scale ${scale}`;
        const found = await readCodes({ data: raster.rgba, width: raster.width, height: raster.height });
        expect(found, label).toHaveLength(1);
        expect(found[0]!.format, label).toBe('QRCode');
        expect(found[0]!.text, label).toBe(payload);
        const second = jsQR(raster.rgba, raster.width, raster.height, { inversionAttempts: 'dontInvert' });
        expect(second?.data, `${label} (second opinion)`).toBe(payload);
        count++;
      }
    }
  }
  expect(count).toBe(56);
}, 120_000);

/** One picture turned the way the test name says, with exact pixel moves, so no resampling filter is involved. */
function transform(p: ImagePixels, how: 'rot90' | 'rot180' | 'rot270' | 'invert' | 'half'): ImagePixels {
  const { data, width, height } = p;
  if (how === 'invert') {
    const out = new Uint8ClampedArray(data.length);
    for (let i = 0; i < data.length; i += 4) {
      out[i] = 255 - data[i]!;
      out[i + 1] = 255 - data[i + 1]!;
      out[i + 2] = 255 - data[i + 2]!;
      out[i + 3] = 255;
    }
    return { data: out, width, height };
  }
  if (how === 'half') {
    const w = Math.max(1, Math.floor(width / 2));
    const h = Math.max(1, Math.floor(height / 2));
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let channel = 0; channel < 3; channel++) {
          let sum = 0;
          for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) sum += data[((y * 2 + dy) * width + x * 2 + dx) * 4 + channel]!;
          }
          out[(y * w + x) * 4 + channel] = Math.round(sum / 4);
        }
        out[(y * w + x) * 4 + 3] = 255;
      }
    }
    return { data: out, width: w, height: h };
  }
  const swap = how !== 'rot180';
  const w = swap ? height : width;
  const h = swap ? width : height;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let nx: number;
      let ny: number;
      if (how === 'rot90') {
        nx = height - 1 - y;
        ny = x;
      } else if (how === 'rot180') {
        nx = width - 1 - x;
        ny = height - 1 - y;
      } else {
        nx = y;
        ny = width - 1 - x;
      }
      const from = (y * width + x) * 4;
      const to = (ny * w + nx) * 4;
      out[to] = data[from]!;
      out[to + 1] = data[from + 1]!;
      out[to + 2] = data[from + 2]!;
      out[to + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * The twelve clean independent images that are turned, and every turned copy the engine does not read, by name and
 * variant, with the reason. A copy missing from this list must read; a copy in it must not (so the list stays honest).
 */
const TURNED_BASES = [
  'qr',
  'code128',
  'code39',
  'ean13',
  'ean8',
  'itf',
  'codabar',
  'datamatrix',
  'pdf417',
  'aztec',
  'code93',
  'microqr',
];
const INVERTED_LINEAR =
  'The engine reads light-on-dark copies of QR, Micro QR, Data Matrix and Aztec codes, but not of one-dimensional barcodes or PDF417; the same engine built for Python (zxing-cpp 3.1.1, try_invert on) reads the same ones and misses the same ones';
const ROTATED_DATA_MATRIX =
  'A Data Matrix copy turned a quarter, half or three quarter turn is not read; the same engine in Python (zxing-cpp 3.1.1, try_rotate on) misses it too, which meta.json lists as a limit';
const HALF_EAN13 =
  'At half size each EAN-13 module is one and a half pixels wide, too narrow to tell apart; the same engine in Python misses it too';
const TURNED_MISSES: { copy: string; reason: string }[] = [
  { copy: 'codabar:invert', reason: INVERTED_LINEAR },
  { copy: 'code128:invert', reason: INVERTED_LINEAR },
  { copy: 'code39:invert', reason: INVERTED_LINEAR },
  { copy: 'code93:invert', reason: INVERTED_LINEAR },
  { copy: 'ean13:invert', reason: INVERTED_LINEAR },
  { copy: 'ean8:invert', reason: INVERTED_LINEAR },
  { copy: 'itf:invert', reason: INVERTED_LINEAR },
  { copy: 'pdf417:invert', reason: INVERTED_LINEAR },
  { copy: 'datamatrix:rot90', reason: ROTATED_DATA_MATRIX },
  { copy: 'datamatrix:rot180', reason: ROTATED_DATA_MATRIX },
  { copy: 'datamatrix:rot270', reason: ROTATED_DATA_MATRIX },
  { copy: 'ean13:half', reason: HALF_EAN13 },
];

it('rotated, inverted and half-scale copies read back and every documented miss is listed by name', async () => {
  expect(TURNED_BASES).toHaveLength(12);
  const misses: string[] = [];
  for (const name of TURNED_BASES) {
    const base = INDEPENDENT_CODES.find((c) => c.name === name)!;
    const clean = await pixelsOf(base.png);
    for (const how of ['rot90', 'rot180', 'rot270', 'invert', 'half'] as const) {
      const found = await readCodes(transform(clean, how));
      const hit = found.some((r) => r.format === base.format && r.text === base.text);
      if (!hit) misses.push(`${name}:${how}`);
    }
  }
  expect(misses.sort()).toEqual(TURNED_MISSES.map((m) => m.copy).sort());
  for (const m of TURNED_MISSES) expect(m.reason.length).toBeGreaterThan(20);
}, 120_000);

it('a UPC-A symbol comes back as EAN-13 with a leading zero and the note gives the 12 digit form', async () => {
  const upca = INDEPENDENT_CODES.find((c) => c.name === 'upca')!;
  const found = await readCodes(await pixelsOf(upca.png));
  expect(found).toHaveLength(1);
  expect(found[0]!.format).toBe('EAN13');
  expect(found[0]!.label).toBe('EAN-13');
  expect(found[0]!.text).toBe('0' + upca.data);
  expect(found[0]!.notes).toHaveLength(1);
  expect(found[0]!.notes[0]).toContain('UPC-A');
  expect(found[0]!.notes[0]).toContain(upca.data);

  // An EAN-13 symbol that does not start with a zero is not a UPC-A symbol and gets no such note.
  const ean = INDEPENDENT_CODES.find((c) => c.name === 'ean13')!;
  const plain = await readCodes(await pixelsOf(ean.png));
  expect(plain[0]!.text).toBe(ean.data);
  expect(plain[0]!.notes).toEqual([]);

  // The note needs exactly 13 digits that start with a zero.
  expect(toCodeResult({ format: 'EAN13', text: '0123456789012' }).notes).toHaveLength(1);
  expect(toCodeResult({ format: 'EAN13', text: '012345678901' }).notes).toEqual([]);
  expect(toCodeResult({ format: 'EAN13', text: '012345678901x' }).notes).toEqual([]);
  expect(toCodeResult({ format: 'Code128', text: '0123456789012' }).notes).toEqual([]);
});

it('symbology names from the engine are looked up safely for __proto__, constructor and toString', () => {
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    expect(SYMBOLOGY_LABELS.get(name), name).toBeUndefined();
    const r = toCodeResult({ format: name, text: 'x' });
    // An unknown name is shown as written.
    expect(r.label).toBe(name);
    expect(r.format).toBe(name);
  }
  // An unknown name is shown escaped when it holds a control character.
  const odd = 'odd' + String.fromCharCode(27);
  expect(toCodeResult({ format: odd, text: 'x' }).label).toBe(visible(odd));
  expect(toCodeResult({ format: odd, text: 'x' }).label).not.toContain(String.fromCharCode(27));
  // Known names give their plain label.
  expect(SYMBOLOGY_LABELS.get('QRCode')).toBe('QR Code');
  expect(SYMBOLOGY_LABELS.get('EAN13')).toBe('EAN-13');
});

/** The photograph of a screen style copies the engine does not read, by the image they were made from. */
const SCREEN_PHOTO_MISSES: string[] = [];

it('a photograph of a screen style copy still reads, or is listed by name', async () => {
  expect(SCREEN_PHOTOS).toHaveLength(3);
  const unreadable: string[] = [];
  for (const photo of SCREEN_PHOTOS) {
    const found = await readCodes(await pixelsOf(photo.jpeg));
    if (!found.some((r) => r.format === photo.format && r.text === photo.text)) unreadable.push(photo.base);
  }
  expect(unreadable).toEqual(SCREEN_PHOTO_MISSES);
}, 60_000);

it('a 12 megapixel image without a code is read in under 10 seconds', async () => {
  const width = 4000;
  const height = 3000;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const started = performance.now();
  const found = await readCodes({ data, width, height });
  const elapsed = performance.now() - started;
  expect(found).toEqual([]);
  expect(elapsed).toBeLessThan(10_000);
}, 60_000);

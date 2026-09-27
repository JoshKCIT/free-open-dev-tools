import { it, expect, vi } from 'vitest';
import {
  MultiFormatReader,
  RGBLuminanceSource,
  HybridBinarizer,
  BinaryBitmap,
  DecodeHintType,
  BarcodeFormat,
  Code128Reader,
  EAN13Reader,
} from '@zxing/library';
import {
  gs1CheckDigit,
  encodeEan13,
  encodeEan8,
  encodeUpcA,
  BarcodeError as EanUpcError,
  QUIET_ZONES,
} from '../src/ean-upc';
import { encodeCode128, CODE128_PATTERNS, BarcodeError as Code128Error } from '../src/code128';
import { generateBarcode, type Symbology } from '../src/index';
import { rasterizeBarsSvg } from './raster';

function decode(svg: string, format: (typeof BarcodeFormat)[keyof typeof BarcodeFormat]): string {
  const raster = rasterizeBarsSvg(svg, 3, 30);
  const source = new RGBLuminanceSource(raster.luminance, raster.width, raster.height);
  const bitmap = new BinaryBitmap(new HybridBinarizer(source));
  const reader = new MultiFormatReader();
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [format]);
  const result = reader.decode(bitmap, hints);
  return result.getText();
}

it('EAN-13, EAN-8 and UPC-A check digits match the GS1 General Specifications check digit calculation and its worked example', () => {
  // Table 7-9's own worked example: 18-digit field, data "37610425002123456", check digit 9.
  expect(gs1CheckDigit('37610425002123456')).toBe('9');
  // GS1's own worked UPC-A example (research, cross-checked by hand): body
  // "03600024145" gives check digit 7, full number "036000241457".
  expect(gs1CheckDigit('03600024145')).toBe('7');

  expect(encodeEan13('400638133393').text).toBe('4006381333931');
  expect(encodeEan8('4006381').text).toBe('40063812');
  expect(encodeUpcA('03600024145').text).toBe('036000241457');
});

it('a wrong check digit is refused with the expected digit named', () => {
  expect(() => encodeEan13('4006381333930')).toThrow(EanUpcError);
  try {
    encodeEan13('4006381333930');
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(EanUpcError);
    expect((err as Error).message).toContain('1');
  }

  expect(() => encodeUpcA('036000241450')).toThrow(EanUpcError);
  expect(() => encodeEan8('40063810')).toThrow(EanUpcError);
});

it('the Code 128 symbol check character is the modulo 103 weighted sum of the symbol values', () => {
  for (const text of ['Wikipedia', '123456', 'AB1234567890', 'Hello, World!']) {
    const result = encodeCode128(text);
    const withoutCheckAndStop = result.values.slice(0, -2);
    let sum = withoutCheckAndStop[0]!;
    for (let i = 1; i < withoutCheckAndStop.length; i++) sum += withoutCheckAndStop[i]! * i;
    expect(result.checkValue).toBe(sum % 103);
  }
});

it('the Code 128 bar and space patterns equal the ZXing Code 128 pattern table', () => {
  // CODE_PATTERNS is declared `private` in the installed type declarations
  // but is a real, accessible static property at runtime; the interface
  // cast below reaches it without `any`.
  const zxingPatterns = (Code128Reader as unknown as { CODE_PATTERNS: Int32Array[] }).CODE_PATTERNS;
  expect(zxingPatterns.length).toBe(CODE128_PATTERNS.length);
  for (let i = 0; i < zxingPatterns.length; i++) {
    expect(Array.from(zxingPatterns[i]!), `pattern ${i}`).toEqual(CODE128_PATTERNS[i]);
  }
});

it('the EAN and UPC digit patterns and the first digit parity equal the GS1 General Specifications tables', () => {
  const zxingL = (EAN13Reader as unknown as { L_PATTERNS: Int32Array[] }).L_PATTERNS;
  // Encode every digit 0-9 in EAN-13's right half (number set C, which
  // renders each digit's set-A width sequence starting with a bar instead
  // of a space) and compare against ZXing's own L_PATTERNS, read the same
  // way EAN13Reader.decodeMiddle itself reads the right half.
  for (let d = 0; d < 10; d++) {
    const digits = String(d).repeat(6);
    const r = encodeEan13('0'.repeat(6) + digits + gs1CheckDigit('0'.repeat(6) + digits));
    // Skip the guards/left-half/centre-guard: right half starts at 3+42+5=50.
    const rightHalfDigit0 = r.modules.slice(50, 57);
    const expectedWidths = Array.from(zxingL[d]!);
    // Rendered as bar-first (Set C): compare run lengths, not raw bits.
    const runs: number[] = [];
    let run = 1;
    for (let i = 1; i < rightHalfDigit0.length; i++) {
      if (rightHalfDigit0[i] === rightHalfDigit0[i - 1]) run++;
      else {
        runs.push(run);
        run = 1;
      }
    }
    runs.push(run);
    expect(runs, `digit ${d}`).toEqual(expectedWidths);
  }

  const firstDigitEncodings = (EAN13Reader as unknown as { FIRST_DIGIT_ENCODINGS: number[] }).FIRST_DIGIT_ENCODINGS;
  expect(firstDigitEncodings).toEqual([0x00, 0x0b, 0x0d, 0x0e, 0x13, 0x19, 0x1c, 0x15, 0x16, 0x1a]);
});

it('Code 128 code set choice gives a symbol no longer than a brute force search finds', () => {
  const alphabet = ['A', 'b', '1', '2', ' ', '!', String.fromCharCode(1)];
  function bruteForceMinSymbols(s: string): number {
    // Exhaustive search over every way to partition s into runs each fully
    // in set A, set B, or set C (C only for consecutive digit pairs), plus
    // the switches needed between runs and one start character.
    const memo = new Map<string, number>();
    function inA(c: string): boolean {
      const code = c.charCodeAt(0);
      return code >= 0 && code <= 95;
    }
    function inB(c: string): boolean {
      const code = c.charCodeAt(0);
      return code >= 32 && code <= 127;
    }
    function best(pos: number, currentSet: 'A' | 'B' | 'C' | null): number {
      if (pos === s.length) return 0;
      const key = `${pos}:${currentSet}`;
      if (memo.has(key)) return memo.get(key)!;
      let result = Infinity;
      for (const target of ['A', 'B', 'C'] as const) {
        const switchCost = currentSet === null ? 1 : target === currentSet ? 0 : 1;
        if (target === 'C') {
          if (pos + 1 < s.length && /[0-9]/.test(s[pos]!) && /[0-9]/.test(s[pos + 1]!)) {
            result = Math.min(result, switchCost + 1 + best(pos + 2, 'C'));
          }
        } else if (target === 'A') {
          if (inA(s[pos]!)) result = Math.min(result, switchCost + 1 + best(pos + 1, 'A'));
        } else {
          if (inB(s[pos]!)) result = Math.min(result, switchCost + 1 + best(pos + 1, 'B'));
        }
      }
      memo.set(key, result);
      return result;
    }
    return best(0, null);
  }

  function* combinations(length: number): Generator<string> {
    if (length === 0) {
      yield '';
      return;
    }
    for (const ch of alphabet) {
      for (const rest of combinations(length - 1)) {
        yield ch + rest;
      }
    }
  }

  for (let len = 1; len <= 4; len++) {
    for (const s of combinations(len)) {
      const result = encodeCode128(s);
      // values includes start + ... + check + stop; symbol count excluding
      // check and stop equals the brute-force count (start + switches + data).
      const ours = result.values.length - 2;
      const expected = bruteForceMinSymbols(s);
      expect(ours, `input ${JSON.stringify(s)}`).toBe(expected);
    }
  }
});

const KNOWN_DECODE_GAPS: Symbology[] = [];

it('every symbology decodes with the ZXing reader to the exact data', () => {
  const cases: { symbology: Symbology; data: string; format: number }[] = [
    { symbology: 'code128', data: 'Wikipedia', format: BarcodeFormat.CODE_128 },
    { symbology: 'code128', data: '123456', format: BarcodeFormat.CODE_128 },
    { symbology: 'ean13', data: '400638133393', format: BarcodeFormat.EAN_13 },
    { symbology: 'ean8', data: '4006381', format: BarcodeFormat.EAN_8 },
    { symbology: 'upca', data: '03600024145', format: BarcodeFormat.UPC_A },
  ];
  const gaps = new Set<Symbology>();
  for (const c of cases) {
    const { svg, text } = generateBarcode({ symbology: c.symbology, data: c.data });
    try {
      const decoded = decode(svg, c.format);
      const expected = c.symbology === 'code128' ? c.data : text;
      expect(decoded, c.symbology).toBe(expected);
    } catch {
      gaps.add(c.symbology);
    }
  }
  expect(Array.from(gaps).sort()).toEqual([...KNOWN_DECODE_GAPS].sort());
});

it('quiet zones are the widths the GS1 General Specifications set for each symbology', () => {
  expect(QUIET_ZONES.ean13).toEqual({ left: 11, right: 7 });
  expect(QUIET_ZONES.ean8).toEqual({ left: 7, right: 7 });
  expect(QUIET_ZONES.upca).toEqual({ left: 9, right: 9 });
});

it('UPC-A is encoded as the EAN-13 symbol with a leading zero as GS1 defines', () => {
  const upc = encodeUpcA('03600024145');
  const ean = encodeEan13('0036000241457');
  expect(upc.modules).toBe(ean.modules);
});

it('non-digit data for EAN and UPC and non-ASCII data for Code 128 are refused with the position', () => {
  try {
    encodeEan13('40063X133393');
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(EanUpcError);
    expect((err as InstanceType<typeof EanUpcError>).position).toBe(6);
  }

  try {
    encodeCode128('AB' + String.fromCharCode(200));
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(Code128Error);
    expect((err as InstanceType<typeof Code128Error>).position).toBe(3);
  }
});

it('the SVG output contains only rectangles and escaped text and nothing that can load a resource', () => {
  const { svg } = generateBarcode({ symbology: 'code128', data: 'Test & <Data>' });
  for (const forbidden of ['href', 'url(', '<script', '<image', '<foreignobject', ' on']) {
    expect(svg.toLowerCase()).not.toContain(forbidden);
  }
  expect(svg).toContain('Test &amp; &lt;Data&gt;');
  expect(svg).not.toContain('<Data>'); // raw, unescaped
});

it('nothing is written to the console while generating', () => {
  const spies = ['log', 'warn', 'error', 'info', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    generateBarcode({ symbology: 'code128', data: 'Hello' });
    generateBarcode({ symbology: 'ean13', data: '400638133393' });
    generateBarcode({ symbology: 'ean8', data: '4006381' });
    generateBarcode({ symbology: 'upca', data: '03600024145' });
  } finally {
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  }
});

import { it, expect, vi } from 'vitest';
import zlib from 'node:zlib';
import jsQR from 'jsqr';
import {
  MultiFormatReader,
  RGBLuminanceSource,
  HybridBinarizer,
  BinaryBitmap,
  DecodeHintType,
  BarcodeFormat,
} from '@zxing/library';
import {
  generateQr,
  buildPayload,
  matrixToSvg,
  matrixToPng,
  QrError,
  PAYLOAD_KINDS,
  VERSION_40_BYTE_CAPACITY,
  type ErrorCorrectionLevel,
} from '../src/index';
import { rasterizeMatrix, mulberry32 } from './raster';

const LEVELS: ErrorCorrectionLevel[] = ['L', 'M', 'Q', 'H'];

function decodeWithJsQr(matrix: { size: number; modules: Uint8Array }): string | null {
  const raster = rasterizeMatrix(matrix, 4, 4);
  const result = jsQR(raster.rgba, raster.width, raster.height, { inversionAttempts: 'dontInvert' });
  return result ? result.data : null;
}

function decodeWithZxing(matrix: { size: number; modules: Uint8Array }): string {
  const raster = rasterizeMatrix(matrix, 4, 6);
  const source = new RGBLuminanceSource(raster.luminance, raster.width, raster.height);
  const bitmap = new BinaryBitmap(new HybridBinarizer(source));
  const reader = new MultiFormatReader();
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
  const result = reader.decode(bitmap, hints);
  return result.getText();
}

const SAMPLE_FIELDS: Record<(typeof PAYLOAD_KINDS)[number], Record<string, unknown>> = {
  text: { text: 'Hello, world' },
  url: { url: 'https://example.invalid/a?b=c' },
  wifi: { ssid: 'MyNetwork', security: 'WPA', password: 'hunter2', hidden: false },
  vcard: { vcardVersion: '4.0', givenName: 'Jane', familyName: 'Doe', email: 'jane@example.invalid' },
  email: { to: 'user@example.invalid', subject: 'Hi', body: 'Hello there' },
  sms: { number: '+15551234567', message: 'Hi', smsScheme: 'sms' },
};

it('text, URL, WiFi, vCard, email and SMS payloads each decode back to the exact payload with jsQR at every error correction level', () => {
  for (const kind of PAYLOAD_KINDS) {
    const { payload } = buildPayload(kind, SAMPLE_FIELDS[kind]);
    for (const level of LEVELS) {
      const qr = generateQr({ payload, level });
      const decoded = decodeWithJsQr(qr);
      expect(decoded, `${kind} at level ${level}`).toBe(payload);
    }
  }
});

it('every payload kind also decodes with the ZXing QR reader', () => {
  for (const kind of PAYLOAD_KINDS) {
    const { payload } = buildPayload(kind, SAMPLE_FIELDS[kind]);
    const qr = generateQr({ payload, level: 'M' });
    const decoded = decodeWithZxing(qr);
    expect(decoded, kind).toBe(payload);
  }
});

it('200 seeded random payloads round trip through jsQR', () => {
  const rand = mulberry32(20260927);
  const printable = () => 0x20 + Math.floor(rand() * (0x7e - 0x20 + 1));
  const nonAscii = () => 0xa1 + Math.floor(rand() * (0x2ff - 0xa1));
  for (let i = 0; i < 200; i++) {
    const targetLength = 1 + Math.floor(rand() * 60); // characters, not bytes
    let text = '';
    while (new TextEncoder().encode(text).length < 500 && text.length < targetLength) {
      const useNonAscii = rand() < 0.15;
      text += String.fromCodePoint(useNonAscii ? nonAscii() : printable());
    }
    // Guarantee byte length stays within the version 40 level L capacity.
    while (new TextEncoder().encode(text).length > 500) {
      text = text.slice(0, -1);
    }
    const level = LEVELS[i % LEVELS.length]!;
    const qr = generateQr({ payload: text, level });
    const decoded = decodeWithJsQr(qr);
    expect(decoded, `seed index ${i}, text ${JSON.stringify(text)}`).toBe(text);
  }
});

it('the WIFI payload escapes backslash, semicolon, comma, colon and double quote as the ZXing barcode contents convention documents', () => {
  const { payload: withoutHidden } = buildPayload('wifi', {
    ssid: 'Cafe;Guest',
    security: 'WPA',
    password: 'p:a,s\\s"',
    hidden: false,
  });
  expect(withoutHidden).toBe('WIFI:T:WPA;S:Cafe\\;Guest;P:p\\:a\\,s\\\\s\\";;');

  const { payload: withHidden } = buildPayload('wifi', {
    ssid: 'Cafe;Guest',
    security: 'WPA',
    password: 'p:a,s\\s"',
    hidden: true,
  });
  expect(withHidden).toBe('WIFI:T:WPA;S:Cafe\\;Guest;P:p\\:a\\,s\\\\s\\";H:true;;');

  const { payload: nopass } = buildPayload('wifi', { ssid: 'Open', security: 'nopass' });
  expect(nopass).toBe('WIFI:T:nopass;S:Open;;');
});

it('vCard 3.0 and 4.0 payloads follow RFC 2426 and RFC 6350 escaping and fold lines at 75 octets', () => {
  for (const version of ['3.0', '4.0'] as const) {
    const { payload } = buildPayload('vcard', {
      vcardVersion: version,
      givenName: 'John',
      familyName: 'Doe, Jr',
      org: 'Example, Inc',
    });
    expect(payload).toContain(`VERSION:${version}`);
    expect(payload).toContain('N:Doe\\, Jr;John;;;');
    expect(payload).toContain('ORG:Example\\, Inc');
    expect(payload).toContain('BEGIN:VCARD\r\n');
    expect(payload).toContain('END:VCARD\r\n');
  }

  // A 100-octet NOTE line (ASCII, so 100 octets == 100 characters) folds at
  // 75 octets with a CRLF followed by exactly one space.
  const longNote = 'N'.repeat(100);
  const { payload } = buildPayload('vcard', {
    vcardVersion: '4.0',
    givenName: 'Jane',
    familyName: 'Roe',
    note: longNote,
  });
  const lines = payload.split('\r\n');
  const noteLineIndex = lines.findIndex((l) => l.startsWith('NOTE:'));
  expect(noteLineIndex).toBeGreaterThan(-1);
  const firstNoteLine = lines[noteLineIndex]!;
  const continuation = lines[noteLineIndex + 1]!;
  expect(new TextEncoder().encode(firstNoteLine).length).toBe(75);
  expect(continuation.startsWith(' ')).toBe(true);
  // Unfolding (drop the CRLF and the single leading space) reconstructs the original line exactly.
  const unfolded = firstNoteLine + continuation.slice(1);
  expect(unfolded).toBe(`NOTE:${longNote}`);
});

it('mailto payloads percent-encode subject and body as RFC 6068 requires', () => {
  const { payload } = buildPayload('email', {
    to: 'user@example.invalid',
    subject: 'Hi & bye',
    body: 'Line one\nLine two',
  });
  expect(payload).toBe('mailto:user@example.invalid?subject=Hi%20%26%20bye&body=Line%20one%0D%0ALine%20two');
});

it('sms payloads follow RFC 5724 and SMSTO payloads follow the ZXing convention', () => {
  const { payload: rfc5724 } = buildPayload('sms', {
    number: '+15105550101',
    message: 'hello there',
    smsScheme: 'sms',
  });
  expect(rfc5724).toBe('sms:+15105550101?body=hello%20there');

  const { payload: smsto } = buildPayload('sms', {
    number: '+15551234567',
    message: 'Hi there',
    smsScheme: 'SMSTO',
  });
  expect(smsto).toBe('SMSTO:+15551234567:Hi there');
});

/**
 * The 32 possible ISO/IEC 18004 format information strings, fetched and
 * quoted verbatim from Thonky's "Format and Version String Tables" QR Code
 * Tutorial page (www.thonky.com/qr-code-tutorial/format-version-tables,
 * 2026-09-27), "List of all Format Information Strings" table. Each string
 * is MSB-first (bit 14 leftmost), confirmed against that page's own worked
 * example for level L, mask 4: "The final format string for a code with
 * error correction level L and mask pattern 4 is 110011000101111", which
 * matches row "L 4 110011000101111" below.
 */
const FORMAT_INFO_STRINGS: Record<ErrorCorrectionLevel, string[]> = {
  L: [
    '111011111000100',
    '111001011110011',
    '111110110101010',
    '111100010011101',
    '110011000101111',
    '110001100011000',
    '110110001000001',
    '110100101110110',
  ],
  M: [
    '101010000010010',
    '101000100100101',
    '101111001111100',
    '101101101001011',
    '100010111111001',
    '100000011001110',
    '100111110010111',
    '100101010100000',
  ],
  Q: [
    '011010101011111',
    '011000001101000',
    '011111100110001',
    '011101000000110',
    '010010010110100',
    '010000110000011',
    '010111011011010',
    '010101111101101',
  ],
  H: [
    '001011010001001',
    '001001110111110',
    '001110011100111',
    '001100111010000',
    '000011101100010',
    '000001001010101',
    '000110100001100',
    '000100000111011',
  ],
};

/**
 * Reads both copies of the 15-bit format information from a generated
 * symbol, at the positions the installed `qrcode` package's own
 * `lib/core/qrcode.js` `setupFormatInfo` writes them to (confirmed read
 * directly from that installed source, itself ISO/IEC 18004's documented
 * placement: one copy runs down column 8 and across row 8 near the
 * top-left finder pattern, split around the timing pattern; the second
 * copy runs up column 8 from the bottom and across row 8 from the right).
 * This is an independent read of the OUTPUT matrix, not a call into the
 * library's own placement function.
 */
function readFormatInfoCopies(size: number, modules: Uint8Array): { vertical: string; horizontal: string } {
  let vertical = 0;
  let horizontal = 0;
  for (let i = 0; i < 15; i++) {
    const vRow = i < 6 ? i : i < 8 ? i + 1 : size - 15 + i;
    const vBit = modules[vRow * size + 8]!;
    vertical |= vBit << i;

    const hCol = i < 8 ? size - i - 1 : i < 9 ? 15 - i - 1 + 1 : 15 - i - 1;
    const hBit = modules[8 * size + hCol]!;
    horizontal |= hBit << i;
  }
  return {
    vertical: vertical.toString(2).padStart(15, '0'),
    horizontal: horizontal.toString(2).padStart(15, '0'),
  };
}

it('the format information of every symbol is the ISO/IEC 18004 BCH code for its error correction level and mask', () => {
  for (const level of LEVELS) {
    for (let mask = 0; mask < 8; mask++) {
      const qr = generateQr({ payload: 'HELLO WORLD', level, mask });
      expect(qr.mask).toBe(mask);
      const { vertical, horizontal } = readFormatInfoCopies(qr.size, qr.modules);
      const expected = FORMAT_INFO_STRINGS[level][mask]!;
      expect(vertical, `${level} mask ${mask} vertical copy`).toBe(expected);
      expect(horizontal, `${level} mask ${mask} horizontal copy`).toBe(expected);
    }
  }
});

it('the symbol has the four-module quiet zone ISO/IEC 18004 requires unless the visitor narrows it', () => {
  const qr = generateQr({ payload: 'Quiet zone test' });
  const { output: defaultSvg, warnings: defaultWarnings } = matrixToSvg(qr, { scale: 2 });
  const expectedSize = (qr.size + 8) * 2; // 4-module margin on each side, per Denso Wave's own "four-module wide margin" rule
  expect(defaultSvg).toContain(`width="${expectedSize}"`);
  expect(defaultWarnings.some((w) => /quiet zone/i.test(w))).toBe(false);

  const { warnings: narrowWarnings } = matrixToSvg(qr, { scale: 2, margin: 1 });
  expect(narrowWarnings.some((w) => /quiet zone/i.test(w))).toBe(true);
});

it('a payload over the capacity of version 40 at the chosen level is refused with the limit stated', () => {
  const tooLong = 'A'.repeat(VERSION_40_BYTE_CAPACITY.L + 1);
  expect(() => generateQr({ payload: tooLong, level: 'L' })).toThrow(QrError);
  try {
    generateQr({ payload: tooLong, level: 'L' });
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(QrError);
    expect((err as Error).message).toContain(String(VERSION_40_BYTE_CAPACITY.L));
  }
});

it('the SVG output draws exactly the dark modules of the matrix and nothing that can load a resource', () => {
  const qr = generateQr({ payload: 'https://example.invalid/svg-test' });
  const { output: svg } = matrixToSvg(qr, { scale: 3, margin: 4 });

  for (const forbidden of ['href', 'url(', '<script', '<image', '<foreignObject', ' on']) {
    expect(svg.toLowerCase()).not.toContain(forbidden.toLowerCase());
  }

  // Parse the path data back into a set of dark module coordinates.
  const pathMatch = /<path d="([^"]*)"/.exec(svg);
  expect(pathMatch).not.toBeNull();
  const pathData = pathMatch![1]!;
  const found = new Set<string>();
  const re = /M(\d+) (\d+)h(\d+)v(\d+)h-?\d+z/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pathData))) {
    const x = Number(m[1]);
    const y = Number(m[2]);
    const scale = Number(m[3]);
    const col = x / scale - 4;
    const row = y / scale - 4;
    found.add(`${row},${col}`);
  }

  const expected = new Set<string>();
  for (let row = 0; row < qr.size; row++) {
    for (let col = 0; col < qr.size; col++) {
      if (qr.modules[row * qr.size + col] === 1) expected.add(`${row},${col}`);
    }
  }
  expect(found).toEqual(expected);
});

function parsePngChunks(png: Uint8Array): { type: string; data: Uint8Array }[] {
  const chunks: { type: string; data: Uint8Array }[] = [];
  let offset = 8; // past the signature
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = new TextDecoder().decode(png.slice(offset + 4, offset + 8));
    const data = png.slice(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 8 + length + 4; // length + type + data + crc
  }
  return chunks;
}

it('the PNG output decodes with Node zlib to exactly the modules of the matrix', () => {
  const qr = generateQr({ payload: 'PNG round trip test' });
  const { output: png } = matrixToPng(qr, { scale: 1, margin: 0 });

  expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = parsePngChunks(png);
  const ihdr = chunks.find((c) => c.type === 'IHDR')!;
  const width = new DataView(ihdr.data.buffer, ihdr.data.byteOffset).getUint32(0);
  const height = new DataView(ihdr.data.buffer, ihdr.data.byteOffset).getUint32(4);
  expect(width).toBe(qr.size);
  expect(height).toBe(qr.size);
  expect(ihdr.data[8]).toBe(1); // bit depth
  expect(ihdr.data[9]).toBe(3); // colour type 3 (palette)

  const idatChunks = chunks.filter((c) => c.type === 'IDAT');
  const idat = Buffer.concat(idatChunks.map((c) => Buffer.from(c.data)));
  const raw = zlib.inflateSync(idat);

  const rowBytes = Math.ceil(width / 8);
  for (let row = 0; row < height; row++) {
    const filterType = raw[row * (rowBytes + 1)];
    expect(filterType).toBe(0);
    for (let col = 0; col < width; col++) {
      const byte = raw[row * (rowBytes + 1) + 1 + (col >> 3)]!;
      const bit = (byte >> (7 - (col & 7))) & 1;
      expect(bit, `row ${row} col ${col}`).toBe(qr.modules[row * qr.size + col]);
    }
  }
});

it('nothing is written to the console while generating', () => {
  const spies = ['log', 'warn', 'error', 'info', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    for (const kind of PAYLOAD_KINDS) {
      const { payload } = buildPayload(kind, SAMPLE_FIELDS[kind]);
      const qr = generateQr({ payload, level: 'M' });
      matrixToSvg(qr, { scale: 4 });
      matrixToPng(qr, { scale: 4 });
    }
  } finally {
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  }
});

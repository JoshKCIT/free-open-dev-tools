import { create as createQrCode } from 'qrcode';
import meta from './meta.json';
import { matrixToSvg, type RenderOptions, type RenderResult, type Matrix } from './svg';
import { matrixToPng } from './png';

export { meta };
export * from './payloads';
export { matrixToSvg, matrixToPng };
export type { RenderOptions, RenderResult, Matrix };

export class QrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QrError';
  }
}

export type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

/**
 * Version 40 byte-mode (ISO/IEC 8859-1) capacity per error correction
 * level, fetched and quoted from Thonky's "Character Capacities by
 * Version, Mode, and Error Correction" QR Code Tutorial page
 * (www.thonky.com/qr-code-tutorial/character-capacities, 2026-09-27),
 * version 40 row: "L 7089 4296 2953 1817 M 5596 3391 2331 1435 Q 3993 2420
 * 1663 1024 H 3057 1852 1273 784" (columns: Numeric, Alphanumeric, Byte,
 * Kanji) -- the Byte column values are used here as a conservative refusal
 * bound: a payload whose UTF-8 byte length already exceeds what byte mode
 * alone could hold at version 40 is refused before `qrcode` ever runs its
 * own (possibly more efficient, numeric/alphanumeric) mode selection, so
 * this never accepts something too large, even though a payload built
 * entirely from the QR alphanumeric charset could in fact fit more
 * characters than this bound implies (see `generateQr`'s own doc comment).
 * Independently confirmed against Denso Wave's own "About QR Code" page
 * (www.qrcode.com/en/about/standards.html): "Binary/byte 2,953 8
 * ISO/IEC 8859-1" for level L.
 */
export const VERSION_40_BYTE_CAPACITY: Record<ErrorCorrectionLevel, number> = {
  L: 2953,
  M: 2331,
  Q: 1663,
  H: 1273,
};

export interface GenerateQrOptions {
  payload: string;
  level?: ErrorCorrectionLevel;
  /** Forces a specific mask pattern (0-7) instead of letting the encoder
   * choose the best-scoring one. Mainly useful for testing the format
   * information placement against every (level, mask) combination. */
  mask?: number;
}

export interface QrResult {
  size: number;
  modules: Uint8Array;
  version: number;
  level: ErrorCorrectionLevel;
  mask: number;
  byteLength: number;
}

/**
 * Encodes `payload` as a QR symbol using `qrcode` (ISO/IEC 18004). The
 * library picks the most efficient QR mode per segment on its own
 * (`lib/core/segments.js`'s `fromString`, confirmed directly against the
 * installed source): numeric for digits, alphanumeric for the QR
 * alphanumeric charset (upper-case letters, digits, space and nine
 * symbols), byte mode for anything else. No Kanji mode is ever used (no
 * `toSJISFunc` is supplied). Whenever byte mode is chosen, the installed
 * package's own `lib/core/byte-data.js` encodes it as
 * `this.data = new TextEncoder().encode(data)` -- UTF-8 with no ECI header
 * of any kind. The library's own default error correction level is M
 * (`lib/core/qrcode.js`: `errorCorrectionLevel = ECLevel.M`), matched here
 * as this function's own default.
 */
export function generateQr(options: GenerateQrOptions): QrResult {
  const level = options.level ?? 'M';
  const byteLength = new TextEncoder().encode(options.payload).length;
  const capacity = VERSION_40_BYTE_CAPACITY[level];
  if (byteLength > capacity) {
    throw new QrError(
      `This payload is ${byteLength} bytes, over the ${capacity}-byte limit ISO/IEC 18004 sets for a version 40 symbol at error correction level ${level}.`,
    );
  }
  let qr;
  try {
    qr = createQrCode(options.payload, {
      errorCorrectionLevel: level,
      ...(options.mask === undefined ? {} : { maskPattern: options.mask as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 }),
    });
  } catch (err) {
    throw new QrError(err instanceof Error ? err.message : String(err));
  }
  return {
    size: qr.modules.size,
    modules: new Uint8Array(qr.modules.data),
    version: qr.version,
    level,
    mask: qr.maskPattern ?? 0,
    byteLength,
  };
}

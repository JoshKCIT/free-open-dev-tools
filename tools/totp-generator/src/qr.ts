/**
 * The QR symbol of an otpauth link, drawn as an SVG picture from the module matrix. The library only works out which
 * modules are dark (`create`); the picture is written by `matrixToSvg` in svg.ts, which draws one background rectangle
 * and one path and so has nothing in it that can load a resource. Nothing is fetched and no raster writer is used.
 *
 * RULE, stated once and enforced by a test: no message thrown from this file may contain a fragment of the link it was
 * given, because the link holds a secret. Describe the shape of the problem, never the content.
 */
import { create } from 'qrcode';
import { TotpError } from './errors';
import { matrixToSvg } from './svg';

/** The SVG text of the QR symbol for `payload`, at error correction level M (the level an app expects for a link of this size). */
export function qrSvg(payload: string): string {
  let symbol;
  try {
    symbol = create(payload, { errorCorrectionLevel: 'M' });
  } catch {
    throw new TotpError('This link is too long to fit in a QR code. Shorten the issuer or the account name.');
  }
  return matrixToSvg({ size: symbol.modules.size, modules: new Uint8Array(symbol.modules.data) }).output;
}

import { inflateSync } from 'node:zlib';

/**
 * A decoder for the one kind of PNG the published vectors use: 8-bit RGBA, not interlaced. It follows the PNG
 * specification (W3C PNG Third Edition, sections 9 and 10: the five filter types and the Paeth predictor), so the tests
 * need no image library. Anything else is refused with a plain error.
 */
export function decodeRgbaPng(bytes: Uint8Array): { data: Uint8ClampedArray; width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (bytes[i] !== signature[i]) throw new Error('not a PNG');

  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      const depth = body[8];
      const colourType = body[9];
      const interlace = body[12];
      if (depth !== 8 || colourType !== 6 || interlace !== 0) throw new Error('only 8-bit RGBA, not interlaced');
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = new Uint8ClampedArray(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const value = raw[line + x]!;
      const left = x >= 4 ? out[y * stride + x - 4]! : 0;
      const up = y > 0 ? out[(y - 1) * stride + x]! : 0;
      const upLeft = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4]! : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) {
        throw new Error('unknown filter type');
      }
      out[y * stride + x] = (value + predicted) & 0xff;
    }
  }
  return { data: out, width, height };
}

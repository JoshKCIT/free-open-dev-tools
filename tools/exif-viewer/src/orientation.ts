/**
 * CIPA DC-008 (Exif 2.32 / 3.0) section 4.6.4 "Tag Support Level 2" defines
 * Orientation (tag 0x0112, IFD0, type SHORT) as one of eight values (1-8)
 * stating how the stored image must be rotated and/or mirrored to be
 * displayed upright. Section 4.6.2 "TIFF Header" defines the two-byte byte
 * order mark ("II" little-endian or "MM" big-endian), the fixed 16-bit
 * magic number 42 that follows it, and the 32-bit offset to IFD0.
 *
 * This is the one metadata item this tool keeps by default even when every
 * other block is removed (`stripMetadata`'s own `keepOrientation` option):
 * dropping it from a photo taken with the camera rotated would silently
 * change what a visitor sees when the copy is opened, since browsers apply
 * this tag while decoding rather than rotating the pixels themselves.
 */

const ORIENTATION_TAG = 0x0112;
const TIFF_TYPE_SHORT = 3;

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}
function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}
function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}
function readUint32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

/**
 * Reads the Orientation tag directly out of a raw TIFF/Exif byte block's own
 * IFD0, honouring the block's own declared byte order. Returns `undefined`
 * (never throws) when the block is too short to hold a TIFF header, the
 * byte-order mark is neither `II` nor `MM`, the magic number is not 42, or
 * IFD0 carries no Orientation entry -- a missing or malformed Orientation
 * tag is not by itself a reason to refuse a file whose picture data is
 * otherwise fine.
 */
export function readOrientation(tiff: Uint8Array): number | undefined {
  if (tiff.length < 8) return undefined;
  let little: boolean;
  if (tiff[0] === 0x49 && tiff[1] === 0x49) little = true;
  else if (tiff[0] === 0x4d && tiff[1] === 0x4d) little = false;
  else return undefined;

  const u16 = (o: number) => (little ? readUint16LE(tiff, o) : readUint16BE(tiff, o));
  const u32 = (o: number) => (little ? readUint32LE(tiff, o) : readUint32BE(tiff, o));

  if (u16(2) !== 42) return undefined;
  const ifd0Offset = u32(4);
  if (ifd0Offset + 2 > tiff.length) return undefined;

  const count = u16(ifd0Offset);
  for (let i = 0; i < count; i++) {
    const entryOffset = ifd0Offset + 2 + i * 12;
    if (entryOffset + 12 > tiff.length) break;
    if (u16(entryOffset) !== ORIENTATION_TAG) continue;
    if (u16(entryOffset + 2) !== TIFF_TYPE_SHORT) return undefined; // not a SHORT: ignore rather than guess
    return u16(entryOffset + 8);
  }
  return undefined;
}

function writeUint16LE(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >> 8) & 0xff;
}
function writeUint32LE(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
  out[offset + 2] = (value >>> 16) & 0xff;
  out[offset + 3] = (value >>> 24) & 0xff;
}

/**
 * Byte length of the block `orientationOnlyExif` writes: an 8-byte TIFF
 * header, a 2-byte IFD0 entry count, one 12-byte directory entry, and a
 * 4-byte "no next IFD" terminator.
 */
export const ORIENTATION_ONLY_EXIF_LENGTH = 8 + 2 + 12 + 4;

/**
 * Builds the smallest valid TIFF/Exif block that carries exactly one tag,
 * Orientation, in IFD0 -- little-endian, one directory entry, no IFD1 --
 * for the case where every other metadata block is being removed but the
 * picture's own display orientation must survive.
 */
export function orientationOnlyExif(orientation: number): Uint8Array {
  const out = new Uint8Array(ORIENTATION_ONLY_EXIF_LENGTH);
  out[0] = 0x49; // "I"
  out[1] = 0x49; // "I"
  writeUint16LE(out, 2, 42);
  writeUint32LE(out, 4, 8); // IFD0 starts right after the 8-byte header
  writeUint16LE(out, 8, 1); // one directory entry
  writeUint16LE(out, 10, ORIENTATION_TAG);
  writeUint16LE(out, 12, TIFF_TYPE_SHORT);
  writeUint32LE(out, 14, 1); // count
  writeUint16LE(out, 18, orientation); // SHORT value, left-justified in the 4-byte value field
  writeUint16LE(out, 20, 0); // padding
  writeUint32LE(out, 22, 0); // no next IFD
  return out;
}

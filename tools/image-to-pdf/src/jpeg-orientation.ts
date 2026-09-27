/**
 * Reads a JPEG's own Exif Orientation tag (CIPA DC-008-2019 section 4.6.4,
 * tag 0x0112, an unsigned SHORT naming one of eight transform values) from
 * its APP1 marker segment (ITU-T T.81 Annex B.1.1.4's own marker-segment
 * layout for the APPn markers, with the fixed "Exif\0\0" identifier the
 * Exif specification itself adds after the segment length). Returns 1
 * ("normal", no transform) when no Exif APP1 segment is found, its TIFF
 * header is not recognised, or the Orientation tag itself is absent or
 * carries a value outside 1 to 8.
 */

function readUint16(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  return littleEndian ? bytes[offset]! | (bytes[offset + 1]! << 8) : (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function readUint32(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  return littleEndian
    ? (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0
    : ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

function findExifApp1(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    let markerOffset = i + 1;
    while (bytes[markerOffset] === 0xff) markerOffset++;
    const marker = bytes[markerOffset];
    if (marker === undefined || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      i = markerOffset + 1;
      continue;
    }
    if (marker === 0xda) return null; // Start of Scan: no Exif segment appears after this
    const lengthOffset = markerOffset + 1;
    if (lengthOffset + 2 > bytes.length) return null;
    const length = readUint16(bytes, lengthOffset, false);
    const segmentStart = lengthOffset + 2;
    const segmentEnd = lengthOffset + length;
    if (segmentEnd > bytes.length) return null;
    if (marker === 0xe1 && segmentEnd - segmentStart >= 6) {
      const identifier = String.fromCharCode(...bytes.subarray(segmentStart, segmentStart + 6));
      if (identifier === 'Exif\0\0') {
        return bytes.subarray(segmentStart + 6, segmentEnd);
      }
    }
    i = segmentEnd;
  }
  return null;
}

/** Reads the Orientation tag (1-8) from a JPEG's own Exif APP1 segment, defaulting to 1 (normal, no transform). */
export function readJpegOrientation(bytes: Uint8Array): number {
  const tiff = findExifApp1(bytes);
  if (!tiff || tiff.length < 8) return 1;

  const byteOrder = String.fromCharCode(tiff[0]!, tiff[1]!);
  if (byteOrder !== 'II' && byteOrder !== 'MM') return 1;
  const littleEndian = byteOrder === 'II';
  const magic = readUint16(tiff, 2, littleEndian);
  if (magic !== 42) return 1;

  const ifd0Offset = readUint32(tiff, 4, littleEndian);
  if (ifd0Offset + 2 > tiff.length) return 1;
  const entryCount = readUint16(tiff, ifd0Offset, littleEndian);
  const entriesStart = ifd0Offset + 2;

  for (let i = 0; i < entryCount; i++) {
    const entryOffset = entriesStart + i * 12;
    if (entryOffset + 12 > tiff.length) break;
    const tag = readUint16(tiff, entryOffset, littleEndian);
    if (tag !== 0x0112) continue;
    const type = readUint16(tiff, entryOffset + 2, littleEndian);
    if (type !== 3) return 1; // Orientation is always SHORT (type 3); anything else is malformed
    const value = readUint16(tiff, entryOffset + 8, littleEndian);
    return value >= 1 && value <= 8 ? value : 1;
  }
  return 1;
}

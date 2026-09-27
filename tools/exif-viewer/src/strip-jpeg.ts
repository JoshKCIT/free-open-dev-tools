/**
 * ITU-T T.81 (the JPEG specification) section B.1.1.3 "Marker": every marker
 * is the byte 0xFF followed by a non-zero, non-0xFF byte (any number of
 * extra 0xFF fill bytes before it are ignored). Section B.1.1.4 "Marker
 * segments" and Table B.1: SOI (0xD8) and EOI (0xD9) and the restart markers
 * RSTm (0xD0-0xD7) and TEM (0x01) carry no length or data of their own;
 * every other marker is followed by a two-byte big-endian length (counting
 * the length field itself) and that many bytes of segment data. Section
 * B.1.1.5 "Compressed data": after a Start Of Scan (SOS, 0xFFDA) segment,
 * the entropy-coded data that follows is not itself made of marker
 * segments -- a literal 0xFF byte in the compressed data is followed by a
 * stuffed 0x00 (byte stuffing, so a decoder never mistakes image data for a
 * marker) or by a restart marker, and the scan only really ends at the next
 * marker that is neither of those. Table B.1 also lists the SOF0-SOF15
 * frame markers, excluding the JPG (0xC8), DHT (0xC4) and DAC (0xCC) codes
 * that share the same numeric range without being frame markers.
 *
 * CIPA DC-008 (Exif) defines the APP1 segment's own "Exif\0\0" identifier;
 * the Adobe XMP Specification Part 3 defines APP1's alternate
 * "http://ns.adobe.com/xap/1.0/\0" identifier; ICC.1 defines the APP2
 * segment's own "ICC_PROFILE\0" identifier and its two sequence-number
 * bytes; the IPTC IIM 4.2 and Photoshop Image Resource specifications
 * define the APP13 segment's own "Photoshop 3.0\0" identifier; and Adobe's
 * own DCT filters documentation defines the APP14 segment's "Adobe\0"
 * identifier.
 */
import { readOrientation, orientationOnlyExif } from './orientation';
import { describeRemoval } from './describe';

export class JpegStripError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JpegStripError';
  }
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}
function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(bytes[offset + i]!);
  return s;
}

const APP0 = 0xe0;
const APP1 = 0xe1;
const APP2 = 0xe2;
const APP13 = 0xed;
const APP14 = 0xee;
const COM = 0xfe;
const SOS = 0xda;
const EOI = 0xd9;
const TEM = 0x01;

function isRestart(marker: number): boolean {
  return marker >= 0xd0 && marker <= 0xd7;
}

export interface StripJpegOptions {
  keepColourProfile: boolean;
  keepOrientation: boolean;
}

export interface StripJpegResult {
  bytes: Uint8Array;
  removed: { what: string; bytes: number }[];
  warnings: string[];
}

interface SegmentDecision {
  keep: boolean;
  what: string;
}

function decideAppSegment(marker: number, segment: Uint8Array, keepColourProfile: boolean): SegmentDecision {
  // segment = [0xFF, marker, lenHi, lenLo, ...data]; the identifier (when
  // one exists for this APPn) starts right after the 4-byte marker+length.
  if (marker === APP0) {
    return { keep: true, what: 'APP0 (JFIF)' };
  }
  if (marker === APP1) {
    const ident = ascii(segment, 4, Math.min(29, segment.length - 4));
    if (ident.startsWith('http://ns.adobe.com/xap')) {
      return { keep: false, what: describeRemoval('xmp') };
    }
    return { keep: false, what: describeRemoval('exif') };
  }
  if (marker === APP2) {
    const ident = ascii(segment, 4, Math.min(12, segment.length - 4));
    if (ident === 'ICC_PROFILE\0') {
      return keepColourProfile
        ? { keep: true, what: 'APP2 (ICC profile)' }
        : { keep: false, what: describeRemoval('colour-profile') };
    }
    return { keep: false, what: 'an unrecognised APP2 segment' };
  }
  if (marker === APP13) {
    return { keep: false, what: describeRemoval('iptc') };
  }
  if (marker === APP14) {
    const ident = ascii(segment, 4, Math.min(6, segment.length - 4));
    if (ident === 'Adobe\0') return { keep: true, what: 'APP14 (Adobe)' };
    return { keep: false, what: 'an unrecognised APP14 segment' };
  }
  // Every other APPn (APP3-APP12, APP15): dropped.
  const n = marker - 0xe0;
  return { keep: false, what: `an unrecognised metadata segment (APP${n})` };
}

/**
 * Removes every metadata segment from a JPEG by walking its marker segments
 * from SOI and copying everything else -- scan data included -- byte for
 * byte. Kept unconditionally: SOI, APP0 (JFIF), APP14 (Adobe, it changes how
 * colours decode), DQT, DHT, DRI, every SOFn, every SOS and its own
 * entropy-coded data through EOI (progressive files carry more than one
 * SOS; each is kept). APP2 (`ICC_PROFILE`) is kept unless `keepColourProfile`
 * is false. Dropped: APP1 (Exif, XMP), APP13, COM, and every other APPn.
 * Data appended after the primary image's own EOI (a thumbnail, motion
 * photo video, or anything else) is dropped too, and reported by its byte
 * count. When the original carried a non-default Exif Orientation and
 * `keepOrientation` is true, a new, minimal APP1 Exif segment holding only
 * that tag is written back in, right after SOI.
 *
 * Refuses (throws, writes nothing) a segment whose length runs past the end
 * of the file, a truncated marker, or a file with no EOI.
 */
export function stripJpeg(bytes: Uint8Array, options: StripJpegOptions): StripJpegResult {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new JpegStripError('this is not a JPEG file');
  }

  const kept: Uint8Array[] = [];
  const removed: { what: string; bytes: number }[] = [];
  let originalOrientation: number | undefined;
  let sawEoi = false;
  let i = 2;

  while (i < bytes.length) {
    if (bytes[i] !== 0xff) {
      throw new JpegStripError('this JPEG file is malformed: expected a marker but found ordinary data');
    }
    let m = i + 1;
    while (bytes[m] === 0xff) m++;
    if (m >= bytes.length) throw new JpegStripError('this JPEG file is malformed: a marker was cut off');
    const marker = bytes[m]!;
    if (marker === 0x00) {
      throw new JpegStripError('this JPEG file is malformed: found byte stuffing outside scan data');
    }
    const afterMarker = m + 1;

    if (marker === EOI) {
      kept.push(Uint8Array.from([0xff, 0xd9]));
      sawEoi = true;
      i = afterMarker;
      break;
    }
    if (marker === TEM || isRestart(marker)) {
      kept.push(Uint8Array.from([0xff, marker]));
      i = afterMarker;
      continue;
    }

    if (afterMarker + 2 > bytes.length) {
      throw new JpegStripError('this JPEG file is malformed: a segment length was cut off');
    }
    const length = readUint16BE(bytes, afterMarker);
    if (length < 2) throw new JpegStripError('this JPEG file is malformed: a segment declares an invalid length');
    const segEnd = i + 2 + length;
    if (segEnd > bytes.length) {
      throw new JpegStripError('this JPEG file is malformed: a segment declares more data than the file has');
    }
    const segment = bytes.subarray(i, segEnd);

    if (marker === SOS) {
      kept.push(segment);
      let p = segEnd;
      while (p < bytes.length) {
        if (bytes[p] === 0xff) {
          const next = bytes[p + 1];
          if (next === undefined) throw new JpegStripError('this JPEG file is malformed: its scan data was cut off');
          if (next === 0x00 || isRestart(next)) {
            // A stuffed byte or a restart marker is still scan data (ITU-T
            // T.81 section B.1.1.5): keep scanning past it rather than
            // treating it as the scan's end. The single push below (not one
            // push per stuffed byte or restart marker) is what makes this
            // copy exactly the source bytes once each, in order -- pushing
            // here too would duplicate every one of them in the output.
            p += 2;
            continue;
          }
          break; // a real marker: the scan ends here
        }
        p++;
      }
      kept.push(bytes.subarray(segEnd, p));
      i = p;
      continue;
    }

    if (marker >= 0xe0 && marker <= 0xef) {
      const decision = decideAppSegment(marker, segment, options.keepColourProfile);
      if (marker === APP1) {
        const ident = ascii(segment, 4, Math.min(6, segment.length - 4));
        if (ident === 'Exif\0\0') {
          try {
            originalOrientation = readOrientation(segment.subarray(10));
          } catch {
            originalOrientation = undefined;
          }
        }
      }
      if (decision.keep) kept.push(segment);
      else removed.push({ what: decision.what, bytes: segment.length });
    } else if (marker === COM) {
      removed.push({ what: describeRemoval('comment'), bytes: segment.length });
    } else {
      // DQT, DHT, DRI, every SOFn, and anything else this file does not
      // specifically drop: kept, since it is picture structure, not
      // metadata.
      kept.push(segment);
    }
    i = segEnd;
  }

  if (!sawEoi) throw new JpegStripError('this JPEG file is malformed: it has no end-of-image marker');

  if (i < bytes.length) {
    removed.push({ what: describeRemoval('trailing-data'), bytes: bytes.length - i });
  }

  const keepingOrientation = options.keepOrientation && originalOrientation !== undefined && originalOrientation !== 1;

  const parts: Uint8Array[] = [Uint8Array.from([0xff, 0xd8])];
  if (keepingOrientation) {
    const tiff = orientationOnlyExif(originalOrientation!);
    const body = new Uint8Array(6 + tiff.length);
    body.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 0); // "Exif\0\0"
    body.set(tiff, 6);
    const lengthBytes = body.length + 2;
    const segment = new Uint8Array(4 + body.length);
    segment.set([0xff, APP1, (lengthBytes >> 8) & 0xff, lengthBytes & 0xff], 0);
    segment.set(body, 4);
    parts.push(segment);
  }
  parts.push(...kept);

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }

  return { bytes: out, removed, warnings: [] };
}

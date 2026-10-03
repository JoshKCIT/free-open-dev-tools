/**
 * Takes the colour profile tags out of a PNG, leaving every pixel and every other chunk exactly as it was.
 *
 * Some browsers (WebKit is one) write a colour profile into the PNG they encode from a canvas. The pixel values in such a
 * file are right, but the same browser colour-manages the tagged file when it shows it again, which moves some values by
 * one. A canvas holds plain sRGB values, so the tags add nothing; without them every browser shows the sheet's pixels as
 * they were drawn. Whole chunks are removed, so no checksum needs rewriting.
 */

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** The ancillary chunks that tag a colour space (PNG specification, section 11.3.3), by their four letters. */
const COLOUR_TAGS = new Set(['iCCP', 'sBIT', 'gAMA', 'cHRM', 'sRGB', 'cICP']);

function chunkName(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
}

/**
 * Returns the PNG without its colour tags. Anything that is not a whole PNG chunk list (no signature, a chunk that runs
 * past the end, bytes left over) is returned unchanged, and so is a PNG that has no such tags.
 */
export function plainPng(png: Uint8Array): Uint8Array {
  if (png.length < SIGNATURE.length + 12) return png;
  for (let i = 0; i < SIGNATURE.length; i++) if (png[i] !== SIGNATURE[i]) return png;

  const kept: { start: number; end: number }[] = [];
  let removed = false;
  let at = SIGNATURE.length;
  while (at < png.length) {
    if (at + 12 > png.length) return png;
    const length = ((png[at]! << 24) | (png[at + 1]! << 16) | (png[at + 2]! << 8) | png[at + 3]!) >>> 0;
    const end = at + 12 + length;
    if (end > png.length) return png;
    if (COLOUR_TAGS.has(chunkName(png, at))) removed = true;
    else kept.push({ start: at, end });
    at = end;
  }
  if (!removed) return png;

  let total = SIGNATURE.length;
  for (const k of kept) total += k.end - k.start;
  const out = new Uint8Array(total);
  out.set(png.subarray(0, SIGNATURE.length), 0);
  let o = SIGNATURE.length;
  for (const k of kept) {
    out.set(png.subarray(k.start, k.end), o);
    o += k.end - k.start;
  }
  return out;
}

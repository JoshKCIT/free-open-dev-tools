import { ByteReader } from './bytes';
import { MAC_GLYPH_NAMES } from './standard-names';
import { tableBytes, type SfntFont } from './sfnt';

/** The longest glyph name kept (names come from the font and are cut here, then shown through the escape routine). */
const MAX_GLYPH_NAME_CHARS = 64;

/**
 * Glyph names from the post table: format 1 uses the standard Macintosh ordering for the first 258 glyphs, format 2 gives
 * each glyph an index into that list or into its own list of Pascal strings, and format 3 has no names. Returns a function
 * from glyph number to name ('' when the font has none). The own strings are located once, in one pass over the table.
 */
export function glyphNamesFromPost(bytes: Uint8Array, font: SfntFont, numGlyphs: number): (gid: number) => string {
  const data = tableBytes(bytes, font.tables.get('post'));
  if (!data || data.length < 32) return () => '';
  const r = new ByteReader(data);
  const version = r.u32(0);
  if (version === 0x00010000)
    return (gid) => (gid >= 0 && gid < MAC_GLYPH_NAMES.length ? (MAC_GLYPH_NAMES[gid] ?? '') : '');
  if (version !== 0x00020000 || data.length < 34) return () => '';
  const stated = r.u16(32);
  const count = Math.min(stated, numGlyphs, Math.floor((data.length - 34) / 2));
  const indexAt = 34;
  // Locate the own strings: each is a length byte and that many characters, in order, after the index array.
  const starts: number[] = [];
  let p = indexAt + 2 * stated;
  while (p < data.length && starts.length < 65535) {
    const length = data[p]!;
    starts.push(p);
    p += 1 + length;
  }
  return (gid) => {
    if (gid < 0 || gid >= count) return '';
    const index = r.u16(indexAt + 2 * gid);
    if (index < 258) return MAC_GLYPH_NAMES[index] ?? '';
    const at = starts[index - 258];
    if (at === undefined) return '';
    const length = Math.min(data[at]!, MAX_GLYPH_NAME_CHARS);
    if (at + 1 + length > data.length) return '';
    let out = '';
    for (let i = 0; i < length; i++) out += String.fromCharCode(data[at + 1 + i]!);
    return out;
  };
}

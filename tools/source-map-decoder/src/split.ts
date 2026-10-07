import { SourceMapError } from './errors';
import { MAX_MAPS, MAX_MAP_BYTES, utf8Length, withCommas } from './limits';

/** The text a served map may start with so that a script cannot read it as code (ECMA-426 7.2). */
const XSSI_PREFIX = ")]}'";
const URL_COMMENT_MARKERS = ['//# sourceMappingURL=', '//@ sourceMappingURL='];

function isSpace(code: number): boolean {
  return code <= 32 || code === 0xa0 || code === 0xfeff || code === 0x2028 || code === 0x2029;
}

/** Where the first line of `text` ends, counting from `from`: just after its line feed, or the end of the text. */
function afterLine(text: string, from: number): number {
  const at = text.indexOf('\n', from);
  return at === -1 ? text.length : at + 1;
}

/**
 * The end of the object that starts at `start` (just after its closing brace), or -1 when it is never closed. A
 * depth counter that knows about strings and escapes: one pass, nothing allocated, and no regular expression.
 */
function objectEnd(text: string, start: number): number {
  const n = text.length;
  let depth = 0;
  let inString = false;
  for (let i = start; i < n; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 92) i++;
      else if (c === 34) inString = false;
    } else if (c === 34) inString = true;
    else if (c === 123) depth++;
    else if (c === 125) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Reads a `data:` address that holds a map and returns the map text. The address is decoded here and never requested.
 * Base64 and percent-encoded forms are read; anything else is refused naming the map.
 */
function readDataAddress(address: string, map: number): string {
  const comma = address.indexOf(',');
  if (comma === -1)
    throw new SourceMapError(`The data address of map ${map} has no comma after its type.`, 'maps', { map });
  const header = address.slice(5, comma).toLowerCase();
  const body = address.slice(comma + 1);
  if (header.endsWith(';base64')) {
    if (Math.floor((body.length * 3) / 4) > MAX_MAP_BYTES) {
      throw new SourceMapError(
        `The data address of map ${map} is larger than the limit of ${withCommas(MAX_MAP_BYTES)} bytes (50 MiB).`,
        'maps',
        { map },
      );
    }
    try {
      const binary = atob(body.includes('%') ? decodeURIComponent(body) : body);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new SourceMapError(`The data address of map ${map} is not valid Base64 holding UTF-8 text.`, 'maps', {
        map,
      });
    }
  }
  try {
    return decodeURIComponent(body);
  } catch {
    throw new SourceMapError(`The data address of map ${map} is not valid percent-encoded text.`, 'maps', { map });
  }
}

/**
 * Splits pasted text into the maps it holds, in order. Maps may follow one another with nothing between them. Around
 * and between them are allowed: white space, a byte order mark, the served-map prefix `)]}'` with the rest of its line
 * (ECMA-426 7.2), and a `data:` address, alone or after a sourceMappingURL comment marker, which is decoded here.
 * Any other address is never followed: it is refused as text that is not a map.
 *
 * More than `maxMaps` maps are refused as soon as the next one is seen, so a text of millions of empty objects costs
 * one pass and a small list. Nothing is parsed as JSON here.
 */
export function splitMaps(text: string, maxMaps: number = MAX_MAPS): string[] {
  const n = text.length;
  const maps: string[] = [];
  let pos = 0;
  for (;;) {
    while (pos < n && isSpace(text.charCodeAt(pos))) pos++;
    if (pos >= n) break;
    if (text.startsWith(XSSI_PREFIX, pos)) {
      pos = afterLine(text, pos);
      continue;
    }
    const number = maps.length + 1;
    if (number > maxMaps) {
      throw new SourceMapError(
        `The text holds more than ${maxMaps} maps. The limit is ${maxMaps} maps in all.`,
        'maps',
      );
    }
    const c = text.charCodeAt(pos);
    if (c === 123) {
      const end = objectEnd(text, pos);
      if (end === -1) {
        throw new SourceMapError(
          `Map ${number} starts at character ${withCommas(pos + 1)} and is never closed.`,
          'maps',
          { map: number },
        );
      }
      const size = end - pos;
      if (size > MAX_MAP_BYTES || (size * 3 > MAX_MAP_BYTES && utf8Length(text.slice(pos, end)) > MAX_MAP_BYTES)) {
        throw new SourceMapError(
          `Map ${number} is larger than the limit of ${withCommas(MAX_MAP_BYTES)} bytes (50 MiB).`,
          'maps',
          { map: number },
        );
      }
      maps.push(text.slice(pos, end));
      pos = end;
      continue;
    }
    let start = pos;
    for (const marker of URL_COMMENT_MARKERS) if (text.startsWith(marker, pos)) start = pos + marker.length;
    if (text.startsWith('data:', start)) {
      let end = start;
      while (end < n && !isSpace(text.charCodeAt(end))) end++;
      maps.push(readDataAddress(text.slice(start, end), number));
      pos = end;
      continue;
    }
    throw new SourceMapError(
      maps.length === 0
        ? `The text at character ${withCommas(pos + 1)} is not a map. A map starts with { , and an address is never followed: paste the map itself.`
        : `The text after map ${maps.length}, at character ${withCommas(pos + 1)}, is not a map. A map starts with { , and an address is never followed: paste the map itself.`,
      'maps',
      maps.length === 0 ? {} : { map: maps.length },
    );
  }
  return maps;
}

/**
 * Takes the byte order mark and the served-map prefix off the start of an opened file's text, so the file reads as a
 * single map. The same rules as for pasted text; nothing else is changed.
 */
export function cleanFileText(text: string): string {
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  if (text.startsWith(XSSI_PREFIX, pos)) pos = afterLine(text, pos);
  return pos === 0 ? text : text.slice(pos);
}

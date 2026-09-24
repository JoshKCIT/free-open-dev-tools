import meta from './meta.json';
import { EMOJI, EMOJI_DATA_VERSION, FULLY_QUALIFIED_COUNT } from './emoji-data';
import type { EmojiTuple } from './emoji-data';

export { meta, EMOJI, EMOJI_DATA_VERSION, FULLY_QUALIFIED_COUNT };

export interface EmojiEntry {
  codePoints: number[];
  character: string;
  name: string;
  group: string;
  subgroup: string;
  emojiVersion: string;
}

export interface EmojiForms {
  character: string;
  codePoints: string;
  jsEscape: string;
  utf16Escape: string;
  htmlEntity: string;
}

export interface EmojiSearchResult {
  results: EmojiEntry[];
  totalMatches: number;
}

function parseCodePoints(hex: string): number[] {
  return hex.split(' ').map((h) => parseInt(h, 16));
}

function toEntry([codePointsHex, name, group, subgroup, emojiVersion]: EmojiTuple): EmojiEntry {
  const codePoints = parseCodePoints(codePointsHex);
  return { codePoints, character: String.fromCodePoint(...codePoints), name, group, subgroup, emojiVersion };
}

/** Built once, in the file's own (CLDR) order, and cached. */
let allEntriesCache: EmojiEntry[] | undefined;
function allEntries(): EmojiEntry[] {
  if (!allEntriesCache) allEntriesCache = EMOJI.map(toEntry);
  return allEntriesCache;
}

/**
 * Searches emoji names. A query is split on whitespace into words; every
 * word must appear in the name (case-insensitive) to match. Results are
 * ranked: an exact name match first, then a name-prefix match, then every
 * other match, each tier keeping the file's own (CLDR) order.
 */
export function searchEmoji(query: string, limit = 200): EmojiSearchResult {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === '') return { results: [], totalMatches: 0 };

  const words = trimmed.split(/\s+/).filter((w) => w.length > 0);
  const matched = allEntries().filter((e) => {
    const lowerName = e.name.toLowerCase();
    return words.every((w) => lowerName.includes(w));
  });

  const rank = (e: EmojiEntry): number => {
    const lowerName = e.name.toLowerCase();
    if (lowerName === trimmed) return 0;
    if (lowerName.startsWith(trimmed)) return 1;
    return 2;
  };

  // Stable sort by rank only, preserving each tier's original (file) order.
  const ranked = matched
    .map((entry, index) => ({ entry, index, rank: rank(entry) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((r) => r.entry);

  return { results: ranked.slice(0, limit), totalMatches: ranked.length };
}

/** One code point per UTF-16 code unit hex string (2 units for anything above U+FFFF). */
function utf16Units(codePoints: number[]): string[] {
  const units: string[] = [];
  for (const cp of codePoints) {
    const s = String.fromCodePoint(cp);
    for (let i = 0; i < s.length; i++) {
      units.push(s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0'));
    }
  }
  return units;
}

/** The five copyable forms of an emoji entry, one escape per code point (or per UTF-16 unit for utf16Escape). */
export function formsOf(entry: EmojiEntry): EmojiForms {
  const codePoints = entry.codePoints.map((cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`).join(' ');
  const jsEscape = entry.codePoints.map((cp) => `\\u{${cp.toString(16).toUpperCase()}}`).join('');
  const htmlEntity = entry.codePoints.map((cp) => `&#x${cp.toString(16).toUpperCase()};`).join('');
  const utf16Escape = utf16Units(entry.codePoints)
    .map((unit) => `\\u${unit}`)
    .join('');
  return { character: entry.character, codePoints, jsEscape, utf16Escape, htmlEntity };
}

import { BLOCKS, UNICODE_VERSION } from './blocks';
import { FontInspectorError } from './errors';
import { MAX_MISSING_LISTED, MAX_SAMPLE_CHARS } from './limits';

export interface BlockCoverage {
  name: string;
  first: number;
  last: number;
  /** How many code points the block spans. */
  size: number;
  /** How many of them the font maps to a glyph. */
  covered: number;
}

export interface Coverage {
  unicodeVersion: string;
  /** Only the blocks with at least one covered code point, in code point order. */
  blocks: BlockCoverage[];
  /** Covered code points that lie in no block of the list. */
  outsideBlocks: number;
  /** How many distinct code points are covered in all. */
  total: number;
}

/**
 * Counts, per Unicode block, how many of the given code points are covered. Each distinct code point counts once whatever
 * its position or how often it is listed. The blocks are those of Unicode 17.0.0.
 */
export function blockCoverage(codePoints: Iterable<number>): Coverage {
  const sorted = Uint32Array.from(new Set(codePoints)).sort();
  const blocks: BlockCoverage[] = [];
  let at = 0;
  let outside = 0;
  for (const [first, last, name] of BLOCKS) {
    // Code points below this block that no block claimed.
    while (at < sorted.length && sorted[at]! < first) {
      outside++;
      at++;
    }
    let covered = 0;
    while (at < sorted.length && sorted[at]! <= last) {
      covered++;
      at++;
    }
    if (covered > 0) blocks.push({ name, first, last, size: last - first + 1, covered });
  }
  outside += sorted.length - at;
  return { unicodeVersion: UNICODE_VERSION, blocks, outsideBlocks: outside, total: sorted.length };
}

export interface SampleResult {
  /** How many characters (code points) the text holds, repeats included. */
  characters: number;
  /** How many different code points. */
  distinct: number;
  /** How many of the different code points the font maps to a glyph. */
  coveredDistinct: number;
  /** The code points the font lacks, in order of first appearance, at most MAX_MISSING_LISTED. */
  missing: { codePoint: number; text: string }[];
  missingCount: number;
}

/**
 * Checks a sample of text against the font's character map. Characters are code points, so a character outside the Basic
 * Multilingual Plane counts once. More than MAX_SAMPLE_CHARS characters are refused naming the field.
 */
export function checkSample(text: string, map: ReadonlyMap<number, number>): SampleResult {
  const seen = new Set<number>();
  const missing: { codePoint: number; text: string }[] = [];
  let characters = 0;
  let covered = 0;
  let missingCount = 0;
  for (const ch of text) {
    characters++;
    if (characters > MAX_SAMPLE_CHARS) {
      throw new FontInspectorError(
        `Check these characters holds more than ${MAX_SAMPLE_CHARS.toLocaleString('en-US')} characters, the most this page checks.`,
        'Check these characters',
      );
    }
    const codePoint = ch.codePointAt(0)!;
    if (seen.has(codePoint)) continue;
    seen.add(codePoint);
    if (map.has(codePoint)) {
      covered++;
    } else {
      missingCount++;
      if (missing.length < MAX_MISSING_LISTED) missing.push({ codePoint, text: ch });
    }
  }
  return { characters, distinct: seen.size, coveredDistinct: covered, missing, missingCount };
}

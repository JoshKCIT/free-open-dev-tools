import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The folder of test fixtures. */
export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export function readFixture(...parts: string[]): string {
  return readFileSync(join(FIXTURES, ...parts), 'utf8');
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Writes one base64 variable length quantity, built here from the format's definition (sign in the lowest bit, then
 * five bits per character with bit 5 meaning more follows), so tests build their maps without the decoder's own code.
 * Works above 32 bits too, which the decoder must refuse.
 */
export function encodeVlq(value: number): string {
  let rest = value < 0 ? -value * 2 + 1 : value * 2;
  let out = '';
  do {
    let digit = rest % 32;
    rest = Math.floor(rest / 32);
    if (rest > 0) digit += 32;
    out += ALPHABET[digit];
  } while (rest > 0);
  return out;
}

/** One segment with absolute values; `source` and the two original numbers are all present or all absent. */
export interface Seg {
  /** Generated column. */
  col: number;
  source?: number;
  line?: number;
  ocol?: number;
  name?: number;
}

/**
 * Builds a `mappings` string from segments with absolute values, one array per generated line. Relative numbers are
 * worked out here, as the format says: the column restarts on every line, the others carry on.
 */
export function buildMappings(lines: Seg[][]): string {
  let source = 0;
  let line = 0;
  let ocol = 0;
  let name = 0;
  return lines
    .map((segments) => {
      let col = 0;
      return segments
        .map((segment) => {
          let text = encodeVlq(segment.col - col);
          col = segment.col;
          if (segment.source !== undefined && segment.line !== undefined && segment.ocol !== undefined) {
            text +=
              encodeVlq(segment.source - source) + encodeVlq(segment.line - line) + encodeVlq(segment.ocol - ocol);
            source = segment.source;
            line = segment.line;
            ocol = segment.ocol;
            if (segment.name !== undefined) {
              text += encodeVlq(segment.name - name);
              name = segment.name;
            }
          }
          return text;
        })
        .join(',');
    })
    .join(';');
}

/** A small map as text. */
export function mapText(parts: {
  mappings: string;
  sources?: (string | null)[];
  names?: string[];
  sourcesContent?: (string | null)[];
  file?: string;
  sourceRoot?: string;
  ignoreList?: number[];
}): string {
  return JSON.stringify({
    version: 3,
    ...(parts.file === undefined ? {} : { file: parts.file }),
    ...(parts.sourceRoot === undefined ? {} : { sourceRoot: parts.sourceRoot }),
    sources: parts.sources ?? ['a.ts'],
    ...(parts.sourcesContent === undefined ? {} : { sourcesContent: parts.sourcesContent }),
    names: parts.names ?? [],
    ...(parts.ignoreList === undefined ? {} : { ignoreList: parts.ignoreList }),
    mappings: parts.mappings,
  });
}

/** A seeded generator (mulberry32) giving numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A V8 frame line for a script. */
export function v8Frame(name: string, url: string, line: number, column: number): string {
  return `    at ${name} (${url}:${line}:${column})`;
}

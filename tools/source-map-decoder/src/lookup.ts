import { decodeNeededLines, type DecodedMappings } from './decode-lines';
import type { Finding } from './errors';
import { sectionAt } from './index-map';
import type { AnyMap, ParsedIndexMap, ParsedMap } from './parse-map';

/** Values kept per segment in `LineSegments.data`: column, source, original line, original column, name. */
const STRIDE = 5;

/** A zero based generated position to look up: a line and a column. */
export interface Position {
  line: number;
  column: number;
}

/** An ordinary map read for the lines a trace names. */
export interface DecodedLeaf {
  map: ParsedMap;
  decoded: DecodedMappings;
}

/** A map ready to be looked up in: an ordinary map, or the sections of an index map each read for its own lines. */
export type Decoded =
  { kind: 'map'; map: ParsedMap; leaf: DecodedLeaf } | { kind: 'index'; map: ParsedIndexMap; leaves: DecodedLeaf[] };

/**
 * Reads a map for the positions a trace names, and only those lines. The whole `mappings` string is still read once
 * (the numbers are relative, and the strict reader needs every segment) but only the named generated lines are kept.
 * For an index map each position goes to the section that holds it, found by binary search, and every section is
 * read once.
 */
export function decodeMap(map: AnyMap, positions: readonly Position[]): Decoded {
  if (map.kind === 'map') {
    const wanted = map.usable ? positions.map((p) => p.line) : [];
    return { kind: 'map', map, leaf: readLeaf(map, wanted) };
  }
  const wantedBySection: number[][] = map.sections.map(() => []);
  for (const position of positions) {
    const at = sectionAt(map, position.line, position.column);
    const section = map.sections[at];
    if (section) wantedBySection[at]?.push(position.line - section.line);
  }
  const leaves = map.sections.map((section, i) => readLeaf(section.map, wantedBySection[i] ?? []));
  return { kind: 'index', map, leaves };
}

function readLeaf(map: ParsedMap, wanted: readonly number[]): DecodedLeaf {
  if (!map.usable) {
    return {
      map,
      decoded: { lines: new Map(), segments: 0, generatedLines: 0, findings: [], complete: false },
    };
  }
  return {
    map,
    decoded: decodeNeededLines(map.mappings, wanted, { sources: map.sources.length, names: map.names.length }),
  };
}

/** The findings the pass over the mappings gave, for a map and all its sections, each with its section's name. */
export function decodeFindings(decoded: Decoded): Finding[] {
  if (decoded.kind === 'map') return decoded.leaf.decoded.findings;
  const out: Finding[] = [];
  decoded.leaves.forEach((leaf, i) => {
    for (const finding of leaf.decoded.findings)
      out.push({ level: finding.level, message: `Section ${i + 1}: ${finding.message}` });
  });
  return out;
}

/** What a lookup found. Lines and columns are zero based. */
export type LookupResult =
  | {
      kind: 'mapped';
      map: ParsedMap;
      sourceIndex: number;
      source: string | null;
      line: number;
      column: number;
      name: string | null;
      ignored: boolean;
    }
  /** The nearest segment at or before the position has no original position (it has one field). */
  | { kind: 'unmapped' }
  /** The position is before the first segment of its line; `nearest` is that segment's column. */
  | { kind: 'before-first'; nearest: number }
  /** The generated line holds no segment, or the position is outside every section. */
  | { kind: 'no-line' };

function lookupLeaf(leaf: DecodedLeaf, line: number, column: number, columnShift: number): LookupResult {
  const segments = leaf.decoded.lines.get(line);
  if (!segments || segments.count === 0) return { kind: 'no-line' };
  const { data, count } = segments;
  // The first segment whose column is greater than the query; the one before it is the answer (the last of equals).
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((data[middle * STRIDE] ?? 0) <= column) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return { kind: 'before-first', nearest: (data[0] ?? 0) + columnShift };
  const at = (low - 1) * STRIDE;
  const sourceIndex = data[at + 1] ?? -1;
  if (sourceIndex < 0) return { kind: 'unmapped' };
  const nameIndex = data[at + 4] ?? -1;
  const map = leaf.map;
  return {
    kind: 'mapped',
    map,
    sourceIndex,
    source: map.sources[sourceIndex] ?? null,
    line: data[at + 2] ?? 0,
    column: data[at + 3] ?? 0,
    name: nameIndex >= 0 ? (map.names[nameIndex] ?? null) : null,
    ignored: map.ignored.has(sourceIndex),
  };
}

/**
 * The original position for a zero based generated position: the segment on that generated line with the greatest
 * column at or before the query (the last one written when several share a column, as Node's `module.SourceMap`
 * returns). The answer is `mapped`, `unmapped` (that segment has no original position), `before-first` or `no-line`;
 * a lookup never reaches back to an earlier line. In an index map the position is taken inside the section that holds
 * it, with the section's column offset applied only on the section's first line.
 */
export function lookup(decoded: Decoded, line: number, column: number): LookupResult {
  if (decoded.kind === 'map') return lookupLeaf(decoded.leaf, line, column, 0);
  const at = sectionAt(decoded.map, line, column);
  const section = decoded.map.sections[at];
  const leaf = decoded.leaves[at];
  if (!section || !leaf) return { kind: 'no-line' };
  const onFirstLine = line === section.line;
  const shift = onFirstLine ? section.column : 0;
  const result = lookupLeaf(leaf, line - section.line, column - shift, shift);
  return result;
}

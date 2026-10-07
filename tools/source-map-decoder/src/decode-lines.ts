import { addFinding, SourceMapError, type Finding } from './errors';
import { MAX_KEPT_SEGMENTS, withCommas } from './limits';
import { DIGIT_OF, VlqError, decodeVlq, type VlqRead } from './vlq';

/** Values kept for each segment, in this order: generated column, source, original line, original column, name. */
const STRIDE = 5;

/** The segments of one generated line, sorted by generated column (equal columns stay in the order they were written). */
export interface LineSegments {
  count: number;
  /** `STRIDE` numbers per segment. Source and name are -1 when the segment has none. */
  data: Float64Array;
  sorted: boolean;
}

/** What one pass over a `mappings` string gives. */
export interface DecodedMappings {
  /** The wanted generated lines (zero based) that hold at least one segment. */
  lines: Map<number, LineSegments>;
  /** How many segments the whole string holds. */
  segments: number;
  /** How many generated lines the string spans. */
  generatedLines: number;
  findings: Finding[];
  /** False when reading stopped early on a fault, so lines after it are missing. */
  complete: boolean;
}

/** How many entries the map has to look up in, so an index past the end is a finding and not a mapping. */
export interface MapShape {
  sources: number;
  names: number;
}

/** The position of the first character that cannot be in a `mappings` string, or -1. */
function firstOutsideAlphabet(mappings: string): number {
  for (let i = 0; i < mappings.length; i++) {
    const code = mappings.charCodeAt(i);
    if (code === 44 || code === 59) continue;
    if (code >= 128 || (DIGIT_OF[code] ?? -1) < 0) return i;
  }
  return -1;
}

function sortLine(line: LineSegments): void {
  const { count, data } = line;
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  order.sort((a, b) => (data[a * STRIDE] ?? 0) - (data[b * STRIDE] ?? 0) || a - b);
  const next = new Float64Array(data.length);
  for (let i = 0; i < count; i++) {
    const from = (order[i] ?? 0) * STRIDE;
    for (let k = 0; k < STRIDE; k++) next[i * STRIDE + k] = data[from + k] ?? 0;
  }
  line.data = next;
  line.sorted = true;
}

/**
 * Reads a whole `mappings` string once (ECMA-426 5.1, "Decode mappings") and keeps the segments of only the generated
 * lines named in `wanted` (zero based), in typed arrays. The relative numbers carry across every line, so every value
 * is read, but a line nobody asked for costs no memory. The characters are checked against the alphabet first, in a
 * separate pass; a fault found while reading stops the pass with a finding that names the position, and the lines
 * read until then are kept.
 *
 * Findings use level `error` for a fault that stops the reading and level `warn` for one the specification says an
 * implementation may report and move past (a segment with 2 or 3 fields, an index past the end of `sources` or
 * `names`, an empty segment, a column below 0). Positions in messages are counted from 1.
 */
export function decodeNeededLines(mappings: string, wanted: readonly number[], shape: MapShape): DecodedMappings {
  const findings: Finding[] = [];
  const lines = new Map<number, LineSegments>();
  const bad = firstOutsideAlphabet(mappings);
  if (bad !== -1) {
    addFinding(
      findings,
      'error',
      `The mappings hold a character outside the Base64 VLQ alphabet at position ${withCommas(bad + 1)}, so they are not read.`,
    );
    return { lines, segments: 0, generatedLines: 0, findings, complete: false };
  }

  const sortedWanted = Array.from(new Set(wanted)).sort((a, b) => a - b);
  let wantedAt = 0;
  let nextWanted = sortedWanted[0] ?? Infinity;
  const n = mappings.length;
  const rd: VlqRead = { value: 0, next: 0 };
  let pos = 0;
  const read = (): number => {
    decodeVlq(mappings, pos, n, rd);
    pos = rd.next;
    return rd.value;
  };
  const atDelimiter = (): boolean => {
    if (pos >= n) return true;
    const c = mappings.charCodeAt(pos);
    return c === 44 || c === 59;
  };
  const skipToDelimiter = (): void => {
    while (pos < n) {
      const c = mappings.charCodeAt(pos);
      if (c === 44 || c === 59) return;
      pos++;
    }
  };

  let line = 0;
  let column = 0;
  let source = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let nameIndex = 0;
  let segments = 0;
  let kept = 0;
  let atSegmentStart = true;
  let current = null as LineSegments | null;
  const enter = (): void => {
    current = null;
    if (line === nextWanted) {
      current = { count: 0, data: new Float64Array(STRIDE * 8), sorted: true };
      lines.set(line, current);
      wantedAt++;
      nextWanted = sortedWanted[wantedAt] ?? Infinity;
    }
  };
  enter();

  let complete = true;
  try {
    while (pos < n) {
      const c = mappings.charCodeAt(pos);
      if (c === 59) {
        line++;
        column = 0;
        atSegmentStart = true;
        pos++;
        enter();
        continue;
      }
      if (c === 44) {
        if (atSegmentStart) addFinding(findings, 'warn', `Generated line ${line + 1} has an empty segment.`);
        atSegmentStart = true;
        pos++;
        continue;
      }
      atSegmentStart = false;
      segments++;
      column += read();
      if (column < 0) {
        addFinding(findings, 'warn', `Generated line ${line + 1} has a segment whose column is below 0.`);
        skipToDelimiter();
        continue;
      }
      let sourceOf = -1;
      let lineOf = -1;
      let columnOf = -1;
      let nameOf = -1;
      if (!atDelimiter()) {
        const relativeSource = read();
        if (atDelimiter()) {
          addFinding(
            findings,
            'warn',
            `Generated line ${line + 1} has a segment with 2 fields; a segment has 1, 4 or 5.`,
          );
        } else {
          const relativeLine = read();
          if (atDelimiter()) {
            addFinding(
              findings,
              'warn',
              `Generated line ${line + 1} has a segment with 3 fields; a segment has 1, 4 or 5.`,
            );
          } else {
            const relativeColumn = read();
            source += relativeSource;
            originalLine += relativeLine;
            originalColumn += relativeColumn;
            if (source < 0 || originalLine < 0 || originalColumn < 0 || source >= shape.sources) {
              addFinding(
                findings,
                'warn',
                `Generated line ${line + 1} has a segment whose source, line or column is outside the map.`,
              );
            } else {
              sourceOf = source;
              lineOf = originalLine;
              columnOf = originalColumn;
            }
            if (!atDelimiter()) {
              nameIndex += read();
              if (nameIndex < 0 || nameIndex >= shape.names) {
                addFinding(
                  findings,
                  'warn',
                  `Generated line ${line + 1} has a segment whose name index is outside the map.`,
                );
              } else nameOf = nameIndex;
              if (!atDelimiter()) {
                addFinding(findings, 'warn', `Generated line ${line + 1} has a segment with more than 5 fields.`);
                skipToDelimiter();
              }
            }
          }
        }
      }
      const into: LineSegments | null = current;
      if (into !== null) {
        kept++;
        if (kept > MAX_KEPT_SEGMENTS) {
          throw new SourceMapError(
            `The generated lines the trace names hold more than ${withCommas(MAX_KEPT_SEGMENTS)} segments in one map; they are not read.`,
            'maps',
          );
        }
        const used = into.count * STRIDE;
        if (used + STRIDE > into.data.length) {
          const bigger = new Float64Array(into.data.length * 2);
          bigger.set(into.data);
          into.data = bigger;
        }
        if (into.count > 0 && column < (into.data[used - STRIDE] ?? 0)) into.sorted = false;
        into.data[used] = column;
        into.data[used + 1] = sourceOf;
        into.data[used + 2] = lineOf;
        into.data[used + 3] = columnOf;
        into.data[used + 4] = nameOf;
        into.count++;
      }
    }
  } catch (err) {
    if (!(err instanceof VlqError)) throw err;
    complete = false;
    addFinding(
      findings,
      'error',
      err.problem === 'too-big'
        ? `A value of 2 to the 31 or more in the mappings at position ${withCommas(err.position + 1)}, so the rest is not read.`
        : err.problem === 'truncated'
          ? `A value in the mappings ends early at position ${withCommas(err.position + 1)}, so the rest is not read.`
          : `A character outside the Base64 VLQ alphabet in the mappings at position ${withCommas(err.position + 1)}, so the rest is not read.`,
    );
  }
  for (const segmentsOfLine of lines.values()) if (!segmentsOfLine.sorted) sortLine(segmentsOfLine);
  return { lines, segments, generatedLines: n === 0 ? 0 : line + 1, findings, complete };
}

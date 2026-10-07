import { SourceMapError } from './errors';

/** The most maps one run reads, pasted and opened together. */
export const MAX_MAPS = 20;
/** The largest single map, in bytes (50 MiB). */
export const MAX_MAP_BYTES = 52_428_800;
/** The most bytes of maps in one run, in all (80 MiB). */
export const MAX_TOTAL_MAP_BYTES = 83_886_080;
/** The most lines a pasted trace may have. */
export const MAX_TRACE_LINES = 5_000;
/** The most bytes a pasted trace may have (1 MiB). */
export const MAX_TRACE_BYTES = 1_048_576;
/** A trace line longer than this is kept as it is and never read as a frame. */
export const MAX_TRACE_LINE_CHARS = 4_096;
/** The most sections an index map may have. */
export const MAX_SECTIONS = 20_000;
/** The most entries in `sources` plus `names` of one map. */
export const MAX_NAMES_AND_SOURCES = 1_000_000;
/** The largest position the format can hold: an unsigned 32-bit number. */
export const MAX_POSITION = 4_294_967_295;
/** The most frame rows a report holds. */
export const MAX_FRAME_ROWS = 5_000;
/** The most frames that get a source excerpt. */
export const MAX_EXCERPT_FRAMES = 10;
/** The most findings a report lists in all. */
export const MAX_FINDINGS = 200;
/**
 * The most characters of a source path the decoded trace keeps (the length of the longest path Linux accepts). The decoded
 * trace is the text a visitor copies into an editor, so a real path is never cut; the Frames table cuts at 200.
 */
export const MAX_DECODED_PATH = 4_096;
/** The most characters of one source line an excerpt shows. */
export const MAX_EXCERPT_CHARS = 200;
/** The most lines of context either side of a frame. */
export const MAX_CONTEXT_LINES = 5;
/** The most segments kept for the generated lines a trace names, in one map. */
export const MAX_KEPT_SEGMENTS = 4_000_000;

/** A whole number with a comma between thousands, for sentences. */
export function withCommas(n: number): string {
  const digits = String(Math.trunc(n));
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}

/** The number of bytes `text` takes in UTF-8, counted in one pass without making the bytes. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/** What `checkInput` needs: the two texts and the sizes in bytes of the opened map files. */
export interface InputSizes {
  trace: string;
  maps: string;
  fileSizes?: readonly number[];
}

/**
 * Refuses what is too big before anything is read or parsed. Every refusal names the part and the number, never the
 * text. The pasted maps are measured in bytes, so a map of mostly non-ASCII characters is held to the same limit as a
 * file of the same size.
 */
export function checkInput(input: InputSizes): void {
  const traceBytes = utf8Length(input.trace);
  if (traceBytes > MAX_TRACE_BYTES) {
    throw new SourceMapError(
      `The trace is ${withCommas(traceBytes)} bytes. The limit is ${withCommas(MAX_TRACE_BYTES)} bytes (1 MiB).`,
      'trace',
    );
  }
  // Lines are counted by the rule the trace is split by: a line feed, a carriage return and line feed, or a lone
  // carriage return each end one line.
  const trace = input.trace;
  let lines = 1;
  for (let at = 0; at < trace.length; at++) {
    const code = trace.charCodeAt(at);
    if (code === 10) lines++;
    else if (code === 13) {
      lines++;
      if (trace.charCodeAt(at + 1) === 10) at++;
    }
  }
  if (lines > MAX_TRACE_LINES) {
    throw new SourceMapError(
      `The trace has ${withCommas(lines)} lines. The limit is ${withCommas(MAX_TRACE_LINES)} lines.`,
      'trace',
    );
  }
  const sizes = input.fileSizes ?? [];
  if (sizes.length > MAX_MAPS) {
    throw new SourceMapError(
      `${withCommas(sizes.length)} map files were opened. The limit is ${MAX_MAPS} maps.`,
      'map file',
    );
  }
  // A single pasted map is held to its own limit when the text is split; here only the total counts.
  let total = utf8Length(input.maps);
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i] ?? 0;
    if (size > MAX_MAP_BYTES) {
      throw new SourceMapError(
        `Map file ${i + 1} is ${withCommas(size)} bytes. The limit for one map is ${withCommas(MAX_MAP_BYTES)} bytes (50 MiB).`,
        'map file',
        { map: i + 1 },
      );
    }
    total += size;
  }
  if (total > MAX_TOTAL_MAP_BYTES) {
    throw new SourceMapError(
      `The maps are ${withCommas(total)} bytes in all. The limit is ${withCommas(MAX_TOTAL_MAP_BYTES)} bytes (80 MiB).`,
      'maps',
    );
  }
}

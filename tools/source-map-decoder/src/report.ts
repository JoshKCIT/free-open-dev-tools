import { decodedFrameText, formatDecodedTrace, type DecodedLine } from './format';
import { SourceMapError, type Finding } from './errors';
import {
  MAX_CONTEXT_LINES,
  MAX_EXCERPT_CHARS,
  MAX_EXCERPT_FRAMES,
  MAX_FINDINGS,
  MAX_FRAME_ROWS,
  MAX_MAPS,
  checkInput,
  utf8Length,
  withCommas,
} from './limits';
import { decodeFindings, decodeMap, lookup, type Decoded, type LookupResult } from './lookup';
import { matchMaps, type MapClaim, type MatchHow } from './match';
import { callSiteName } from './names';
import { collectFindings, parseMap, type AnyMap } from './parse-map';
import { cleanFileText, splitMaps } from './split';
import { isOutOfRange, parseTrace, type Frame } from './trace';
import { visible } from './visible';

/** A map file the visitor opened, already read as text. */
export interface OpenedFile {
  name: string;
  text: string;
}

export interface DecodeInput {
  /** The pasted stack trace. */
  trace: string;
  /** The pasted maps, one after another, or `data:` addresses that hold maps. */
  maps: string;
  /** Opened map files, read by the caller. */
  files?: readonly OpenedFile[];
  /** Lines of original source shown either side of a frame: 0 to 5. Default 2. */
  context?: number;
  /** Remove frames whose source is on its map's ignore list from the decoded trace and the rows. */
  hideIgnored?: boolean;
}

export type RowStatus = 'mapped' | 'unmapped' | 'before-first' | 'no-line' | 'no-map' | 'several-maps' | 'out-of-range';

/** One frame of the trace, in the order of the trace. */
export interface FrameRow {
  /** The frame's place among the frames, from 1. */
  number: number;
  /** The line of the pasted trace the frame is on, from 1. */
  traceLine: number;
  /** The generated place as printed: address, line and column (the address cut at 200 characters). */
  generated: string;
  status: RowStatus;
  /** The map used, as its number from 1, or null. */
  map: number | null;
  how: MatchHow | null;
  source: string | null;
  /** Original line and column, one based, or null. */
  originalLine: number | null;
  originalColumn: number | null;
  /** `source:line:column`, or '' when there is no original position. */
  original: string;
  /** The name the map gives at this frame's own position. */
  name: string | null;
  /** The function name as the engine printed it (cut at 200 characters). */
  traceFunction: string;
  /** The function name read from the next frame's call site. */
  functionName: string | null;
  ignored: boolean;
  note: string;
}

/** What was read from one map, for the "Maps read" table. */
export interface MapInfo {
  number: number;
  label: string;
  kind: 'map' | 'index map';
  usable: boolean;
  sections: number;
  sources: number;
  names: number;
  segments: number;
  generatedLines: number;
  bytes: number;
  errors: number;
  warnings: number;
}

export interface ReportFinding {
  map: number;
  level: 'error' | 'warn';
  message: string;
}

/** A few lines of original source around a frame. `marker` is the index in `lines` of the frame's own line. */
export interface Excerpt {
  frame: number;
  source: string;
  startLine: number;
  lines: string[];
  marker: number;
}

/** One line of the pasted trace: the text as pasted, the row it became (if it is a frame) and whether it is hidden. */
export interface TraceItem {
  text: string;
  decoded: string;
  row: number | null;
  hidden: boolean;
}

export interface ReportNote {
  tone: 'info' | 'warn';
  text: string;
}

export interface DecodeReport {
  rows: FrameRow[];
  maps: MapInfo[];
  findings: ReportFinding[];
  findingsLeftOut: number;
  excerpts: Excerpt[];
  items: TraceItem[];
  /** The trace with every mapped frame decoded, in the shape of the input. */
  decoded: string;
  hiddenIgnored: number;
  notes: ReportNote[];
}

function pastedKind(map: AnyMap): 'map' | 'index map' {
  return map.kind === 'index' ? 'index map' : 'map';
}

/**
 * Cuts the lines of an original source around a zero based line. Lines end at a line feed, a carriage return, a pair of
 * them, or U+2028 or U+2029, as ECMAScript counts them. The scan stops after the last line wanted, and each line is cut
 * at 200 characters. Returns null when the source has no such line.
 */
function excerptOf(
  content: string,
  line: number,
  context: number,
): { startLine: number; lines: string[]; marker: number } | null {
  const first = Math.max(0, line - context);
  const last = line + context;
  const lines: string[] = [];
  const n = content.length;
  let index = 0;
  let start = 0;
  let reached = false;
  for (;;) {
    let end = start;
    while (end < n) {
      const c = content.charCodeAt(end);
      if (c === 10 || c === 13 || c === 0x2028 || c === 0x2029) break;
      end++;
    }
    if (index >= first && index <= last) {
      const text = content.slice(start, Math.min(end, start + MAX_EXCERPT_CHARS + 1));
      lines.push(
        text.length > MAX_EXCERPT_CHARS ? text.slice(0, MAX_EXCERPT_CHARS) + String.fromCodePoint(0x2026) : text,
      );
    }
    if (index === line) reached = true;
    if (end >= n) break;
    start = end + (content.charCodeAt(end) === 13 && content.charCodeAt(end + 1) === 10 ? 2 : 1);
    index++;
    if (index > last) break;
  }
  return reached ? { startLine: first + 1, lines, marker: line - first } : null;
}

interface Scratch {
  status: RowStatus;
  map: number | null;
  how: MatchHow | null;
  result: LookupResult | null;
  note: string;
}

const NOTE_ONLY =
  'Only one map was given, so it was used although no file name matched. Check that it was built together with this file.';

/**
 * Decodes a stack trace through source maps. The trace is read line by line (V8, SpiderMonkey and JavaScriptCore
 * shapes), each frame is given the map that claims its file, the maps are read once each for only the generated lines
 * the trace names, and every frame is looked up. Nothing is fetched: addresses in a trace or a map are text.
 *
 * Sizes are checked before anything is read; a refusal names the part and the number and never repeats input. The
 * result holds no state between calls: the same input always gives deep-equal results, in the order of the trace.
 */
export function decodeStackTrace(input: DecodeInput): DecodeReport {
  const context = input.context ?? 2;
  if (!Number.isInteger(context) || context < 0 || context > MAX_CONTEXT_LINES) {
    throw new SourceMapError(`Lines of context must be a whole number from 0 to ${MAX_CONTEXT_LINES}.`, 'trace');
  }
  const files = input.files ?? [];
  const fileBytes = files.map((file) => utf8Length(file.text));
  checkInput({ trace: input.trace, maps: input.maps, fileSizes: fileBytes });

  const traceLines = parseTrace(input.trace);
  const pastedTexts = splitMaps(input.maps, MAX_MAPS);
  if (pastedTexts.length + files.length > MAX_MAPS) {
    throw new SourceMapError(
      `${withCommas(pastedTexts.length + files.length)} maps were given. The limit is ${MAX_MAPS} maps in all.`,
      'maps',
    );
  }

  const maps: AnyMap[] = [];
  const claims: MapClaim[] = [];
  pastedTexts.forEach((text, i) => {
    const map = parseMap(text, `Map ${i + 1}`, i + 1, utf8Length(text));
    maps.push(map);
    claims.push({ file: map.file, openedName: null });
  });
  files.forEach((file, i) => {
    const number = pastedTexts.length + i + 1;
    const map = parseMap(cleanFileText(file.text), visible(file.name, 200), number, fileBytes[i] ?? 0);
    maps.push(map);
    claims.push({ file: map.file, openedName: file.name });
  });
  if (maps.length > 0 && !maps.some((map) => map.usable)) {
    const first = maps[0];
    const why = first?.findings[0]?.message ?? 'The map cannot be read.';
    throw new SourceMapError(
      `Map 1 could not be read, so there is nothing to decode with. ${why}`,
      pastedTexts.length > 0 ? 'maps' : 'map file',
      { map: 1 },
    );
  }

  // The frames, in trace order, each with the map that claims it.
  const frameLines: { at: number; frame: Frame }[] = [];
  traceLines.forEach((line, at) => {
    if (line.frame !== null && frameLines.length < MAX_FRAME_ROWS) frameLines.push({ at, frame: line.frame });
  });
  const matches = matchMaps(
    frameLines.map((f) => ({ url: f.frame.url })),
    claims,
  );
  const scratch: Scratch[] = frameLines.map((f, i) => {
    const match = matches[i];
    if (isOutOfRange(f.frame)) {
      return {
        status: 'out-of-range',
        map: null,
        how: null,
        result: null,
        note: 'The line or column is too big for the format to hold.',
      };
    }
    if (!match || match.kind === 'no-maps')
      return { status: 'no-map', map: null, how: null, result: null, note: 'No map was given.' };
    if (match.kind === 'none')
      return { status: 'no-map', map: null, how: null, result: null, note: 'No map matches this file.' };
    if (match.kind === 'several') {
      return {
        status: 'several-maps',
        map: null,
        how: null,
        result: null,
        note: `${match.count} maps match this file equally well, so none was used. Give only the one built with it.`,
      };
    }
    return { status: 'no-line', map: match.map + 1, how: match.how, result: null, note: '' };
  });

  // Read each map once, for the lines its frames name, and look every one of its frames up.
  const mapInfos: MapInfo[] = [];
  const findings: ReportFinding[] = [];
  let findingsLeftOut = 0;
  const addReportFinding = (map: number, finding: Finding): void => {
    if (findings.length < MAX_FINDINGS) findings.push({ map, level: finding.level, message: finding.message });
    else findingsLeftOut++;
  };
  maps.forEach((map, k) => {
    const number = k + 1;
    const positions: { line: number; column: number }[] = [];
    const framesOfMap: number[] = [];
    scratch.forEach((s, i) => {
      const frame = frameLines[i]?.frame;
      if (s.map === number && frame) {
        positions.push({ line: frame.line - 1, column: frame.column - 1 });
        framesOfMap.push(i);
      }
    });
    let decoded: Decoded;
    try {
      decoded = decodeMap(map, positions);
    } catch (err) {
      if (err instanceof SourceMapError) throw new SourceMapError(err.message, err.part, { map: number });
      throw err;
    }
    for (const i of framesOfMap) {
      const frame = frameLines[i]?.frame;
      const row = scratch[i];
      if (!frame || !row) continue;
      const result = lookup(decoded, frame.line - 1, frame.column - 1);
      row.result = result;
      if (result.kind === 'mapped') row.status = 'mapped';
      else if (result.kind === 'unmapped') {
        row.status = 'unmapped';
        row.note = 'The map has a mapping here but no original position for it.';
      } else if (result.kind === 'before-first') {
        row.status = 'before-first';
        row.note = `This is before the first mapping on its generated line, which starts at column ${withCommas(result.nearest + 1)}.`;
      } else {
        row.status = 'no-line';
        row.note = 'The map has no mapping on this generated line.';
      }
      if (row.how === 'only') row.note = row.note === '' ? NOTE_ONLY : `${row.note} ${NOTE_ONLY}`;
    }
    const all = [...collectFindings(map), ...decodeFindings(decoded)];
    let errors = 0;
    let warnings = 0;
    for (const finding of all) {
      if (finding.level === 'error') errors++;
      else warnings++;
      addReportFinding(number, finding);
    }
    let segments = 0;
    let generatedLines = 0;
    let sources = 0;
    let names = 0;
    if (decoded.kind === 'map') {
      segments = decoded.leaf.decoded.segments;
      generatedLines = decoded.leaf.decoded.generatedLines;
      sources = decoded.map.sources.length;
      names = decoded.map.names.length;
    } else {
      decoded.leaves.forEach((leaf, i) => {
        segments += leaf.decoded.segments;
        const section = decoded.map.sections[i];
        generatedLines = Math.max(generatedLines, (section?.line ?? 0) + leaf.decoded.generatedLines);
        sources += leaf.map.sources.length;
        names += leaf.map.names.length;
      });
    }
    mapInfos.push({
      number,
      label: map.label,
      kind: pastedKind(map),
      usable: map.usable,
      sections: map.kind === 'index' ? map.sections.length : 0,
      sources,
      names,
      segments,
      generatedLines,
      bytes: map.bytes,
      errors,
      warnings,
    });
  });

  // Names from call sites, then the rows.
  const named = scratch.map((s) => ({ name: s.result && s.result.kind === 'mapped' ? s.result.name : null }));
  const rows: FrameRow[] = [];
  frameLines.forEach((f, i) => {
    const s = scratch[i];
    if (!s) return;
    const result = s.result;
    const mapped = result && result.kind === 'mapped' ? result : null;
    const source = mapped ? mapped.source : null;
    const originalLine = mapped ? mapped.line + 1 : null;
    const originalColumn = mapped ? mapped.column + 1 : null;
    const original = mapped ? `${visible(source ?? '(no file name)', 200)}:${originalLine}:${originalColumn}` : '';
    const functionName = mapped ? callSiteName(named, i) : null;
    rows.push({
      number: i + 1,
      traceLine: f.at + 1,
      generated: `${visible(f.frame.url, 200)}:${f.frame.line}:${f.frame.column}`,
      status: s.status,
      map: s.map,
      how: s.how,
      source,
      originalLine,
      originalColumn,
      original,
      name: mapped ? mapped.name : null,
      traceFunction: visible(f.frame.functionName, 200),
      functionName,
      ignored: mapped ? mapped.ignored : false,
      note:
        mapped && mapped.ignored
          ? s.note === ''
            ? 'On the map ignore list.'
            : `${s.note} On the map ignore list.`
          : s.note,
    });
  });

  // The decoded trace, in the shape of the pasted one.
  const items: TraceItem[] = [];
  const rowAt = new Map<number, number>();
  frameLines.forEach((f, i) => rowAt.set(f.at, i));
  let hiddenIgnored = 0;
  traceLines.forEach((line, at) => {
    const rowIndex = rowAt.get(at);
    if (rowIndex === undefined || line.frame === null) {
      items.push({ text: line.text, decoded: line.text, row: null, hidden: false });
      return;
    }
    const row = rows[rowIndex];
    const s = scratch[rowIndex];
    const mapped = s?.result && s.result.kind === 'mapped' ? s.result : null;
    let decodedText = line.text;
    if (row && mapped && row.original !== '') {
      decodedText = decodedFrameText(line.frame, row.original, row.functionName);
    }
    const hidden = Boolean(input.hideIgnored && row && row.ignored);
    if (hidden) hiddenIgnored++;
    items.push({ text: line.text, decoded: decodedText, row: rowIndex, hidden });
  });
  const decodedLines: DecodedLine[] = items.map((item) => ({ text: item.decoded, hidden: item.hidden }));

  // Source excerpts for the first mapped frames that have the source text.
  const excerpts: Excerpt[] = [];
  for (let i = 0; i < rows.length && excerpts.length < MAX_EXCERPT_FRAMES; i++) {
    const row = rows[i];
    const s = scratch[i];
    const result = s?.result;
    if (!row || !result || result.kind !== 'mapped') continue;
    if (input.hideIgnored && row.ignored) continue;
    const content = result.map.sourcesContent[result.sourceIndex];
    if (typeof content !== 'string') continue;
    const cut = excerptOf(content, result.line, context);
    if (cut === null) continue;
    excerpts.push({ frame: row.number, source: visible(result.source ?? '(no file name)', 200), ...cut });
  }

  const notes: ReportNote[] = [];
  if (frameLines.length === 0) {
    notes.push({
      tone: 'info',
      text: 'No stack frames were found in the trace. A frame looks like "at name (file.js:1:2)" or "name@file.js:1:2".',
    });
  } else if (maps.length === 0) {
    notes.push({ tone: 'info', text: 'No map was given, so the frames are shown as they are.' });
  }
  if (rows.some((row) => row.how === 'only')) notes.push({ tone: 'warn', text: NOTE_ONLY });
  for (const info of mapInfos) {
    if (info.errors > 0) {
      notes.push({
        tone: 'warn',
        text: `Map ${info.number} has errors (see the findings). What it gives may be wrong.`,
      });
    }
  }
  if (hiddenIgnored > 0) {
    notes.push({
      tone: 'info',
      text: `${withCommas(hiddenIgnored)} frame${hiddenIgnored === 1 ? '' : 's'} from ignored sources ${hiddenIgnored === 1 ? 'was' : 'were'} hidden.`,
    });
  }

  const shownRows = input.hideIgnored ? rows.filter((row) => !row.ignored) : rows;
  return {
    rows: shownRows,
    maps: mapInfos,
    findings,
    findingsLeftOut,
    excerpts,
    items,
    decoded: formatDecodedTrace(decodedLines),
    hiddenIgnored,
    notes,
  };
}

import meta from './meta.json';

export { meta };
export { SourceMapError, addFinding, hasError, MAX_FINDINGS_PER_MAP } from './errors';
export type { Finding } from './errors';
export {
  MAX_CONTEXT_LINES,
  MAX_DECODED_PATH,
  MAX_EXCERPT_CHARS,
  MAX_EXCERPT_FRAMES,
  MAX_FINDINGS,
  MAX_FRAME_ROWS,
  MAX_KEPT_SEGMENTS,
  MAX_MAPS,
  MAX_MAP_BYTES,
  MAX_NAMES_AND_SOURCES,
  MAX_POSITION,
  MAX_SECTIONS,
  MAX_TOTAL_MAP_BYTES,
  MAX_TRACE_BYTES,
  MAX_TRACE_LINES,
  MAX_TRACE_LINE_CHARS,
  checkInput,
  utf8Length,
  withCommas,
} from './limits';
export type { InputSizes } from './limits';
export { VlqError, decodeVlq } from './vlq';
export type { VlqProblem, VlqRead } from './vlq';
export { cleanFileText, splitMaps } from './split';
export { collectFindings, parseMap } from './parse-map';
export type { AnyMap, IndexSection, ParsedIndexMap, ParsedMap } from './parse-map';
export { parseSections, sectionAt } from './index-map';
export { decodeNeededLines } from './decode-lines';
export type { DecodedMappings, LineSegments, MapShape } from './decode-lines';
export { decodeFindings, decodeMap, lookup } from './lookup';
export type { Decoded, DecodedLeaf, LookupResult, Position } from './lookup';
export { isOutOfRange, parseFrame, parseTrace } from './trace';
export type { Frame, TraceLine } from './trace';
export { callSiteName } from './names';
export type { NamedFrame } from './names';
export { matchMaps } from './match';
export type { MapClaim, Match, MatchHow } from './match';
export { decodeStackTrace } from './report';
export type {
  DecodeInput,
  DecodeReport,
  Excerpt,
  FrameRow,
  MapInfo,
  OpenedFile,
  ReportFinding,
  ReportNote,
  RowStatus,
  TraceItem,
} from './report';
export { decodedFrameText, displayName, formatDecodedTrace } from './format';
export type { DecodedLine } from './format';
export { MAX_SHOWN_PATH, MAX_SHOWN_PATTERN, visible } from './visible';

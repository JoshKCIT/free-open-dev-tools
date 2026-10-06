import meta from './meta.json';

export { meta };
export { checkCors } from './check';
export type { CorsReport, CorsStep, ReadableHeader, StepResult, Verdict } from './check';
export { CorsCheckerError } from './errors';
export type { CorsCheckerPart } from './errors';
export { extractHeaderListValues, firstBadListLine } from './extract';
export { getAll, getCombined, isToken, parseHeaderBlock, trimHttpWhitespace } from './headers';
export type { HeaderBlock, HeaderEntry } from './headers';
export {
  MAX_HEADER_LINES,
  MAX_HEADER_PASTE_CHARACTERS,
  MAX_METHOD_CHARACTERS,
  MAX_URL_CHARACTERS,
  checkInput,
  withCommas,
} from './limits';
export { isSameOrigin, serializeOrigin } from './origin';
export { describeRequest } from './request';
export type { CorsInput, HeaderFate, PlannedHeader, RequestPlan } from './request';
export { parseMimeEssence } from './mime';
export {
  MAX_SAFELISTED_TOTAL_BYTES,
  MAX_SAFELISTED_VALUE_BYTES,
  analyseRequestHeaders,
  corsUnsafeRequestHeaderNames,
  isCorsSafelistedMethod,
  isCorsSafelistedRequestHeader,
  isCorsSafelistedResponseHeaderName,
  isForbiddenMethod,
  isForbiddenRequestHeader,
  isForbiddenResponseHeaderName,
  isNoCorsSafelistedRequestHeader,
  normalizeMethod,
  splitHeaderValue,
} from './safelist';
export type { UnsafeAnalysis } from './safelist';
export { MAX_SHOWN_PATH, MAX_SHOWN_PATTERN, visible } from './visible';

import meta from './meta.json';
import { SetCookieInspectorError } from './errors';
import { checkInput } from './limits';
import { maskValue } from './mask';
import { parseSetCookie, type Attribute } from './parse';
import { readRequest, type RequestContext, type RequestInfo } from './request';
import { decide, ignoredLineDecision, type Decision } from './store';
import { splitLines } from './lines';

export { meta };
export { SetCookieInspectorError } from './errors';
export type { SetCookieInspectorPart } from './errors';
export {
  MAX_AGE_LIMIT_SECONDS,
  MAX_ATTRIBUTE_VALUE_OCTETS,
  MAX_ATTRIBUTES,
  MAX_LINE_CHARACTERS,
  MAX_LINES,
  MAX_NAME_VALUE_OCTETS,
  MAX_PASTE_CHARACTERS,
  MAX_URL_CHARACTERS,
  checkInput,
  octetLength,
  withCommas,
} from './limits';
export { splitLines } from './lines';
export type { PastedLine } from './lines';
export { maskValue } from './mask';
export { parseSetCookie, readMaxAge, trimWsp } from './parse';
export type { Attribute, AttributeKind, IgnoredLine, MaxAge, ParsedCookie, SameSiteValue } from './parse';
export { readRequest } from './request';
export type { RequestContext, RequestInfo } from './request';
export { defaultPath } from './scope';
export { decide } from './store';
export type { CookieScope, Decision, Lifetime, Outcome, StepRecord } from './store';
export { MAX_SHOWN_PATH, MAX_SHOWN_PATTERN, visible } from './visible';

/** What to inspect. */
export interface InspectInput {
  /** The pasted Set-Cookie lines, one to a line. */
  lines: string;
  /** The address of the response that carried them (http or https). */
  requestUrl: string;
  /** How the request was made: from the same site, a top-level navigation from another site, or a cross-site request. */
  context: RequestContext;
  /** The moment the response arrives, in milliseconds since 1970. The package never reads a clock. */
  nowMs: number;
  /** True to show values as they are; false to show their first characters and their length. */
  reveal: boolean;
}

/** One pasted line, judged. */
export interface CookieRow {
  /** The line number in the paste, counting blank lines. */
  line: number;
  name: string;
  /** The value exactly as parsed. */
  value: string;
  /** The value as it may be shown: masked unless `reveal` was true. */
  valueShown: string;
  /** Name and value together, in UTF-8 octets. */
  octets: number;
  /** Every attribute in the order written; empty for a line that was ignored while it was read. */
  attributes: Attribute[];
  decision: Decision;
  /** True when the line looks like several cookies joined by commas. */
  looksJoined: boolean;
}

export interface CookieReport {
  /** The response address as read, or null when nothing was pasted. */
  request: RequestInfo | null;
  /** One row per pasted line that holds something, in the order pasted. */
  cookies: CookieRow[];
}

function checkTime(nowMs: number): void {
  if (!Number.isFinite(nowMs) || Math.abs(nowMs) > 8_640_000_000_000_000) {
    throw new SetCookieInspectorError('The time is not a moment that can be written as a date.', 'time');
  }
}

/**
 * Judges every Set-Cookie line of a paste the way a browser following draft-ietf-httpbis-rfc6265bis-22 would: parse it
 * (section 5.6), then store it or not (section 5.7). The same input gives an equal report every time.
 */
export function inspectCookies(input: InspectInput): CookieReport {
  checkInput(input.lines);
  checkTime(input.nowMs);
  const pasted = splitLines(input.lines);
  if (pasted.length === 0) return { request: null, cookies: [] };
  const request = readRequest(input.requestUrl, input.context);
  const cookies: CookieRow[] = pasted.map((line) => {
    const parsed = parseSetCookie(line.text);
    const shown = (value: string): string => (input.reveal ? value : maskValue(value));
    if (parsed.ignored) {
      return {
        line: line.number,
        name: parsed.name,
        value: parsed.value,
        valueShown: shown(parsed.value),
        octets: parsed.octets,
        attributes: [],
        decision: ignoredLineDecision(parsed),
        looksJoined: line.looksJoined,
      };
    }
    return {
      line: line.number,
      name: parsed.name,
      value: parsed.value,
      valueShown: shown(parsed.value),
      octets: parsed.octets,
      attributes: parsed.attributes,
      decision: decide(parsed, request, input.nowMs),
      looksJoined: line.looksJoined,
    };
  });
  return { request, cookies };
}

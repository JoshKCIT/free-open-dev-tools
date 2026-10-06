import meta from './meta.json';
import { SetCookieInspectorError } from './errors';
import { splitLines } from './lines';
import { checkInput } from './limits';
import { maskValue } from './mask';
import { parseSetCookie, type Attribute, type ParsedCookie } from './parse';
import { collectRemarks, type Remark } from './remarks';
import { readRequest, type RequestContext, type RequestInfo } from './request';
import { describeSameSite, describeScope, wouldBeSent, type CookieScope } from './scope';
import { decide, describePrefix, ignoredLineDecision, type Decision } from './store';
import { visible } from './visible';

export { meta };
export { SetCookieInspectorError } from './errors';
export type { SetCookieInspectorPart } from './errors';
export { parseCookieDate } from './date';
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
export { looksLikeToken } from './remarks';
export type { Remark } from './remarks';
export { readRequest } from './request';
export type { RequestContext, RequestInfo } from './request';
export { defaultPath, describeSameSite, describeScope, domainMatches, pathMatches, wouldBeSent } from './scope';
export type { CookieScope } from './scope';
export { decide, describeDuration, describePrefix, lifetimeOf } from './store';
export type { Decision, Lifetime, Outcome, StepRecord } from './store';
export { parseUtcTime } from './time';
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

/** An attribute as written, with its value as it may be shown. */
export interface AttributeRow extends Attribute {
  /** The value as it may be shown: the settings (Path, Domain, lifetimes, SameSite) as they are, any other value masked unless `reveal` was true. */
  valueShown: string;
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
  attributes: AttributeRow[];
  decision: Decision;
  /** True when the line looks like several cookies joined by commas. */
  looksJoined: boolean;
  /** Where the cookie is sent, in plain words. Empty when it is not stored. */
  sentTo: string;
  /** How the domain was decided, in plain words. Empty when the cookie is not stored. */
  domainHandling: string;
  /** How the path was decided, in plain words. Empty when the cookie is not stored. */
  pathHandling: string;
  /** What SameSite means for this cookie, in plain words. Empty when the line was ignored while it was read. */
  sameSiteText: string;
  /** What the prefix rules say, in plain words. */
  prefixRule: string;
}

export interface CookieReport {
  /** The response address as read, or null when nothing was pasted. */
  request: RequestInfo | null;
  /** One row per pasted line that holds something, in the order pasted. */
  cookies: CookieRow[];
  /**
   * The line numbers of the stored cookies a same-site request to the response address would carry, in the order of
   * section 5.8.3 step 4: longer paths first, and among equal paths the one pasted first.
   */
  sendOrder: number[];
  /** The things worth a look, in line order. */
  worthALook: Remark[];
}

function checkTime(nowMs: number): void {
  if (!Number.isFinite(nowMs) || Math.abs(nowMs) > 8_640_000_000_000_000) {
    throw new SetCookieInspectorError('The time is not a moment that can be written as a date.', 'time');
  }
}

/** Attributes that carry a setting are shown as they are; every other value is masked unless Reveal is on. */
const SETTINGS: ReadonlySet<string> = new Set([
  'expires',
  'max-age',
  'domain',
  'path',
  'secure',
  'httponly',
  'samesite',
]);

function attributeRows(attributes: readonly Attribute[], reveal: boolean): AttributeRow[] {
  return attributes.map((attribute) => ({
    ...attribute,
    valueShown: reveal || SETTINGS.has(attribute.kind) ? attribute.value : maskValue(attribute.value),
  }));
}

function domainHandling(cookie: ParsedCookie, scope: CookieScope): string {
  const domain = visible(scope.domain, 100);
  if (scope.hostOnly) {
    const why = cookie.domain === null ? 'there is no Domain attribute' : 'the Domain attribute is empty';
    return `Host-only: ${why}, so only ${domain} gets the cookie, not its subdomains.`;
  }
  return `Domain cookie: Domain=${domain} matches the host of the response address, so ${domain} and its subdomains get the cookie.`;
}

function pathHandling(cookie: ParsedCookie, scope: CookieScope): string {
  const path = visible(scope.path, 100);
  if (cookie.path === null) {
    return `There is no Path attribute, so the default path ${path} is used: the path of the response address up to its last slash (section 5.1.4).`;
  }
  if (cookie.path === '' || cookie.path.charCodeAt(0) !== 47) {
    return `The Path attribute is empty or does not start with a slash, so the default path ${path} is used (section 5.6.4).`;
  }
  return `Path=${path}, as written.`;
}

/**
 * Judges every Set-Cookie line of a paste the way a browser following draft-ietf-httpbis-rfc6265bis-22 would: parse it
 * (section 5.6), then store it or not (section 5.7). The same input gives an equal report every time.
 */
export function inspectCookies(input: InspectInput): CookieReport {
  checkInput(input.lines);
  checkTime(input.nowMs);
  const pasted = splitLines(input.lines);
  if (pasted.length === 0) return { request: null, cookies: [], sendOrder: [], worthALook: [] };
  const request = readRequest(input.requestUrl, input.context);
  const parsedCookies: Array<ParsedCookie | null> = [];
  const cookies: CookieRow[] = pasted.map((line) => {
    const parsed = parseSetCookie(line.text);
    const shown = (value: string): string => (input.reveal ? value : maskValue(value));
    if (parsed.ignored) {
      parsedCookies.push(null);
      return {
        line: line.number,
        name: parsed.name,
        value: parsed.value,
        valueShown: shown(parsed.value),
        octets: parsed.octets,
        attributes: [],
        decision: ignoredLineDecision(parsed),
        looksJoined: line.looksJoined,
        sentTo: '',
        domainHandling: '',
        pathHandling: '',
        sameSiteText: '',
        prefixRule: 'The line was ignored before any rule about a prefix was reached.',
      };
    }
    parsedCookies.push(parsed);
    const decision = decide(parsed, request, input.nowMs);
    const scope = decision.scope;
    return {
      line: line.number,
      name: parsed.name,
      value: parsed.value,
      valueShown: shown(parsed.value),
      octets: parsed.octets,
      attributes: attributeRows(parsed.attributes, input.reveal),
      decision,
      looksJoined: line.looksJoined,
      sentTo: scope !== null && decision.outcome === 'stored' ? describeScope(scope, parsed.sameSiteWritten) : '',
      domainHandling: scope === null ? '' : domainHandling(parsed, scope),
      pathHandling: scope === null ? '' : pathHandling(parsed, scope),
      sameSiteText: describeSameSite(parsed.sameSite, parsed.sameSiteWritten),
      prefixRule: describePrefix(parsed, decision),
    };
  });
  // Section 5.8.3 step 4: longer paths first; among equal lengths the earlier creation time (here the earlier line) first.
  const sendable = cookies
    .flatMap((row, index) =>
      row.decision.outcome === 'stored' && row.decision.scope !== null && wouldBeSent(row.decision.scope, request)
        ? [{ row, index, path: row.decision.scope.path }]
        : [],
    )
    .sort((a, b) => b.path.length - a.path.length || a.index - b.index);
  const worthALook = collectRemarks(
    cookies.map((row, index) => ({
      line: row.line,
      looksJoined: row.looksJoined,
      cookie: parsedCookies[index] ?? null,
      decision: row.decision,
    })),
    request,
  );
  return { request, cookies, sendOrder: sendable.map((entry) => entry.row.line), worthALook };
}

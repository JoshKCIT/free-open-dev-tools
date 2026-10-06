import { CorsCheckerError } from './errors';
import { isToken, readBlock } from './headers';
import {
  MAX_SAFELISTED_TOTAL_BYTES,
  analyseRequestHeaders,
  asciiLower,
  isCorsSafelistedMethod,
  isForbiddenMethod,
  isForbiddenRequestHeader,
  isNoCorsSafelistedRequestHeader,
  normalizeMethod,
} from './safelist';
import { withCommas } from './limits';
import { isSameOrigin, serializeOrigin } from './origin';
import { visible } from './visible';

/** What to check: the request as a page's script would describe it, and the answers pasted for it. */
export interface CorsInput {
  /** The origin of the page that makes the request, such as `https://app.example`, or the word `null`. */
  pageOrigin: string;
  /** The address requested (http or https). */
  url: string;
  /** The method, in any letter case. An empty method means GET. */
  method: string;
  mode: 'cors' | 'no-cors';
  credentials: 'omit' | 'same-origin' | 'include';
  /** One `Name: value` per line. */
  requestHeaders: string;
  /** The status of the answer to the preflight. */
  preflightStatus: number;
  /** The headers of the answer to the preflight, pasted. */
  preflightHeaders: string;
  /** The status of the answer to the real request. Any status is fine; it is not looked at. */
  responseStatus: number;
  /** The headers of the answer to the real request, pasted. */
  responseHeaders: string;
}

/** What the browser does with one request header. */
export type HeaderFate = 'sent' | 'dropped-forbidden' | 'dropped-no-cors';

export interface PlannedHeader {
  /** The name as pasted. */
  name: string;
  value: string;
  line: number;
  fate: HeaderFate;
  /** True when the header is sent and CORS-unsafe, so it forces a preflight (when one is sent at all). */
  unsafe: boolean;
}

export interface RequestPlan {
  /** The method as the browser sends it (normalised). */
  method: string;
  mode: 'cors' | 'no-cors';
  credentials: 'omit' | 'same-origin' | 'include';
  /** The page's origin, serialized the way the Origin header writes it. */
  requestOrigin: string;
  targetOrigin: string;
  /** The address without its fragment. */
  url: string;
  crossOrigin: boolean;
  /** Every pasted request header with what the browser does with it. */
  headers: PlannedHeader[];
  /** The CORS-unsafe request-header names of the headers that are sent: lower-cased, each once, sorted by byte. */
  unsafeNames: string[];
  /** Why the browser refuses to build this request (a TypeError before anything is sent), or null. */
  refused: string | null;
  preflight: {
    sent: boolean;
    reasons: string[];
    /** The Access-Control-Request-Headers value: the unsafe names joined by a comma and no space. Absent when there are none. */
    accessControlRequestHeaders?: string;
  };
}

function refuse(message: string, part: 'url' | 'page origin' | 'method'): CorsCheckerError {
  return new CorsCheckerError(message, part);
}

/** The most unsafe names a reason lists before it says how many more there are. */
const MAX_NAMES_LISTED = 8;

function listNames(names: readonly string[]): string {
  const shown = names.slice(0, MAX_NAMES_LISTED).map((name) => visible(name, 40));
  const more = names.length - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ');
}

/** True when a value holds a character the fetch API cannot take: above U+00FF is not a byte. */
function hasWideCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 0xff) return true;
  }
  return false;
}

/**
 * Describes the request: the method as the browser sends it, what happens to each header (sent, dropped without a message
 * because it is forbidden or because a no-cors request may not carry it), which sent headers are CORS-unsafe, and whether
 * a preflight is sent with the exact Access-Control-Request-Headers line. Throws a `CorsCheckerError` for an address, an
 * origin, a method or a header line that cannot be read, naming the part and never the text. A request the browser itself
 * refuses to build (a forbidden method, a no-cors method other than GET, HEAD or POST, a header value with a character above
 * U+00FF) is not an error: it is returned with `refused` set.
 */
export function describeRequest(input: CorsInput): RequestPlan {
  const requestOrigin = serializeOrigin(input.pageOrigin);
  if (requestOrigin === null) {
    throw refuse(
      'The page origin must be an http or https origin such as https://app.example, or the word null for a page with an opaque origin.',
      'page origin',
    );
  }

  let target: URL;
  try {
    target = new URL(input.url.trim());
  } catch {
    throw refuse('The URL could not be read. Write it in full, starting with http:// or https://.', 'url');
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw refuse('The URL must start with http:// or https://.', 'url');
  }
  if (target.username !== '' || target.password !== '') {
    throw refuse('The URL must not hold a user name or a password: the fetch API refuses such an address.', 'url');
  }
  target.hash = '';

  const rawMethod = input.method.trim();
  const written = rawMethod === '' ? 'GET' : rawMethod;
  if (!isToken(written)) {
    throw refuse(
      "The method must be one word made of letters, digits and the characters ! # $ % & ' * + - . ^ _ ` | ~.",
      'method',
    );
  }
  const method = normalizeMethod(written);
  const block = readBlock(input.requestHeaders, 'request headers');

  let refused: string | null = null;
  if (isForbiddenMethod(method)) {
    refused = `The method ${visible(method, 40)} is forbidden: the fetch API refuses CONNECT, TRACE and TRACK with a TypeError.`;
  } else if (input.mode === 'no-cors' && !isCorsSafelistedMethod(method)) {
    refused = `A no-cors request may only use GET, HEAD or POST: the fetch API refuses ${visible(method, 40)} with a TypeError.`;
  }

  // What the Headers object does with each header, in the order written: a forbidden request-header is ignored, and in
  // no-cors mode a header is kept only when the value it would have with the earlier kept headers of the same name,
  // joined with a comma and a space, is no-CORS-safelisted.
  const kept = new Map<string, string[]>();
  const planned: PlannedHeader[] = [];
  for (const entry of block.entries) {
    if (refused === null && hasWideCharacter(entry.value)) {
      refused = `A request header value holds a character above U+00FF, which the fetch API refuses with a TypeError (line ${entry.line} of the request headers).`;
    }
    const lower = asciiLower(entry.name);
    let fate: HeaderFate = 'sent';
    if (isForbiddenRequestHeader(entry.name, entry.value)) {
      fate = 'dropped-forbidden';
    } else if (input.mode === 'no-cors') {
      const earlier = kept.get(lower) ?? [];
      const combined = [...earlier, entry.value].join(', ');
      if (isNoCorsSafelistedRequestHeader(entry.name, combined)) kept.set(lower, [...earlier, entry.value]);
      else fate = 'dropped-no-cors';
    }
    planned.push({ name: entry.name, value: entry.value, line: entry.line, fate, unsafe: false });
  }

  const sent = planned.filter((header) => header.fate === 'sent');
  const analysis = analyseRequestHeaders(sent);
  const unsafe = new Set(analysis.names);
  for (const header of sent) header.unsafe = unsafe.has(asciiLower(header.name));

  const targetOrigin = target.origin;
  const crossOrigin = !isSameOrigin(requestOrigin, targetOrigin);
  const reasons: string[] = [];
  if (refused === null && crossOrigin && input.mode === 'cors') {
    if (!isCorsSafelistedMethod(method)) reasons.push(`The method ${visible(method, 40)} is not GET, HEAD or POST.`);
    const own = analysis.names.filter((name) => !analysis.totalNames.includes(name));
    if (own.length > 0) reasons.push(`The request headers ${listNames(own)} are not CORS-safelisted request headers.`);
    if (analysis.totalNames.length > 0) {
      reasons.push(
        `The safelisted request headers add up to ${withCommas(analysis.safelistedBytes)} bytes, more than ${withCommas(MAX_SAFELISTED_TOTAL_BYTES)}, so each of them (${listNames(analysis.totalNames)}) counts as unsafe.`,
      );
    }
  }
  const preflightSent = reasons.length > 0;

  return {
    method,
    mode: input.mode,
    credentials: input.credentials,
    requestOrigin,
    targetOrigin,
    url: target.href,
    crossOrigin,
    headers: planned,
    unsafeNames: analysis.names,
    refused,
    preflight: {
      sent: preflightSent,
      reasons,
      ...(preflightSent && analysis.names.length > 0 ? { accessControlRequestHeaders: analysis.names.join(',') } : {}),
    },
  };
}

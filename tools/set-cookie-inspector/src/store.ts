import { MAX_NAME_VALUE_OCTETS, withCommas } from './limits';
import type { IgnoredLine, ParsedCookie, SameSiteValue } from './parse';
import type { RequestInfo } from './request';
import { defaultPath } from './scope';

/**
 * The storage model of draft-ietf-httpbis-rfc6265bis-22 section 5.7: what a browser does with a cookie it has received,
 * step by step in the order of the draft, naming the first step that stops it. Nothing is stored anywhere; the answer is
 * what the draft would do with the text given.
 *
 * The four outcomes: `stored` (every step passes), `not-stored` (a rule of the storage model refuses it), `ignored`
 * (the draft ignores the line or cookie entirely: malformed, too big, empty, or not allowed on this kind of request) and
 * `stored-then-deleted` (stored, then its lifetime has already ended, so it is removed at once).
 */

export type Outcome = 'stored' | 'not-stored' | 'ignored' | 'stored-then-deleted';

/** One step of the draft, with what happened to this cookie there. */
export interface StepRecord {
  /** The section of the draft, for example `5.7`. */
  section: string;
  /** The step number inside that section. */
  step: number;
  /** The rule in a few words. */
  rule: string;
  result: 'pass' | 'fail' | 'not-modelled' | 'not-applicable';
}

/** How long a stored cookie lives. */
export interface Lifetime {
  kind: 'session' | 'persistent' | 'deleted';
  /** Which attribute decided: Max-Age over Expires, or neither. */
  source: 'none' | 'Max-Age' | 'Expires';
  /** Whole seconds from the chosen time to the end of the cookie, after the 400-day limit. Null for a session cookie. */
  seconds: number | null;
  /** The moment it ends, in milliseconds since 1970. Null for a session cookie. */
  expiresAtMs: number | null;
  /** True when the lifetime asked for was longer than 400 days and was reduced. */
  clamped: boolean;
  /** The lifetime in plain words. */
  text: string;
}

/** The fields a browser keeps for a stored cookie that decide where it is sent. */
export interface CookieScope {
  domain: string;
  hostOnly: boolean;
  path: string;
  secureOnly: boolean;
  httpOnly: boolean;
  sameSite: SameSiteValue;
}

export interface Decision {
  outcome: Outcome;
  /** Every step looked at, in the order of the draft, up to and including the one that stopped the cookie. */
  stepsApplied: StepRecord[];
  /** The step that stopped the cookie, or null when nothing did. */
  failedStep: StepRecord | null;
  /** The answer in plain words. For a prefix rule it starts with the prefix. */
  reason: string;
  lifetime: Lifetime | null;
  scope: CookieScope | null;
}

const SECURE_PREFIX = '__secure-';
const HOST_PREFIX = '__host-';

/** True when `text` starts with `prefix` ignoring the case of ASCII letters (section 5.4: prefixes match case-insensitively). */
function startsWithFolded(text: string, prefix: string): boolean {
  if (text.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    let code = text.charCodeAt(i);
    if (code >= 65 && code <= 90) code += 32;
    if (code !== prefix.charCodeAt(i)) return false;
  }
  return true;
}

function stop(
  steps: StepRecord[],
  outcome: Outcome,
  step: number,
  rule: string,
  reason: string,
  section = '5.7',
): Decision {
  const failed: StepRecord = { section, step, rule, result: 'fail' };
  steps.push(failed);
  return { outcome, stepsApplied: steps, failedStep: failed, reason, lifetime: null, scope: null };
}

/** The decision for a line that the parsing algorithm of section 5.6 ignores in its entirety. */
export function ignoredLineDecision(line: IgnoredLine): Decision {
  const step = line.where.endsWith('step 1') ? 1 : 5;
  const rule =
    step === 1
      ? 'A set-cookie-string with a control character is ignored.'
      : `Name and value together must be at most ${withCommas(MAX_NAME_VALUE_OCTETS)} octets.`;
  return stop([], 'ignored', step, rule, line.reason, '5.6');
}

/**
 * Judges one parsed cookie with the storage model of section 5.7.
 *
 * `nowMs` is the moment the response arrives, in milliseconds since 1970; nothing reads a clock.
 */
export function decide(cookie: ParsedCookie, request: RequestInfo, _nowMs: number): Decision {
  const steps: StepRecord[] = [];
  const pass = (step: number, rule: string): void => {
    steps.push({ section: '5.7', step, rule, result: 'pass' });
  };

  // Step 2: an empty name with an empty value.
  if (cookie.name === '' && cookie.value === '') {
    return stop(
      steps,
      'ignored',
      2,
      'An empty name with an empty value is ignored.',
      'The name and the value are both empty, so there is no cookie to store (step 2).',
    );
  }
  pass(2, 'An empty name with an empty value is ignored.');

  // Step 4: the size (read with section 5.6 step 5, so a larger cookie never reaches this point).
  pass(4, `Name and value together are at most ${withCommas(MAX_NAME_VALUE_OCTETS)} octets.`);

  const domainAttribute = cookie.domain ?? '';
  const hostOnly = domainAttribute === '';
  const path =
    cookie.path !== null && cookie.path !== '' && cookie.path.charCodeAt(0) === 47
      ? cookie.path
      : defaultPath(request.path);

  // Step 13: a Secure cookie needs a secure connection.
  if (cookie.secure && !request.secure) {
    return stop(
      steps,
      'not-stored',
      13,
      'A cookie with Secure needs a secure connection.',
      'The cookie has the Secure attribute but the response address is plain http, which is not a secure connection, so the cookie is refused (step 13).',
    );
  }
  pass(13, 'A cookie with Secure needs a secure connection.');

  // Step 18: a cookie whose SameSite is not None, set on a cross-site request that is not a top-level navigation.
  if (cookie.sameSite !== 'None') {
    if (request.context === 'cross-site') {
      return stop(
        steps,
        'ignored',
        18,
        'A cookie whose SameSite is not None is ignored on a cross-site request that is not a top-level navigation.',
        `SameSite is ${cookie.sameSite} here (anything but None) and the cookie arrived on a cross-site request that is not a top-level navigation, so the draft ignores it entirely (step 18).`,
      );
    }
  }
  pass(
    18,
    'A cookie whose SameSite is not None is ignored on a cross-site request that is not a top-level navigation.',
  );

  // Step 19: SameSite=None needs Secure.
  if (cookie.sameSite === 'None' && !cookie.secure) {
    return stop(
      steps,
      'not-stored',
      19,
      'SameSite=None needs the Secure attribute.',
      'SameSite=None needs the Secure attribute, and this cookie has none, so it is refused (step 19).',
    );
  }
  pass(19, 'SameSite=None needs the Secure attribute.');

  // Step 20: the __Secure- prefix.
  if (startsWithFolded(cookie.name, SECURE_PREFIX)) {
    if (!cookie.secure) {
      return stop(
        steps,
        'not-stored',
        20,
        'A name that starts with __Secure- needs the Secure attribute.',
        `__Secure- needs the Secure attribute, and this cookie has none (step 20). The name starts with ${cookie.name.slice(0, SECURE_PREFIX.length)}; prefixes are matched whatever the letter case (section 5.4).`,
      );
    }
  }
  pass(20, 'A name that starts with __Secure- needs the Secure attribute.');

  // Step 21: the __Host- prefix.
  if (startsWithFolded(cookie.name, HOST_PREFIX)) {
    const missing: string[] = [];
    if (!cookie.secure) missing.push('the Secure attribute');
    if (!hostOnly)
      missing.push('no Domain attribute (a Domain makes it a domain cookie, and __Host- cookies are host-only)');
    if (cookie.path === null) missing.push('a Path attribute');
    else if (path !== '/') missing.push('a path of / (here the path is not /)');
    if (missing.length > 0) {
      return stop(
        steps,
        'not-stored',
        21,
        'A name that starts with __Host- needs Secure, no Domain and a Path attribute of /.',
        `__Host- needs Secure, no Domain and Path=/ (step 21). Missing here: ${missing.join('; ')}. The name starts with ${cookie.name.slice(0, HOST_PREFIX.length)}; prefixes are matched whatever the letter case (section 5.4).`,
      );
    }
  }
  pass(21, 'A name that starts with __Host- needs Secure, no Domain and a Path attribute of /.');

  // Step 22: an empty name whose value starts like a prefix.
  if (
    cookie.name === '' &&
    (startsWithFolded(cookie.value, SECURE_PREFIX) || startsWithFolded(cookie.value, HOST_PREFIX))
  ) {
    return stop(
      steps,
      'not-stored',
      22,
      'An empty name with a value that starts with __Secure- or __Host- is ignored.',
      'The cookie has no name and its text starts with __Secure- or __Host-, which could pass for a prefixed cookie, so it is refused whatever its letter case (step 22).',
    );
  }
  pass(22, 'An empty name with a value that starts with __Secure- or __Host- is ignored.');

  return {
    outcome: 'stored',
    stepsApplied: steps,
    failedStep: null,
    reason: 'No step of the storage model stops it.',
    lifetime: null,
    scope: null,
  };
}

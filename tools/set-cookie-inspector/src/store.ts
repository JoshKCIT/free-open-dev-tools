import { MAX_AGE_LIMIT_SECONDS, MAX_ATTRIBUTE_VALUE_OCTETS, MAX_NAME_VALUE_OCTETS, withCommas } from './limits';
import { maskJoined } from './mask';
import type { IgnoredLine, ParsedCookie } from './parse';
import type { RequestInfo } from './request';
import { defaultPath, domainMatches, type CookieScope } from './scope';
import { visible } from './visible';

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
  /** The moment it ends as `2026-10-06 13:00:00 UTC`. Null for a session cookie. */
  until: string | null;
  /** True when the lifetime asked for was longer than 400 days and was reduced. */
  clamped: boolean;
  /** The lifetime in plain words. */
  text: string;
}

export interface Decision {
  outcome: Outcome;
  /** Every step looked at, in the order of the draft, up to and including the one that stopped the cookie. */
  stepsApplied: StepRecord[];
  /** The step that stopped the cookie, or null when nothing did. */
  failedStep: StepRecord | null;
  /** The answer in plain words. For a prefix rule it starts with the prefix. */
  reason: string;
  /** The lifetime of a cookie that passed every step, else null. */
  lifetime: Lifetime | null;
  /** The fields a browser would keep for a cookie that passed every step, else null. */
  scope: CookieScope | null;
}

const SECURE_PREFIX = '__secure-';
const HOST_PREFIX = '__host-';
const SIZE_RULE = `Name and value together must be at most ${withCommas(MAX_NAME_VALUE_OCTETS)} octets.`;

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

/** True when the text holds a character that is not in CHAR (%x01-7F): a NUL or anything above ASCII. */
function hasNonChar(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0 || code > 127) return true;
  }
  return false;
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
  const rule = step === 1 ? 'A set-cookie-string with a control character is ignored.' : SIZE_RULE;
  return stop([], 'ignored', step, rule, line.reason, '5.6');
}

/** A length of time as days, hours, minutes and seconds, leaving out the parts that are zero. */
export function describeDuration(seconds: number): string {
  if (seconds === 0) return '0 seconds';
  const parts: string[] = [];
  const unit = (count: number, name: string): void => {
    if (count > 0) parts.push(`${withCommas(count)} ${name}${count === 1 ? '' : 's'}`);
  };
  unit(Math.floor(seconds / 86_400), 'day');
  unit(Math.floor((seconds % 86_400) / 3_600), 'hour');
  unit(Math.floor((seconds % 3_600) / 60), 'minute');
  unit(seconds % 60, 'second');
  return parts.join(' ');
}

/** A moment as `2026-10-06 13:00:00 UTC`; a year past 9999 is written with its sign, as `+275760-09-13 00:00:00 UTC`. */
function describeMoment(ms: number): string {
  const iso = new Date(ms).toISOString();
  const t = iso.indexOf('T');
  return `${iso.slice(0, t)} ${iso.slice(t + 1, t + 9)} UTC`;
}

/**
 * The lifetime of a cookie that passed every step (sections 5.5, 5.6.1, 5.6.2 and 5.7 step 6). Max-Age wins over Expires,
 * a lifetime is never more than 400 days from `nowMs`, and one that is zero, negative or already over is deleted at once.
 */
export function lifetimeOf(cookie: ParsedCookie, nowMs: number): Lifetime {
  const limitMs = MAX_AGE_LIMIT_SECONDS * 1000;
  const deleted = (source: 'Max-Age' | 'Expires', text: string): Lifetime => ({
    kind: 'deleted',
    source,
    seconds: 0,
    expiresAtMs: nowMs,
    until: describeMoment(nowMs),
    clamped: false,
    text,
  });
  const lives = (source: 'Max-Age' | 'Expires', seconds: number, expiresAtMs: number, clamped: boolean): Lifetime => ({
    kind: 'persistent',
    source,
    seconds,
    expiresAtMs,
    until: describeMoment(expiresAtMs),
    clamped,
    text: `${withCommas(seconds)} seconds (${describeDuration(seconds)}) from the time of the response, until ${describeMoment(expiresAtMs)}${clamped ? `. The lifetime asked for was longer, so it is reduced to the limit of 400 days (${withCommas(MAX_AGE_LIMIT_SECONDS)} seconds, section 5.5)` : ''}.`,
  });
  if (cookie.maxAge !== null) {
    if (cookie.maxAge.immediate)
      return deleted('Max-Age', 'Deleted at once: Max-Age is zero or negative (section 5.6.2 step 7).');
    return lives('Max-Age', cookie.maxAge.seconds, nowMs + cookie.maxAge.seconds * 1000, cookie.maxAge.clamped);
  }
  if (cookie.expires !== null) {
    const delta = cookie.expires - nowMs;
    if (delta <= 0) {
      return deleted(
        'Expires',
        'Deleted at once: Expires is at or before the time of the response, so the cookie is already expired (section 5.7).',
      );
    }
    if (delta > limitMs) return lives('Expires', MAX_AGE_LIMIT_SECONDS, nowMs + limitMs, true);
    return lives('Expires', Math.floor(delta / 1000), cookie.expires, false);
  }
  return {
    kind: 'session',
    source: 'none',
    seconds: null,
    expiresAtMs: null,
    until: null,
    clamped: false,
    text: 'Until the browser session ends: there is no Max-Age or valid Expires, so the cookie is not kept for later (section 5.7 step 6).',
  };
}

/** The path a cookie gets (section 5.7 step 11 and 5.6.4): the Path attribute when it starts with a slash, else the default path. */
function pathOf(cookie: ParsedCookie, request: RequestInfo): string {
  if (cookie.path !== null && cookie.path !== '' && cookie.path.charCodeAt(0) === 47) return cookie.path;
  return defaultPath(request.path);
}

/**
 * Judges one parsed cookie with the storage model of section 5.7.
 *
 * `nowMs` is the moment the response arrives, in milliseconds since 1970; nothing reads a clock.
 */
export function decide(cookie: ParsedCookie, request: RequestInfo, nowMs: number): Decision {
  const steps: StepRecord[] = [];
  const pass = (step: number, rule: string): void => {
    steps.push({ section: '5.7', step, rule, result: 'pass' });
  };
  const notModelled = (step: number, rule: string): void => {
    steps.push({ section: '5.7', step, rule, result: 'not-modelled' });
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
  pass(4, SIZE_RULE);

  // Steps 6 and 7: the lifetime attributes and the Domain attribute that count were picked while the line was read.
  pass(6, 'Max-Age, else Expires, sets the lifetime, and the last of each counts.');
  const domainAttribute = cookie.domain ?? '';
  pass(
    7,
    `The last Domain attribute of ${withCommas(MAX_ATTRIBUTE_VALUE_OCTETS)} octets or less is the domain-attribute.`,
  );

  // Step 8: a Domain with a character that is not in CHAR.
  if (hasNonChar(domainAttribute)) {
    return stop(
      steps,
      'not-stored',
      8,
      'A Domain with a character that is not in CHAR ignores the cookie.',
      'The Domain attribute holds a character outside ASCII, so the cookie is refused (step 8).',
    );
  }
  pass(8, 'A Domain with a character that is not in CHAR ignores the cookie.');

  // Step 9: the public suffix list is not consulted.
  notModelled(9, 'A Domain that is a public suffix is refused (needs the public suffix list).');

  // Step 10: the Domain must match the host of the response address.
  const hostOnly = domainAttribute === '';
  if (!hostOnly && !domainMatches(request.host, domainAttribute)) {
    return stop(
      steps,
      'not-stored',
      10,
      'A Domain must domain-match the host of the response address.',
      `The Domain attribute (${visible(maskJoined(domainAttribute), 40)}) does not domain-match the host of the response address, so the cookie is refused (step 10). A Domain must be the host itself or a parent of it${request.isIp ? '; an IP address matches only itself' : ''}.`,
    );
  }
  pass(10, 'A Domain must domain-match the host of the response address.');

  // Step 11: the path.
  const path = pathOf(cookie, request);
  pass(11, 'The path is the last Path attribute, else the default path of the response address.');

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

  // Step 16: the cookie store is not modelled.
  notModelled(
    16,
    'A cookie without Secure cannot overlay a Secure cookie from a plain http address (needs the cookie store).',
  );

  // Steps 17 and 18: SameSite, and a cookie whose SameSite is not None on a cross-site request that is not a navigation.
  if (cookie.sameSite !== 'None' && request.context === 'cross-site') {
    return stop(
      steps,
      'ignored',
      18,
      'A cookie whose SameSite is not None is ignored on a cross-site request that is not a top-level navigation.',
      `SameSite is ${cookie.sameSite} here (anything but None) and the cookie arrived on a cross-site request that is not a top-level navigation, so the draft ignores it entirely (step 18).`,
    );
  }
  pass(17, 'The SameSite flag is the last SameSite attribute, else Default.');
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
  if (startsWithFolded(cookie.name, SECURE_PREFIX) && !cookie.secure) {
    return stop(
      steps,
      'not-stored',
      20,
      'A name that starts with __Secure- needs the Secure attribute.',
      `__Secure- needs the Secure attribute, and this cookie has none (step 20). The name starts with ${cookie.name.slice(0, SECURE_PREFIX.length)}; prefixes are matched whatever the letter case (section 5.4).`,
    );
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

  // Steps 23 and 24: replacing an old cookie and inserting the new one need the cookie store.
  notModelled(23, 'An existing cookie with the same name, domain and path is replaced (needs the cookie store).');

  const lifetime = lifetimeOf(cookie, nowMs);
  const scope: CookieScope = {
    domain: hostOnly ? request.host : domainAttribute,
    hostOnly,
    path,
    secureOnly: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
  };
  if (lifetime.kind === 'deleted') {
    return {
      outcome: 'stored-then-deleted',
      stepsApplied: steps,
      failedStep: null,
      reason: `It passes every storage step, then its lifetime is over (${lifetime.source === 'Max-Age' ? 'Max-Age is zero or negative' : 'Expires is at or before the time of the response'}), so a browser removes it at once (section 5.7).`,
      lifetime,
      scope,
    };
  }
  return {
    outcome: 'stored',
    stepsApplied: steps,
    failedStep: null,
    reason: 'A browser following the draft would store it: no step of the storage model stops it.',
    lifetime,
    scope,
  };
}

/** What the prefix rules say about this cookie, in plain words. */
export function describePrefix(cookie: ParsedCookie, decision: Decision): string {
  const prefixed = startsWithFolded(cookie.name, SECURE_PREFIX)
    ? '__Secure-'
    : startsWithFolded(cookie.name, HOST_PREFIX)
      ? '__Host-'
      : null;
  const emptyNamePrefixed =
    cookie.name === '' &&
    (startsWithFolded(cookie.value, SECURE_PREFIX) || startsWithFolded(cookie.value, HOST_PREFIX));
  if (prefixed === null && !emptyNamePrefixed)
    return 'The name has no __Secure- or __Host- prefix, so no prefix rule applies.';
  const step = decision.failedStep?.step ?? 0;
  if (emptyNamePrefixed) {
    return step === 22
      ? 'The cookie has no name and its text starts with a prefix: refused (step 22).'
      : 'The cookie has no name and its text starts with a prefix: the rule applies when the earlier steps pass.';
  }
  const need = prefixed === '__Host-' ? 'needs Secure, no Domain and Path=/' : 'needs the Secure attribute';
  if (step === 20 || step === 21)
    return `The name starts with ${prefixed}, which ${need}. Not met, so the cookie is refused.`;
  if (decision.failedStep !== null)
    return `The name starts with ${prefixed}, which ${need}. Not reached: another rule stopped the cookie first.`;
  return `The name starts with ${prefixed}, which ${need}. Met. Prefixes are matched whatever the letter case.`;
}

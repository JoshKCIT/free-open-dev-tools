import meta from './meta.json';
import { assertSingleLine } from './safe-value';
import { parseCspDirectives, serialiseCsp } from './csp';
import { renderApache } from './target-apache';
import { renderNginx } from './target-nginx';
import { renderNetlify } from './target-netlify';
import { renderGeneric } from './target-generic';

export { meta };
export { UnsafeValueError, findUnsafeCharacter, assertSingleLine } from './safe-value';
export { CSP_DIRECTIVES, SANDBOX_TOKENS, parseCspDirectives, serialiseCsp } from './csp';
export type { CspDirective, CspProblem, ParsedCsp } from './csp';
export { NginxDollarSignError } from './target-nginx';

export class SecurityHeadersError extends Error {
  readonly field?: string;
  readonly line?: number;

  constructor(message: string, detail: { field?: string; line?: number } = {}) {
    super(message);
    this.name = 'SecurityHeadersError';
    this.field = detail.field;
    this.line = detail.line;
  }
}

export interface HeaderEntry {
  name: string;
  value: string;
}

export interface HstsOptions {
  maxAge: number;
  includeSubDomains: boolean;
  preload: boolean;
}

export interface BuildSecurityHeadersOptions {
  csp?: string;
  reportOnly?: boolean;
  upgradeInsecure?: boolean;
  hsts?: HstsOptions | null;
  referrerPolicy?: string;
  nosniff?: boolean;
  /** One `feature=allowlist` per line. */
  permissions?: string;
  coop?: string;
  coep?: string;
  corp?: string;
  /** The path pattern the Netlify target's `_headers` file applies to. */
  path?: string;
}

export interface BuildSecurityHeadersResult {
  headers: HeaderEntry[];
  apache: string;
  nginx: string;
  netlify: string;
  generic: string;
  warnings: string[];
}

// Referrer Policy (w3.org/TR/referrer-policy/, section 3, "Referrer Policies"): eight tokens.
const REFERRER_POLICY_TOKENS = new Set([
  'no-referrer',
  'no-referrer-when-downgrade',
  'same-origin',
  'origin',
  'strict-origin',
  'origin-when-cross-origin',
  'strict-origin-when-cross-origin',
  'unsafe-url',
]);

// HTML Living Standard, "Cross-origin opener policies": the values settable
// via the Cross-Origin-Opener-Policy header itself ("same-origin-plus-COEP"
// cannot be set directly; it results from combining same-origin with COEP).
const COOP_TOKENS = new Set(['unsafe-none', 'same-origin-allow-popups', 'same-origin', 'noopener-allow-popups']);

// HTML Living Standard, "Cross-origin embedder policies".
const COEP_TOKENS = new Set(['unsafe-none', 'require-corp', 'credentialless']);

// Fetch Standard, "Cross-Origin-Resource-Policy header": %s"same-origin" / %s"same-site" / %s"cross-origin".
const CORP_TOKENS = new Set(['same-origin', 'same-site', 'cross-origin']);

// The Permissions Policy standardised feature list
// (w3.org/TR/permissions-policy/ plus w3c/webappsec-permissions-policy's
// own features.md, "Standardized Features" table, fetched live).
const STANDARDISED_FEATURES = new Set([
  'accelerometer',
  'ambient-light-sensor',
  'attribution-reporting',
  'autoplay',
  'battery',
  'bluetooth',
  'camera',
  'ch-ua',
  'ch-ua-arch',
  'ch-ua-bitness',
  'ch-ua-full-version',
  'ch-ua-full-version-list',
  'ch-ua-high-entropy-values',
  'ch-ua-mobile',
  'ch-ua-model',
  'ch-ua-platform',
  'ch-ua-platform-version',
  'ch-ua-wow64',
  'compute-pressure',
  'cross-origin-isolated',
  'direct-sockets',
  'display-capture',
  'encrypted-media',
  'execution-while-not-rendered',
  'execution-while-out-of-viewport',
  'fullscreen',
  'geolocation',
  'gyroscope',
  'hid',
  'identity-credentials-get',
  'idle-detection',
  'keyboard-map',
  'magnetometer',
  'mediasession',
  'microphone',
  'midi',
  'navigation-override',
  'otp-credentials',
  'payment',
  'picture-in-picture',
  'publickey-credentials-get',
  'screen-wake-lock',
  'serial',
  'storage-access',
  'sync-xhr',
  'tools',
  'usb',
  'web-share',
  'window-management',
  'xr-spatial-tracking',
]);

/** RFC 9651 section 4.1.6, Serializing a String: DQUOTE-wrapped, `\` and `"` backslash-escaped. */
function serialiseRfc9651String(value: string): string {
  let out = '"';
  for (const ch of value) {
    if (ch === '\\' || ch === '"') out += '\\';
    out += ch;
  }
  return out + '"';
}

/** Splits a parenthesised allowlist's inner text into tokens, respecting double-quoted origins. */
function tokeniseAllowlist(inner: string, lineNumber: number): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < inner.length) {
    while (i < inner.length && /\s/.test(inner[i]!)) i++;
    if (i >= inner.length) break;
    if (inner[i] === '"') {
      const end = inner.indexOf('"', i + 1);
      if (end === -1) {
        throw new SecurityHeadersError(`Permissions-Policy line ${lineNumber} has an unterminated quoted origin.`, {
          line: lineNumber,
        });
      }
      tokens.push(inner.slice(i, end + 1));
      i = end + 1;
    } else {
      const start = i;
      while (i < inner.length && !/\s/.test(inner[i]!)) i++;
      tokens.push(inner.slice(start, i));
    }
  }
  return tokens;
}

/**
 * Serialises one Permissions-Policy allowlist (`*`, `()`, `(self)` or
 * `(self "https://origin")`) as an RFC 9651 structured field inner list:
 * `self`/`*` as bare tokens, an origin as a quoted string whose text must
 * already equal `new URL(origin).origin` (RFC 9651 section 4.1.1.1).
 */
function serialisePermissionsAllowlist(allow: string, lineNumber: number): string {
  if (allow === '*') return '*';
  if (!allow.startsWith('(') || !allow.endsWith(')')) {
    throw new SecurityHeadersError(
      `Permissions-Policy line ${lineNumber}: "${allow}" is not *, () or a parenthesised allowlist such as (self) or (self "https://origin").`,
      { line: lineNumber },
    );
  }
  const inner = allow.slice(1, -1).trim();
  if (inner === '') return '()';

  const tokens = tokeniseAllowlist(inner, lineNumber);
  const serialisedParts = tokens.map((token) => {
    if (token === 'self' || token === '*') return token;
    const unquoted = token.startsWith('"') && token.endsWith('"') ? token.slice(1, -1) : token;
    let origin: string;
    try {
      origin = new URL(unquoted).origin;
    } catch {
      throw new SecurityHeadersError(`Permissions-Policy line ${lineNumber}: "${token}" is not a valid origin.`, {
        line: lineNumber,
      });
    }
    if (origin !== unquoted) {
      throw new SecurityHeadersError(
        `Permissions-Policy line ${lineNumber}: "${unquoted}" is not written as its own origin ("${origin}").`,
        { line: lineNumber },
      );
    }
    assertSingleLine(origin, `Permissions-Policy origin on line ${lineNumber}`);
    return serialiseRfc9651String(origin);
  });
  return `(${serialisedParts.join(' ')})`;
}

/** Parses `feature=allowlist` lines into RFC 9651 dictionary members, warning on a non-standardised feature name. */
function parsePermissionsPolicy(text: string, warnings: string[]): { feature: string; serialised: string }[] {
  const result: { feature: string; serialised: string }[] = [];
  let lineNumber = 0;
  for (const raw of text.split('\n')) {
    lineNumber++;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) {
      throw new SecurityHeadersError(
        `Permissions-Policy line ${lineNumber} has no "=". Expected "feature=allowlist".`,
        { line: lineNumber },
      );
    }
    const feature = trimmed.slice(0, eq).trim().toLowerCase();
    assertSingleLine(feature, `Permissions-Policy feature on line ${lineNumber}`);
    if (!STANDARDISED_FEATURES.has(feature)) {
      warnings.push(
        `"${feature}" (Permissions-Policy line ${lineNumber}) is not on the standardised feature list this tool checked against; browsers ship other feature names too, so it is passed through as typed.`,
      );
    }
    const allow = trimmed.slice(eq + 1).trim();
    const serialised = serialisePermissionsAllowlist(allow, lineNumber);
    result.push({ feature, serialised });
  }
  return result;
}

/**
 * Composes the headers a visitor's fields describe: CSP (or its Report-Only
 * name), HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy,
 * COOP, COEP and CORP, in that fixed order, plus the same set rendered for
 * Apache, nginx, Netlify's `_headers` file and a plain generic list. Every
 * value passes `assertSingleLine` before it reaches any target.
 */
export function buildSecurityHeaders(options: BuildSecurityHeadersOptions = {}): BuildSecurityHeadersResult {
  const warnings: string[] = [];
  const headers: HeaderEntry[] = [];

  let cspText = options.csp ?? '';
  if (options.upgradeInsecure) {
    cspText = cspText.trim() ? `${cspText}\nupgrade-insecure-requests` : 'upgrade-insecure-requests';
  }
  if (cspText.trim()) {
    const parsed = parseCspDirectives(cspText);
    for (const problem of parsed.problems) {
      warnings.push(`Content-Security-Policy line ${problem.line}: ${problem.message}`);
    }
    const cspValue = assertSingleLine(serialiseCsp(parsed.directives), 'Content-Security-Policy');
    const cspName = options.reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
    headers.push({ name: cspName, value: cspValue });

    const names = new Set(parsed.directives.map((d) => d.name));
    if (!names.has('default-src')) {
      warnings.push(
        'This policy has no default-src, so any fetch directive it omits falls back to allowing everything.',
      );
    }
    if (!names.has('object-src')) {
      warnings.push('This policy has no object-src. Plugin content is not restricted unless default-src covers it.');
    }
    if (!names.has('base-uri')) {
      warnings.push(
        'This policy has no base-uri, so a base element can still redirect every relative URL on the page.',
      );
    }
    const hasUnsafeInline = parsed.directives.some((d) => d.value.includes("'unsafe-inline'"));
    const hasNonceOrHash = parsed.directives.some((d) => /'nonce-|'sha(256|384|512)-/.test(d.value));
    if (hasUnsafeInline && hasNonceOrHash) {
      warnings.push(
        "A directive combines 'unsafe-inline' with a nonce or hash source. CSP Level 3 says browsers that support nonces or hashes ignore 'unsafe-inline' whenever either is present, so it has no effect there.",
      );
    }
  }

  if (options.hsts) {
    const { maxAge, includeSubDomains, preload } = options.hsts;
    if (!Number.isFinite(maxAge) || !Number.isInteger(maxAge) || maxAge < 0) {
      throw new SecurityHeadersError(
        "HSTS max-age must be a non-negative integer (RFC 6797 section 6.1.1's delta-seconds is defined as 1*DIGIT).",
        { field: 'hstsMaxAge' },
      );
    }
    if (preload && (!includeSubDomains || maxAge < 31536000)) {
      throw new SecurityHeadersError(
        'The preload token is refused unless includeSubDomains is set and max-age is at least 31536000 seconds (one year), the hstspreload.org submission requirements.',
        { field: 'hstsPreload' },
      );
    }
    const parts = [`max-age=${maxAge}`];
    if (includeSubDomains) parts.push('includeSubDomains');
    if (preload) parts.push('preload');
    headers.push({
      name: 'Strict-Transport-Security',
      value: assertSingleLine(parts.join('; '), 'Strict-Transport-Security'),
    });
    warnings.push(
      'Browsers ignore this header entirely on a plain HTTP response (RFC 6797 section 8.1): "If an HTTP response is received over insecure transport, the UA MUST ignore any present STS header field(s)."',
    );
  }

  if (options.nosniff) {
    headers.push({ name: 'X-Content-Type-Options', value: 'nosniff' });
  }

  if (options.referrerPolicy && options.referrerPolicy.trim()) {
    const token = options.referrerPolicy.trim();
    if (!REFERRER_POLICY_TOKENS.has(token)) {
      throw new SecurityHeadersError(
        `"${token}" is not one of the Referrer Policy specification's eight defined tokens.`,
        { field: 'referrerPolicy' },
      );
    }
    headers.push({ name: 'Referrer-Policy', value: token });
  }

  if (options.permissions && options.permissions.trim()) {
    const features = parsePermissionsPolicy(options.permissions, warnings);
    if (features.length > 0) {
      const value = features.map((f) => `${f.feature}=${f.serialised}`).join(', ');
      headers.push({ name: 'Permissions-Policy', value: assertSingleLine(value, 'Permissions-Policy') });
    }
  }

  if (options.coop && options.coop.trim()) {
    const token = options.coop.trim();
    if (!COOP_TOKENS.has(token)) {
      throw new SecurityHeadersError(
        `"${token}" is not one of the HTML Living Standard's Cross-Origin-Opener-Policy values.`,
        { field: 'coop' },
      );
    }
    headers.push({ name: 'Cross-Origin-Opener-Policy', value: token });
  }

  if (options.coep && options.coep.trim()) {
    const token = options.coep.trim();
    if (!COEP_TOKENS.has(token)) {
      throw new SecurityHeadersError(
        `"${token}" is not one of the HTML Living Standard's Cross-Origin-Embedder-Policy values.`,
        { field: 'coep' },
      );
    }
    headers.push({ name: 'Cross-Origin-Embedder-Policy', value: token });
  }

  if (options.corp && options.corp.trim()) {
    const token = options.corp.trim();
    if (!CORP_TOKENS.has(token)) {
      throw new SecurityHeadersError(
        `"${token}" is not one of the Fetch Standard's Cross-Origin-Resource-Policy values.`,
        { field: 'corp' },
      );
    }
    headers.push({ name: 'Cross-Origin-Resource-Policy', value: token });
  }

  const path = options.path && options.path.trim() ? options.path.trim() : '/*';

  return {
    headers,
    apache: renderApache(headers),
    nginx: renderNginx(headers),
    netlify: renderNetlify(headers, path),
    generic: renderGeneric(headers),
    warnings,
  };
}

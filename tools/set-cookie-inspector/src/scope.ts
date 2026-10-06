import type { SameSiteValue } from './parse';
import { isIpHost, type RequestInfo } from './request';
import { visible } from './visible';

/**
 * Where a cookie is sent: the default path and the path match of draft-ietf-httpbis-rfc6265bis-22 section 5.1.4, the
 * domain match of section 5.1.3, and the plain-words sentences that say what the fields a browser keeps for a cookie mean.
 */

/** The fields a browser keeps for a stored cookie that decide where it is sent. */
export interface CookieScope {
  domain: string;
  hostOnly: boolean;
  path: string;
  secureOnly: boolean;
  httpOnly: boolean;
  sameSite: SameSiteValue;
}

/**
 * The default path of a cookie (section 5.1.4): the path of the response address up to, but not including, its right-most
 * slash; a path with no more than one slash, or one that does not start with a slash, gives `/`.
 */
export function defaultPath(path: string): string {
  if (path === '' || path.charCodeAt(0) !== 47) return '/';
  const last = path.lastIndexOf('/');
  if (last === 0) return '/';
  return path.slice(0, last);
}

/**
 * Whether a host domain-matches a domain (section 5.1.3): they are identical, or the domain is a suffix of the host, the
 * character before that suffix is a dot, and the host is a host name and not an IP address. Both are in lower case.
 */
export function domainMatches(host: string, domain: string): boolean {
  if (host === domain) return true;
  if (domain === '' || domain.length >= host.length) return false;
  if (isIpHost(host)) return false;
  return host.endsWith(domain) && host.charCodeAt(host.length - domain.length - 1) === 46;
}

/**
 * Whether a request path path-matches a cookie path (section 5.1.4): they are identical; or the cookie path is a prefix of
 * the request path and either ends with a slash or is followed in the request path by a slash.
 */
export function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  if (cookiePath.endsWith('/')) return true;
  return requestPath.charCodeAt(cookiePath.length) === 47;
}

/**
 * Whether a stored cookie would be sent with a same-site request to the response address (section 5.8.3 step 3): the host
 * and path match, and Secure is met. A same-site request never meets a SameSite restriction.
 */
export function wouldBeSent(scope: CookieScope, request: RequestInfo): boolean {
  const hostMatches = scope.hostOnly ? request.host === scope.domain : domainMatches(request.host, scope.domain);
  if (!hostMatches) return false;
  if (!pathMatches(request.path, scope.path)) return false;
  return !scope.secureOnly || request.secure;
}

/** How SameSite decides when the cookie is sent (section 5.8.3 step 3), in plain words. */
export function describeSameSite(sameSite: SameSiteValue, written: boolean): string {
  switch (sameSite) {
    case 'None':
      return 'SameSite=None: sent on every request, cross-site ones included (it needs Secure).';
    case 'Strict':
      return 'SameSite=Strict: sent on same-site requests only.';
    case 'Lax':
      return 'SameSite=Lax: sent on same-site requests, and on top-level navigations from other sites that use a safe method such as GET.';
    default:
      return `${written ? 'SameSite is Default (the value is not None, Strict or Lax)' : 'SameSite is Default (no SameSite attribute)'}: the draft sends it like Lax (same-site requests, and top-level navigations from other sites that use a safe method such as GET). Some browsers apply Lax when no SameSite is written and others do not.`;
  }
}

/** The sentence for the Sent to column: where a stored cookie goes, in plain words. */
export function describeScope(scope: CookieScope, written: boolean): string {
  const domain = visible(scope.domain, 100);
  const path = visible(scope.path, 100);
  const where = scope.hostOnly
    ? `${domain} only (a host-only cookie: no subdomains)`
    : isIpHost(scope.domain)
      ? `${domain} only (an address matches only itself)`
      : `${domain} and its subdomains`;
  const paths = scope.path === '/' ? 'every path' : `the path ${path} and the paths under it`;
  const secure = scope.secureOnly ? 'only over a secure connection' : 'over plain http as well as https';
  const script = scope.httpOnly ? 'never to page script (HttpOnly)' : 'and page script can read it (no HttpOnly)';
  const sameSite = describeSameSite(scope.sameSite, written);
  return `Would be sent to ${where}, for ${paths}, ${secure}, ${script}. ${sameSite}`;
}

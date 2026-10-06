import { SetCookieInspectorError } from './errors';
import { checkUrl } from './limits';

/**
 * How the response that carried the Set-Cookie lines reached the browser, in the three kinds the storage model of
 * draft-ietf-httpbis-rfc6265bis-22 section 5.7 step 18 tells apart. The page cannot know whether two sites are the same
 * site (that needs the public suffix list), so the visitor chooses.
 */
export type RequestContext = 'same-site' | 'top-level' | 'cross-site';

/** The address the Set-Cookie lines came from, read once. */
export interface RequestInfo {
  /** `http` or `https`. */
  scheme: 'http' | 'https';
  /** The host in lower case, as the address API writes it (an IPv6 address keeps its brackets). */
  host: string;
  /** The path of the address, without the query. Always starts with a slash. */
  path: string;
  /** True when the host is an IP address, so a Domain attribute can only be identical to it. */
  isIp: boolean;
  /** True when the connection counts as secure: https, or a host the browser trusts (localhost and loopback addresses). */
  secure: boolean;
  /** True when the connection counts as secure only because of the host, not because of https. */
  trustedHost: boolean;
  context: RequestContext;
}

function isDigitCode(code: number): boolean {
  return code >= 48 && code <= 57;
}

/** True for a dotted decimal IPv4 address such as 127.0.0.1 (the address API writes every IPv4 form this way). */
function isDottedQuad(host: string): boolean {
  let groups = 1;
  let digits = 0;
  for (let i = 0; i < host.length; i++) {
    const code = host.charCodeAt(i);
    if (code === 46) {
      if (digits === 0) return false;
      groups += 1;
      digits = 0;
    } else if (isDigitCode(code)) {
      digits += 1;
      if (digits > 3) return false;
    } else return false;
  }
  return groups === 4 && digits > 0;
}

/** True when the host is an IPv4 or IPv6 address. */
export function isIpHost(host: string): boolean {
  return host.startsWith('[') || isDottedQuad(host);
}

/** True for localhost and the loopback addresses, which browsers treat as secure. */
function isTrustedHost(host: string): boolean {
  if (host === 'localhost' || host === '[::1]') return true;
  return isDottedQuad(host) && host.startsWith('127.');
}

/**
 * Reads the response address. Only http and https addresses are accepted. A refusal names the part and never holds the
 * address.
 */
export function readRequest(requestUrl: string, context: RequestContext): RequestInfo {
  checkUrl(requestUrl);
  let url: URL;
  try {
    url = new URL(requestUrl.trim());
  } catch {
    throw new SetCookieInspectorError(
      'The response address could not be read. Write a full address that starts with http:// or https://.',
      'request url',
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SetCookieInspectorError(
      'The response address must start with http:// or https://, because only those carry Set-Cookie lines.',
      'request url',
    );
  }
  const host = url.hostname;
  if (host === '') {
    throw new SetCookieInspectorError('The response address has no host.', 'request url');
  }
  const scheme = url.protocol === 'https:' ? 'https' : 'http';
  const trustedHost = scheme === 'http' && isTrustedHost(host);
  return {
    scheme,
    host,
    path: url.pathname,
    isIp: isIpHost(host),
    secure: scheme === 'https' || trustedHost,
    trustedHost,
    context,
  };
}

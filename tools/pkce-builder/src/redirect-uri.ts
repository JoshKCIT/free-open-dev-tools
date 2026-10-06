import { MAX_URL_CHARACTERS, checkLength } from './limits';

export type FindingTone = 'warn' | 'info';

/** Something worth knowing about a request or an address. It names a rule and never repeats typed text. */
export interface Finding {
  tone: FindingTone;
  message: string;
}

function isAlpha(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/** The scheme of an address in lower case (RFC 3986 section 3.1), or null when the text does not start with one. */
export function schemeOf(text: string): string | null {
  if (!isAlpha(text.charCodeAt(0))) return null;
  for (let i = 1; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 58) return text.slice(0, i).toLowerCase();
    const allowed = isAlpha(code) || (code >= 48 && code <= 57) || code === 43 || code === 45 || code === 46;
    if (!allowed) return null;
  }
  return null;
}

/** A host that is a loopback IP literal (RFC 8252 section 7.3): 127.0.0.0/8 written as four numbers, or [::1]. */
function isLoopbackLiteral(host: string): boolean {
  if (host === '[::1]') return true;
  const parts = host.split('.');
  if (parts.length !== 4 || parts[0] !== '127') return false;
  for (const part of parts) {
    if (part === '' || part.length > 3) return false;
    for (let i = 0; i < part.length; i++) {
      const code = part.charCodeAt(i);
      if (code < 48 || code > 57) return false;
    }
    if (Number(part) > 255) return false;
  }
  return true;
}

/**
 * Judges a redirect address by RFC 6749 section 3.1.2 (absolute, no fragment), section 3.1.2.1 (TLS), and RFC 8252
 * (private-use schemes written from a reversed domain name, loopback IP literals, localhost not recommended). The findings
 * say which rule is broken and never repeat the address. An empty list means none of these rules is broken, which says
 * nothing about whether the server has the address registered.
 */
export function checkRedirectUri(text: string): Finding[] {
  checkLength(text, MAX_URL_CHARACTERS, 'redirect uri', 'redirect address');
  const findings: Finding[] = [];
  const scheme = schemeOf(text);
  if (scheme === null) {
    findings.push({
      tone: 'warn',
      message:
        'The redirect address is not absolute. RFC 6749 section 3.1.2 says it must be an absolute URI: a scheme, a colon, then the rest.',
    });
  }
  if (text.indexOf('#') >= 0) {
    findings.push({
      tone: 'warn',
      message: 'The redirect address has a fragment. RFC 6749 section 3.1.2 says it must not include one.',
    });
  }
  if (scheme === null) return findings;
  if (scheme === 'http' || scheme === 'https') {
    let host = '';
    try {
      host = new URL(text).hostname.toLowerCase();
    } catch {
      findings.push({ tone: 'warn', message: 'The redirect address cannot be read as an http or https address.' });
      return findings;
    }
    if (host === 'localhost' || host.endsWith('.localhost')) {
      findings.push({
        tone: 'warn',
        message:
          'The redirect address uses localhost. RFC 8252 section 8.3 says the use of localhost is NOT RECOMMENDED: write the loopback IP literal 127.0.0.1 or [::1] instead.',
      });
    } else if (scheme === 'http' && !isLoopbackLiteral(host)) {
      findings.push({
        tone: 'warn',
        message:
          'The redirect address uses http on a host that is not a loopback IP literal. RFC 6749 section 3.1.2.1 says the redirection endpoint should require TLS, and RFC 8252 section 8.3 allows plain http only for the loopback IP literals 127.0.0.1 and [::1].',
      });
    }
    return findings;
  }
  if (scheme.indexOf('.') < 0) {
    findings.push({
      tone: 'warn',
      message:
        'The scheme of the redirect address has no period. RFC 8252 section 7.1 asks a private-use scheme to be based on a domain name you control, written in reverse order, such as com.example.app, and says a scheme without a period should be rejected.',
    });
  }
  return findings;
}

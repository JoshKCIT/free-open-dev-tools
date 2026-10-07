import { maskJoined } from './mask';
import type { ParsedCookie } from './parse';
import type { RequestInfo } from './request';
import type { Decision } from './store';
import { visible } from './visible';

/** One thing worth a look on a pasted line. It never holds a cookie value. */
export interface Remark {
  /** The line number in the paste. */
  line: number;
  text: string;
}

/** What `collectRemarks` reads of one row. */
export interface RemarkInput {
  line: number;
  looksJoined: boolean;
  /** The parsed cookie, or null for a line that was ignored while it was read. */
  cookie: ParsedCookie | null;
  decision: Decision;
}

function isTokenCharacter(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 45 ||
    code === 46 ||
    code === 95 ||
    code === 126 ||
    code === 43 ||
    code === 47 ||
    code === 61
  );
}

/**
 * True when a value looks like a token or a session identifier: at least 20 characters, all of them letters, digits or
 * the characters of base64 and base64url, with a letter and a digit in it, or in the shape of three parts joined by dots.
 */
export function looksLikeToken(value: string): boolean {
  if (value.length < 20) return false;
  let letters = 0;
  let digits = 0;
  let dots = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (!isTokenCharacter(code)) return false;
    if (code >= 48 && code <= 57) digits += 1;
    else if (code === 46) dots += 1;
    else if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) letters += 1;
  }
  return (letters > 0 && digits > 0) || dots === 2;
}

function hasNonAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) return true;
  }
  return false;
}

function holdsNonAscii(cookie: ParsedCookie): boolean {
  if (hasNonAscii(cookie.name) || hasNonAscii(cookie.value)) return true;
  return cookie.attributes.some((attribute) => hasNonAscii(attribute.name) || hasNonAscii(attribute.value));
}

/**
 * The short list of things worth a look, in line order: cookies joined by commas, a Domain with one label, Secure over http,
 * a session cookie without HttpOnly, a value that looks like a token, non-ASCII text, and quotes kept as part of a value.
 */
export function collectRemarks(rows: readonly RemarkInput[], request: RequestInfo): Remark[] {
  const remarks: Remark[] = [];
  for (const row of rows) {
    const add = (text: string): void => {
      remarks.push({ line: row.line, text });
    };
    const label = `Line ${row.line}`;
    if (row.looksJoined) {
      add(
        `${label} looks like several cookies joined by commas. A browser reads it as one cookie and never splits it, so send one Set-Cookie line for each cookie.`,
      );
    }
    const cookie = row.cookie;
    if (cookie === null) continue;
    const domain = cookie.domain ?? '';
    if (domain !== '' && !domain.includes('.') && domain !== request.host) {
      add(
        `${label} has Domain=${visible(maskJoined(domain), 40)}, a single label. The public suffix list is not consulted here, so a browser may refuse a Domain like this where this page does not.`,
      );
    }
    if (cookie.secure && !request.secure) {
      add(`${label} has Secure but the response address is plain http, so a browser refuses it. Send it over https.`);
    } else if (!cookie.secure && request.scheme === 'http' && row.decision.outcome === 'stored') {
      add(
        `${label} has no Secure and the response came over plain http, so it travels in clear text and anyone on the network can read it.`,
      );
    }
    if (row.decision.outcome === 'stored' && row.decision.lifetime?.kind === 'session' && !cookie.httpOnly) {
      add(
        `${label} has no lifetime (a session cookie) and no HttpOnly attribute, so page script can read it. If it identifies a session, add HttpOnly.`,
      );
    }
    if (looksLikeToken(cookie.value)) {
      add(
        `${label} has a value of ${cookie.value.length} characters that looks like a token or a session identifier. Treat it as a password.`,
      );
    }
    if (holdsNonAscii(cookie)) {
      add(
        `${label} holds non-ASCII text. Sizes here are octets of that text as UTF-8, and the page cannot know how the server encoded its bytes.`,
      );
    }
    if (cookie.value.startsWith('"')) {
      add(
        `${label} has a value that starts with a double quote. The draft keeps quotes as part of the value; they are not removed.`,
      );
    }
  }
  return remarks;
}

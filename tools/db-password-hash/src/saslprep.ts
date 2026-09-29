/**
 * PostgreSQL's own SASLprep (RFC 4013) password preparation, so this
 * tool's SCRAM-SHA-256 output matches what a real PostgreSQL server
 * derives for the same password.
 *
 * Implements: RFC 3454 (stringprep) table C.1.2 (non-ASCII space
 * characters, mapped to U+0020), applied FIRST; then table B.1 (commonly
 * mapped to nothing); then Unicode NFKC normalisation. This is PD-07's
 * documented scope -- RFC 4013's prohibited-output check (section 2.3),
 * bidirectional check (section 2.4, RFC 3454 section 6) and unassigned
 * code point check (section 2.5) are NOT performed; every SASLprep result
 * for a non-ASCII password therefore carries a warning on the page. A
 * pure-ASCII password is returned completely unchanged (PostgreSQL's own
 * fast path, and also the case where none of these steps could change
 * anything).
 */
import { DbHashError } from './errors';

/** RFC 3454 Appendix C.1.2 -- non-ASCII space characters, mapped to U+0020. */
const NON_ASCII_SPACE = new Set<number>([
  0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x200b,
  0x202f, 0x205f, 0x3000,
]);

/** RFC 3454 Appendix B.1 -- commonly mapped to nothing. */
function isMappedToNothing(cp: number): boolean {
  if (cp === 0x00ad || cp === 0x034f || cp === 0x1806) return true;
  if (cp >= 0x180b && cp <= 0x180d) return true;
  if (cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0x2060) return true;
  if (cp >= 0xfe00 && cp <= 0xfe0f) return true;
  if (cp === 0xfeff) return true;
  return false;
}

function isAsciiOnly(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}

/** True when `text` contains a UTF-16 surrogate with no matching partner -- it has no UTF-8 encoding. */
function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) return true;
      i++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

export interface SaslprepResult {
  value: string;
  changed: boolean;
  /** Whether the ORIGINAL password was pure ASCII (every code unit <= 0x7F). */
  asciiOnly: boolean;
}

export function saslprep(password: string): SaslprepResult {
  if (hasLoneSurrogate(password)) {
    throw new DbHashError(
      'This password contains an incomplete character (a lone UTF-16 surrogate) and has no UTF-8 encoding.',
    );
  }
  if (isAsciiOnly(password)) {
    return { value: password, changed: false, asciiOnly: true };
  }

  let mapped = '';
  for (const ch of password) {
    const cp = ch.codePointAt(0)!;
    if (NON_ASCII_SPACE.has(cp)) {
      mapped += ' ';
    } else if (isMappedToNothing(cp)) {
      // dropped
    } else {
      mapped += ch;
    }
  }
  const normalised = mapped.normalize('NFKC');
  return { value: normalised, changed: normalised !== password, asciiOnly: false };
}

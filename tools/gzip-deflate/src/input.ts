/**
 * Decodes the pasted text into raw bytes: standard or URL-safe Base64 (RFC
 * 4648 sections 4 and 5), hex, or percent-encoded Base64 (RFC 3986 section
 * 2.1, as SAML 2.0's HTTP-Redirect binding uses for a `SAMLRequest` value).
 */
import { GzipDeflateError } from './errors';

const B64_STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
}

/** Decodes a Base64 string (standard or URL-safe, not mixed). `rejectPercent` names the option to suggest when a literal `%` is seen. */
function decodeBase64Core(text: string, rejectPercent: boolean): Uint8Array {
  const significant: { ch: string; pos: number }[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (isWhitespace(ch)) continue;
    if (rejectPercent && ch === '%') {
      throw new GzipDeflateError(
        'input',
        'unexpected "%" in Base64 input; choose "URL-encoded Base64" if this value was percent-encoded',
        {
          position: i,
        },
      );
    }
    significant.push({ ch, pos: i });
  }
  let end = significant.length;
  while (end > 0 && significant[end - 1]!.ch === '=') end--;
  const body = significant.slice(0, end);
  if (body.length === 0) return new Uint8Array(0);

  let usesStd = false;
  let usesUrl = false;
  const values: number[] = [];
  for (const { ch, pos } of body) {
    const stdIndex = B64_STD.indexOf(ch);
    if (stdIndex !== -1) {
      if (ch === '+' || ch === '/') usesStd = true;
      values.push(stdIndex);
      continue;
    }
    if (ch === '-' || ch === '_') {
      usesUrl = true;
      values.push(ch === '-' ? 62 : 63);
      continue;
    }
    throw new GzipDeflateError('input', `"${ch}" is not a valid Base64 character`, { position: pos });
  }
  if (usesStd && usesUrl) {
    throw new GzipDeflateError(
      'input',
      'this text mixes the standard Base64 alphabet (+ and /) with the URL-safe alphabet (- and _); use one alphabet, not both',
    );
  }
  if (values.length % 4 === 1) {
    throw new GzipDeflateError(
      'input',
      `Base64 text with ${values.length} significant characters cannot be valid: a length of 1 more than a multiple of 4 is impossible`,
    );
  }

  const byteLength = Math.floor((values.length * 6) / 8);
  const out = new Uint8Array(byteLength);
  let bitBuffer = 0;
  let bitCount = 0;
  let outIdx = 0;
  for (const v of values) {
    bitBuffer = (bitBuffer << 6) | v;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      out[outIdx++] = (bitBuffer >> bitCount) & 0xff;
    }
  }
  return out;
}

function decodeHexCore(text: string): Uint8Array {
  const digits: { ch: string; pos: number }[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (isWhitespace(ch)) continue;
    if (!/^[0-9a-fA-F]$/.test(ch)) {
      throw new GzipDeflateError('input', `"${ch}" is not a valid hexadecimal digit`, { position: i });
    }
    digits.push({ ch, pos: i });
  }
  if (digits.length % 2 !== 0) {
    throw new GzipDeflateError('input', `hex input must have an even number of digits (found ${digits.length})`, {
      position: digits[digits.length - 1]?.pos,
    });
  }
  const out = new Uint8Array(digits.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(digits[i * 2]!.ch + digits[i * 2 + 1]!.ch, 16);
  }
  return out;
}

function decodeUrlBase64Core(text: string): Uint8Array {
  let decoded = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '%') {
      const hex = text.slice(i + 1, i + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
        throw new GzipDeflateError('input', `"%" must be followed by exactly two hexadecimal digits; found "${hex}"`, {
          position: i,
        });
      }
      decoded += String.fromCharCode(parseInt(hex, 16));
      i += 3;
      continue;
    }
    decoded += ch;
    i++;
  }
  return decodeBase64Core(decoded, false);
}

/** Decodes hex text to bytes without the "nothing to decompress" empty check `decodeInput` applies -- used by the compress path, where empty hex input is simply zero bytes. */
export function decodeHex(text: string): Uint8Array {
  return decodeHexCore(text);
}

export function decodeInput(text: string, encoding: 'base64' | 'hex' | 'url-base64'): Uint8Array {
  let bytes: Uint8Array;
  if (encoding === 'hex') bytes = decodeHexCore(text);
  else if (encoding === 'url-base64') bytes = decodeUrlBase64Core(text);
  else bytes = decodeBase64Core(text, true);

  if (bytes.length === 0) {
    throw new GzipDeflateError('input', 'nothing to decompress');
  }
  return bytes;
}

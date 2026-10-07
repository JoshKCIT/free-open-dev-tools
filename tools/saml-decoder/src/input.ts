import { SamlDecoderError } from './errors';
import { withCommas } from './limits';

export type InputKind = 'xml' | 'redirect' | 'post' | 'base64';
export type MessageParameter = 'SAMLRequest' | 'SAMLResponse';

export interface InputReading {
  kind: InputKind;
  /** What was recognised: HTTP-Redirect, HTTP-POST, raw XML, or a bare Base64 value with no binding named. */
  binding: string;
  /** For raw XML, the XML text. For every other kind, the message value as Base64 text, ready to decode. */
  raw: string;
  parameter?: MessageParameter;
  /** The RelayState value, percent-decoded. */
  relayState?: string;
  /** The SigAlg value, percent-decoded and otherwise exactly as written. */
  sigAlg?: string;
  /** The Signature value as pasted (Base64, still percent-encoded). */
  signature?: string;
  /** The octet string the HTTP-Redirect binding signs, built from the pasted substrings and never re-encoded. */
  signedString?: string;
  /** What was done to the pasted text, in order. */
  steps: string[];
  warnings: string[];
}

const ARTIFACT_MESSAGE =
  'This is an artifact reference (SAMLart): a short stand-in that the receiver exchanges for the message over a separate back channel. There is no message in it to decode. Only SAML 2.0 HTTP-Redirect and HTTP-POST messages are read.';

function isWhite(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d || code === 0x0c || code === 0x0b;
}

/** Cuts leading and trailing white space and a leading byte order mark. */
function trimBoth(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && (isWhite(text.charCodeAt(start)) || text.charCodeAt(start) === 0xfeff)) start++;
  while (end > start && isWhite(text.charCodeAt(end - 1))) end--;
  return text.slice(start, end);
}

/** Removes line breaks and tabs, the characters a copied address picks up when it wraps. */
function removeBreaks(text: string): { text: string; removed: boolean } {
  let out = '';
  let removed = false;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x0a || code === 0x0d || code === 0x09) {
      out += text.slice(from, i);
      from = i + 1;
      removed = true;
    }
  }
  return { text: removed ? out + text.slice(from) : text, removed };
}

function hasPercentPair(text: string): boolean {
  let at = text.indexOf('%');
  while (at !== -1) {
    const a = text.charCodeAt(at + 1);
    const b = text.charCodeAt(at + 2);
    if (isHex(a) && isHex(b)) return true;
    at = text.indexOf('%', at + 1);
  }
  return false;
}

function isHex(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
}

function percentDecode(text: string, what: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    throw new SamlDecoderError(
      `The ${what} has a percent sign that is not followed by two hexadecimal digits, or does not decode to valid text, so it was not read.`,
      'message',
    );
  }
}

interface QueryParameters {
  start: number;
  values: Map<string, string>;
  duplicates: string[];
  others: number;
  ampersandWords: boolean;
}

/** The index of a parameter name followed by `=` that starts the text or follows `?`, `&`, `;`, a space or a slash. */
function findParameter(text: string, name: string): number {
  const needle = name + '=';
  let at = text.indexOf(needle);
  while (at !== -1) {
    const before = at === 0 ? '' : text[at - 1]!;
    if (
      before === '' ||
      before === '?' ||
      before === '&' ||
      before === ';' ||
      before === ' ' ||
      before === '/' ||
      before === ':'
    ) {
      return at;
    }
    at = text.indexOf(needle, at + 1);
  }
  return -1;
}

function readQuery(flat: string): QueryParameters | null {
  let start = -1;
  for (const name of ['SAMLRequest', 'SAMLResponse', 'SAMLart']) {
    const at = findParameter(flat, name);
    if (at !== -1 && (start === -1 || at < start)) start = at;
  }
  if (start === -1) return null;
  let tail = flat.slice(start);
  const fragment = tail.indexOf('#');
  if (fragment !== -1) tail = tail.slice(0, fragment);
  const values = new Map<string, string>();
  const duplicates: string[] = [];
  let others = 0;
  let ampersandWords = false;
  let pos = 0;
  while (pos <= tail.length) {
    let end = tail.indexOf('&', pos);
    if (end === -1) end = tail.length;
    let piece = tail.slice(pos, end);
    if (piece.startsWith('amp;')) {
      piece = piece.slice(4);
      ampersandWords = true;
    }
    const eq = piece.indexOf('=');
    if (eq !== -1) {
      const name = piece.slice(0, eq);
      const value = piece.slice(eq + 1);
      if (
        name === 'SAMLRequest' ||
        name === 'SAMLResponse' ||
        name === 'SAMLart' ||
        name === 'RelayState' ||
        name === 'SigAlg' ||
        name === 'Signature'
      ) {
        if (values.has(name)) duplicates.push(name);
        else values.set(name, value);
      } else others++;
    } else if (piece !== '') others++;
    pos = end + 1;
  }
  return { start, values, duplicates, others, ampersandWords };
}

function readRedirect(text: string): InputReading | null {
  const steps: string[] = [];
  const warnings: string[] = [];
  const broken = removeBreaks(text);
  const query = readQuery(broken.text);
  if (query === null) return null;
  if (query.values.has('SAMLart') && !query.values.has('SAMLRequest') && !query.values.has('SAMLResponse')) {
    throw new SamlDecoderError(ARTIFACT_MESSAGE, 'message');
  }
  const parameter: MessageParameter = query.values.has('SAMLRequest') ? 'SAMLRequest' : 'SAMLResponse';
  if (query.values.has('SAMLRequest') && query.values.has('SAMLResponse')) {
    warnings.push('Both SAMLRequest and SAMLResponse are in the address; SAMLRequest was read.');
  }
  for (const name of query.duplicates)
    warnings.push(`The ${name} parameter is written more than once; the first was read.`);
  if (query.ampersandWords) warnings.push('The address holds &amp; where a plain & belongs; it was read as &.');
  steps.push(`Found the ${parameter} parameter in a redirect address or query string (the HTTP-Redirect binding).`);
  if (broken.removed) {
    steps.push('Removed line breaks and tabs that sat inside the address (an address never holds them).');
  }
  const rawValue = query.values.get(parameter) ?? '';
  let value = rawValue;
  if (value.includes(' ')) {
    value = value.split(' ').join('+');
    warnings.push(
      'The message value held spaces, which are plus signs that were turned into spaces; they were put back as +.',
    );
  }
  if (hasPercentPair(value) || value.includes('%')) {
    value = percentDecode(value, 'message value');
    steps.push('Undid the URL encoding (percent codes) of the message value once.');
    if (hasPercentPair(value)) {
      value = percentDecode(value, 'message value');
      warnings.push('The message value was URL-encoded twice; the encoding was undone a second time.');
    }
  }
  const reading: InputReading = {
    kind: 'redirect',
    binding: 'HTTP-Redirect',
    raw: value,
    parameter,
    steps,
    warnings,
  };
  const relayRaw = query.values.get('RelayState');
  if (relayRaw !== undefined) reading.relayState = percentDecode(relayRaw.split(' ').join('+'), 'RelayState value');
  const sigAlgRaw = query.values.get('SigAlg');
  if (sigAlgRaw !== undefined) reading.sigAlg = percentDecode(sigAlgRaw, 'SigAlg value');
  const signatureRaw = query.values.get('Signature');
  if (signatureRaw !== undefined) reading.signature = signatureRaw;
  if (sigAlgRaw !== undefined) {
    // Bindings section 3.4.4.1: the signed string is built from the original URL-encoded values as received.
    const parts = [`${parameter}=${rawValue}`];
    if (relayRaw !== undefined) parts.push(`RelayState=${relayRaw}`);
    parts.push(`SigAlg=${sigAlgRaw}`);
    reading.signedString = parts.join('&');
  } else if (signatureRaw !== undefined) {
    warnings.push('The address holds a Signature parameter but no SigAlg, so there is no signed string to show.');
  }
  return reading;
}

/**
 * Works out what the pasted text is and undoes the wrapper around the message: raw XML as it is; a redirect address or query
 * string by finding its parameters and undoing the URL encoding once. Everything it does is listed in `steps`, and anything
 * unusual in `warnings`.
 */
export function readInput(text: string): InputReading {
  const trimmed = trimBoth(text);
  if (trimmed === '') throw new SamlDecoderError('There is no message to read.', 'message');
  if (trimmed.charCodeAt(0) === 0x3c) {
    return {
      kind: 'xml',
      binding: 'Raw XML (no binding)',
      raw: trimmed,
      steps: ['The text starts with a less-than sign, so it was read as XML as it is.'],
      warnings: [],
    };
  }
  const redirect = readRedirect(trimmed);
  if (redirect !== null) return redirect;
  const compact = trimmed.length > 0 ? trimmed : '';
  return {
    kind: 'base64',
    binding: 'Base64 value (no binding named)',
    raw: compact,
    steps: [`Read the ${withCommas(compact.length)} characters as a bare Base64 value.`],
    warnings: [],
  };
}

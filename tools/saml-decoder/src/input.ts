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
  /** True when the pasted text was a whole address (it has a scheme or a question mark before the parameters). */
  hasAddress?: boolean;
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

function isHex(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
}

/** Cuts leading and trailing white space and a leading byte order mark. */
function trimBoth(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && (isWhite(text.charCodeAt(start)) || text.charCodeAt(start) === 0xfeff)) start++;
  while (end > start && isWhite(text.charCodeAt(end - 1))) end--;
  return text.slice(start, end);
}

/** True when the text holds a space, tab or line break. */
function hasWhite(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (isWhite(text.charCodeAt(i))) return true;
  return false;
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
    if (isHex(text.charCodeAt(at + 1)) && isHex(text.charCodeAt(at + 2))) return true;
    at = text.indexOf('%', at + 1);
  }
  return false;
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

/** Undoes the URL encoding of a message value once, and a second time when percent codes are still in it. */
function decodeValue(value: string, steps: string[], warnings: string[], what: string): string {
  if (!value.includes('%')) return value;
  let out = percentDecode(value, what);
  steps.push(`Undid the URL encoding (percent codes) of the ${what} once.`);
  if (hasPercentPair(out)) {
    out = percentDecode(out, what);
    warnings.push(`The ${what} was URL-encoded twice; the encoding was undone a second time.`);
  }
  return out;
}

// ---- Redirect addresses and query strings ----

const KNOWN = ['SAMLRequest', 'SAMLResponse', 'SAMLart', 'RelayState', 'SigAlg', 'Signature'];

/** The index of a parameter name followed by `=` that starts the text or follows `?`, `&`, `;`, a space, a slash or a colon. */
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

interface QueryParameters {
  start: number;
  values: Map<string, string>;
  duplicates: string[];
  ampersandWords: boolean;
}

function readQuery(flat: string): QueryParameters | null {
  let start = -1;
  for (const name of KNOWN) {
    const at = findParameter(flat, name);
    if (at !== -1 && (start === -1 || at < start)) start = at;
  }
  if (start === -1) return null;
  let tail = flat.slice(start);
  const fragment = tail.indexOf('#');
  if (fragment !== -1) tail = tail.slice(0, fragment);
  const values = new Map<string, string>();
  const duplicates: string[] = [];
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
      if (KNOWN.includes(name)) {
        if (values.has(name)) duplicates.push(name);
        else values.set(name, piece.slice(eq + 1));
      }
    }
    pos = end + 1;
  }
  return { start, values, duplicates, ampersandWords };
}

function readRedirect(text: string): InputReading | null {
  const steps: string[] = [];
  const warnings: string[] = [];
  const broken = removeBreaks(text);
  const query = readQuery(broken.text);
  if (query === null) return null;
  const { values } = query;
  if (values.has('SAMLart') && !values.has('SAMLRequest') && !values.has('SAMLResponse')) {
    throw new SamlDecoderError(ARTIFACT_MESSAGE, 'message');
  }
  const parameter: MessageParameter = values.has('SAMLRequest') ? 'SAMLRequest' : 'SAMLResponse';
  if (values.has('SAMLRequest') && values.has('SAMLResponse')) {
    warnings.push('Both SAMLRequest and SAMLResponse are in the address; SAMLRequest was read.');
  }
  for (const name of query.duplicates)
    warnings.push(`The ${name} parameter is written more than once; the first was read.`);
  if (query.ampersandWords) warnings.push('The address holds &amp; where a plain & belongs; it was read as &.');
  const before = broken.text.slice(0, query.start);
  const hasAddress = before.includes('?') || before.includes('://');
  steps.push(
    hasAddress
      ? `Found the ${parameter} parameter in a redirect address (the HTTP-Redirect binding).`
      : `Found the ${parameter} parameter in a query string or form body.`,
  );
  if (broken.removed)
    steps.push('Removed line breaks and tabs that sat inside the address (an address never holds them).');
  const rawValue = values.get(parameter) ?? '';
  let value = rawValue;
  if (value.includes(' ')) {
    value = value.split(' ').join('+');
    warnings.push(
      'The message value held spaces, which are plus signs that were turned into spaces; they were put back as +.',
    );
  }
  value = decodeValue(value, steps, warnings, 'message value');
  const reading: InputReading = {
    kind: 'redirect',
    binding: 'HTTP-Redirect',
    raw: value,
    parameter,
    hasAddress,
    steps,
    warnings,
  };
  const relayRaw = values.get('RelayState');
  if (relayRaw !== undefined) reading.relayState = percentDecode(relayRaw, 'RelayState value');
  const sigAlgRaw = values.get('SigAlg');
  if (sigAlgRaw !== undefined) reading.sigAlg = percentDecode(sigAlgRaw, 'SigAlg value');
  const signatureRaw = values.get('Signature');
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

// ---- HTML forms ----

/** Reads the five named character references and numeric ones, and leaves any other `&` as it is. */
function decodeEntities(text: string): string {
  let at = text.indexOf('&');
  if (at === -1) return text;
  let out = '';
  let from = 0;
  while (at !== -1) {
    let semi = -1;
    const limit = Math.min(text.length, at + 12);
    for (let k = at + 1; k < limit; k++) {
      if (text.charCodeAt(k) === 59) {
        semi = k;
        break;
      }
    }
    let replacement: string | null = null;
    if (semi !== -1) {
      const body = text.slice(at + 1, semi);
      if (body === 'amp') replacement = '&';
      else if (body === 'lt') replacement = '<';
      else if (body === 'gt') replacement = '>';
      else if (body === 'quot') replacement = '"';
      else if (body === 'apos') replacement = "'";
      else if (body.charCodeAt(0) === 35 && body.length > 1) {
        const hex = body.charCodeAt(1) === 120 || body.charCodeAt(1) === 88;
        const digits = hex ? body.slice(2) : body.slice(1);
        let valid = digits.length > 0;
        for (let k = 0; k < digits.length && valid; k++) {
          const c = digits.charCodeAt(k);
          valid = hex ? isHex(c) : c >= 48 && c <= 57;
        }
        if (valid) {
          const point = parseInt(digits, hex ? 16 : 10);
          if (point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff))
            replacement = String.fromCodePoint(point);
        }
      }
    }
    if (replacement !== null) {
      out += text.slice(from, at) + replacement;
      from = semi + 1;
      at = text.indexOf('&', from);
    } else {
      at = text.indexOf('&', at + 1);
    }
  }
  return out + text.slice(from);
}

interface HtmlInput {
  name: string;
  value: string;
}

/** Reads the attributes of one tag from the position after its name, up to its closing `>`. */
function readTagAttributes(html: string, from: number): { attributes: Map<string, string>; end: number } {
  const attributes = new Map<string, string>();
  const n = html.length;
  let j = from;
  for (;;) {
    while (j < n && (isWhite(html.charCodeAt(j)) || html.charCodeAt(j) === 47)) j++;
    if (j >= n) return { attributes, end: n };
    if (html.charCodeAt(j) === 62) return { attributes, end: j + 1 };
    const start = j;
    while (j < n) {
      const c = html.charCodeAt(j);
      if (isWhite(c) || c === 61 || c === 62 || c === 47) break;
      j++;
    }
    const name = html.slice(start, j).toLowerCase();
    while (j < n && isWhite(html.charCodeAt(j))) j++;
    let value = '';
    if (html.charCodeAt(j) === 61) {
      j++;
      while (j < n && isWhite(html.charCodeAt(j))) j++;
      const quote = html.charCodeAt(j);
      if (quote === 34 || quote === 39) {
        const close = html.indexOf(html[j]!, j + 1);
        if (close === -1) return { attributes, end: n };
        value = html.slice(j + 1, close);
        j = close + 1;
      } else {
        const valueStart = j;
        while (j < n && !isWhite(html.charCodeAt(j)) && html.charCodeAt(j) !== 62) j++;
        value = html.slice(valueStart, j);
      }
    }
    if (name !== '' && !attributes.has(name)) attributes.set(name, decodeEntities(value));
  }
}

/** Finds every input tag of an HTML text, in one forward pass, with its name and value. */
function readInputTags(html: string): HtmlInput[] {
  const found: HtmlInput[] = [];
  let i = 0;
  for (;;) {
    i = html.indexOf('<', i);
    if (i === -1) break;
    if (html.slice(i + 1, i + 6).toLowerCase() === 'input') {
      const after = html.charCodeAt(i + 6);
      if (Number.isNaN(after) || isWhite(after) || after === 47 || after === 62) {
        const tag = readTagAttributes(html, i + 6);
        const name = tag.attributes.get('name');
        if (name !== undefined) found.push({ name, value: tag.attributes.get('value') ?? '' });
        i = tag.end;
        continue;
      }
    }
    i++;
  }
  return found;
}

function readHtmlForm(text: string): InputReading | null {
  const inputs = readInputTags(text);
  const first = (name: string): HtmlInput | undefined => inputs.find((input) => input.name === name);
  const request = first('SAMLRequest');
  const response = first('SAMLResponse');
  if (!request && !response && first('SAMLart')) throw new SamlDecoderError(ARTIFACT_MESSAGE, 'message');
  const chosen =
    request && response
      ? inputs.indexOf(request) < inputs.indexOf(response)
        ? request
        : response
      : (request ?? response);
  if (!chosen) return null;
  const parameter: MessageParameter = chosen === request ? 'SAMLRequest' : 'SAMLResponse';
  const steps = [`Found the ${parameter} input in an HTML form (the HTTP-POST binding).`];
  const warnings: string[] = [];
  if (request && response)
    warnings.push('Both a SAMLRequest and a SAMLResponse input are in the form; the first was read.');
  if (hasWhite(chosen.value)) steps.push('Removed the white space and line breaks inside the value.');
  const value = decodeValue(chosen.value, steps, warnings, 'message value');
  const reading: InputReading = { kind: 'post', binding: 'HTTP-POST', raw: value, parameter, steps, warnings };
  const relay = first('RelayState');
  if (relay) reading.relayState = relay.value;
  return reading;
}

/**
 * Works out what the pasted text is and undoes the wrapper around the message: raw XML as it is; an HTML form by reading its
 * hidden input; a redirect address, query string or form body by finding its parameters and undoing the URL encoding; or a
 * bare Base64 value. Everything it does is listed in `steps`, and anything unusual in `warnings`.
 */
export function readInput(text: string): InputReading {
  const trimmed = trimBoth(text);
  if (trimmed === '') throw new SamlDecoderError('There is no message to read.', 'message');
  if (trimmed.charCodeAt(0) === 0x3c) {
    const form = readHtmlForm(trimmed);
    if (form !== null) return form;
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
  if (trimmed.includes('://')) {
    throw new SamlDecoderError(
      'The address has no SAMLRequest or SAMLResponse parameter, so there is no message in it.',
      'message',
    );
  }
  const steps: string[] = [];
  const warnings: string[] = [];
  const value = decodeValue(trimmed, steps, warnings, 'value');
  steps.push(`Read the ${withCommas(value.length)} characters as a bare Base64 value.`);
  return { kind: 'base64', binding: 'Base64 value (no binding named)', raw: value, steps, warnings };
}

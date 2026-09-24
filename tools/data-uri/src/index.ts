/**
 * RFC 2397 data URI construction and parsing, over bytes.
 *
 * Neither this file nor `./signatures` mentions a browser file or blob type
 * anywhere. The page that wraps this package is what reads a picked file
 * into bytes; this package only ever sees the bytes, because the standalone
 * folder test (`scripts/check-standalone.mjs --full`) runs this package's
 * own test suite in plain Node, where DOM file types do not exist.
 *
 * Base64 encoding and decoding are reimplemented here rather than imported
 * from `tools/base64`, even though the algorithm is the same: a tool folder
 * may not import another tool package (D-02), so a data URI's base64 half
 * has to be self-contained the same way its percent-encoded half is.
 */
import meta from './meta.json';
import { sniffMediaType, looksLikePlainText, detectMediaType, SIGNATURES, type MediaTypeSource } from './signatures';

export { meta, sniffMediaType, looksLikePlainText, SIGNATURES };

/**
 * A generous ceiling for the genuine use this tool is for -- an icon, a
 * small font, a short sound clip -- and a hopeless one for the misuse the
 * cycle-2 plan review flagged: reading a large file into memory, expanding
 * it into a base64 string roughly a third larger again, with no message
 * until the tab has already done most of the damage. Enforced in three
 * places: the page checks a picked file's size against this constant
 * before it ever reads the file; {@link buildDataUri} checks the input
 * byte array; {@link parseDataUri} checks the input string's length before
 * it expands anything. The exact number is a planner/executor judgement
 * under D-24, recorded with its reasoning in this plan's summary.
 */
export const MAX_DATA_URI_BYTES = 10 * 1024 * 1024; // 10 MB

export class DataUriError extends Error {
  /** Index into the original input string where the problem was found, when known. */
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'DataUriError';
    this.position = position;
  }
}

export interface DataUri {
  mediaType: string;
  /** Parameters from the header, in the order they appeared, separate from `mediaType` itself. */
  params: [string, string][];
  /** Whether the data segment used the `;base64` marker. */
  base64: boolean;
  bytes: Uint8Array;
}

export interface BuildOptions {
  /** An explicit media type, e.g. from a visitor's override field. Highest priority when given. */
  mediaType?: string;
  /** What the browser's own file object reported as its type, used as the second-tier fallback (see {@link detectMediaType}). */
  browserReportedType?: string;
  /** Whether to use the `;base64` marker. Default true, matching how binary assets are normally shared. */
  base64?: boolean;
}

export interface BuildResult {
  dataUri: string;
  mediaType: string;
  /** Which source decided the media type -- 'override' is new here; the other three come from {@link detectMediaType}. */
  source: MediaTypeSource | 'override';
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function buildBase64Lookup(): Int16Array {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < BASE64_ALPHABET.length; i++) table[BASE64_ALPHABET.charCodeAt(i)] = i;
  return table;
}
const BASE64_LOOKUP = buildBase64Lookup();

function encodeBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += BASE64_ALPHABET[b0 >> 2];
    if (b1 === undefined) {
      out += BASE64_ALPHABET[(b0 & 0x03) << 4];
      out += '==';
      break;
    }
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (b2 === undefined) {
      out += BASE64_ALPHABET[(b1 & 0x0f) << 2];
      out += '=';
      break;
    }
    out += BASE64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
    out += BASE64_ALPHABET[b2 & 0x3f];
  }
  return out;
}

/** Decoded length of a base64 body, computed from its length alone -- used to enforce the ceiling before decoding. */
function estimateBase64DecodedLength(data: string): number {
  let body = data;
  while (body.endsWith('=')) body = body.slice(0, -1);
  const groups = Math.floor(body.length / 4);
  const tail = body.length % 4;
  return groups * 3 + (tail === 2 ? 1 : tail === 3 ? 2 : 0);
}

function decodeBase64DataUri(data: string, offset: number): Uint8Array {
  if (data.length === 0) return new Uint8Array(0);

  let body = data;
  while (body.endsWith('=')) body = body.slice(0, -1);

  for (let i = 0; i < body.length; i++) {
    const code = body.charCodeAt(i);
    if (code > 127 || BASE64_LOOKUP[code] === -1) {
      throw new DataUriError(`"${body[i]}" is not a base64 character.`, offset + i);
    }
  }

  const remainder = body.length % 4;
  if (remainder === 1) {
    throw new DataUriError(
      'Truncated base64: a group of four characters cannot end on a single character.',
      offset + body.length,
    );
  }

  const groups = Math.floor(body.length / 4);
  const tail = remainder;
  const byteLength = groups * 3 + (tail === 2 ? 1 : tail === 3 ? 2 : 0);
  const out = new Uint8Array(byteLength);

  let o = 0;
  let i = 0;
  for (; i + 4 <= body.length; i += 4) {
    const v =
      (BASE64_LOOKUP[body.charCodeAt(i)]! << 18) |
      (BASE64_LOOKUP[body.charCodeAt(i + 1)]! << 12) |
      (BASE64_LOOKUP[body.charCodeAt(i + 2)]! << 6) |
      BASE64_LOOKUP[body.charCodeAt(i + 3)]!;
    out[o++] = (v >> 16) & 0xff;
    out[o++] = (v >> 8) & 0xff;
    out[o++] = v & 0xff;
  }
  if (tail === 2) {
    const a = BASE64_LOOKUP[body.charCodeAt(i)]!;
    const b = BASE64_LOOKUP[body.charCodeAt(i + 1)]!;
    out[o++] = (a << 2) | (b >> 4);
  } else if (tail === 3) {
    const a = BASE64_LOOKUP[body.charCodeAt(i)]!;
    const b = BASE64_LOOKUP[body.charCodeAt(i + 1)]!;
    const c = BASE64_LOOKUP[body.charCodeAt(i + 2)]!;
    out[o++] = (a << 2) | (b >> 4);
    out[o++] = ((b & 0x0f) << 4) | (c >> 2);
  }
  return out;
}

/**
 * RFC 2396's "unreserved" set, imported by RFC 2397's grammar for the data
 * segment: letters, digits, and `-_.!~*'()`. Written here against the
 * grammar directly rather than reaching for `encodeURIComponent`, whose
 * escaping rules are close but not identical (it additionally leaves
 * several "reserved" characters unescaped that this grammar does not).
 */
const UNRESERVED = /^[A-Za-z0-9\-_.!~*'()]$/;

function percentEncode(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) {
    const ch = b < 128 ? String.fromCharCode(b) : '';
    if (ch !== '' && UNRESERVED.test(ch)) out += ch;
    else out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

/** Decoded length of a percent-encoded data segment, without allocating the output -- each byte costs at least one input character. */
function estimatePercentDecodedLength(data: string): number {
  let n = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === '%') i += 2;
    n++;
  }
  return n;
}

function percentDecode(data: string, offset: number): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const ch = data[i]!;
    if (ch === '%') {
      const h1 = data[i + 1];
      const h2 = data[i + 2];
      const isHex = (c: string | undefined): c is string => c !== undefined && /^[0-9A-Fa-f]$/.test(c);
      if (!isHex(h1)) {
        throw new DataUriError(
          `"${h1 ?? ''}" is not a hexadecimal digit in the percent escape starting here.`,
          offset + i + 1,
        );
      }
      if (!isHex(h2)) {
        throw new DataUriError(
          `"${h2 ?? ''}" is not a hexadecimal digit in the percent escape "%${h1}${h2 ?? ''}".`,
          offset + i + 2,
        );
      }
      out.push(parseInt(h1 + h2, 16));
      i += 2;
    } else {
      const code = ch.charCodeAt(0);
      if (code > 0x7f) {
        throw new DataUriError(
          `"${ch}" is outside the ASCII range a data URI allows unescaped; it must be percent-encoded.`,
          offset + i,
        );
      }
      out.push(code);
    }
  }
  return new Uint8Array(out);
}

/**
 * Builds a data URI, matching RFC 2397's grammar exactly:
 * `data:[<mediatype>][;base64],<data>`.
 *
 * When `options.mediaType` is not given, the media type comes from
 * {@link detectMediaType}: a specific signature match, then the browser's
 * reported type, then a generic signature match, then `unknown`
 * (`application/octet-stream`). The `source` on the returned result says
 * which of these actually produced the answer.
 */
export function buildDataUri(bytes: Uint8Array, options: BuildOptions = {}): BuildResult {
  if (bytes.length > MAX_DATA_URI_BYTES) {
    throw new DataUriError(
      `This is ${bytes.length} bytes, above the ${MAX_DATA_URI_BYTES}-byte ceiling this tool reads before building a data URI.`,
    );
  }

  let mediaType: string;
  let source: MediaTypeSource | 'override';
  if (options.mediaType) {
    mediaType = options.mediaType;
    source = 'override';
  } else {
    const decision = detectMediaType(bytes, options.browserReportedType ?? '');
    mediaType = decision.mediaType;
    source = decision.source;
  }

  const useBase64 = options.base64 ?? true;
  const body = useBase64 ? encodeBase64(bytes) : percentEncode(bytes);
  const dataUri = `data:${mediaType}${useBase64 ? ';base64' : ''},${body}`;
  return { dataUri, mediaType, source };
}

/**
 * Parses a data URI per RFC 2397's grammar: `data:[<mediatype>][;base64],<data>`.
 *
 * When `<mediatype>` is entirely omitted, it defaults to
 * `text/plain;charset=US-ASCII`, written into `params` explicitly rather
 * than left for the caller to assume (RFC 2397 section 2). When only the
 * `type/subtype` half is omitted but a parameter such as `charset` is
 * given, `text/plain` is filled in and the given parameter is kept exactly
 * as written -- the shorthand the same paragraph describes.
 */
export function parseDataUri(value: string): DataUri {
  if (!value.startsWith('data:')) {
    const preview = value.length > 60 ? `${value.slice(0, 60)}…` : value;
    throw new DataUriError(`This does not start with the "data:" scheme. Found "${preview}".`, 0);
  }

  const rest = value.slice(5);
  const commaIndex = rest.indexOf(',');
  if (commaIndex === -1) {
    throw new DataUriError('No comma found. The comma is what separates the header from the data.', value.length);
  }

  let header = rest.slice(0, commaIndex);
  const data = rest.slice(commaIndex + 1);
  const dataOffset = value.length - data.length;

  let base64 = false;
  if (header.endsWith(';base64')) {
    base64 = true;
    header = header.slice(0, -';base64'.length);
  }

  let typeSubtype = '';
  const params: [string, string][] = [];
  if (header.length > 0) {
    const parts = header.split(';');
    let paramStart: number;
    if (parts[0]!.includes('/')) {
      typeSubtype = parts[0]!;
      paramStart = 1;
    } else if (parts[0] === '') {
      // Header started with ';': the media type is omitted (the shorthand
      // RFC 2397 section 2 describes), so only the parameters remain.
      paramStart = 1;
    } else {
      throw new DataUriError(`"${parts[0]}" is not a valid media type: expected "type/subtype".`, 5);
    }
    for (let i = paramStart; i < parts.length; i++) {
      const seg = parts[i]!;
      const eq = seg.indexOf('=');
      if (eq === -1) {
        throw new DataUriError(`"${seg}" is not a valid parameter: expected "name=value".`, 5);
      }
      params.push([seg.slice(0, eq), seg.slice(eq + 1)]);
    }
  }

  const mediaType = typeSubtype || 'text/plain';
  if (!typeSubtype && params.length === 0) {
    // RFC 2397 section 2: an entirely omitted media type defaults to
    // text/plain;charset=US-ASCII. Written explicitly rather than left implicit.
    params.push(['charset', 'US-ASCII']);
  }

  const estimatedLength = base64 ? estimateBase64DecodedLength(data) : estimatePercentDecodedLength(data);
  if (estimatedLength > MAX_DATA_URI_BYTES) {
    throw new DataUriError(
      `This decodes to more than ${MAX_DATA_URI_BYTES} bytes, above the ceiling this tool reads before expanding it.`,
      dataOffset,
    );
  }

  const bytes = base64 ? decodeBase64DataUri(data, dataOffset) : percentDecode(data, dataOffset);

  return { mediaType, params, base64, bytes };
}

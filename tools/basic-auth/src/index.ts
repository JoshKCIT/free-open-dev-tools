import meta from './meta.json';

export { meta };

export interface Credentials {
  userid: string;
  password: string;
}

export class BasicAuthError extends Error {
  /** Index into the input where the problem was found, when known. */
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'BasicAuthError';
    this.position = position;
  }
}

const STANDARD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64Encode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += STANDARD_ALPHABET[b0 >> 2];
    if (b1 === undefined) {
      out += STANDARD_ALPHABET[(b0 & 0x03) << 4] + '==';
      break;
    }
    out += STANDARD_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (b2 === undefined) {
      out += STANDARD_ALPHABET[(b1 & 0x0f) << 2] + '=';
      break;
    }
    out += STANDARD_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)]! + STANDARD_ALPHABET[b2 & 0x3f]!;
  }
  return out;
}

/** Decodes standard Base64. Throws {@link BasicAuthError} naming the offending position. */
function base64Decode(input: string): Uint8Array {
  let body = input;
  let pad = 0;
  while (body.endsWith('=')) {
    body = body.slice(0, -1);
    pad++;
  }
  if (pad > 2) throw new BasicAuthError('More than two padding characters in the credentials.', body.length);
  if (body.includes('=')) {
    throw new BasicAuthError('Padding ("=") appears before the end of the credentials.', body.indexOf('='));
  }
  for (let i = 0; i < body.length; i++) {
    if (STANDARD_ALPHABET.indexOf(body[i]!) === -1) {
      throw new BasicAuthError(`"${body[i]}" is not a valid Base64 character in the credentials.`, i);
    }
  }
  const remainder = body.length % 4;
  if (remainder === 1) {
    throw new BasicAuthError('Truncated credentials: a Base64 group cannot be a single character.', body.length);
  }
  const lookup = (ch: string) => STANDARD_ALPHABET.indexOf(ch);
  const groups = Math.floor(body.length / 4);
  const tail = body.length % 4;
  const byteLength = groups * 3 + (tail === 2 ? 1 : tail === 3 ? 2 : 0);
  const out = new Uint8Array(byteLength);
  let o = 0;
  let i = 0;
  for (; i + 4 <= body.length; i += 4) {
    const v =
      (lookup(body[i]!) << 18) | (lookup(body[i + 1]!) << 12) | (lookup(body[i + 2]!) << 6) | lookup(body[i + 3]!);
    out[o++] = (v >> 16) & 0xff;
    out[o++] = (v >> 8) & 0xff;
    out[o++] = v & 0xff;
  }
  if (tail === 2) {
    const a = lookup(body[i]!);
    const b = lookup(body[i + 1]!);
    out[o++] = (a << 2) | (b >> 4);
  } else if (tail === 3) {
    const a = lookup(body[i]!);
    const b = lookup(body[i + 1]!);
    const c = lookup(body[i + 2]!);
    out[o++] = (a << 2) | (b >> 4);
    out[o++] = ((b & 0x0f) << 4) | (c >> 2);
  }
  return out;
}

/**
 * Builds the credentials half of an Authorization/Proxy-Authorization
 * header value: `Basic ` followed by a single token68 run with NO
 * authentication parameter. RFC 7617 section 2.1 defines `charset` on the
 * CHALLENGE only, because credentials are non-extensible token68 syntax --
 * `Basic <credentials>, charset="UTF-8"` is not a value any server accepts.
 * There is deliberately no charset option here; see {@link buildChallenge}.
 */
export function buildHeader(credentials: Credentials): string {
  if (credentials.userid.includes(':')) {
    throw new BasicAuthError(
      'The user identifier cannot contain a colon: the first colon in the decoded credentials is what separates the user identifier from the password.',
    );
  }
  const userPass = `${credentials.userid}:${credentials.password}`;
  const bytes = new TextEncoder().encode(userPass);
  return `Basic ${base64Encode(bytes)}`;
}

/**
 * Parses a `Basic` Authorization/Proxy-Authorization header value back into
 * its user identifier and password. Splits on the FIRST colon only, so a
 * password may itself contain a colon.
 */
export function parseHeader(value: string): Credentials {
  const trimmed = value.trim();
  const spaceIdx = trimmed.indexOf(' ');
  const scheme = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  if (scheme.toLowerCase() !== 'basic') {
    throw new BasicAuthError(`Expected the "Basic" scheme, found "${scheme}".`, 0);
  }
  const credentialsPart = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();
  const bytes = base64Decode(credentialsPart);
  const userPass = new TextDecoder().decode(bytes);
  const colonIdx = userPass.indexOf(':');
  if (colonIdx === -1) {
    return { userid: userPass, password: '' };
  }
  return { userid: userPass.slice(0, colonIdx), password: userPass.slice(colonIdx + 1) };
}

export interface ChallengeOptions {
  /** Adds the `charset="UTF-8"` authentication parameter. Default false. */
  charset?: boolean;
}

/**
 * Builds a WWW-Authenticate/Proxy-Authenticate CHALLENGE field value, such
 * as `Basic realm="Example"`. This is a field value, not a whole header
 * line -- the caller prefixes `WWW-Authenticate: ` themselves.
 *
 * The realm is attacker-shaped input, so it is serialised per the
 * quoted-string rule (RFC 7230 section 3.2.6): a double quote or a
 * backslash inside it is escaped with a backslash, and any control
 * character (below 0x20, or 0x7F) is REJECTED rather than stripped, naming
 * the offending character -- a realm containing a carriage return and line
 * feed could otherwise let a caller emit a second header line through the
 * generated value.
 */
export function buildChallenge(realm: string, options: ChallengeOptions = {}): string {
  const { charset = false } = options;
  let hasNonAscii = false;
  let escaped = '';
  for (let i = 0; i < realm.length; i++) {
    const ch = realm[i]!;
    const code = realm.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      throw new BasicAuthError(
        `The realm cannot contain the control character at position ${i} (code ${code}). It could be used to inject an extra header line.`,
        i,
      );
    }
    if (code > 0x7e) hasNonAscii = true;
    if (ch === '"' || ch === '\\') escaped += '\\' + ch;
    else escaped += ch;
  }
  if (hasNonAscii && !charset) {
    throw new BasicAuthError(
      'The realm contains a non-ASCII character. A quoted-string has no encoding of its own; pass { charset: true } to signal UTF-8, or use only ASCII in the realm.',
    );
  }
  const params = [`realm="${escaped}"`];
  if (charset) params.push('charset="UTF-8"');
  return `Basic ${params.join(', ')}`;
}

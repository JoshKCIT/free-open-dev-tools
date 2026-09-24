/**
 * PEM and JSON Web Key handling, and key import into the platform's own
 * cryptography interface (`globalThis.crypto.subtle`).
 *
 * Nothing in this file performs any asymmetric arithmetic itself. Signing and
 * verification both go through the platform; this file only gets bytes into
 * the shape `importKey` accepts (PEM is base64 plus header/footer stripping,
 * which the platform does not do for you) and reports what went wrong in a
 * way that never repeats the key back.
 *
 * RULE, stated once and enforced by a test: no message thrown or returned
 * from this file may ever contain a fragment of a key, a secret, or a token.
 * Describe the shape of the problem, never the content.
 */

export type JwsAlgorithm =
  'HS256' | 'HS384' | 'HS512' | 'RS256' | 'RS384' | 'RS512' | 'PS256' | 'PS384' | 'PS512' | 'ES256' | 'ES384' | 'ES512';

export type KeyFormat = 'pem-private' | 'pem-public' | 'jwk' | 'secret';

export type Encoding = 'utf8' | 'hex' | 'base64';

export interface PemKeyInput {
  format: 'pem-private' | 'pem-public';
  pem: string;
}

export interface JwkKeyInput {
  format: 'jwk';
  json: string;
}

export interface SecretKeyInput {
  format: 'secret';
  encoding: Encoding;
  value: string;
}

export type KeyInput = PemKeyInput | JwkKeyInput | SecretKeyInput;

export class JwtKeyError extends Error {
  /** Index into the relevant text where the problem was found, when known. */
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'JwtKeyError';
    this.position = position;
  }
}

type Family = 'hmac' | 'rsassa-pkcs1' | 'rsa-pss' | 'ecdsa';
type HashName = 'SHA-256' | 'SHA-384' | 'SHA-512';
type Curve = 'P-256' | 'P-384' | 'P-521';

interface AlgorithmParams {
  family: Family;
  hash: HashName;
  /** Only meaningful for the ecdsa family. Taken from this table, never parsed from the algorithm name. */
  curve?: Curve;
}

/**
 * The curve for every elliptic-curve algorithm lives here, keyed by the
 * algorithm identifier. ES512 uses curve P-521 -- the algorithm name's
 * number and the curve's own number are simply different conventions, and a
 * pattern match against the name (dropping the trailing zero, say) picks the
 * wrong curve. Always read the curve from this table.
 */
export const ALGORITHM_PARAMS: Record<JwsAlgorithm, AlgorithmParams> = {
  HS256: { family: 'hmac', hash: 'SHA-256' },
  HS384: { family: 'hmac', hash: 'SHA-384' },
  HS512: { family: 'hmac', hash: 'SHA-512' },
  RS256: { family: 'rsassa-pkcs1', hash: 'SHA-256' },
  RS384: { family: 'rsassa-pkcs1', hash: 'SHA-384' },
  RS512: { family: 'rsassa-pkcs1', hash: 'SHA-512' },
  PS256: { family: 'rsa-pss', hash: 'SHA-256' },
  PS384: { family: 'rsa-pss', hash: 'SHA-384' },
  PS512: { family: 'rsa-pss', hash: 'SHA-512' },
  ES256: { family: 'ecdsa', hash: 'SHA-256', curve: 'P-256' },
  ES384: { family: 'ecdsa', hash: 'SHA-384', curve: 'P-384' },
  ES512: { family: 'ecdsa', hash: 'SHA-512', curve: 'P-521' },
};

/** Bytes a hash function produces, needed for RSA-PSS's salt length. */
const HASH_BYTES: Record<HashName, number> = { 'SHA-256': 32, 'SHA-384': 48, 'SHA-512': 64 };

/**
 * `crypto.subtle` is available only in a secure context in a browser (https,
 * or localhost); the Node path this project's standalone check runs is
 * unaffected. Checked once at the top of every function that needs it,
 * rather than letting an undefined property throw somewhere unclear.
 */
export function requireSecureContext(): void {
  const g = globalThis as { crypto?: Crypto };
  if (typeof g.crypto === 'undefined' || typeof g.crypto.subtle === 'undefined') {
    throw new JwtKeyError(
      'The browser cryptography interface (crypto.subtle) is not available here. It requires a secure context: https, or localhost. Load this page over https to use it.',
    );
  }
}

/** The WebCrypto algorithm parameter object `importKey` needs for the HMAC family. */
function hmacImportParams(params: AlgorithmParams): HmacImportParams {
  return { name: 'HMAC', hash: { name: params.hash } };
}

/** The WebCrypto algorithm parameter object `importKey` needs for the RSA and ECDSA families. */
function asymmetricImportParams(params: AlgorithmParams): RsaHashedImportParams | EcKeyImportParams {
  if (params.family === 'ecdsa') return { name: 'ECDSA', namedCurve: params.curve! };
  const name = params.family === 'rsassa-pkcs1' ? 'RSASSA-PKCS1-v1_5' : 'RSA-PSS';
  return { name, hash: { name: params.hash } };
}

/** The WebCrypto algorithm parameter object `sign`/`verify` need for this algorithm. */
export function signVerifyAlgorithmParams(algorithm: JwsAlgorithm): AlgorithmIdentifier | RsaPssParams | EcdsaParams {
  const params = ALGORITHM_PARAMS[algorithm];
  if (params.family === 'ecdsa') return { name: 'ECDSA', hash: { name: params.hash } };
  if (params.family === 'rsa-pss') return { name: 'RSA-PSS', saltLength: HASH_BYTES[params.hash] };
  // HMAC and RSASSA-PKCS1-v1_5 both need only their name; the imported key already carries its hash.
  return params.family === 'hmac' ? 'HMAC' : 'RSASSA-PKCS1-v1_5';
}

function formatLabel(format: KeyFormat): string {
  switch (format) {
    case 'pem-private':
      return 'PEM private key';
    case 'pem-public':
      return 'PEM public key';
    case 'jwk':
      return 'JSON Web Key';
    case 'secret':
      return 'shared secret';
  }
}

// ---------------------------------------------------------------------------
// PEM
// ---------------------------------------------------------------------------

const B64_STANDARD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64Standard(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64_STANDARD[b0 >> 2];
    if (b1 === undefined) {
      out += B64_STANDARD[(b0 & 0x03) << 4] + '==';
      break;
    }
    out += B64_STANDARD[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (b2 === undefined) {
      out += B64_STANDARD[(b1 & 0x0f) << 2] + '=';
      break;
    }
    out += B64_STANDARD[((b1 & 0x0f) << 2) | (b2 >> 6)];
    out += B64_STANDARD[b2 & 0x3f];
  }
  return out;
}

/**
 * Decodes a standard-alphabet Base64 body (padding already separated out by
 * the caller is not required; trailing `=` is tolerated here). Throws
 * {@link JwtKeyError} carrying the position of the first character that is
 * not part of the Base64 alphabet, without ever repeating that character
 * back -- a single byte of a private key is still a fragment of the key.
 */
function base64StandardToBytes(body: string): Uint8Array {
  let core = body;
  while (core.endsWith('=')) core = core.slice(0, -1);
  for (let i = 0; i < core.length; i++) {
    if (!B64_STANDARD.includes(core[i]!)) {
      throw new JwtKeyError(
        `The PEM body is not valid Base64: the character at position ${i} is not a Base64 character.`,
        i,
      );
    }
  }
  const padded = core + '='.repeat((4 - (core.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new JwtKeyError('The PEM body is not valid Base64: its length does not divide correctly into full groups.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface PemBlock {
  /** The label between BEGIN and the dashes, e.g. "PRIVATE KEY". */
  label: string;
  bytes: Uint8Array;
}

const PEM_BEGIN = /^-----BEGIN ([A-Z0-9 ]+)-----/;
const PEM_END = /-----END ([A-Z0-9 ]+)-----\s*$/;

/**
 * Converts a PEM block to bytes: strips the header and footer lines and any
 * whitespace, then decodes the remaining Base64. Returns the label that was
 * on the block so the caller can check it matches the intended use.
 */
export function pemToBytes(pem: string): PemBlock {
  const trimmed = pem.trim();
  const begin = PEM_BEGIN.exec(trimmed);
  if (!begin) {
    throw new JwtKeyError('A PEM block starts with "-----BEGIN <LABEL>-----". This text does not start that way.');
  }
  const end = PEM_END.exec(trimmed);
  if (!end) {
    throw new JwtKeyError(`This PEM block has no matching "-----END ${begin[1]}-----" footer.`);
  }
  const beginLabel = begin[1]!;
  const endLabel = end[1]!;
  if (beginLabel !== endLabel) {
    throw new JwtKeyError(
      `The PEM header says "${beginLabel}" but the footer says "${endLabel}". A PEM block's header and footer labels must match.`,
    );
  }
  const bodyStart = begin[0].length;
  const bodyEnd = trimmed.length - end[0].length;
  const body = trimmed.slice(bodyStart, bodyEnd).replace(/\s+/g, '');
  const bytes = base64StandardToBytes(body);
  return { label: beginLabel, bytes };
}

/** Converts bytes back to a PEM block, wrapping the Base64 body at 64 characters per line. */
export function bytesToPem(bytes: Uint8Array, label: string): string {
  const body = bytesToBase64Standard(bytes);
  const lines: string[] = [];
  for (let i = 0; i < body.length; i += 64) lines.push(body.slice(i, i + 64));
  return [`-----BEGIN ${label}-----`, ...lines, `-----END ${label}-----`].join('\n');
}

// ---------------------------------------------------------------------------
// Shared secret
// ---------------------------------------------------------------------------

function decodeSecret(value: string, encoding: Encoding): Uint8Array {
  if (encoding === 'utf8') return new TextEncoder().encode(value);
  if (encoding === 'hex') {
    const cleaned = value.replace(/[\s:_-]/g, '');
    if (cleaned.length % 2 !== 0) throw new JwtKeyError('The hex secret has an odd number of digits.');
    if (!/^[0-9a-fA-F]*$/.test(cleaned))
      throw new JwtKeyError('The hex secret contains a character that is not a hex digit.');
    const bytes = new Uint8Array(cleaned.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
    return bytes;
  }
  // base64 (tolerant of the url-safe alphabet, since a secret pasted from a token is often base64url)
  const cleaned = value.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = cleaned + '='.repeat((4 - (cleaned.length % 4)) % 4);
  let binary: string;
  try {
    binary = padded === '' ? '' : atob(padded);
  } catch {
    throw new JwtKeyError('The Base64 secret could not be decoded.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// JSON Web Key
// ---------------------------------------------------------------------------

function parseJwk(json: string): JsonWebKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new JwtKeyError('The JSON Web Key is not valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new JwtKeyError('The JSON Web Key must be a JSON object.');
  }
  return parsed as JsonWebKey;
}

// ---------------------------------------------------------------------------
// Key import
// ---------------------------------------------------------------------------

async function importKeyForUse(algorithm: JwsAlgorithm, input: KeyInput, use: 'sign' | 'verify'): Promise<CryptoKey> {
  requireSecureContext();
  const params = ALGORITHM_PARAMS[algorithm];
  if (!params) throw new JwtKeyError(`"${algorithm}" is not a supported algorithm.`);

  if (params.family === 'hmac') {
    if (input.format !== 'secret') {
      throw new JwtKeyError(`${algorithm} needs a shared secret, not a ${formatLabel(input.format)}.`);
    }
    const bytes = decodeSecret(input.value, input.encoding);
    if (bytes.length === 0) throw new JwtKeyError('A shared secret cannot be empty.');
    try {
      return await globalThis.crypto.subtle.importKey('raw', bytes as BufferSource, hmacImportParams(params), false, [
        use,
      ]);
    } catch {
      throw new JwtKeyError(`The shared secret could not be prepared for ${algorithm}.`);
    }
  }

  if (input.format === 'secret') {
    throw new JwtKeyError(`${algorithm} needs a public or private key, not a shared secret.`);
  }

  if (input.format === 'jwk') {
    const jwk = parseJwk(input.json);
    const expectedKty = params.family === 'ecdsa' ? 'EC' : 'RSA';
    const actualKty = jwk.kty ?? '(missing)';
    if (actualKty !== expectedKty) {
      throw new JwtKeyError(
        `This key is a "${actualKty}" JSON Web Key, but ${algorithm} needs a "${expectedKty}" key.`,
      );
    }
    if (params.family === 'ecdsa' && jwk.crv !== params.curve) {
      throw new JwtKeyError(
        `This key uses curve "${jwk.crv ?? '(none)'}", but ${algorithm} requires curve "${params.curve}".`,
      );
    }
    const isPrivate = jwk.d !== undefined;
    if (use === 'sign' && !isPrivate) {
      throw new JwtKeyError(
        `This JSON Web Key has no private component ("d"), so it cannot sign for ${algorithm}. Supply the private key.`,
      );
    }
    try {
      return await globalThis.crypto.subtle.importKey('jwk', jwk, asymmetricImportParams(params), false, [use]);
    } catch {
      throw new JwtKeyError(
        `This JSON Web Key could not be imported for ${algorithm}. Check that its fields match a valid ${expectedKty} key.`,
      );
    }
  }

  // pem-private / pem-public
  const block = pemToBytes(input.pem);
  const expectedFormat = input.format === 'pem-private' ? 'pkcs8' : 'spki';
  const expectedLabel = input.format === 'pem-private' ? 'PRIVATE KEY' : 'PUBLIC KEY';
  if (block.label !== expectedLabel) {
    throw new JwtKeyError(
      `This PEM is labelled "${block.label}", but a ${formatLabel(input.format)} must be labelled "${expectedLabel}".`,
    );
  }
  const wantsPrivate = use === 'sign';
  if (wantsPrivate && input.format !== 'pem-private') {
    throw new JwtKeyError(`${algorithm} needs a private key to sign, but a public key was supplied.`);
  }
  if (!wantsPrivate && input.format !== 'pem-public') {
    throw new JwtKeyError(`${algorithm} needs a public key to verify, but a private key was supplied.`);
  }
  try {
    return await globalThis.crypto.subtle.importKey(
      expectedFormat,
      block.bytes as BufferSource,
      asymmetricImportParams(params),
      false,
      [use],
    );
  } catch {
    const shape =
      params.family === 'ecdsa' ? `a key using curve ${params.curve}` : `a valid ${formatLabel(input.format)}`;
    throw new JwtKeyError(`This key could not be imported for ${algorithm}. It does not look like ${shape}.`);
  }
}

/** Imports a key for signing: a private key (PEM or JWK) for the asymmetric families, or a shared secret for HMAC. */
export function importSigningKey(algorithm: JwsAlgorithm, input: KeyInput): Promise<CryptoKey> {
  return importKeyForUse(algorithm, input, 'sign');
}

/** Imports a key for verification: a public key (PEM or JWK) for the asymmetric families, or the same shared secret for HMAC. */
export function importVerifyingKey(algorithm: JwsAlgorithm, input: KeyInput): Promise<CryptoKey> {
  return importKeyForUse(algorithm, input, 'verify');
}

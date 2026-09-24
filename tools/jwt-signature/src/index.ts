import meta from './meta.json';
import { ALGORITHM_PARAMS, requireSecureContext, signVerifyAlgorithmParams, type JwsAlgorithm } from './keys';

export { meta };
export {
  pemToBytes,
  bytesToPem,
  importSigningKey,
  importVerifyingKey,
  JwtKeyError,
  type KeyFormat,
  type KeyInput,
  type PemKeyInput,
  type JwkKeyInput,
  type SecretKeyInput,
  type Encoding,
  type JwsAlgorithm,
} from './keys';

/**
 * Signs and verifies compact JSON Web Signatures over the platform's own
 * cryptography interface (`globalThis.crypto.subtle`). No asymmetric
 * arithmetic is written here; `keys.ts` gets bytes into a shape the platform
 * accepts and this file drives `sign`/`verify` with them.
 *
 * TWO RULES, both load-bearing and both covered by a test:
 *
 * 1. The algorithm and the key used to verify come from the caller, never
 *    from the token's own header. Reading the header to decide how to verify
 *    is the algorithm-confusion attack: it lets an attacker who holds a
 *    public key present it as a shared secret. `verify` reads the header
 *    only to report whether it agrees with what the caller chose. The
 *    header members `jku`, `jwk` and `kid` -- an attacker's pointer to a key,
 *    an attacker's embedded key, and an attacker's key identifier -- are
 *    never read for key selection anywhere in this file.
 *
 * 2. The unsecured "none" algorithm is refused, on both signing and
 *    verification. Defining it is not the same as it being safe to offer.
 */

export class JwtSignatureError extends Error {
  /** Index into the relevant segment where the problem was found, when known. */
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'JwtSignatureError';
    this.position = position;
  }
}

export interface AlgorithmInfo {
  id: JwsAlgorithm;
  label: string;
  family: 'HMAC' | 'RSASSA-PKCS1-v1_5' | 'RSA-PSS' | 'ECDSA';
  hash: 'SHA-256' | 'SHA-384' | 'SHA-512';
  curve?: 'P-256' | 'P-384' | 'P-521';
  note: string;
}

function algorithmFamilyLabel(algorithm: JwsAlgorithm): AlgorithmInfo['family'] {
  const family = ALGORITHM_PARAMS[algorithm].family;
  if (family === 'hmac') return 'HMAC';
  if (family === 'rsassa-pkcs1') return 'RSASSA-PKCS1-v1_5';
  if (family === 'rsa-pss') return 'RSA-PSS';
  return 'ECDSA';
}

const NOTES: Record<JwsAlgorithm, string> = {
  HS256: 'A shared secret. The sensible default for keyed-hash JWTs; needs SubtleCrypto.',
  HS384: 'A shared secret with a larger digest. Needs SubtleCrypto.',
  HS512: 'A shared secret with the largest SHA-2 digest. Needs SubtleCrypto.',
  RS256: 'RSASSA-PKCS1-v1_5 with SHA-256, the most widely deployed RSA JWS algorithm. Needs SubtleCrypto.',
  RS384: 'RSASSA-PKCS1-v1_5 with SHA-384. Needs SubtleCrypto.',
  RS512: 'RSASSA-PKCS1-v1_5 with SHA-512. Needs SubtleCrypto.',
  PS256: 'RSASSA-PSS with SHA-256, the probabilistic RSA scheme RFC 7518 also defines. Needs SubtleCrypto.',
  PS384: 'RSASSA-PSS with SHA-384. Needs SubtleCrypto.',
  PS512: 'RSASSA-PSS with SHA-512. Needs SubtleCrypto.',
  ES256: 'ECDSA over curve P-256 with SHA-256. Signatures are not deterministic. Needs SubtleCrypto.',
  ES384: 'ECDSA over curve P-384 with SHA-384. Signatures are not deterministic. Needs SubtleCrypto.',
  ES512:
    'ECDSA over curve P-521 (not "P-512" -- there is no such curve) with SHA-512. Signatures are not deterministic. Needs SubtleCrypto.',
};

const LABELS: Record<JwsAlgorithm, string> = {
  HS256: 'HS256',
  HS384: 'HS384',
  HS512: 'HS512',
  RS256: 'RS256',
  RS384: 'RS384',
  RS512: 'RS512',
  PS256: 'PS256',
  PS384: 'PS384',
  PS512: 'PS512',
  ES256: 'ES256',
  ES384: 'ES384',
  ES512: 'ES512',
};

/** Every algorithm this tool signs and verifies. The unsecured "none" algorithm is deliberately absent. */
export const ALGORITHMS: AlgorithmInfo[] = (Object.keys(ALGORITHM_PARAMS) as JwsAlgorithm[]).map((id) => {
  const params = ALGORITHM_PARAMS[id];
  return {
    id,
    label: LABELS[id],
    family: algorithmFamilyLabel(id),
    hash: params.hash,
    curve: params.curve,
    note: NOTES[id],
  };
});

function isSupportedAlgorithm(value: string): value is JwsAlgorithm {
  return Object.prototype.hasOwnProperty.call(ALGORITHM_PARAMS, value);
}

const B64URL = /^[A-Za-z0-9_-]*$/;

function base64UrlToBytes(segment: string): Uint8Array {
  for (let i = 0; i < segment.length; i++) {
    if (!B64URL.test(segment[i]!)) {
      throw new JwtSignatureError(
        `This segment is not valid Base64url: the character at position ${i} is not allowed.`,
        i,
      );
    }
  }
  const normalised = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  const binary = padded === '' ? '' : atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Splits a compact JWS into its three segments without decoding them. Throws
 * naming how many segments a compact token has when the count is wrong,
 * never anything about the segments' content.
 */
export function splitCompact(token: string): [string, string, string] {
  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    throw new JwtSignatureError(
      `A compact JWS has three dot-separated segments: header, payload and signature. This has ${parts.length}.`,
    );
  }
  return parts as [string, string, string];
}

export interface SignOptions {
  algorithm: JwsAlgorithm;
}

/**
 * Signs `header` and `payload`, used VERBATIM as the exact bytes to be
 * signed. This takes strings rather than objects on purpose: the JOSE
 * signing input is the specific byte sequence of the header and payload
 * text, including whitespace, and re-serialising an equivalent object would
 * change those bytes and therefore the signature. A caller with an object
 * must serialise it first.
 */
export async function sign(header: string, payload: string, key: CryptoKey, options: SignOptions): Promise<string> {
  // Checked once, at the top: crypto.subtle needs a secure context (https, or
  // localhost) in a browser. requireSecureContext (keys.ts) gives a clear
  // message instead of letting an undefined property throw.
  requireSecureContext();
  const algorithm = options?.algorithm as string | undefined;
  if (algorithm === undefined) {
    throw new JwtSignatureError('sign() requires options.algorithm; there is no default.');
  }
  if (algorithm === 'none') {
    throw new JwtSignatureError(
      'The unsecured "none" algorithm carries no signature at all and cannot be produced by this tool.',
    );
  }
  if (!isSupportedAlgorithm(algorithm)) {
    throw new JwtSignatureError(`"${algorithm}" is not a supported algorithm.`);
  }

  const encodedHeader = bytesToBase64Url(new TextEncoder().encode(header));
  const encodedPayload = bytesToBase64Url(new TextEncoder().encode(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await globalThis.crypto.subtle.sign(
    signVerifyAlgorithmParams(algorithm),
    key,
    new TextEncoder().encode(signingInput) as BufferSource,
  );
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export interface VerifyOptions {
  algorithm: JwsAlgorithm;
}

export type VerifyReason =
  'valid' | 'signature-mismatch' | 'algorithm-disagreement' | 'unsecured-refused' | 'malformed-token' | 'key-error';

export interface VerifyReport {
  valid: boolean;
  reason: VerifyReason;
  /** A plain-English explanation, safe to show a visitor -- never contains token or key content. */
  message: string;
  /** The algorithm the token's own header names, when the header could be read at all. */
  headerAlgorithm?: string;
  /** The algorithm the caller chose to verify under -- always the algorithm actually used. */
  chosenAlgorithm: JwsAlgorithm;
  /** Whether the header's algorithm agrees with the caller's choice. Undefined when the header could not be read. */
  algorithmsAgree?: boolean;
}

/**
 * Verifies a compact JWS. `options.algorithm` is REQUIRED -- not optional on
 * the type, and rejected at runtime when missing too, because a JavaScript
 * caller is not bound by the TypeScript type. The algorithm and the key both
 * come from the caller. The token's own header is read only to report
 * whether it agrees; it never selects the algorithm or the key. The header
 * members `jku`, `jwk` and `kid` are never read here at all -- this function
 * receives an already-imported key from its caller and performs no key
 * import of its own, so there is no code path by which an attacker-supplied
 * `jwk` header could ever reach the platform.
 */
export async function verify(token: string, key: CryptoKey, options: VerifyOptions): Promise<VerifyReport> {
  requireSecureContext();
  const algorithm = options?.algorithm as string | undefined;
  if (algorithm === undefined) {
    throw new JwtSignatureError('verify() requires options.algorithm; there is no default.');
  }
  if (algorithm === 'none') {
    throw new JwtSignatureError(
      'The unsecured "none" algorithm is refused. This tool never verifies an unsigned token.',
    );
  }
  if (!isSupportedAlgorithm(algorithm)) {
    throw new JwtSignatureError(`"${algorithm}" is not a supported algorithm.`);
  }

  let headerRaw: string;
  let payloadRaw: string;
  let signatureRaw: string;
  try {
    [headerRaw, payloadRaw, signatureRaw] = splitCompact(token);
  } catch (err) {
    return {
      valid: false,
      reason: 'malformed-token',
      message: err instanceof JwtSignatureError ? err.message : 'This is not a well-formed compact JWS.',
      chosenAlgorithm: algorithm,
    };
  }

  let headerJson: Record<string, unknown> | undefined;
  try {
    const headerBytes = base64UrlToBytes(headerRaw);
    headerJson = JSON.parse(new TextDecoder().decode(headerBytes)) as Record<string, unknown>;
  } catch {
    return {
      valid: false,
      reason: 'malformed-token',
      message: 'The header segment is not valid Base64url-encoded JSON.',
      chosenAlgorithm: algorithm,
    };
  }

  // The header is read only to compare, never to select. `jku`, `jwk` and
  // `kid` -- an attacker's pointer to a key, an attacker's embedded key, and
  // an attacker's key identifier -- are deliberately never read below.
  const headerAlgorithm = typeof headerJson.alg === 'string' ? headerJson.alg : undefined;

  if (headerAlgorithm === 'none') {
    return {
      valid: false,
      reason: 'unsecured-refused',
      message:
        'The token\'s header claims algorithm "none", meaning it carries no signature. This tool refuses to treat that as verified, no matter which algorithm you chose.',
      headerAlgorithm,
      chosenAlgorithm: algorithm,
      algorithmsAgree: false,
    };
  }

  if (headerAlgorithm !== undefined && headerAlgorithm !== algorithm) {
    return {
      valid: false,
      reason: 'algorithm-disagreement',
      message: `The token's header claims algorithm "${headerAlgorithm}", but you chose to verify it as ${algorithm}. Verification always uses the algorithm you choose, never the token's own header, so a disagreement is reported rather than silently verified under the header's claim.`,
      headerAlgorithm,
      chosenAlgorithm: algorithm,
      algorithmsAgree: false,
    };
  }

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64UrlToBytes(signatureRaw);
  } catch {
    return {
      valid: false,
      reason: 'malformed-token',
      message: 'The signature segment is not valid Base64url.',
      headerAlgorithm,
      chosenAlgorithm: algorithm,
      algorithmsAgree: headerAlgorithm === undefined ? undefined : true,
    };
  }

  const signingInput = new TextEncoder().encode(`${headerRaw}.${payloadRaw}`);

  let valid: boolean;
  try {
    // HMAC verification goes through the platform verifier, not a re-sign-
    // and-compare. Re-signing and comparing the two Base64url strings with
    // `===` is a timing oracle; RFC 7518 section 3.2 requires a
    // constant-time comparison, and `subtle.verify` provides it for every
    // algorithm family, not only HMAC.
    valid = await globalThis.crypto.subtle.verify(
      signVerifyAlgorithmParams(algorithm),
      key,
      signatureBytes as BufferSource,
      signingInput as BufferSource,
    );
  } catch {
    return {
      valid: false,
      reason: 'key-error',
      message: `The signature could not be checked: the supplied key does not fit ${algorithm}.`,
      headerAlgorithm,
      chosenAlgorithm: algorithm,
      algorithmsAgree: headerAlgorithm === undefined ? undefined : true,
    };
  }

  return {
    valid,
    reason: valid ? 'valid' : 'signature-mismatch',
    message: valid ? 'The signature is valid.' : 'The signature does not match.',
    headerAlgorithm,
    chosenAlgorithm: algorithm,
    algorithmsAgree: headerAlgorithm === undefined ? undefined : true,
  };
}

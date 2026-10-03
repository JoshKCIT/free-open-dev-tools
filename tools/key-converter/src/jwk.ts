/**
 * JSON Web Keys (RFC 7517) for RSA (RFC 7518 section 6.3), elliptic curve (RFC 7518 section 6.2) and Ed25519 (RFC 8037
 * section 2) keys, read into the package's own key model.
 *
 * A JWK is untrusted text. It is parsed with JSON.parse (which makes a member called __proto__ an ordinary own property
 * of the result), and every member is looked up with Object.hasOwn on a fixed list of names, so a member or a value named
 * __proto__, constructor or toString finds nothing on Object.prototype. Values must be Base64url strings (RFC 7515
 * section 2); the numbers stay bytes and BigInt from the text to the model and never pass through a JavaScript number.
 *
 * RULE, stated once and enforced by a test: no message thrown or returned from this file may ever contain a fragment
 * of a key, a secret, or a token. Describe the shape of the problem, never the content.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { CURVE_SENTENCE, DOES_NOT_BELONG, curveInfo, ecNormalizePoint, ecPublicFromPrivate, padTo } from './formats';
import { CURVES, KeyConverterError, bytesEqual, isPrivate, type Curve, type KeyModel } from './model';
import { PemError, base64ToBytes, bytesToBase64 } from './pem';
import { checkRsaModulus, completeRsa, trimZeros } from './rsa-math';

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The curves of EC keys by their JWK names, looked up with a Map. */
const JWK_CURVES = new Map<string, Curve>(Array.from(CURVES.keys(), (name) => [name, name]));

/** A string member, or undefined when the member is absent. Only an own property counts. */
function stringMember(jwk: Json, name: string): string | undefined {
  if (!Object.hasOwn(jwk, name)) return undefined;
  const value = jwk[name];
  if (typeof value !== 'string') throw new KeyConverterError(`The JWK member ${name} must be a string.`);
  return value;
}

/** The bytes of a Base64url member, or undefined when it is absent. */
function bytesMember(jwk: Json, name: string): Uint8Array | undefined {
  const text = stringMember(jwk, name);
  if (text === undefined) return undefined;
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(text, { url: true });
  } catch (err) {
    throw new KeyConverterError(
      `The JWK member ${name} is not valid Base64url.`,
      err instanceof PemError ? err.position : undefined,
    );
  }
  if (bytes.length === 0) throw new KeyConverterError(`The JWK member ${name} is empty.`);
  return bytes;
}

function requiredBytes(jwk: Json, name: string): Uint8Array {
  const bytes = bytesMember(jwk, name);
  if (bytes === undefined) throw new KeyConverterError(`The JWK has no member ${name}.`);
  return bytes;
}

function rsaFromJwk(jwk: Json): KeyModel {
  if (Object.hasOwn(jwk, 'oth')) {
    throw new KeyConverterError('Only two-prime RSA keys are supported, and this JWK lists other primes.');
  }
  const n = trimZeros(requiredBytes(jwk, 'n'));
  checkRsaModulus(n);
  const optional = (name: string): Uint8Array | undefined => {
    const bytes = bytesMember(jwk, name);
    return bytes === undefined ? undefined : trimZeros(bytes);
  };
  return completeRsa({
    type: 'rsa',
    n,
    e: trimZeros(requiredBytes(jwk, 'e')),
    d: optional('d'),
    p: optional('p'),
    q: optional('q'),
    dp: optional('dp'),
    dq: optional('dq'),
    qi: optional('qi'),
  });
}

function ecFromJwk(jwk: Json): KeyModel {
  const name = stringMember(jwk, 'crv');
  const curve = name === undefined ? undefined : JWK_CURVES.get(name);
  if (curve === undefined) throw new KeyConverterError(CURVE_SENTENCE);
  const size = curveInfo(curve).size;
  const x = padTo(requiredBytes(jwk, 'x'), size);
  const y = padTo(requiredBytes(jwk, 'y'), size);
  const point = ecNormalizePoint(curve, new Uint8Array([4, ...x, ...y]));
  const secret = bytesMember(jwk, 'd');
  if (secret === undefined) return { type: 'ec', curve, point };
  const d = padTo(secret, size);
  if (!bytesEqual(ecPublicFromPrivate(curve, d), point)) throw new KeyConverterError(DOES_NOT_BELONG);
  return { type: 'ec', curve, point, d };
}

function okpFromJwk(jwk: Json): KeyModel {
  if (stringMember(jwk, 'crv') !== 'Ed25519') throw new KeyConverterError(CURVE_SENTENCE);
  const x = requiredBytes(jwk, 'x');
  if (x.length !== 32) throw new KeyConverterError('An Ed25519 public key is 32 bytes.');
  try {
    ed25519.Point.fromBytes(x);
  } catch {
    throw new KeyConverterError('The public key is not a valid Ed25519 point.');
  }
  const secret = bytesMember(jwk, 'd');
  if (secret === undefined) return { type: 'ed25519', pub: Uint8Array.from(x) };
  if (secret.length !== 32) throw new KeyConverterError('An Ed25519 private key is 32 bytes.');
  const seed = Uint8Array.from(secret);
  if (!bytesEqual(Uint8Array.from(ed25519.getPublicKey(seed)), x)) throw new KeyConverterError(DOES_NOT_BELONG);
  return { type: 'ed25519', pub: Uint8Array.from(x), seed };
}

const KEY_TYPES = new Map<string, (jwk: Json) => KeyModel>([
  ['RSA', rsaFromJwk],
  ['EC', ecFromJwk],
  ['OKP', okpFromJwk],
]);

/** The position V8 names in a JSON syntax error, so the page can point at it. The message text itself is never shown. */
function jsonPosition(err: unknown): number | undefined {
  if (!(err instanceof Error)) return undefined;
  const marker = 'position ';
  const at = err.message.indexOf(marker);
  if (at < 0) return undefined;
  let end = at + marker.length;
  while (end < err.message.length && err.message.charCodeAt(end) >= 48 && err.message.charCodeAt(end) <= 57) end++;
  const digits = err.message.slice(at + marker.length, end);
  return digits === '' || digits.length > 9 ? undefined : Number(digits);
}

/**
 * Reads a JWK, or the first key of a JWK set ({"keys": [...]}); a set also gives a note that says so. Only the
 * members a key needs are read. A private RSA key must carry its prime factors, and dp, dq and qi are computed when they
 * are left out.
 */
export function readJwk(text: string): { key: KeyModel; note?: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    const position = jsonPosition(err);
    throw new KeyConverterError(
      position === undefined
        ? 'This is not valid JSON.'
        : `This is not valid JSON: the problem is at position ${position}.`,
      position,
    );
  }
  if (!isObject(value)) throw new KeyConverterError('A JWK is a JSON object, or a set {"keys": [...]} of them.');
  let jwk = value;
  let note: string | undefined;
  if (Object.hasOwn(value, 'keys')) {
    const keys = value['keys'];
    if (!Array.isArray(keys) || keys.length === 0) throw new KeyConverterError('This JWK set holds no keys.');
    const first: unknown = keys[0];
    if (!isObject(first)) throw new KeyConverterError('The first entry of this JWK set is not a JWK.');
    jwk = first;
    note =
      keys.length === 1
        ? 'This is a JWK set that holds 1 key, and that key was converted.'
        : `This is a JWK set that holds ${keys.length} keys. Only the first key was converted.`;
  }
  const kty = stringMember(jwk, 'kty');
  const reader = kty === undefined ? undefined : KEY_TYPES.get(kty);
  if (reader === undefined) {
    throw new KeyConverterError(
      kty === undefined
        ? 'This JWK has no kty member.'
        : 'This JWK has a key type this page does not read. It reads RSA, EC and OKP keys.',
    );
  }
  const key = reader(jwk);
  return note === undefined ? { key } : { key, note };
}

// ---------------------------------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------------------------------

/** Base64url without padding (RFC 7515 section 2). */
function b64u(bytes: Uint8Array): string {
  return bytesToBase64(bytes, true, false);
}

/** The members of the public JWK, in the lexicographic order RFC 7638 section 3.3 gives for the thumbprint. */
function publicMembers(key: KeyModel): Record<string, string> {
  switch (key.type) {
    case 'rsa':
      return { e: b64u(trimZeros(key.e)), kty: 'RSA', n: b64u(trimZeros(key.n)) };
    case 'ec': {
      const size = curveInfo(key.curve).size;
      // The coordinates are the full size of the curve (RFC 7518 section 6.2.1.2), whatever their leading bytes are.
      return {
        crv: key.curve,
        kty: 'EC',
        x: b64u(key.point.subarray(1, 1 + size)),
        y: b64u(key.point.subarray(1 + size)),
      };
    }
    case 'ed25519':
      return { crv: 'Ed25519', kty: 'OKP', x: b64u(key.pub) };
  }
}

/** The private members, after the public ones. */
function privateMembers(key: KeyModel): Record<string, string> {
  const missing = new KeyConverterError('This key has no private part, so it cannot be written as a private key.');
  switch (key.type) {
    case 'rsa': {
      if (!isPrivate(key)) throw missing;
      return {
        d: b64u(trimZeros(key.d!)),
        p: b64u(trimZeros(key.p!)),
        q: b64u(trimZeros(key.q!)),
        dp: b64u(trimZeros(key.dp!)),
        dq: b64u(trimZeros(key.dq!)),
        qi: b64u(trimZeros(key.qi!)),
      };
    }
    case 'ec':
      if (key.d === undefined) throw missing;
      return { d: b64u(padTo(key.d, curveInfo(key.curve).size)) };
    case 'ed25519':
      if (key.seed === undefined) throw missing;
      return { d: b64u(key.seed) };
  }
}

/**
 * The JWK of a key as JSON text with two-space indentation. The public members come first in the order of RFC 7638
 * (which is also the order the thumbprint is computed from), then the private members when `private` is true. EC
 * coordinates and private numbers are the full size of the curve (32, 48 or 66 bytes), and RSA numbers are Base64urlUInt
 * (no leading zero byte, RFC 7518 section 6.3.1.1).
 */
export function writeJwk(key: KeyModel, options: { private: boolean }): string {
  const members = options.private ? { ...publicMembers(key), ...privateMembers(key) } : publicMembers(key);
  return JSON.stringify(members, null, 2);
}

/**
 * The JWK SHA-256 thumbprint of RFC 7638, as Base64url: the digest of the compact JSON of the required public members in
 * lexicographic order (for an Ed25519 key those of RFC 8037 section 2).
 */
export function jwkThumbprint(key: KeyModel): string {
  return b64u(sha256(new TextEncoder().encode(JSON.stringify(publicMembers(key)))));
}

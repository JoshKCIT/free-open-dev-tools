/**
 * PostgreSQL's SCRAM-SHA-256 stored-secret format (RFC 5802 section 3,
 * RFC 7677), the default password format since PostgreSQL 14.
 *
 * `SaltedPassword = PBKDF2-HMAC-SHA256(password, salt, iterations, 32)`
 * `ClientKey = HMAC-SHA256(SaltedPassword, "Client Key")`
 * `StoredKey = SHA-256(ClientKey)`
 * `ServerKey = HMAC-SHA256(SaltedPassword, "Server Key")`
 *
 * Stored form: `SCRAM-SHA-256$<iterations>:<salt base64>$<StoredKey
 * base64>:<ServerKey base64>`, standard Base64 with padding throughout.
 */
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { DbHashError } from './errors';
import { saslprep } from './saslprep';

export const SCRAM_ITERATIONS = { min: 1, max: 1_000_000, default: 4096 } as const;

const KEY_LEN = 32;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

const STRICT_B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Strict standard Base64 (with padding) decoding, naming which field failed. */
function fromBase64(text: string, fieldLabel: string): Uint8Array {
  if (text.length === 0 || text.length % 4 !== 0 || !STRICT_B64.test(text)) {
    throw new DbHashError(`The ${fieldLabel} field is not valid Base64.`);
  }
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    throw new DbHashError(`The ${fieldLabel} field is not valid Base64.`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DbHashError('The run was cancelled.');
}

/** SaltedPassword -> { storedKey, serverKey }, the computation shared by generation and verification. */
export async function scramKeys(
  preparedPasswordBytes: Uint8Array,
  salt: Uint8Array,
  iterations: number,
): Promise<{ storedKey: Uint8Array; serverKey: Uint8Array }> {
  const saltedPassword = await pbkdf2Async(sha256, preparedPasswordBytes, salt, { c: iterations, dkLen: KEY_LEN });
  const clientKey = hmac(sha256, saltedPassword, new TextEncoder().encode('Client Key'));
  const storedKey = sha256(clientKey);
  const serverKey = hmac(sha256, saltedPassword, new TextEncoder().encode('Server Key'));
  return { storedKey, serverKey };
}

export interface ScramOptions {
  /** 16 random bytes when omitted. A visitor-supplied salt as Base64 text, or raw bytes. */
  salt?: Uint8Array | string;
  iterations?: number;
  signal?: AbortSignal;
}

export interface ScramResult {
  /** `SCRAM-SHA-256$<iterations>:<salt b64>$<StoredKey b64>:<ServerKey b64>` */
  stored: string;
  iterations: number;
  saltBase64: string;
  prep: { changed: boolean; asciiOnly: boolean };
  warnings: string[];
}

function resolveIterations(iterations: number | undefined): number {
  const value = iterations ?? SCRAM_ITERATIONS.default;
  if (!Number.isInteger(value) || value < SCRAM_ITERATIONS.min || value > SCRAM_ITERATIONS.max) {
    throw new DbHashError(
      `Iterations must be a whole number from ${SCRAM_ITERATIONS.min} to ${SCRAM_ITERATIONS.max.toLocaleString('en-US')}.`,
    );
  }
  return value;
}

function resolveSalt(salt: Uint8Array | string | undefined): Uint8Array {
  if (salt === undefined) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  if (typeof salt !== 'string') {
    if (salt.length === 0) throw new DbHashError('The salt cannot be empty.');
    return salt;
  }
  if (salt.length === 0) throw new DbHashError('The salt cannot be empty.');
  return fromBase64(salt, 'salt');
}

export async function scramSha256(password: string, opts: ScramOptions = {}): Promise<ScramResult> {
  if (password === '') throw new DbHashError('Enter a password.');
  checkAbort(opts.signal);
  const iterations = resolveIterations(opts.iterations);
  const salt = resolveSalt(opts.salt);

  const prep = saslprep(password);
  const warnings: string[] = [];
  if (!prep.asciiOnly) {
    warnings.push(
      "This password contains non-ASCII characters. This tool applies SASLprep mapping and NFKC as PostgreSQL does, but PostgreSQL's own SASLprep may differ for right-to-left text or unassigned characters: test a login before relying on this hash.",
    );
  }

  const { storedKey, serverKey } = await scramKeys(new TextEncoder().encode(prep.value), salt, iterations);
  checkAbort(opts.signal);

  const saltBase64 = toBase64(salt);
  const stored = `SCRAM-SHA-256$${iterations}:${saltBase64}$${toBase64(storedKey)}:${toBase64(serverKey)}`;
  return { stored, iterations, saltBase64, prep: { changed: prep.changed, asciiOnly: prep.asciiOnly }, warnings };
}

export interface ParsedScram {
  iterations: number;
  salt: Uint8Array;
  storedKey: Uint8Array;
  serverKey: Uint8Array;
}

const UNRECOGNISED_MESSAGE =
  'This is not a stored hash this tool recognises. Expected SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>, ' +
  'md5 followed by 32 hex digits, or * followed by 40 hex digits.';

/** Parses a `SCRAM-SHA-256$...` stored secret. Every malformed case names what is wrong. */
export function parseScram(stored: string): ParsedScram {
  const trimmed = stored.trim();
  if (!trimmed.startsWith('SCRAM-SHA-256$')) {
    throw new DbHashError(UNRECOGNISED_MESSAGE);
  }
  const rest = trimmed.slice('SCRAM-SHA-256$'.length);
  const dollarParts = rest.split('$');
  if (dollarParts.length !== 2) {
    throw new DbHashError(
      'A SCRAM-SHA-256 stored secret must have exactly two "$"-separated sections after the algorithm name.',
    );
  }
  const [iterSaltPart, keysPart] = dollarParts as [string, string];
  const colonParts1 = iterSaltPart.split(':');
  if (colonParts1.length !== 2) {
    throw new DbHashError('The iteration count and salt section must be "<iterations>:<salt>".');
  }
  const [iterText, saltB64] = colonParts1 as [string, string];
  if (!/^\d+$/.test(iterText)) {
    throw new DbHashError('The iteration count is not a whole number.');
  }
  const iterations = Number(iterText);
  if (iterations < SCRAM_ITERATIONS.min || iterations > SCRAM_ITERATIONS.max) {
    throw new DbHashError(
      `The iteration count (${iterations}) is outside the range this tool accepts, ${SCRAM_ITERATIONS.min} to ${SCRAM_ITERATIONS.max.toLocaleString('en-US')}.`,
    );
  }
  const salt = fromBase64(saltB64, 'salt');

  const colonParts2 = keysPart.split(':');
  if (colonParts2.length !== 2) {
    throw new DbHashError('The StoredKey and ServerKey section must be "<StoredKey>:<ServerKey>".');
  }
  const [storedKeyB64, serverKeyB64] = colonParts2 as [string, string];
  const storedKey = fromBase64(storedKeyB64, 'StoredKey');
  if (storedKey.length !== KEY_LEN) {
    throw new DbHashError(`StoredKey must decode to ${KEY_LEN} bytes; this one decodes to ${storedKey.length}.`);
  }
  const serverKey = fromBase64(serverKeyB64, 'ServerKey');
  if (serverKey.length !== KEY_LEN) {
    throw new DbHashError(`ServerKey must decode to ${KEY_LEN} bytes; this one decodes to ${serverKey.length}.`);
  }

  return { iterations, salt, storedKey, serverKey };
}

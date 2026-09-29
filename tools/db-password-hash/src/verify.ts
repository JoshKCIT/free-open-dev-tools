/**
 * Detects which of the three stored-hash kinds a pasted value is, then
 * checks a candidate password against it with a constant-time comparison
 * (T-j95-08: stored-hash verification must not leak a timing oracle).
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { DbHashError } from './errors';
import { saslprep } from './saslprep';
import { scramKeys, parseScram } from './scram';
import { postgresMd5, mysqlNativePassword } from './legacy';

export type StoredHashKind = 'scram-sha-256' | 'postgres-md5' | 'mysql-native';

const MD5_RE = /^md5[0-9a-fA-F]{32}$/;
const NATIVE_RE = /^\*[0-9a-fA-F]{40}$/;

const UNRECOGNISED_MESSAGE =
  'This is not a stored hash this tool recognises. Expected SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>, ' +
  'md5 followed by 32 hex digits, or * followed by 40 hex digits.';

export function detectKind(stored: string): StoredHashKind {
  const trimmed = stored.trim();
  if (trimmed.startsWith('SCRAM-SHA-256$')) return 'scram-sha-256';
  if (MD5_RE.test(trimmed)) return 'postgres-md5';
  if (NATIVE_RE.test(trimmed)) return 'mysql-native';
  throw new DbHashError(UNRECOGNISED_MESSAGE);
}

/** Constant-time byte comparison. A length mismatch returns false immediately -- lengths are not secret. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export interface VerifyOptions {
  /** Required when the stored hash is a PostgreSQL md5 hash. */
  role?: string;
  signal?: AbortSignal;
}

export interface VerifyResult {
  kind: StoredHashKind;
  match: boolean;
  /** Present for SCRAM-SHA-256 only. */
  iterations?: number;
  warnings: string[];
}

const MATCH_MESSAGE = 'Match: this password produces the stored hash.';
const NO_MATCH_MESSAGE = 'No match: this password does not produce the stored hash.';
export { MATCH_MESSAGE, NO_MATCH_MESSAGE };

export async function verifyStoredHash(
  stored: string,
  password: string,
  opts: VerifyOptions = {},
): Promise<VerifyResult> {
  if (password === '') throw new DbHashError('Enter a password.');
  const kind = detectKind(stored);
  const warnings: string[] = [];

  if (kind === 'scram-sha-256') {
    const parsed = parseScram(stored.trim());
    const prep = saslprep(password);
    if (!prep.asciiOnly) {
      warnings.push(
        "This password contains non-ASCII characters. This tool applies SASLprep mapping and NFKC as PostgreSQL does, but PostgreSQL's own SASLprep may differ for right-to-left text or unassigned characters: test a login before relying on this result.",
      );
    }
    if (opts.signal?.aborted) throw new DbHashError('The run was cancelled.');
    const { storedKey, serverKey } = await scramKeys(
      new TextEncoder().encode(prep.value),
      parsed.salt,
      parsed.iterations,
    );
    if (opts.signal?.aborted) throw new DbHashError('The run was cancelled.');
    const match = constantTimeEqual(storedKey, parsed.storedKey) && constantTimeEqual(serverKey, parsed.serverKey);
    return { kind, match, iterations: parsed.iterations, warnings };
  }

  if (kind === 'postgres-md5') {
    if (!opts.role) {
      throw new DbHashError(
        'A PostgreSQL md5 hash is salted with the role name: enter the role name it was created for.',
      );
    }
    const candidate = postgresMd5(password, opts.role);
    const match = constantTimeEqual(hexTail(candidate, 3), hexTail(stored.trim(), 3));
    return { kind, match, warnings };
  }

  // mysql-native
  const candidate = mysqlNativePassword(password);
  const match = constantTimeEqual(hexTail(candidate, 1), hexTail(stored.trim(), 1));
  return { kind, match, warnings };
}

/** Decodes the hex digest after a fixed-length prefix (3 for "md5", 1 for "*") into raw bytes. */
function hexTail(text: string, prefixLength: number): Uint8Array {
  const hexPart = text.slice(prefixLength);
  const out = new Uint8Array(hexPart.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hexPart.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// Re-exported so callers of `sha256`/`hmac` in this module's own tests (a
// differential check on the digest primitives themselves) don't need a
// second import of `@noble/hashes` for the same functions this file uses.
export { sha256, hmac };

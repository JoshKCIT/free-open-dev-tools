import { hash as bcryptHash, compare as bcryptCompare } from 'bcrypt-ts';
import meta from './meta.json';

export { meta };

/**
 * Thrown for anything this package rejects itself: an out-of-range or
 * non-integer cost, or a string that is not shaped like a bcrypt hash. The
 * page never lets a raw error from `bcrypt-ts` reach the visitor; every
 * failure this package can produce is one of these, with a message that
 * explains the problem rather than echoing the library's own wording.
 */
export class BcryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BcryptError';
  }
}

export interface CostRange {
  min: number;
  max: number;
  default: number;
}

/**
 * D-06's generation bounds. The algorithm itself (and `bcrypt-ts`, read
 * directly in `hash.ts`) allows 4 to 31; this tool narrows *generation* to
 * 4-15 with a default of 10, because a cost in the twenties in a browser
 * tab is a very long wait with no way out. Verification is unbounded — see
 * `verifyPassword`, which reads the cost out of the pasted hash and never
 * consults this range.
 */
export const COST_RANGE: CostRange = { min: 4, max: 15, default: 10 };

/** The number of UTF-8 bytes of a password bcrypt actually uses. Everything after this is ignored. */
const MAX_PASSWORD_BYTES = 72;

/**
 * The shape every bcrypt hash this tool accepts takes: `$2`, an optional
 * one-letter minor version (`a`, `b`, `x` or `y`), `$`, a two-digit cost,
 * `$`, then 53 base64-alphabet characters combining the 16-byte salt and
 * the 23-byte digest. This is checked here, before the hash ever reaches
 * `bcrypt-ts`, so a malformed paste gets a message describing what a
 * bcrypt hash looks like instead of an uncaught throw from the library (its
 * own salt parser throws synchronously on some malformed input) or a
 * silent `false` (its `compare()` resolves `false` for any hash whose
 * length isn't exactly 60, which reads as "wrong password" rather than
 * "not a hash").
 */
const HASH_SHAPE = /^\$2([abxy]?)\$(\d{2})\$([./A-Za-z0-9]{53})$/;

const BAD_SHAPE_MESSAGE =
  'This does not look like a bcrypt hash. A bcrypt hash looks like $2b$10$ followed by 53 more ' +
  'characters combining the salt and the digest, for example ' +
  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy.';

interface ParsedHash {
  /** '' for the bare `$2$` tag, otherwise 'a' | 'b' | 'x' | 'y'. */
  minor: string;
  cost: number;
  saltAndDigest: string;
}

function parseHashShape(hash: unknown): ParsedHash {
  if (typeof hash !== 'string') throw new BcryptError(BAD_SHAPE_MESSAGE);
  const trimmed = hash.trim();
  const m = HASH_SHAPE.exec(trimmed);
  if (!m) throw new BcryptError(BAD_SHAPE_MESSAGE);
  return { minor: m[1]!, cost: Number(m[2]), saltAndDigest: m[3]! };
}

export interface TagNormalisation {
  /** The hash with its tag rewritten to one `bcrypt-ts` accepts. Cost, salt and digest are untouched. */
  hash: string;
  wasNormalised: boolean;
  /** The tag as it was in the pasted hash: '2', '2a', '2b', '2x' or '2y'. */
  originalTag: string;
  cost: number;
}

/**
 * Rewrites a `$2x$` tag to `$2a$` so `bcrypt-ts` will parse the hash at
 * all — its salt parser only accepts a bare `$2$` or minor version `a`,
 * `b` or `y`, and throws synchronously on `x` (`02-RESEARCH.md` Pitfall
 * 1, read directly from the library's `hash.ts`). Once past that check the
 * library treats every accepted minor version identically: verification
 * only has to reproduce the stored digest, not echo the original tag back,
 * so rewriting the tag and leaving the salt and digest alone is enough to
 * let a `$2x$` hash verify. Every other accepted tag passes through
 * unchanged. Throws for anything not shaped like a bcrypt hash.
 */
export function normaliseTag(hash: string): TagNormalisation {
  const parsed = parseHashShape(hash);
  const originalTag = `2${parsed.minor}`;
  if (parsed.minor === 'x') {
    const costText = parsed.cost < 10 ? `0${parsed.cost}` : String(parsed.cost);
    return {
      hash: `$2a$${costText}$${parsed.saltAndDigest}`,
      wasNormalised: true,
      originalTag,
      cost: parsed.cost,
    };
  }
  return { hash: hash.trim(), wasNormalised: false, originalTag, cost: parsed.cost };
}

export interface TruncationReport {
  /** The password's own length in UTF-8 bytes, before any truncation. */
  byteLength: number;
  /** True when the password is longer than bcrypt will ever use. */
  truncated: boolean;
  /** How many trailing bytes bcrypt ignores. 0 when not truncated. */
  ignoredBytes: number;
  /**
   * True when byte 72 (the boundary bcrypt truncates at) falls inside a
   * multi-byte character rather than between two characters, so the
   * character spanning the boundary is not itself included.
   */
  splitsCharacter: boolean;
}

/**
 * Reports, but never performs, bcrypt's 72-byte truncation. `bcrypt-ts`'s
 * key schedule (`crypt.ts`, read directly this session) always reads
 * exactly 72 bytes starting from byte 0 of the password on every pass — a
 * structural consequence of its key-mixing loop running exactly 18 times
 * at 4 bytes each, with the read offset reset to 0 on each call — so bytes
 * beyond the 72nd are never consulted at all. Confirmed empirically this
 * session: `compareSync` of two passwords sharing the first 72 bytes and
 * differing only after them, against a hash of either one, both return
 * true.
 *
 * This function never truncates the string itself and never re-encodes
 * it: decoding a byte-truncated buffer back to a string can strand a lead
 * byte of a multi-byte character with no correct repair (encode,
 * cut at 72 bytes, decode "safely" all disagree on what to do with a
 * stranded continuation byte, and would hash a different password from
 * the one the tool tells the visitor it hashed). `hashPassword` and
 * `verifyPassword` always pass the original string to `bcrypt-ts`
 * unchanged; this function only computes what happened.
 */
export function truncateToLimit(password: string): TruncationReport {
  if (typeof password !== 'string') throw new BcryptError('Password must be a string.');
  const bytes = new TextEncoder().encode(password);
  const byteLength = bytes.length;
  const truncated = byteLength > MAX_PASSWORD_BYTES;
  const ignoredBytes = truncated ? byteLength - MAX_PASSWORD_BYTES : 0;
  // The first ignored byte (index MAX_PASSWORD_BYTES) is a UTF-8
  // continuation byte (top two bits 10) exactly when the character that
  // straddles the boundary has some of its bytes kept and some cut.
  const firstIgnoredByte = truncated ? bytes[MAX_PASSWORD_BYTES]! : undefined;
  const splitsCharacter = truncated && firstIgnoredByte !== undefined && (firstIgnoredByte & 0xc0) === 0x80;
  return { byteLength, truncated, ignoredBytes, splitsCharacter };
}

/**
 * A rough order-of-magnitude duration for hashing at a given cost, in
 * milliseconds. Not a promise: hardware varies enormously, and this is
 * meant to warn a visitor before they choose a slow cost, not to predict
 * their machine exactly.
 *
 * Baseline measured this session (2026-09-24) on the machine this tool
 * was built on, Node 22, via `bcrypt-ts`'s synchronous `hashSync` hashing
 * "correct horse battery staple": cost 10 took 62ms. bcrypt's cost factor
 * is defined as a power of two (`rounds = 2^cost` key-schedule
 * iterations, confirmed directly in `crypt.ts`), so each step up doubles
 * the work; the rest of the range is derived from that one measurement
 * rather than measured individually.
 */
const BASELINE_COST = 10;
const BASELINE_MS = 62;

export function estimateCostDuration(cost: number): number {
  return BASELINE_MS * Math.pow(2, cost - BASELINE_COST);
}

function assertIntegerCost(cost: unknown): asserts cost is number {
  if (typeof cost !== 'number' || !Number.isInteger(cost)) {
    throw new BcryptError(`Cost must be a whole number, got ${JSON.stringify(cost)}.`);
  }
}

function assertGenerationCost(cost: number): void {
  assertIntegerCost(cost);
  if (cost < COST_RANGE.min || cost > COST_RANGE.max) {
    throw new BcryptError(
      `Cost must be between ${COST_RANGE.min} and ${COST_RANGE.max} (got ${cost}). This tool bounds ` +
        'generation to keep a browser tab from locking up for a very long time; the algorithm itself ' +
        'allows up to 31.',
    );
  }
}

/**
 * Wraps whatever `bcrypt-ts` itself rejects with (an out-of-range cost
 * baked into a pasted hash, an illegal salt) into a `BcryptError`, so
 * nothing from the library reaches a caller as an uncaught or
 * unrecognisable error.
 */
function wrapLibraryError(err: unknown): never {
  if (err instanceof BcryptError) throw err;
  const detail = err instanceof Error ? err.message : String(err);
  throw new BcryptError(`This hash could not be processed: ${detail}`);
}

export interface HashOptions {
  /** Fired with a fraction between 0 and 1 as the library completes rounds. Fires at most ~10 times a second. */
  onProgress?(fraction: number): void;
  /**
   * Checked before hashing starts (rejects immediately if already
   * aborted) and again once hashing finishes (rejects rather than
   * resolving). `bcrypt-ts` exposes no way to interrupt work already in
   * progress, so this signal cannot stop a hash that is already running —
   * real cancellation of a running hash comes only from terminating the
   * worker it runs on, which is the page's job, not this package's.
   */
  signal?: AbortSignal;
}

export interface HashReport {
  hash: string;
  cost: number;
  /** Generation always produces this tag. D-07: never a tag known to be wrong. */
  tag: '2b';
  truncation: TruncationReport;
}

/**
 * Hashes a password at the given cost. Always produces a `$2b$` hash —
 * `bcrypt-ts`'s own salt generator always uses that tag — never one of
 * the other historical tags, which only `verifyPassword` accepts.
 *
 * Promise-returning, matching `bcrypt-ts`'s own API. See `HashOptions` for
 * exactly what `signal` does and does not guarantee.
 */
export async function hashPassword(password: string, cost: number, options: HashOptions = {}): Promise<HashReport> {
  if (typeof password !== 'string') throw new BcryptError('Password must be a string.');
  assertGenerationCost(cost);
  if (options.signal?.aborted) throw new BcryptError('The run was cancelled before it started.');

  const truncation = truncateToLimit(password);
  let hash: string;
  try {
    hash = await bcryptHash(password, cost, options.onProgress);
  } catch (err) {
    wrapLibraryError(err);
  }

  if (options.signal?.aborted) throw new BcryptError('The run was cancelled.');
  return { hash, cost, tag: '2b', truncation };
}

export type VerifyOutcome = 'correct' | 'incorrect' | 'cannot-check';

export interface VerifyReport {
  outcome: VerifyOutcome;
  cost: number;
  /** The tag as it appeared in the pasted hash, before normalisation: '2', '2a', '2b', '2x' or '2y'. */
  tag: string;
  wasNormalised: boolean;
  /** Present only when `outcome` is 'cannot-check', explaining why this tool refuses to guess. */
  message?: string;
}

export interface VerifyOptions {
  onProgress?(fraction: number): void;
  signal?: AbortSignal;
}

/** True when any UTF-8 byte of the password is 0x80 or above (i.e. the password is not pure ASCII). */
function hasHighByte(password: string): boolean {
  const bytes = new TextEncoder().encode(password);
  for (const b of bytes) if (b >= 0x80) return true;
  return false;
}

const CANNOT_CHECK_MESSAGE =
  'This tool cannot check this hash for this password. The $2x$ tag marks a hash made by an old, ' +
  'buggy bcrypt implementation that mishandled password bytes at 0x80 or above (a sign-extension ' +
  'bug in the original C code). The library this tool uses does not expose a way to reproduce that ' +
  'bug, and reporting this as a mismatch when it might in fact be right would be a wrong answer ' +
  'presented as a right one — worse than refusing. Only $2x$ hashes checked against a password ' +
  'containing a byte at or above 0x80 are affected; every other tag, and every ASCII-only password, ' +
  'verifies normally.';

/**
 * Verifies a password against a hash carrying any of the tags the
 * algorithm has used: `$2$`, `$2a$`, `$2b$`, `$2x$` or `$2y$` (D-07). The
 * cost comes from the hash itself, so a hash from a production system at
 * a cost far above this tool's own generation maximum still verifies.
 *
 * D-07 was narrowed by the owner (`02-CONTEXT.md`, 2026-09-22): a `$2x$`
 * verifier that does not reproduce the sign-extension bug must never
 * report "incorrect" for a password that is in fact correct. This
 * package took **route 2**: `bcrypt-ts`'s key-mixing step masks every
 * byte with `& 0xff` (read directly in `crypt.ts`) and the library
 * exports no way to supply pre-mangled key bytes, so reproducing the
 * historical sign-extension behaviour (route 1) is not reachable through
 * its public API without hand-rolling the Blowfish key schedule, which
 * `docs/ARCHITECTURE.md` forbids. Instead, a `$2x$` hash checked against
 * a password containing any byte at or above 0x80 returns the explicit
 * `'cannot-check'` outcome rather than a verdict. ASCII-only `$2x$`
 * verification is unaffected and returns a real verdict either way,
 * because sign-extending a byte below 0x80 does not change its value.
 *
 * **A second, independently discovered defect this function also works
 * around.** `bcrypt-ts`'s own `compare()`/`compareSync()` hard-code
 * `if (hash.length !== 60) return false` (read directly in `compare.ts`),
 * but a bare `$2$` hash — no minor version letter — is 59 characters, one
 * shorter. Confirmed empirically this session: calling the library's own
 * `compare()` with a hash it had itself just produced from a bare-tag
 * salt returns `false` for the password that hash was made from. Worse,
 * the bare tag cannot simply be relabelled to `$2a$`/`$2b$`/`$2y$` the
 * way `$2x$` is: `hashString()` (`hash.ts`) appends an extra NUL byte to
 * the password for every tag `>= 'a'` but not for the bare tag, so a bare
 * hash's digest is computed from different bytes than an `a`/`b`/`y`
 * hash of the same password, salt and cost — confirmed empirically by
 * hashing the same password under all four tags and comparing digests
 * directly. Relabelling would silently change what is being checked. The
 * fix: for a bare-tag hash, call `hash()` directly with the hash's own
 * salt portion (bypassing `compare()`'s broken length gate entirely) and
 * compare the resulting string to the original hash.
 */
export async function verifyPassword(
  password: string,
  hash: string,
  options: VerifyOptions = {},
): Promise<VerifyReport> {
  if (typeof password !== 'string') throw new BcryptError('Password must be a string.');
  if (options.signal?.aborted) throw new BcryptError('The run was cancelled before it started.');

  const parsed = parseHashShape(hash);
  const trimmedHash = hash.trim();
  const originalTag = `2${parsed.minor}`;

  if (originalTag === '2x' && hasHighByte(password)) {
    return {
      outcome: 'cannot-check',
      cost: parsed.cost,
      tag: originalTag,
      wasNormalised: false,
      message: CANNOT_CHECK_MESSAGE,
    };
  }

  let matches: boolean;
  try {
    if (parsed.minor === '') {
      // Bare tag: bypass compare()'s broken length gate by recomputing
      // directly against this hash's own salt spec and comparing strings.
      const saltSpec = trimmedHash.slice(0, trimmedHash.length - 31);
      const recomputed = await bcryptHash(password, saltSpec, options.onProgress);
      matches = recomputed === trimmedHash;
    } else if (parsed.minor === 'x') {
      const normalised = normaliseTag(trimmedHash);
      matches = await bcryptCompare(password, normalised.hash, options.onProgress);
    } else {
      matches = await bcryptCompare(password, trimmedHash, options.onProgress);
    }
  } catch (err) {
    wrapLibraryError(err);
  }

  if (options.signal?.aborted) throw new BcryptError('The run was cancelled.');
  return {
    outcome: matches ? 'correct' : 'incorrect',
    cost: parsed.cost,
    tag: originalTag,
    wasNormalised: originalTag === '2x',
  };
}

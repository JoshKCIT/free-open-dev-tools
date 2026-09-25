import { hash as bcryptHash } from 'bcrypt-ts';
import { assertSingleLine } from './safe-value';

/**
 * Thrown for anything this package itself rejects: a malformed user name,
 * realm or path, a redirect or cache line that cannot be parsed, an option
 * outside its documented range. Defined here (not in index.ts) because
 * `htpasswd.ts` throws it too; `index.ts` re-exports the same class rather
 * than defining a second one, so `err instanceof HtaccessError` holds no
 * matter which function threw.
 */
export class HtaccessError extends Error {
  readonly field?: string;
  readonly line?: number;

  constructor(message: string, detail: { field?: string; line?: number } = {}) {
    super(message);
    this.name = 'HtaccessError';
    this.field = detail.field;
    this.line = detail.line;
  }
}

export interface HtpasswdCostRange {
  min: number;
  max: number;
  default: number;
}

/**
 * Apache's own htpasswd program page (programs/htpasswd.html, fetched
 * 2026-09-25): "-C ... It sets the computing time used for the bcrypt
 * algorithm (higher is more secure but slower, default: 5, valid: 4 to
 * 17)." This tool keeps Apache's own default of 5, but narrows the ceiling
 * to 15 -- one below Apache's own 17 -- because each cost step doubles the
 * work (`tools/bcrypt/src/index.ts`'s `COST_RANGE` comment gives the same
 * reasoning for its own, separately-chosen ceiling) and this hash is made
 * in a browser tab, not a command-line tool with no responsiveness to lose.
 */
export const HTPASSWD_COST: HtpasswdCostRange = { min: 4, max: 15, default: 5 };

/** The number of UTF-8 bytes of a password bcrypt actually uses. Everything after this is ignored. */
const MAX_PASSWORD_BYTES = 72;

export interface HtpasswdLineResult {
  /** `user:hash`, tagged `$2y$` (D-97). Never contains the password. */
  line: string;
  cost: number;
  warnings: string[];
}

function assertIntegerCost(cost: unknown): asserts cost is number {
  if (typeof cost !== 'number' || !Number.isInteger(cost)) {
    throw new HtaccessError(`Cost must be a whole number, got ${JSON.stringify(cost)}.`, { field: 'cost' });
  }
}

/**
 * Makes one `user:hash` `.htpasswd` line (D-95). Hashes with `bcrypt-ts`,
 * which always tags its output `$2b$`, then relabels only the three-byte
 * tag to `$2y$` -- never the cost, salt or digest -- because Apache's own
 * `htpasswd -B` writes `$2y$` (D-97): `$2b$` and `$2y$` are the same
 * algorithm, so the relabelled line verifies exactly like the original
 * `$2b$` hash and against every Apache 2.4 build's own `apr-util`.
 *
 * Apache's programs/htpasswd.html (fetched 2026-09-25): "Usernames are
 * limited to 255 bytes and may not include the character :." -- checked
 * here, before hashing starts, using the character length of the string
 * this project reads (a JavaScript string), not a byte count. The password
 * is never included in the returned line, in `warnings`, or in any thrown
 * error message.
 */
export async function htpasswdLine(user: string, password: string, cost: number): Promise<HtpasswdLineResult> {
  if (typeof user !== 'string') throw new HtaccessError('Username must be a string.', { field: 'username' });
  assertSingleLine(user, 'Username');
  if (user.length === 0) throw new HtaccessError('Username cannot be empty.', { field: 'username' });
  if (user.includes(':')) {
    throw new HtaccessError(
      'A username cannot contain a colon: htpasswd uses it as the separator between the name and the hash.',
      { field: 'username' },
    );
  }
  if (user.length > 255) {
    throw new HtaccessError("Apache's htpasswd program limits usernames to 255 bytes; this one is longer.", {
      field: 'username',
    });
  }

  if (typeof password !== 'string') throw new HtaccessError('Password must be a string.', { field: 'password' });
  if (password.length === 0) throw new HtaccessError('Password cannot be empty.', { field: 'password' });

  assertIntegerCost(cost);
  if (cost < HTPASSWD_COST.min || cost > HTPASSWD_COST.max) {
    throw new HtaccessError(`Cost must be between ${HTPASSWD_COST.min} and ${HTPASSWD_COST.max} (got ${cost}).`, {
      field: 'cost',
    });
  }

  const warnings: string[] = [];
  const byteLength = new TextEncoder().encode(password).length;
  if (byteLength > MAX_PASSWORD_BYTES) {
    warnings.push(
      `This password is ${byteLength} bytes; bcrypt only reads the first ${MAX_PASSWORD_BYTES}. Everything after that is ignored.`,
    );
  }

  let hash2b: string;
  try {
    hash2b = await bcryptHash(password, cost);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new HtaccessError(`Could not hash this password: ${detail}`, { field: 'password' });
  }
  // hash2b always starts "$2b$NN$..." (bcrypt-ts's own tag, see
  // tools/bcrypt/src/index.ts's identical HashReport.tag comment). Relabel
  // only that four-character prefix; cost, salt and digest are untouched.
  const hash2y = `$2y$${hash2b.slice(4)}`;

  return { line: `${user}:${hash2y}`, cost, warnings };
}

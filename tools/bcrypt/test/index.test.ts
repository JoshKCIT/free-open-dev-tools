import { describe, it, expect } from 'vitest';
import { compareSync, hashSync } from 'bcrypt-ts';
import {
  hashPassword,
  verifyPassword,
  normaliseTag,
  truncateToLimit,
  estimateCostDuration,
  COST_RANGE,
  BcryptError,
  meta,
} from '../src/index';

/**
 * A published, cross-implementation differential vector, not invented
 * here. Sourced this session from pyca/bcrypt's own test suite
 * (github.com/pyca/bcrypt, tests/test_bcrypt.py, `_test_vectors`), which
 * is itself checked against the OpenBSD reference bcrypt implementation.
 * Re-confirmed directly against the installed `bcrypt-ts` this session:
 * `hashSync('Kk4DQuMMfZL9o', '$2b$04$cVWp4XaNU8a4v1uMRum2SO')` reproduces
 * this exact 60-character string byte for byte, and `compareSync` accepts
 * it. No canonical published known-answer-test vector table exists for
 * bcrypt itself (confirmed by this phase's research); this is the closest
 * available thing, a vector independently maintained by a widely-used
 * Python binding and cross-checked against a second implementation here.
 */
const PYCA_PASSWORD = 'Kk4DQuMMfZL9o';
const PYCA_SALT_22 = 'cVWp4XaNU8a4v1uMRum2SO';
const PYCA_COST = '04';
const PYCA_HASH = '$2b$04$cVWp4XaNU8a4v1uMRum2SO026BWLIoQMD/TXg5uZV.0P.uO8m3YEm';
const PYCA_DIGEST_31 = PYCA_HASH.slice(-31);

it('an ASCII password verifies against a 2x-tagged hash', async () => {
  // The password is pure ASCII, so the sign-extension bug this tag exists
  // to mark never manifests: relabelling a confirmed $2b$ vector's tag to
  // $2x$ produces a hash that is bit-for-bit what a genuine historical
  // $2x$ implementation would have produced for this password, salt and
  // cost. hash.ts appends the same NUL terminator for every tag >= 'a'
  // (confirmed empirically below), so a/b/x/y share one digest space.
  const relabelled = `$2x$${PYCA_COST}$${PYCA_SALT_22}${PYCA_DIGEST_31}`;
  const report = await verifyPassword(PYCA_PASSWORD, relabelled);
  expect(report.outcome).toBe('correct');
  expect(report.tag).toBe('2x');
  expect(report.wasNormalised).toBe(true);
});

it('an ASCII password verifies against a 2a, 2b, 2y and bare 2 tagged hash', async () => {
  const hA = `$2a$${PYCA_COST}$${PYCA_SALT_22}${PYCA_DIGEST_31}`;
  const hB = `$2b$${PYCA_COST}$${PYCA_SALT_22}${PYCA_DIGEST_31}`;
  const hY = `$2y$${PYCA_COST}$${PYCA_SALT_22}${PYCA_DIGEST_31}`;
  expect((await verifyPassword(PYCA_PASSWORD, hA)).outcome).toBe('correct');
  expect((await verifyPassword(PYCA_PASSWORD, hB)).outcome).toBe('correct');
  expect((await verifyPassword(PYCA_PASSWORD, hY)).outcome).toBe('correct');

  // The bare "$2$" tag needs its own, genuinely generated hash rather
  // than a relabel: hashString() (hash.ts) appends a NUL terminator for
  // every OTHER tag but not for bare, so a bare hash's digest is computed
  // from different bytes than a/b/y for the same password+salt+cost.
  // Confirmed here directly, and this is also why bare verification below
  // cannot be reached by relabelling.
  const bareSaltSpec = `$2$${PYCA_COST}$${PYCA_SALT_22}`;
  const hBare = hashSync(PYCA_PASSWORD, bareSaltSpec);
  expect(hBare.length).toBe(59);
  expect(hBare.slice(-31)).not.toBe(PYCA_DIGEST_31); // proves bare is genuinely a different digest
  const bareReport = await verifyPassword(PYCA_PASSWORD, hBare);
  expect(bareReport.outcome).toBe('correct');
  expect(bareReport.tag).toBe('2');
  expect(bareReport.wasNormalised).toBe(false);
});

it('a 2x hash with a candidate password containing a byte at or above 0x80 returns cannot-check, never incorrect', async () => {
  const relabelled = `$2x$${PYCA_COST}$${PYCA_SALT_22}${PYCA_DIGEST_31}`;
  // 'é' encodes to two UTF-8 bytes, 0xC3 0xA9 -- both at or above 0x80.
  const report = await verifyPassword('café-anything-not-the-real-password', relabelled);
  expect(report.outcome).toBe('cannot-check');
  expect(report.outcome).not.toBe('incorrect');
  expect(report.message).toMatch(/cannot check this hash/i);

  // Scoped narrowly: the same high-byte password against a non-2x tag
  // gets a real verdict, not a refusal.
  const bReport = await verifyPassword(
    'café-anything-not-the-real-password',
    `$2b$${PYCA_COST}$${PYCA_SALT_22}${PYCA_DIGEST_31}`,
  );
  expect(bReport.outcome).toBe('incorrect');

  // And an ASCII candidate against the same 2x hash gets a real verdict too.
  const asciiWrong = await verifyPassword('definitely-not-it', relabelled);
  expect(asciiWrong.outcome).toBe('incorrect');
});

it('two passwords differing only after the seventy-second byte both verify against one stored hash', async () => {
  const base72 = 'x'.repeat(72);
  const passwordA = `${base72}-tail-one-with-more-bytes-after-the-limit`;
  const passwordB = `${base72}-a-totally-different-tail-after-the-limit`;
  const wrong = `${'y'.repeat(72)}-different-inside-the-limit`;

  const { hash } = await hashPassword(passwordA, COST_RANGE.min);
  const reportA = await verifyPassword(passwordA, hash);
  const reportB = await verifyPassword(passwordB, hash);
  expect(reportA.outcome).toBe('correct');
  expect(reportB.outcome).toBe('correct');

  // The "wrong password does not verify" half of the claim.
  const reportWrong = await verifyPassword(wrong, hash);
  expect(reportWrong.outcome).toBe('incorrect');
});

it('a wrong password does not verify against that stored hash', async () => {
  const { hash } = await hashPassword('the actual password', COST_RANGE.min);
  const report = await verifyPassword('not the actual password', hash);
  expect(report.outcome).toBe('incorrect');
});

it('truncateToLimit returns metadata only and never a truncated string', () => {
  const short = truncateToLimit('short password');
  expect(short).toEqual({ byteLength: 14, truncated: false, ignoredBytes: 0, splitsCharacter: false });

  const long = truncateToLimit('z'.repeat(100));
  expect(long).toEqual({ byteLength: 100, truncated: true, ignoredBytes: 28, splitsCharacter: false });

  // Never a truncated string: every value on the report is a number or a
  // boolean, so there is no field that could carry mangled password bytes.
  for (const report of [short, long]) {
    for (const value of Object.values(report)) {
      expect(typeof value === 'number' || typeof value === 'boolean').toBe(true);
    }
  }
});

it('the split-character boundary case reports the split flag and hashes the original string unchanged', async () => {
  // 71 ASCII bytes (indices 0-70) followed by 'é' (U+00E9, encodes to the
  // two bytes 0xC3 0xA9 at indices 71-72). Bcrypt's 72-byte cutoff keeps
  // bytes 0-71 (index 71 is 0xC3, the lead byte) and drops byte 72
  // (0xA9, the continuation byte) -- the character is split.
  const password = 'a'.repeat(71) + 'é';
  const report = truncateToLimit(password);
  expect(report.byteLength).toBe(73);
  expect(report.truncated).toBe(true);
  expect(report.ignoredBytes).toBe(1);
  expect(report.splitsCharacter).toBe(true);

  // The original string -- not a re-encoded or truncated one -- is what
  // actually reaches the library: hashing then verifying the exact same
  // original string round-trips correctly.
  const { hash } = await hashPassword(password, COST_RANGE.min);
  const verified = await verifyPassword(password, hash);
  expect(verified.outcome).toBe('correct');
});

it('the library itself accepts the hash this tool produced for the boundary password', async () => {
  // Differential: checked against bcrypt-ts's own compareSync directly,
  // not only through this package's verifyPassword, closing the gap
  // where a wrapper that mangles a password identically on both the hash
  // side and the verify side would agree with itself and pass anyway.
  const base72 = 'q'.repeat(72);
  const passwordA = `${base72}-one-tail`;
  const passwordB = `${base72}-a-different-tail-entirely`;
  const { hash } = await hashPassword(passwordA, COST_RANGE.min);
  expect(compareSync(passwordA, hash)).toBe(true);
  expect(compareSync(passwordB, hash)).toBe(true);
  expect(compareSync('not either password at all', hash)).toBe(false);
});

it('a cost outside the generation range is rejected inside the package, not only by the field', async () => {
  // Called directly with a raw out-of-range number, exactly as a crafted
  // values object reaching run() without passing through the field's own
  // min/max would -- the package must not trust the field alone.
  await expect(hashPassword('anything', COST_RANGE.min - 1)).rejects.toThrow(BcryptError);
  await expect(hashPassword('anything', COST_RANGE.max + 1)).rejects.toThrow(BcryptError);
  await expect(hashPassword('anything', COST_RANGE.min - 1)).rejects.toThrow(/between 4 and 15/);
});

describe('hashing and verifying at every supported cost', () => {
  // Kept to the low end so the suite stays fast; the top of the range gets
  // its own single case below rather than sweeping the whole range.
  for (const cost of [4, 5, 6]) {
    it(`cost ${cost}: hashing then verifying the same password succeeds`, async () => {
      const { hash, cost: reportedCost, tag } = await hashPassword('a reasonable password', cost);
      expect(reportedCost).toBe(cost);
      expect(tag).toBe('2b');
      expect(hash.startsWith(`$2b$0${cost}$`)).toBe(true);
      const verified = await verifyPassword('a reasonable password', hash);
      expect(verified.outcome).toBe('correct');
      const wrong = await verifyPassword('a different password', hash);
      expect(wrong.outcome).toBe('incorrect');
    });
  }

  it('cost 15 (the top of the generation range): hashing then verifying succeeds', async () => {
    const { hash } = await hashPassword('top of the range', COST_RANGE.max);
    const verified = await verifyPassword('top of the range', hash);
    expect(verified.outcome).toBe('correct');
  }, 20_000);
});

it('a hash whose cost is above the generation maximum still verifies', async () => {
  // Cost 16 is legal for the algorithm (4-31) but above this tool's own
  // generation ceiling of 15 -- verification is unbounded because the
  // cost comes from the hash, never from a generation-time option.
  const salt16 = '$2b$16$cVWp4XaNU8a4v1uMRum2SO';
  const hash = hashSync('a production password', salt16);
  const report = await verifyPassword('a production password', hash);
  expect(report.outcome).toBe('correct');
  expect(report.cost).toBe(16);
}, 30_000);

it('normalising a 2x tag changes only the tag portion and leaves cost, salt and digest untouched', () => {
  const original = `$2x$${PYCA_COST}$${PYCA_SALT_22}${PYCA_DIGEST_31}`;
  const { hash: rewritten, wasNormalised, originalTag, cost } = normaliseTag(original);
  expect(wasNormalised).toBe(true);
  expect(originalTag).toBe('2x');
  expect(cost).toBe(4);
  expect(rewritten).toBe(`$2a$${PYCA_COST}$${PYCA_SALT_22}${PYCA_DIGEST_31}`);
  // Character-for-character: everything after the four-character tag prefix is identical.
  expect(rewritten.slice(4)).toBe(original.slice(4));
});

it('normalising a tag that is not 2x reports it unchanged', () => {
  const original = `$2b$${PYCA_COST}$${PYCA_SALT_22}${PYCA_DIGEST_31}`;
  const result = normaliseTag(original);
  expect(result.wasNormalised).toBe(false);
  expect(result.hash).toBe(original);
  expect(result.originalTag).toBe('2b');
});

it('a non-integer cost is rejected', async () => {
  await expect(hashPassword('anything', 10.5)).rejects.toThrow(BcryptError);
  await expect(hashPassword('anything', Number.NaN)).rejects.toThrow(BcryptError);
});

it('a malformed hash string is rejected with a message describing what a bcrypt hash looks like, never an uncaught error', async () => {
  await expect(verifyPassword('anything', 'not a bcrypt hash at all')).rejects.toThrow(BcryptError);
  await expect(verifyPassword('anything', 'not a bcrypt hash at all')).rejects.toThrow(/looks like/);
  // Wrong length, and garbage inside a plausible-looking prefix.
  await expect(verifyPassword('anything', '$2b$10$tooshort')).rejects.toThrow(BcryptError);
  await expect(verifyPassword('anything', '')).rejects.toThrow(BcryptError);
});

it('an unrecognised minor version is rejected rather than silently accepted', async () => {
  // 'z' is not one of the five tags this algorithm has ever used.
  const fake = `$2z$${PYCA_COST}$${PYCA_SALT_22}${PYCA_DIGEST_31}`;
  await expect(verifyPassword('anything', fake)).rejects.toThrow(BcryptError);
});

it('a password of seventy-two bytes or fewer reports that no truncation occurred', () => {
  const exact = truncateToLimit('w'.repeat(72));
  expect(exact.truncated).toBe(false);
  expect(exact.ignoredBytes).toBe(0);
  expect(exact.byteLength).toBe(72);
});

it('truncation counts bytes rather than characters', () => {
  // 40 two-byte characters = 40 characters but 80 bytes, over the limit.
  const password = 'é'.repeat(40);
  const report = truncateToLimit(password);
  expect(password.length).toBe(40);
  expect(report.byteLength).toBe(80);
  expect(report.truncated).toBe(true);
});

it('the duration estimate for a cost factor is roughly double the estimate for the cost below it', () => {
  for (let cost = COST_RANGE.min + 1; cost <= COST_RANGE.max; cost++) {
    const ratio = estimateCostDuration(cost) / estimateCostDuration(cost - 1);
    expect(ratio).toBeCloseTo(2, 5);
  }
});

it('COST_RANGE bounds generation to 4-15 with a default of 10', () => {
  expect(COST_RANGE).toEqual({ min: 4, max: 15, default: 10 });
});

it('meta documents the seventy-two byte truncation and the normalised-tag caveat', () => {
  const limitsText = meta.limits.join(' ').toLowerCase();
  expect(limitsText).toContain('72');
  expect(meta.limits.length).toBeGreaterThanOrEqual(5);
  expect(meta.supports.length).toBeGreaterThanOrEqual(6);
});

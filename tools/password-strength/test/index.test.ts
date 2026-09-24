import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  score,
  SCORE_LABELS,
  MAX_PASSWORD_LENGTH,
  PasswordStrengthError,
  __setupCallCountForTesting,
} from '../src/index';

// The reference here is the installed scorer itself, not an external vector
// table: this tool exposes what @zxcvbn-ts/core actually computed for a given
// input rather than reimplementing a published algorithm. The common-password
// and dictionary-word cases below are asserted by the KIND of match reported
// (dictionary / repeat / spatial / bruteforce), not by an exact score, so a
// future dictionary update in the library does not turn this suite red for no
// reason. See meta.json's testNotes and ambiguities for the same statement.

it('a known leaked password scores zero and its reason names the leaked-password match', () => {
  const report = score('password');
  expect(report.score).toBe(0);
  expect(report.reasons.length).toBeGreaterThan(0);
  expect(report.reasons[0]!.kind).toBe('dictionary');
  expect(report.reasons[0]!.sentence.toLowerCase()).toContain('leaked');
  // Never the password itself or a fragment of it.
  expect(report.reasons[0]!.sentence).not.toContain('password');
});

it('a dictionary word with digits appended scores low and its reasons name both parts', () => {
  // 'xylophone' is a wikipedia-en dictionary word; '42' is not itself a
  // recognised pattern, so the scorer reports two separate matches: a
  // dictionary match for the word and a bruteforce match for the digits.
  const report = score('xylophone42');
  expect(report.score).toBeLessThanOrEqual(2);
  expect(report.reasons).toHaveLength(2);
  expect(report.reasons[0]!.kind).toBe('dictionary');
  expect(report.reasons[0]!.sentence.toLowerCase()).toContain('word');
  expect(report.reasons[1]!.kind).toBe('bruteforce');
  expect(report.reasons[1]!.sentence.toLowerCase()).toContain('digit');
  // Neither reason quotes the word or the digits that were actually typed.
  expect(report.reasons[0]!.sentence).not.toContain('xylophone');
  expect(report.reasons[1]!.sentence).not.toContain('42');
});

it('a long random passphrase scores four', () => {
  const report = score('correct horse battery staple velvet lantern');
  expect(report.score).toBe(4);
  // The reasoning still renders for a strong password -- it is not hidden
  // once the password "passes".
  expect(report.reasons.length).toBeGreaterThan(0);
  for (const reason of report.reasons) {
    expect(reason.sentence.length).toBeGreaterThan(0);
  }
});

it('the crack-time scenarios are mapped to plain-language names, all four of them', () => {
  const report = score('a reasonably ordinary password');
  expect(report.crackTimes).toHaveLength(4);
  const scenarios = report.crackTimes.map((c) => c.scenario);
  expect(scenarios).toEqual([
    'Online attack, rate-limited',
    'Online attack, no rate limit',
    'Offline attack, slow/salted hash',
    'Offline attack, fast/unsalted hash',
  ]);
  // None of these repeats the scorer's own internal key.
  for (const raw of [
    'onlineThrottlingXPerHour',
    'onlineNoThrottlingXPerSecond',
    'offlineSlowHashingXPerSecond',
    'offlineFastHashingXPerSecond',
  ]) {
    expect(scenarios.join(' | ')).not.toContain(raw);
  }
  for (const entry of report.crackTimes) {
    expect(typeof entry.display).toBe('string');
    expect(typeof entry.seconds).toBe('number');
  }
});

it('the language packs are loaded from a static import, not from inside the scoring call', () => {
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const setupIndex = source.indexOf('function ensureFactory');
  expect(setupIndex).toBeGreaterThan(0);
  const importSection = source.slice(0, setupIndex);
  expect(importSection).toContain("from '@zxcvbn-ts/language-common'");
  expect(importSection).toContain("from '@zxcvbn-ts/language-en'");
  expect(importSection).toContain("from '@zxcvbn-ts/core'");
  // No dynamic import anywhere in the file, in particular not inside score().
  expect(source.replace(/ /g, '')).not.toContain('import(');
});

it('the score-to-tone mapping matches the design contract at every score from zero to four', () => {
  expect(SCORE_LABELS.map((entry) => entry.score)).toEqual([0, 1, 2, 3, 4]);
  expect(SCORE_LABELS.map((entry) => entry.tone)).toEqual(['error', 'error', 'warn', 'info', 'success']);
  for (const entry of SCORE_LABELS) {
    expect(entry.label.length).toBeGreaterThan(0);
    expect(entry.note.length).toBeGreaterThan(0);
  }
});

it('a keyboard-adjacent sequence names it as such', () => {
  const report = score('zxcvbnm,');
  expect(report.reasons.some((r) => r.kind === 'spatial')).toBe(true);
  const spatial = report.reasons.find((r) => r.kind === 'spatial')!;
  expect(spatial.sentence.toLowerCase()).toContain('keyboard');
});

it('a repeated character run names the repetition', () => {
  const report = score('aaaaaaaa');
  expect(report.reasons).toHaveLength(1);
  expect(report.reasons[0]!.kind).toBe('repeat');
  expect(report.reasons[0]!.sentence.toLowerCase()).toContain('repeat');
});

it('a reversed dictionary word is still named as a dictionary match, without quoting the word', () => {
  const report = score('poiuytrewq');
  expect(report.reasons[0]!.kind).toBe('dictionary');
  expect(report.reasons[0]!.sentence.toLowerCase()).toContain('backwards');
  expect(report.reasons[0]!.sentence).not.toContain('poiuytrewq');
  expect(report.reasons[0]!.sentence).not.toContain('qwertyuiop');
});

it('a l33t-substituted dictionary word is named as such, without quoting the substitution', () => {
  const report = score('p4ssw0rd');
  expect(report.reasons[0]!.kind).toBe('dictionary');
  expect(report.reasons[0]!.sentence.toLowerCase()).toContain('look-alike');
  expect(report.reasons[0]!.sentence).not.toContain('p4ssw0rd');
});

it('every reason carries a plain-language sentence and the position in the password it applies to, and no reason contains the password itself or any fragment of it', () => {
  const passwords = ['password', 'xylophone42', 'aaaaaaaa', 'zxcvbnm,', 'correct horse battery staple velvet lantern'];
  for (const password of passwords) {
    const report = score(password);
    for (const reason of report.reasons) {
      expect(typeof reason.sentence).toBe('string');
      expect(reason.sentence.length).toBeGreaterThan(0);
      expect(typeof reason.start).toBe('number');
      expect(typeof reason.end).toBe('number');
      expect(reason.start).toBeGreaterThanOrEqual(0);
      expect(reason.end).toBeGreaterThanOrEqual(reason.start);
      expect(reason.end).toBeLessThan(password.length);
      // The reason may never contain the exact password substring it covers.
      const coveredFragment = password.slice(reason.start, reason.end + 1);
      if (coveredFragment.trim().length > 1) {
        expect(reason.sentence.toLowerCase()).not.toContain(coveredFragment.toLowerCase());
      }
    }
  }
});

it("the report carries a score in the scorer's own range with a label, and one crack-time entry per attack scenario", () => {
  const report = score('a reasonably ordinary password');
  expect(report.score).toBeGreaterThanOrEqual(0);
  expect(report.score).toBeLessThanOrEqual(4);
  expect(SCORE_LABELS.map((s) => s.score)).toContain(report.score);
  expect(report.label).toBe(SCORE_LABELS[report.score]!.label);
  expect(report.crackTimes).toHaveLength(4);
});

it('scoring the empty string returns the lowest score without throwing', () => {
  expect(() => score('')).not.toThrow();
  const report = score('');
  expect(report.score).toBe(0);
  expect(report.truncated).toBe(false);
});

it('scoring a password longer than the stated maximum is truncated to that maximum before scoring, and the report says truncation occurred', () => {
  const long = 'a'.repeat(MAX_PASSWORD_LENGTH + 50);
  const report = score(long);
  expect(report.truncated).toBe(true);

  const short = 'a'.repeat(MAX_PASSWORD_LENGTH);
  const shortReport = score(short);
  expect(shortReport.truncated).toBe(false);
});

it("calling the score function twice in a row returns identical results, and the first call performs the scorer's one-time setup exactly once", () => {
  const first = score('a moderately unusual passphrase');
  const countAfterFirst = __setupCallCountForTesting();
  expect(countAfterFirst).toBe(1);

  const second = score('a moderately unusual passphrase');
  const countAfterSecond = __setupCallCountForTesting();

  expect(second).toEqual(first);
  expect(countAfterSecond).toBe(countAfterFirst);
});

it('rejects a non-string password with PasswordStrengthError rather than crashing', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expect(() => score(42 as any)).toThrow(PasswordStrengthError);
});

describe('meta.json documentation', () => {
  it('carries the full documentation set with a non-empty limits list', async () => {
    const { meta } = await import('../src/index');
    expect(meta.limits.length).toBeGreaterThan(0);
    expect(meta.supports.length).toBeGreaterThan(0);
    for (const field of [meta.about, ...meta.supports, ...meta.limits]) {
      expect(field.toLowerCase()).not.toMatch(/\b(hash-text|hash-file|bcrypt|jwt-signature|random-string|uuid)\b/);
    }
  });
});

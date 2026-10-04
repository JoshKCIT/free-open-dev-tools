import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it, expect } from 'vitest';
import { SemverCheckerError, checkVersions, sortVersions } from '../src/index';
import { FIXTURE_DIR, NO_OPTIONS, loadFixture, toOptions, type Options } from './loader';

// Expected values: node-semver's own published fixtures at tag v7.8.5 (see test/fixtures/node-semver/UPSTREAM.md),
// read exactly as node-semver's own tests read them. Every entry is passed through this package's own functions with
// the loose and include-prerelease options its fixture entry names. Entries that cannot be reproduced as pasted text
// are listed by name below with the reason, never dropped silently.

const RANGE_REFUSAL = 'This is not a valid range';

/** True when this package's own check marks the version as satisfying the range (an unreadable range satisfies nothing). */
function satisfiesThroughTool(range: string, version: string, options: Options): boolean {
  try {
    return checkVersions(version, range, options).rows[0]?.result === 'satisfies';
  } catch (error) {
    if (error instanceof SemverCheckerError && error.message.startsWith(RANGE_REFUSAL)) return false;
    throw error;
  }
}

/** range-exclude.js entries whose version is not text: a visitor can only paste text. */
const EXCLUDE_NOT_TEXT = [{ range: '>=2', reason: 'the version is the boolean false, which cannot be pasted as text' }];

it('node-semver published range-include fixtures are satisfied and range-exclude fixtures are not', () => {
  const include = loadFixture('range-include');
  const exclude = loadFixture('range-exclude');
  expect(include.length).toBe(126);
  expect(exclude.length).toBe(98);

  for (const [range, version, options] of include) {
    expect(typeof range).toBe('string');
    expect(typeof version).toBe('string');
    expect(satisfiesThroughTool(range as string, version as string, toOptions(options)), `${range} by ${version}`).toBe(
      true,
    );
  }

  const listed = new Set(EXCLUDE_NOT_TEXT.map((entry) => entry.range));
  let judged = 0;
  for (const [range, version, options] of exclude) {
    if (typeof version !== 'string') {
      expect(listed.has(range as string), `${range} is a listed entry that is not text`).toBe(true);
      continue;
    }
    judged += 1;
    expect(satisfiesThroughTool(range as string, version, toOptions(options)), `${range} by ${version}`).toBe(false);
  }
  expect(judged).toBe(exclude.length - EXCLUDE_NOT_TEXT.length);
});

/** invalid-versions.js entries that are not text, with the reason each cannot be pasted. */
const INVALID_NOT_TEXT = [
  'regexp is not a string',
  'semver-ish regexp is not a string',
  'obj with a tostring is not a string',
];

/** invalid-versions.js entries this package refuses before parsing, because the page limits a version to 256 characters. */
const INVALID_REFUSED_BEFORE_PARSING = ['too long'];

it('node-semver published valid-versions and invalid-versions fixtures are judged the same', () => {
  const valid = loadFixture('valid-versions');
  const invalid = loadFixture('invalid-versions');
  expect(valid.length).toBe(22);
  expect(invalid.length).toBe(10);

  for (const entry of valid) {
    const [version, major, minor, patch, prerelease, build] = entry as [
      string,
      number,
      number,
      number,
      (string | number)[],
      string[],
    ];
    const sorted = sortVersions(version, NO_OPTIONS);
    expect(sorted.invalid, version).toEqual([]);
    expect(sorted.sorted.length, version).toBe(1);
    expect(sorted.sorted[0]?.build, version).toBe(build.join('.'));
    // The published parts, written back as an exact range, are satisfied by the pasted version.
    const exact = `${major}.${minor}.${patch}` + (prerelease.length > 0 ? '-' + prerelease.join('.') : '');
    expect(checkVersions(version, exact, NO_OPTIONS).rows[0]?.result, version).toBe('satisfies');
  }

  let judged = 0;
  for (const entry of invalid) {
    const [value, reason, options] = entry as [unknown, string, unknown];
    if (typeof value !== 'string') {
      expect(INVALID_NOT_TEXT, reason).toContain(reason);
      continue;
    }
    const loose = toOptions(options).loose;
    if (INVALID_REFUSED_BEFORE_PARSING.includes(reason)) {
      expect(() => sortVersions(value, { loose }), reason).toThrow(SemverCheckerError);
      continue;
    }
    judged += 1;
    const result = sortVersions(value, { loose });
    expect(result.sorted, reason).toEqual([]);
    expect(result.invalid.length, reason).toBe(1);
  }
  expect(judged).toBe(invalid.length - INVALID_NOT_TEXT.length - INVALID_REFUSED_BEFORE_PARSING.length);
});

it('node-semver published range-parse fixtures give the same normalised range', () => {
  const parse = loadFixture('range-parse');
  expect(parse.length).toBe(133);
  let readable = 0;
  let refused = 0;
  for (const [range, wanted, options] of parse) {
    const opts = toOptions(options);
    if (wanted === null) {
      refused += 1;
      let thrown: unknown;
      try {
        checkVersions('', range as string, opts);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, `${range} is not a range`).toBeInstanceOf(SemverCheckerError);
      expect((thrown as Error).message.startsWith(RANGE_REFUSAL)).toBe(true);
      continue;
    }
    readable += 1;
    expect(checkVersions('', range as string, opts).normalized, `${range} with ${JSON.stringify(options)}`).toBe(
      wanted,
    );
  }
  expect(readable + refused).toBe(parse.length);
  expect(refused).toBe(12);
});

/** Reads the `- name: sha` lines under the Files heading of an UPSTREAM.md. */
function readUpstreamShas(text: string): { path: string; sha: string }[] {
  const entries: { path: string; sha: string }[] = [];
  const marker = text.indexOf('## Files');
  expect(marker).toBeGreaterThan(0);
  for (const line of text.slice(marker).split('\n')) {
    if (!line.startsWith('- ')) continue;
    const colon = line.indexOf(': ');
    if (colon < 0) continue;
    const sha = line.slice(colon + 2).trim();
    if (sha.length === 40 && /^[0-9a-f]+$/.test(sha)) entries.push({ path: line.slice(2, colon), sha });
  }
  return entries;
}

/** The git blob SHA of a file: SHA-1 of the word blob, a space, the size, a zero byte and then the bytes. */
function gitBlobShaOfFile(path: string): string {
  const bytes = readFileSync(path);
  return createHash('sha1')
    .update('blob ' + bytes.length + String.fromCharCode(0))
    .update(bytes)
    .digest('hex');
}

it('every vendored node-semver fixture matches the git blob SHA recorded in UPSTREAM.md', () => {
  const entries = readUpstreamShas(readFileSync(join(FIXTURE_DIR, 'UPSTREAM.md'), 'utf8'));
  expect(entries.map((entry) => entry.path).sort()).toEqual([
    'LICENSE',
    'comparator-intersection.js',
    'invalid-versions.js',
    'range-exclude.js',
    'range-include.js',
    'range-parse.js',
    'valid-versions.js',
  ]);
  for (const entry of entries) {
    expect(gitBlobShaOfFile(join(FIXTURE_DIR, entry.path)), entry.path).toBe(entry.sha);
  }
});

import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import compare from 'semver/functions/compare';
import satisfies from 'semver/functions/satisfies';
import {
  MAX_ALTERNATIVES,
  MAX_INPUT_CHARACTERS,
  MAX_LINES,
  MAX_RANGE_CHARACTERS,
  MAX_VERSION_CHARACTERS,
  SemverCheckerError,
  checkVersions,
  explainRange,
  meta,
  sortVersions,
  splitVersionLines,
  visible,
} from '../src/index';
import { NO_OPTIONS } from './loader';

// Expected values: the SemVer 2.0.0 precedence example and the build metadata rule are copied from the specification
// page https://semver.org/spec/v2.0.0.html (fetched 2026-10-04); the boundary answers follow the operators as npm's
// README defines them; the limits are the ones meta.json states. Sorting and checking are compared with semver
// functions called directly where an independent answer is useful.

let spies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  for (const spy of spies) spy.mockRestore();
});

const MARKER = 'FODT-MARKER-4417';
const INCLUDE: typeof NO_OPTIONS = { loose: false, includePrerelease: true };

/** A seeded generator (mulberry32), so a shuffle is the same on every run. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const random = mulberry32(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

function results(versions: string, range: string, options = NO_OPTIONS): string[] {
  return checkVersions(versions, range, options).rows.map((row) => row.result);
}

it('versions sort in SemVer 2.0.0 section 11 precedence order and build metadata is ignored', () => {
  // The example chain of section 11 of the specification, lowest first.
  const chain = [
    '1.0.0-alpha',
    '1.0.0-alpha.1',
    '1.0.0-alpha.beta',
    '1.0.0-beta',
    '1.0.0-beta.2',
    '1.0.0-beta.11',
    '1.0.0-rc.1',
    '1.0.0',
  ];
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const result = sortVersions(shuffled(chain, seed).join('\n'), NO_OPTIONS);
    expect(
      result.sorted.map((entry) => entry.shown),
      `seed ${seed}`,
    ).toEqual(chain);
    expect(result.invalid).toEqual([]);
  }
  // Also from section 11: major, minor and patch are compared as numbers, so 2.10.0 is above 2.9.0.
  const numbers = ['1.0.0', '2.0.0', '2.1.0', '2.1.1', '2.9.0', '2.10.0', '10.0.0'];
  expect(sortVersions(shuffled(numbers, 9).join('\n'), NO_OPTIONS).sorted.map((entry) => entry.shown)).toEqual(numbers);

  // Section 10: build metadata is ignored when ordering, so it never moves a version past another.
  const built = sortVersions('1.0.1-alpha+a\n1.0.0+z\n0.9.9+y\n1.0.0+b', NO_OPTIONS);
  expect(built.sorted.map((entry) => entry.shown)).toEqual(['0.9.9+y', '1.0.0+z', '1.0.0+b', '1.0.1-alpha+a']);
  expect(built.sorted.map((entry) => entry.build)).toEqual(['y', 'z', 'b', 'a']);
  expect(built.sorted.map((entry) => entry.line)).toEqual([3, 2, 4, 1]);
});

it('versions equal in precedence keep their pasted order because build metadata is ignored', () => {
  const result = sortVersions('1.0.0+b\n1.0.0+a\n0.1.0\n1.0.0+c\n2.0.0+z\n2.0.0', NO_OPTIONS);
  expect(result.sorted.map((entry) => entry.shown)).toEqual([
    '0.1.0',
    '1.0.0+b',
    '1.0.0+a',
    '1.0.0+c',
    '2.0.0+z',
    '2.0.0',
  ]);
  expect(result.equalGroups).toBe(2);
  expect(sortVersions('1.0.0\n2.0.0\n3.0.0', NO_OPTIONS).equalGroups).toBe(0);
  // The same version pasted twice is two lines, in pasted order.
  const twice = sortVersions('1.0.0\n0.5.0\n1.0.0', NO_OPTIONS);
  expect(twice.sorted.map((entry) => entry.line)).toEqual([2, 1, 3]);
  expect(twice.equalGroups).toBe(1);
});

it('a bad line never stops the sort and is listed with its line number and no pasted text', () => {
  const text = ['1.0.0', '=1.0.0', '0.9.0', 'bogus'].join('\n');
  const strict = sortVersions(text, NO_OPTIONS);
  expect(strict.sorted.map((entry) => [entry.shown, entry.line])).toEqual([
    ['0.9.0', 3],
    ['1.0.0', 1],
  ]);
  expect(strict.invalid).toEqual([
    { line: 2, shown: '=1.0.0' },
    { line: 4, shown: 'bogus' },
  ]);
  // With loose parsing the leading = is accepted.
  const loose = sortVersions(text, { loose: true });
  expect(loose.invalid).toEqual([{ line: 4, shown: 'bogus' }]);
  expect(loose.sorted.map((entry) => entry.line)).toEqual([3, 1, 2]);

  // Blank lines are skipped but counted, and a bad line holding a marker is cut and carries nothing else.
  const long = MARKER + ' ' + 'x'.repeat(100);
  const result = sortVersions('\n1.0.0\n\n' + long, NO_OPTIONS);
  expect(result.invalid.length).toBe(1);
  expect(result.invalid[0]?.line).toBe(4);
  expect(Object.keys(result.invalid[0] ?? {}).sort()).toEqual(['line', 'shown']);
  expect(result.invalid[0]?.shown.length).toBeLessThanOrEqual(41);
  expect(result.invalid[0]?.shown.startsWith(MARKER)).toBe(true);
  expect(result.invalid[0]?.shown.includes('x'.repeat(40))).toBe(false);
  expect(result.sorted.map((entry) => entry.line)).toEqual([2]);
});

it('pre-release versions are excluded unless include prerelease is ticked, as node-semver does', () => {
  expect(results('1.2.4-beta.1', '^1.2.3')).toEqual(['does not satisfy']);
  expect(results('1.2.4-beta.1', '^1.2.3', INCLUDE)).toEqual(['satisfies']);
  // A pre-release on the same major, minor and patch as a comparator that names a pre-release is allowed.
  expect(results('1.2.3-beta.2', '^1.2.3-beta.1')).toEqual(['satisfies']);
  expect(results('1.2.4-beta.2', '^1.2.3-beta.1')).toEqual(['does not satisfy']);
  expect(results('1.3.0-beta.1\n1.3.0', '*')).toEqual(['does not satisfy', 'satisfies']);
  expect(results('1.3.0-beta.1', '*', INCLUDE)).toEqual(['satisfies']);
  // The rows agree with semver.satisfies called directly, for a grid of versions, ranges and options.
  const versions = ['0.9.9', '1.2.3', '1.2.3-beta.2', '1.2.4-alpha', '1.9.9', '2.0.0-0', '2.0.0', '4.1.0'];
  for (const range of ['^1.2.3', '>=1.2.3-beta.1 <2.0.0', '1.x || >=4', '~1.2.3-beta.1', '<2.0.0']) {
    for (const includePrerelease of [false, true]) {
      const options = { loose: false, includePrerelease };
      expect(results(versions.join('\n'), range, options), `${range} ${includePrerelease}`).toEqual(
        versions.map((version) => (satisfies(version, range, options) ? 'satisfies' : 'does not satisfy')),
      );
    }
  }
});

it('boundary versions follow their operator and hyphen ranges include both ends', () => {
  expect(results('1.9.9\n2.0.0', '<2.0.0')).toEqual(['satisfies', 'does not satisfy']);
  expect(results('2.3.4\n2.3.5', '<=2.3.4')).toEqual(['satisfies', 'does not satisfy']);
  expect(results('1.2.3\n1.2.4', '>1.2.3')).toEqual(['does not satisfy', 'satisfies']);
  expect(results('1.2.2\n1.2.3', '>=1.2.3')).toEqual(['does not satisfy', 'satisfies']);
  expect(results('1.2.2\n1.2.3\n2.3.4\n2.3.5', '1.2.3 - 2.3.4')).toEqual([
    'does not satisfy',
    'satisfies',
    'satisfies',
    'does not satisfy',
  ]);
  // ^1.2.3 stops below the next major's pre-releases too, with or without Include pre-releases.
  for (const options of [NO_OPTIONS, INCLUDE]) {
    expect(results('1.9.9\n2.0.0-alpha\n2.0.0-0\n2.0.0', '^1.2.3', options).slice(1)).toEqual([
      'does not satisfy',
      'does not satisfy',
      'does not satisfy',
    ]);
  }
  expect(results('0.2.9\n0.3.0', '^0.2.3')).toEqual(['satisfies', 'does not satisfy']);
});

it('check mode names the highest pasted version that satisfies the range and the lowest version it allows', () => {
  const checked = checkVersions('1.2.2\n1.9.9\n1.5.0\n2.0.0\nbogus\n', '^1.2.3', NO_OPTIONS);
  expect(checked.normalized).toBe('>=1.2.3 <2.0.0-0');
  expect(checked.rows).toEqual([
    { line: 1, shown: '1.2.2', result: 'does not satisfy' },
    { line: 2, shown: '1.9.9', result: 'satisfies' },
    { line: 3, shown: '1.5.0', result: 'satisfies' },
    { line: 4, shown: '2.0.0', result: 'does not satisfy' },
    { line: 5, shown: 'bogus', result: 'not a valid version' },
  ]);
  expect(checked.maxSatisfying).toBe('1.9.9');
  expect(checked.minVersion).toBe('1.2.3');
  expect(checked.prereleases).toBe(0);
  expect(checkVersions('1.0.0\n1.3.0-beta.1\n2.0.0-rc.1\nnope', '*', NO_OPTIONS).prereleases).toBe(2);
  // Loose parsing accepts =1.5.0 and v1.5.0 as versions; strict parsing does not accept the first.
  expect(results('=1.5.0\nv1.5.0', '^1.2.3')).toEqual(['not a valid version', 'satisfies']);
  expect(results('=1.5.0\nv1.5.0', '^1.2.3', { loose: true, includePrerelease: false })).toEqual([
    'satisfies',
    'satisfies',
  ]);
  const none = checkVersions('3.0.0', '^1.2.3', NO_OPTIONS);
  expect(none.maxSatisfying).toBeNull();
  expect(none.minVersion).toBe('1.2.3');
  expect(checkVersions('1.0.0', '<0.0.0-0', NO_OPTIONS).minVersion).toBeNull();
  expect(checkVersions('1.0.0', '*', NO_OPTIONS).minVersion).toBe('0.0.0');
  // npm's own answer for the highest satisfying version, called directly.
  expect(checkVersions('1.0.0\n1.4.0\n1.3.0', '~1.3.0 || 1.0.x', NO_OPTIONS).maxSatisfying).toBe('1.3.0');
});

it('no versions give no rows, a range of star or x reads any version and one version sorts to itself', () => {
  expect(checkVersions('', '^1.2.3', NO_OPTIONS).rows).toEqual([]);
  expect(checkVersions('  \n\n', '^1.2.3', NO_OPTIONS).rows).toEqual([]);
  expect(checkVersions('', '^1.2.3', NO_OPTIONS).maxSatisfying).toBeNull();
  expect(sortVersions('', NO_OPTIONS)).toEqual({ sorted: [], invalid: [], equalGroups: 0 });
  for (const any of ['*', 'x', 'X', '']) {
    expect(results('0.0.1\n99.99.99', any), JSON.stringify(any)).toEqual(['satisfies', 'satisfies']);
  }
  expect(checkVersions('1.0.0', 'x', NO_OPTIONS).normalized).toBe('*');
  expect(sortVersions('3.2.1', NO_OPTIONS).sorted).toEqual([{ shown: '3.2.1', line: 1, build: '' }]);
});

it('pasted lines are trimmed, blank lines are skipped and line numbers count every line', () => {
  const bom = String.fromCharCode(0xfeff);
  expect(splitVersionLines('  1.0.0  \r\n\r\n\t2.0.0\n   \n3.0.0')).toEqual([
    { line: 1, text: '1.0.0' },
    { line: 3, text: '2.0.0' },
    { line: 5, text: '3.0.0' },
  ]);
  expect(splitVersionLines(bom + '1.0.0\n2.0.0')).toEqual([
    { line: 1, text: '1.0.0' },
    { line: 2, text: '2.0.0' },
  ]);
  expect(splitVersionLines('')).toEqual([]);
});

it('shown text has control and direction-changing characters escaped and is cut at 40 characters', () => {
  const backslashU = String.fromCodePoint(92) + 'u{';
  const escape = String.fromCodePoint(0x1b);
  const override = String.fromCodePoint(0x202e);
  expect(visible('a' + escape + 'b', 40)).toBe('a' + backslashU + '1B}b');
  expect(visible(override + '1.0.0', 40)).toBe(backslashU + '202E}1.0.0');
  expect(visible('a'.repeat(50), 40)).toBe('a'.repeat(40) + String.fromCodePoint(0x2026));
  expect(visible('a'.repeat(40), 40)).toBe('a'.repeat(40));
  // A character outside the basic plane counts once.
  const wide = String.fromCodePoint(0x1f600);
  expect(visible(wide.repeat(41), 40)).toBe(wide.repeat(40) + String.fromCodePoint(0x2026));
  // Shown in a row: a bad line carrying control characters is written out, never passed through.
  const row = checkVersions('1.0.0' + escape + override + 'x', '*', NO_OPTIONS).rows[0];
  expect(row?.result).toBe('not a valid version');
  expect(row?.shown).toBe('1.0.0' + backslashU + '1B}' + backslashU + '202E}x');
});

/** The size error a call throws, or a failing test when nothing was refused. */
function refusal(run: () => unknown): SemverCheckerError {
  const error = thrownBy(run);
  expect(error).toBeInstanceOf(SemverCheckerError);
  return error as SemverCheckerError;
}

it('inputs over the limits are refused before parsing', () => {
  expect(MAX_INPUT_CHARACTERS).toBe(262_144);
  expect(MAX_LINES).toBe(20_000);
  expect(MAX_VERSION_CHARACTERS).toBe(256);
  expect(MAX_RANGE_CHARACTERS).toBe(1_000);
  expect(MAX_ALTERNATIVES).toBe(500);

  // Pasted characters: exactly the limit is read, one more is refused, in every mode that reads versions.
  const atLimit = '1.0.0\n' + '\n'.repeat(MAX_INPUT_CHARACTERS - 6);
  expect(atLimit.length).toBe(MAX_INPUT_CHARACTERS);
  expect(checkVersions(atLimit, '*', NO_OPTIONS).rows.length).toBe(1);
  expect(sortVersions(atLimit, NO_OPTIONS).sorted.length).toBe(1);
  const tooMany = atLimit + '\n';
  for (const run of [() => checkVersions(tooMany, '*', NO_OPTIONS), () => sortVersions(tooMany, NO_OPTIONS)]) {
    const error = refusal(run);
    expect(error.message).toContain('262,144');
    expect(error.message).toContain('262,145');
    expect(error.message).not.toMatch(/^This is not a valid range/);
  }

  // Lines: 20,000 version lines are read (blank lines do not count), one more is refused and named, even when every
  // line is junk, which proves the refusal comes before any line is parsed.
  expect(checkVersions('1.0.0\n'.repeat(MAX_LINES) + '\n'.repeat(30_000), '*', NO_OPTIONS).rows.length).toBe(MAX_LINES);
  const junk = 'bogus\n'.repeat(MAX_LINES + 1);
  const lineError = refusal(() => sortVersions(junk, NO_OPTIONS));
  expect(lineError.message).toContain('20,000');
  expect(lineError.line).toBe(MAX_LINES + 1);
  expect(refusal(() => checkVersions(junk, '*', NO_OPTIONS)).message).toContain('20,000');

  // One version: 256 characters are read (and found not to be a version), 257 are refused naming the line.
  expect(checkVersions('1.0.0\n' + 'a'.repeat(256), '*', NO_OPTIONS).rows[1]?.result).toBe('not a valid version');
  const longError = refusal(() => checkVersions('1.0.0\n' + 'a'.repeat(257), '*', NO_OPTIONS));
  // The page writes the line number in front of this sentence ("Line 2: ..."), so the sentence itself must not repeat it.
  expect(longError.message).toMatch(/^This line is longer than 256 characters/);
  expect(longError.message).not.toMatch(/Line \d/);
  expect(longError.message).toContain('256 characters');
  expect(longError.line).toBe(2);
  expect(longError.message).not.toContain('aaaa');
  expect(refusal(() => sortVersions('a'.repeat(257), NO_OPTIONS)).line).toBe(1);

  // The range: 1,000 characters are read, 1,001 are refused even when they are junk that would not parse.
  const rangeAtLimit = '1.0.0' + ' '.repeat(MAX_RANGE_CHARACTERS - 5);
  expect(rangeAtLimit.length).toBe(MAX_RANGE_CHARACTERS);
  expect(checkVersions('1.0.0', rangeAtLimit, NO_OPTIONS).normalized).toBe('1.0.0');
  const rangeError = refusal(() => checkVersions('1.0.0', 'a'.repeat(MAX_RANGE_CHARACTERS + 1), NO_OPTIONS));
  expect(rangeError.message).toContain('1,000 characters');
  expect(rangeError.message).not.toMatch(/^This is not a valid range/);
  expect(refusal(() => explainRange('a'.repeat(MAX_RANGE_CHARACTERS + 1), NO_OPTIONS)).message).toContain(
    '1,000 characters',
  );

  // Alternatives: 500 are read (499 bars), 501 are refused (500 bars fit in 1,000 characters).
  expect(checkVersions('1.0.0', '||'.repeat(MAX_ALTERNATIVES - 1), NO_OPTIONS).rows[0]?.result).toBe('satisfies');
  const alternativesError = refusal(() => checkVersions('1.0.0', '||'.repeat(MAX_ALTERNATIVES), NO_OPTIONS));
  expect(alternativesError.message).toContain('500 alternatives');
  expect(refusal(() => explainRange('||'.repeat(MAX_ALTERNATIVES), NO_OPTIONS)).message).toContain('500 alternatives');
});

it('library messages never reach the page and a marker inside a bad range is never repeated', () => {
  const strictRanges = [
    MARKER,
    `^1.2.3 || ${MARKER}`,
    `>=${MARKER}`,
    `${MARKER} || 1.2.3`,
    `1.2.3 - ${MARKER}`,
    '99999999999999999999.0.0',
    `>=1.0.0 ${MARKER} <2.0.0`,
  ];
  const libraryWords = [
    'Invalid comparator',
    'Invalid SemVer Range',
    'Invalid major version',
    'Invalid Version',
    'TypeError',
  ];
  const runs: ((range: string, loose: boolean) => unknown)[] = [
    (range, loose) => checkVersions('1.0.0', range, { loose, includePrerelease: false }),
    (range, loose) => explainRange(range, { loose, includePrerelease: true }),
  ];
  for (const run of runs) {
    for (const range of strictRanges) {
      const error = refusal(() => run(range, false));
      expect(error.message, range).toMatch(/^This is not a valid range: /);
      expect(error.message).not.toContain(MARKER);
      expect(error.message).not.toContain('99999999999999999999');
      for (const word of libraryWords) expect(error.message).not.toContain(word);
      expect(error.name).toBe('SemverCheckerError');
      expect(JSON.stringify({ ...error, message: error.message, stack: error.stack?.split('\n')[0] })).not.toContain(
        MARKER,
      );
      expect((error as { cause?: unknown }).cause).toBeUndefined();
    }
    // Loose parsing throws unreadable parts out, so a range that is nothing but junk is the one that is refused.
    const looseError = refusal(() => run(MARKER, true));
    expect(looseError.message).toMatch(/^This is not a valid range: /);
    expect(looseError.message).not.toContain(MARKER);
  }
  // The message names the alternative that cannot be read, counting from 1, and not what is in it.
  expect(refusal(() => checkVersions('', '1.0.0 || ' + MARKER + ' || 2.0.0', NO_OPTIONS)).message).toContain(
    'alternative 2',
  );
  expect(refusal(() => checkVersions('', MARKER, NO_OPTIONS)).message).not.toContain('alternative');
  // A refusal of a line never repeats the line either.
  expect(refusal(() => checkVersions('1.0.0\n' + MARKER + 'a'.repeat(300), '*', NO_OPTIONS)).message).not.toContain(
    MARKER,
  );
});

it('20,000 versions, the most a paste may hold, sort in under 5 seconds', () => {
  const lines: string[] = [];
  for (let i = 0; i < MAX_LINES; i++) {
    lines.push(`${i % 97}.${i % 31}.${i % 1000}` + (i % 3 === 0 ? `-b${i % 7}` : ''));
  }
  const text = lines.join('\n');
  expect(text.length).toBeLessThanOrEqual(MAX_INPUT_CHARACTERS);
  const start = performance.now();
  const result = sortVersions(text, NO_OPTIONS);
  const elapsed = performance.now() - start;
  expect(elapsed).toBeLessThan(5_000);
  expect(result.sorted.length).toBe(MAX_LINES);
  expect(result.invalid).toEqual([]);
  for (let i = 1; i < result.sorted.length; i++) {
    const before = result.sorted[i - 1];
    const after = result.sorted[i];
    expect(compare((before as { shown: string }).shown, (after as { shown: string }).shown) <= 0).toBe(true);
  }
}, 60_000);

it('the most alternatives a range can hold are checked against 20,000 versions in under 5 seconds', () => {
  const alternatives: string[] = [];
  for (let i = 0; alternatives.join('||').length < 900; i++) alternatives.push(`${i}.x`);
  const range = alternatives.join('||');
  expect(range.length).toBeLessThanOrEqual(MAX_RANGE_CHARACTERS);
  const lines: string[] = [];
  for (let i = 0; i < MAX_LINES; i++) lines.push(`${i % 300}.${i % 31}.${i % 100}`);
  const text = lines.join('\n');
  expect(text.length).toBeLessThanOrEqual(MAX_INPUT_CHARACTERS);
  const start = performance.now();
  const result = checkVersions(text, range, NO_OPTIONS);
  const elapsed = performance.now() - start;
  expect(elapsed).toBeLessThan(5_000);
  expect(result.rows.length).toBe(MAX_LINES);
  expect(result.rows.some((row) => row.result === 'satisfies')).toBe(true);
  expect(result.rows.some((row) => row.result === 'does not satisfy')).toBe(true);
}, 60_000);

it('nothing is written to the console while checking, sorting or explaining', () => {
  checkVersions('1.0.0\nbogus\n1.2.3-beta.1', '^1.2.3 || >=4', NO_OPTIONS);
  checkVersions('1.0.0', '*', INCLUDE);
  sortVersions('2.0.0\n1.0.0\nbogus', NO_OPTIONS);
  sortVersions('=1.0.0', { loose: true });
  explainRange('^1.2.3 || 1.x - 2', NO_OPTIONS);
  explainRange('*', INCLUDE);
  thrownBy(() => checkVersions('1.0.0', MARKER, NO_OPTIONS));
  thrownBy(() => explainRange(MARKER, NO_OPTIONS));
  thrownBy(() => sortVersions('a'.repeat(300), NO_OPTIONS));
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
});

it('the folder metadata names the primary export and pins semver exactly', () => {
  expect(meta.primaryExport).toBe('checkVersions');
  expect(meta.dependencies).toEqual({ semver: '7.8.5' });
});

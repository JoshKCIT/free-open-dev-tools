import { it, expect } from 'vitest';
import compare from 'semver/functions/compare';
import parse from 'semver/functions/parse';
import satisfies from 'semver/functions/satisfies';
import validRange from 'semver/ranges/valid';
import { SemverCheckerError, explainRange } from '../src/index';
import { NO_OPTIONS, loadFixture, toOptions, type Options } from './loader';

// Expected values: semver.satisfies from npm's own package, called directly (not through this package) on versions
// chosen at and around every boundary an explanation names, and the sentence shapes this page promises. The test reads
// nothing but the words of each explanation to build the interval the words claim, so a sentence that disagrees with
// the range is caught even when the structured fields next to it are right.

interface Claim {
  op: '' | '<' | '<=' | '>' | '>=';
  version: string;
}

/** The one reading of every sentence the explanation may use, written independently of the package's own code. */
function readSentence(text: string): Claim {
  let match = /^(\d+\.\d+\.\d+) or higher, including its pre-releases$/.exec(text);
  if (match) return { op: '>=', version: (match[1] as string) + '-0' };
  match = /^(\S+) or higher$/.exec(text);
  if (match) return { op: '>=', version: match[1] as string };
  match = /^higher than (\S+)$/.exec(text);
  if (match) return { op: '>', version: match[1] as string };
  match = /^(\S+) or lower$/.exec(text);
  if (match) return { op: '<=', version: match[1] as string };
  match = /^lower than (\d+\.\d+\.\d+), with no (\d+\.\d+\.\d+) pre-release$/.exec(text);
  if (match) {
    expect(match[2], text).toBe(match[1]);
    return { op: '<', version: (match[1] as string) + '-0' };
  }
  match = /^lower than (\S+)$/.exec(text);
  if (match) return { op: '<', version: match[1] as string };
  match = /^exactly (\S+)$/.exec(text);
  if (match) return { op: '', version: match[1] as string };
  if (text === 'no version at all') return { op: '<', version: '0.0.0-0' };
  throw new Error('a sentence this test does not know: ' + text);
}

/** The comparators an alternative's words claim. */
function readAlternative(words: string): Claim[] {
  if (words === 'any version') return [];
  return words.split(', and ').map(readSentence);
}

function holds(claim: Claim, version: string): boolean {
  const order = compare(version, claim.version);
  if (claim.op === '>=') return order >= 0;
  if (claim.op === '>') return order > 0;
  if (claim.op === '<=') return order <= 0;
  if (claim.op === '<') return order < 0;
  return order === 0;
}

/** What the words say about one version, including the pre-release rule the explanation states. */
function claimedBy(alternatives: Claim[][], version: string, includePrerelease: boolean): boolean {
  const parsed = parse(version);
  if (!parsed) throw new Error('not a version: ' + version);
  return alternatives.some((claims) => {
    if (!claims.every((claim) => holds(claim, version))) return false;
    if (parsed.prerelease.length === 0 || includePrerelease) return true;
    return claims.some((claim) => {
      const named = parse(claim.version);
      return (
        named !== null &&
        named.prerelease.length > 0 &&
        named.major === parsed.major &&
        named.minor === parsed.minor &&
        named.patch === parsed.patch
      );
    });
  });
}

/** Versions at and just around a boundary: itself, its pre-releases, the next patch and the previous one. */
function around(version: string): string[] {
  const named = parse(version);
  if (!named) return [];
  const core = `${named.major}.${named.minor}.${named.patch}`;
  const found = new Set<string>([version, core, core + '-0', core + '-alpha', core + '-zzz.9']);
  const next = `${named.major}.${named.minor}.${named.patch + 1}`;
  found.add(next);
  found.add(next + '-0');
  found.add(next + '-alpha');
  let previous: string | null = null;
  if (named.patch > 0) previous = `${named.major}.${named.minor}.${named.patch - 1}`;
  else if (named.minor > 0) previous = `${named.major}.${named.minor - 1}.99`;
  else if (named.major > 0) previous = `${named.major - 1}.99.99`;
  if (previous !== null) {
    found.add(previous);
    found.add(previous + '-alpha');
  }
  if (named.prerelease.length > 0) {
    found.add(version + '.0');
    found.add(core + '-' + named.prerelease.join('.') + '.1');
    const last = named.prerelease[named.prerelease.length - 1];
    if (typeof last === 'number') {
      const head = named.prerelease.slice(0, -1);
      found.add([core, [...head, last + 1].join('.')].join('-'));
      if (last > 0) found.add([core, [...head, last - 1].join('.')].join('-'));
    }
  }
  return [...found].filter((candidate) => parse(candidate) !== null);
}

/** Every range in the published fixtures, with the options its entry names. */
function fixtureRanges(): { range: string; options: Options }[] {
  const ranges: { range: string; options: Options }[] = [];
  for (const name of ['range-include', 'range-exclude']) {
    for (const [range, , options] of loadFixture(name)) {
      if (typeof range === 'string') ranges.push({ range, options: toOptions(options) });
    }
  }
  for (const [range, wanted, options] of loadFixture('range-parse')) {
    if (typeof range === 'string' && wanted !== null) ranges.push({ range, options: toOptions(options) });
  }
  for (const [first, second, , includePrerelease] of loadFixture('comparator-intersection')) {
    for (const range of [first, second]) {
      if (typeof range === 'string')
        ranges.push({ range, options: { loose: false, includePrerelease: Boolean(includePrerelease) } });
    }
  }
  return ranges;
}

it('every range explanation agrees with satisfies at and just around each boundary it names', () => {
  let explained = 0;
  let comparisons = 0;
  let satisfied = 0;
  let unsatisfied = 0;
  for (const { range, options } of fixtureRanges()) {
    for (const includePrerelease of [false, true]) {
      const asked: Options = { loose: options.loose, includePrerelease };
      let explanation;
      try {
        explanation = explainRange(range, asked);
      } catch (error) {
        // A range node-semver cannot read is refused with the fixed sentence, as range-parse lists them.
        expect(error, range).toBeInstanceOf(SemverCheckerError);
        expect(validRange(range, asked), range).toBeNull();
        continue;
      }
      explained += 1;
      expect(explanation.normalized, range).toBe(validRange(range, asked));

      const claims = explanation.alternatives.map((alternative) => readAlternative(alternative.words));
      // The structured comparators say the same thing as the words next to them.
      expect(
        explanation.alternatives.map((alternative) =>
          alternative.comparators.map((c) => ({ op: c.operator, version: c.version })),
        ),
        range,
      ).toEqual(claims);

      const named = new Set<string>();
      for (const claim of claims.flat()) for (const candidate of around(claim.version)) named.add(candidate);
      for (const candidate of [...named, '0.0.0', '0.0.1', '1.0.0', '1.0.0-0', '99.0.0']) {
        if (parse(candidate) === null) continue;
        const expected = satisfies(candidate, range, asked);
        comparisons += 1;
        if (expected) satisfied += 1;
        else unsatisfied += 1;
        expect(
          claimedBy(claims, candidate, includePrerelease),
          `${range} (${JSON.stringify(asked)}) at ${candidate}`,
        ).toBe(expected);
      }
    }
  }
  // The property is not vacuous: many ranges were explained and both answers were seen many times.
  expect(explained).toBeGreaterThan(800);
  expect(comparisons).toBeGreaterThan(15000);
  expect(satisfied).toBeGreaterThan(4000);
  expect(unsatisfied).toBeGreaterThan(10000);
});

it('range explanations read as plain words alternative by alternative', () => {
  const caret = explainRange('^1.2.3 || >=4.0.0 <5.0.0', NO_OPTIONS);
  expect(caret.normalized).toBe('>=1.2.3 <2.0.0-0||>=4.0.0 <5.0.0');
  expect(caret.alternatives.map((alternative) => alternative.words)).toEqual([
    '1.2.3 or higher, and lower than 2.0.0, with no 2.0.0 pre-release',
    '4.0.0 or higher, and lower than 5.0.0',
  ]);
  expect(caret.alternatives[0]?.comparators.map((c) => c.words)).toEqual([
    '1.2.3 or higher',
    'lower than 2.0.0, with no 2.0.0 pre-release',
  ]);
  expect(caret.prereleaseNote).toContain('same major, minor and patch');

  const operators: [string, string][] = [
    ['>=1.2.3', '1.2.3 or higher'],
    ['>1.2.3', 'higher than 1.2.3'],
    ['<=1.2.3', '1.2.3 or lower'],
    ['<1.2.3', 'lower than 1.2.3'],
    ['=1.2.3', 'exactly 1.2.3'],
    ['1.2.3', 'exactly 1.2.3'],
    ['1.2.3 - 2.3.4', '1.2.3 or higher, and 2.3.4 or lower'],
    ['~1.2', '1.2.0 or higher, and lower than 1.3.0, with no 1.3.0 pre-release'],
    ['1.x', '1.0.0 or higher, and lower than 2.0.0, with no 2.0.0 pre-release'],
    ['>=1.2.3-beta.2', '1.2.3-beta.2 or higher'],
  ];
  for (const [range, words] of operators) {
    expect(explainRange(range, NO_OPTIONS).alternatives[0]?.words, range).toBe(words);
  }

  for (const any of ['*', 'x', '']) {
    const everything = explainRange(any, NO_OPTIONS);
    expect(everything.normalized, 'range ' + JSON.stringify(any)).toBe('*');
    expect(everything.alternatives).toEqual([{ comparators: [], words: 'any version' }]);
  }
  expect(explainRange('<0.0.0-0', NO_OPTIONS).alternatives[0]?.words).toBe('no version at all');

  // With Include pre-releases a range written with x or a short version starts at the first pre-release of its lowest
  // version (npm writes >=1.2.0-0), and the rule note is not needed. A full version such as ^1.2.3 starts at 1.2.3.
  const included = explainRange('~1.2', { loose: false, includePrerelease: true });
  expect(included.normalized).toBe('>=1.2.0-0 <1.3.0-0');
  expect(included.alternatives[0]?.words).toBe(
    '1.2.0 or higher, including its pre-releases, and lower than 1.3.0, with no 1.3.0 pre-release',
  );
  expect(explainRange('^1.2.3', { loose: false, includePrerelease: true }).alternatives[0]?.words).toBe(
    '1.2.3 or higher, and lower than 2.0.0, with no 2.0.0 pre-release',
  );
  expect(included.prereleaseNote).toBeNull();
});

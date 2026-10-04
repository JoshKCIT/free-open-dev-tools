import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import compare from 'semver/functions/compare';
import { meta, sortVersions } from '../src/index';
import { NO_OPTIONS } from './loader';

let spies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  for (const spy of spies) spy.mockRestore();
});

const LOOSE = { loose: true };

it('the sort note says "differ only in build metadata" only for versions that are the same text without their build and have different builds', () => {
  // Same text without the build, different builds: build metadata only.
  const builds = sortVersions('1.2.3+a\n1.2.3+b', NO_OPTIONS);
  expect(builds.equalGroups).toBe(1);
  expect(builds.buildOnlyGroups).toBe(1);
  expect(builds.equalNote).toBe(
    '1 set of versions is equal in precedence: they differ only in build metadata (the part after +), which SemVer 2.0.0 ignores when ordering. Each set keeps the order you pasted it in.',
  );
  // A version with and without a build is the same case.
  expect(sortVersions('2.0.0+z\n2.0.0', NO_OPTIONS).buildOnlyGroups).toBe(1);

  // Plain duplicates, a leading v, and a loose leading equals sign are equal in precedence but not a build difference.
  for (const [text, options] of [
    ['1.2.3\nv1.2.3\n1.2.3', NO_OPTIONS],
    ['1.2.3\n1.2.3', NO_OPTIONS],
    ['=1.2.3\n1.2.3', LOOSE],
    ['1.2.3+a\n1.2.3+a', NO_OPTIONS],
    ['v1.2.3+a\n1.2.3+b', NO_OPTIONS],
  ] as const) {
    const result = sortVersions(text, options);
    expect(result.equalGroups, text).toBe(1);
    expect(result.buildOnlyGroups, text).toBe(0);
    expect(result.equalNote, text).toBe(
      '1 set of versions is equal in precedence: SemVer 2.0.0 gives them the same place in the order, whether the same version is pasted twice or written two ways. Each set keeps the order you pasted it in.',
    );
    expect(result.equalNote, text).not.toContain('build metadata');
  }

  // Both kinds in one paste say how many of the sets are build metadata only.
  const mixed = sortVersions('1.0.0+a\n1.0.0+b\n2.0.0\nv2.0.0\n3.0.0\n3.0.0+x\n3.0.0+y', NO_OPTIONS);
  expect(mixed.equalGroups).toBe(3);
  expect(mixed.buildOnlyGroups).toBe(2);
  expect(mixed.equalNote).toBe(
    '3 sets of versions are equal in precedence, and 2 of them differ only in build metadata (the part after +), which SemVer 2.0.0 ignores when ordering. Each set keeps the order you pasted it in.',
  );
  expect(sortVersions('1.0.0+a\n1.0.0+b\n2.0.0+c\n2.0.0+d', NO_OPTIONS).equalNote).toContain('2 sets of versions are');

  // Nothing equal, nothing to say.
  const none = sortVersions('1.0.0\n2.0.0', NO_OPTIONS);
  expect(none.equalGroups).toBe(0);
  expect(none.equalNote).toBeUndefined();
  expect(none.buildOnlyGroups).toBeUndefined();
});

it('the limits say numeric pre-release identifiers above 9,007,199,254,740,991 are compared as numbers by the semver package', () => {
  const line = meta.limits.find((text) => text.includes('9,007,199,254,740,991'));
  expect(line).toBeDefined();
  expect(line).toContain('pre-release');
  expect(line).toContain('compared as numbers');
  // The statement is true of the package this page uses: identifiers that differ only past 2^53 compare as equal.
  expect(compare('1.0.0-9007199254740993', '1.0.0-9007199254740992')).toBe(0);
  const huge = sortVersions('1.0.0-99999999999999999999\n1.0.0-100000000000000000000', NO_OPTIONS);
  expect(huge.equalGroups).toBe(1);
  expect(huge.buildOnlyGroups).toBe(0);
});

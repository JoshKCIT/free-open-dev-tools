/**
 * Uses npm's own packages (all devDependency-only, never shipped -- D-82)
 * as oracles for this package's name, version and range checks, and for
 * the finished package.json object itself.
 *
 * Sources fetched and quoted this session:
 * - validate-npm-package-name's own source (github.com/npm/validate-npm-package-name, lib/index.js)
 * - Semantic Versioning 2.0.0 (https://semver.org/spec/v2.0.0.html), section 11 and its own recommended regex
 * - the semver package's own README range grammar (https://github.com/npm/node-semver#ranges)
 */
import normalize from 'normalize-package-data';
import validate from 'validate-npm-package-name';
import semver from 'semver';
import { it, expect, vi } from 'vitest';
import { buildPackageJson, checkPackageName, isValidVersion, isValidRange } from '../src/index';

it('generated package.json passes normalize-package-data in strict mode with no warnings', () => {
  const { object, problems, warnings } = buildPackageJson({
    name: '@scope/my-lib',
    version: '1.0.0',
    description: 'A scoped library, built for this test.',
    license: 'MIT',
    repository: 'https://example.invalid/repo.git',
    bin: [{ command: 'my-lib', path: './bin/cli.js' }],
    scripts: [{ name: 'build', command: 'tsc' }],
  });
  expect(problems).toEqual([]);
  expect(warnings).toEqual([]);

  // normalize-package-data's own fixReadmeField always warns "missingReadme"
  // unless a readme file's content is present -- a real check about a
  // SEPARATE file this tool does not generate (that is readme-generator's
  // job, elsewhere in this phase). A real npm package always has one
  // alongside its package.json, so the test supplies a stand-in readme
  // here, isolating the oracle to this package.json's own fields.
  const candidate = { ...object, readme: 'stand-in readme content for this test only' };
  const strictWarnings: string[] = [];
  normalize(candidate, (w: string) => strictWarnings.push(w), true);
  expect(strictWarnings).toEqual([]);
});

it('package names are accepted or refused exactly as validate-npm-package-name decides', () => {
  const names = [
    'some-package',
    'example.com',
    'under_score',
    '123numeric',
    '@npm/thingy',
    '@jane/foo.js',
    'excited!',
    ' leading-space:and:weirdchars',
    'My-Lib',
    'http',
    'stream',
    'node_modules',
    'favicon.ico',
    '.hidden',
    '-dash-start',
    '_underscore-start',
    '',
    '@scope/pkg',
    '@scope/.pkg',
    'a'.repeat(215),
    'has~tilde',
    "has'quote",
    '@a/b/c',
  ];
  for (const name of names) {
    const real = validate(name);
    const ours = checkPackageName(name);
    expect(ours.validForNewPackages, name).toBe(real.validForNewPackages);
    expect(ours.validForOldPackages, name).toBe(real.validForOldPackages);
    expect(ours.warnings, name).toEqual(real.warnings ?? []);
    expect(ours.errors, name).toEqual(real.errors ?? []);
  }

  // The plan's own named example, and the exact message the fetched source gives.
  const myLib = checkPackageName('My-Lib');
  expect(myLib.warnings).toContain('name can no longer contain capital letters');
  expect(myLib.validForNewPackages).toBe(false);

  // Core module refusal (http is a Node.js core module name).
  expect(checkPackageName('http').warnings).toContain('http is a core module name');
});

it('versions follow Semantic Versioning 2.0.0 including the precedence examples in section 11', () => {
  expect(isValidVersion('1.0.0-alpha.1+build.5')).toBe(true);
  expect(isValidVersion('01.0.0')).toBe(false);
  expect(isValidVersion('1.0')).toBe(false);
  expect(isValidVersion('1.0.0-0.3.7')).toBe(true);
  expect(isValidVersion('1.0.0-x.7.z.92')).toBe(true);
  expect(isValidVersion('1.0.0-x-y-z.--')).toBe(true);
  expect(isValidVersion('1.0.0+21AF26D3----117B344092BD')).toBe(true);

  // Section 11's own precedence chain, quoted:
  // "1.0.0-alpha < 1.0.0-alpha.1 < 1.0.0-alpha.beta < 1.0.0-beta <
  //  1.0.0-beta.2 < 1.0.0-beta.11 < 1.0.0-rc.1 < 1.0.0"
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
  for (const v of chain) expect(isValidVersion(v), v).toBe(true);
  for (let i = 0; i < chain.length - 1; i++) {
    // semver itself is the precedence oracle here: it implements the exact
    // algorithm section 11 describes.
    expect(semver.lt(chain[i]!, chain[i + 1]!), `${chain[i]} < ${chain[i + 1]}`).toBe(true);
  }
});

it('dependency ranges are accepted or refused exactly as the npm semver package decides on the README examples and a generated battery', () => {
  const readmeExamples = [
    '1.2.7',
    '>=1.2.7',
    '>1',
    '>=1.2.7 <1.3.0',
    '1.2.7 || >=1.2.9 <2.0.0',
    '1.2.3 - 2.3.4',
    '1.2 - 2.3.4',
    '1.2.3 - 2.3',
    '1.2.3 - 2',
    '*',
    '1.x',
    '1.2.x',
    '',
    '1',
    '1.2',
    '~1.2.3',
    '~1.2',
    '~1',
    '~0.2.3',
    '~0.2',
    '~0',
    '~1.2.3-beta.2',
    '^1.2.3',
    '^0.2.3',
    '^0.0.3',
    '^1.2.3-beta.2',
    '^0.0.3-beta',
    '^1.2.x',
    '^0.0.x',
    '^0.0',
    '^1.x',
    '^0.x',
  ];

  const operators = ['', '=', '>', '>=', '<', '<='];
  const forms = [
    '1',
    '1.2',
    '1.2.3',
    '1.2.3-alpha',
    '1.2.3-alpha.1',
    '1.2.3+build',
    '1.2.3-alpha.1+build.5',
    '1.x',
    '1.2.x',
    'x',
    '*',
  ];
  const generated: string[] = [];
  for (const op of operators) for (const f of forms) generated.push(`${op}${f}`);
  for (const f of forms) {
    generated.push(`~${f}`);
    generated.push(`^${f}`);
  }
  generated.push('1.2.3 - 2.0.0', '1.2 - 2.3.4', '1.2.3 - 2.3', '1.2.3 - 2', '>=1.2.3 <2.0.0', '1.2.3 || 2.0.0');

  const invalidBattery = [
    'not-a-range',
    '>=',
    '1.2.3 -',
    '^^1.2.3',
    '1.2.3.4',
    '1..2.3',
    '>=1.2.3 <',
    '1.2.3-',
    '1.2.3+',
    '01.2.3',
    '1.02.3',
    '1.2.03',
    '1.2.3-01',
    'x.2.3',
    '*.2.3',
    '1.*.3',
    'V1.2.3',
    '~',
    '^',
    '-',
    '>=1.2.3<2.0.0',
    'garbage!!!',
    '1.2.3-alpha.',
    '1.2.3-.alpha',
  ];

  for (const t of [...readmeExamples, ...generated]) {
    expect(isValidRange(t), t).toBe(semver.validRange(t) !== null);
  }
  for (const t of invalidBattery) {
    expect(isValidRange(t), t).toBe(false);
    expect(semver.validRange(t), t).toBeNull();
  }
});

it('nothing is written to the console while building', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    buildPackageJson({ name: '@scope/my-lib', version: '1.0.0', license: 'MIT' });
    buildPackageJson({
      name: 'My-Lib',
      version: 'not-a-version',
      dependencies: [{ name: 'lodash', specifier: 'not-a-range!!!' }],
    });
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  }
});

import { it, expect } from 'vitest';
import { buildPackageJson, PackageJsonError, FIELDS, findField, classifySpecifier, SPDX_LICENSES } from '../src/index';

// Required top-level titles are plain it(...) calls, never nested in
// describe(...): this phase's verify scripts match by exact `fullName`,
// which vitest's JSON reporter would otherwise prefix with the describe
// name (03-01 precedent).

it('only fields the npm package.json documentation or the Node.js packages documentation defines are written', () => {
  const { object } = buildPackageJson({
    name: '@scope/my-lib',
    version: '1.0.0',
    description: 'desc',
    keywords: ['a', 'b'],
    homepage: 'https://example.invalid/',
    author: 'Jane Doe',
    license: 'MIT',
    repository: 'https://example.invalid/repo.git',
    main: 'index.js',
    type: 'module',
    exports: [{ subpath: '.', target: './index.js' }],
    bin: [{ command: 'cmd', path: './bin.js' }],
    scripts: [{ name: 'build', command: 'tsc' }],
    dependencies: [{ name: 'lodash', specifier: '^4.17.21' }],
    devDependencies: [{ name: 'vitest', specifier: '^3.0.0' }],
    peerDependencies: [{ name: 'react', specifier: '^19.0.0' }],
    files: ['dist'],
    engineNode: '>=20',
    packageManager: 'pnpm@10.0.0',
    private: true,
  });
  for (const key of Object.keys(object)) {
    expect(findField(key), key).toBeDefined();
  }
  expect(Object.keys(object).length).toBeGreaterThan(15);
});

it('every field carries an explanation and its documentation link', () => {
  for (const field of FIELDS) {
    expect(field.explanation.length, field.name).toBeGreaterThan(10);
    expect(field.docsUrl, field.name).toMatch(/^https:\/\//);
    expect(['npm', 'Node.js', 'Corepack']).toContain(field.readBy);
  }
});

it('bin, exports and files are written in the forms npm and Node.js document', () => {
  const { object } = buildPackageJson({
    name: 'x',
    exports: [
      { subpath: '.', target: './index.js' },
      { subpath: './extra', target: './extra.js' },
    ],
    bin: [{ command: 'x', path: './bin.js' }],
    files: ['dist', 'README.md'],
  });
  expect(object.exports).toEqual({ '.': './index.js', './extra': './extra.js' });
  expect(object.bin).toEqual({ x: './bin.js' });
  expect(Array.isArray(object.files)).toBe(true);
  expect(object.files).toEqual(['dist', 'README.md']);
});

it('My-Lib is refused for new packages as validate-npm-package-name refuses it', () => {
  const { object, problems } = buildPackageJson({ name: 'My-Lib', version: '1.0.0' });
  expect(object.name).toBeUndefined();
  expect(problems.some((p) => p.startsWith('name:'))).toBe(true);
});

it('http is refused as a core module name', () => {
  const { object, problems } = buildPackageJson({ name: 'http', version: '1.0.0' });
  expect(object.name).toBeUndefined();
  expect(problems.some((p) => p.includes('core module'))).toBe(true);
});

it('a valid scoped name is written unchanged', () => {
  const { object } = buildPackageJson({ name: '@scope/my-lib', version: '1.0.0' });
  expect(object.name).toBe('@scope/my-lib');
});

it('an invalid version is left out and reported, and a valid one is written', () => {
  const bad = buildPackageJson({ name: 'x', version: '01.0.0' });
  expect(bad.object.version).toBeUndefined();
  expect(bad.problems.some((p) => p.startsWith('version:'))).toBe(true);

  const good = buildPackageJson({ name: 'x', version: '1.0.0-alpha.1+build.5' });
  expect(good.object.version).toBe('1.0.0-alpha.1+build.5');
});

it('version defaults to 1.0.0 when omitted', () => {
  const { object } = buildPackageJson({ name: 'x' });
  expect(object.version).toBe('1.0.0');
});

it('lodash@^4.17.21 is a range, npm:lodash@4 an alias, file:../lib a local path, workspace:* a warning that npm does not read that protocol', () => {
  expect(classifySpecifier('^4.17.21').kind).toBe('range');
  expect(classifySpecifier('npm:lodash@4').kind).toBe('npm-alias');
  expect(classifySpecifier('file:../lib').kind).toBe('file');
  const workspace = classifySpecifier('workspace:*');
  expect(workspace.kind).toBe('workspace');
  expect(workspace.warning).toBeDefined();
});

it('a workspace: dependency is still written, with a warning', () => {
  const { object, warnings } = buildPackageJson({
    name: 'x',
    dependencies: [{ name: 'sibling', specifier: 'workspace:*' }],
  });
  expect((object.dependencies as Record<string, string>).sibling).toBe('workspace:*');
  expect(warnings.some((w) => w.includes('sibling'))).toBe(true);
});

it('a specifier npm cannot read at all is left out and reported as a problem', () => {
  const { object, problems } = buildPackageJson({
    name: 'x',
    dependencies: [{ name: 'bad', specifier: '???not-anything' }],
  });
  expect(object.dependencies).toBeUndefined();
  expect(problems.some((p) => p.includes('bad'))).toBe(true);
});

it('a script named __proto__ stays an own key and Object.prototype gains nothing', () => {
  const { object } = buildPackageJson({ name: 'x', scripts: [{ name: '__proto__', command: 'echo hi' }] });
  const scripts = object.scripts as Record<string, unknown>;
  expect(Object.hasOwn(scripts, '__proto__')).toBe(true);
  expect(Object.getOwnPropertyDescriptor(scripts, '__proto__')?.value).toBe('echo hi');
  expect(Object.getPrototypeOf({})).toBe(Object.prototype);
});

it('accepts an offered SPDX identifier, UNLICENSED, and SEE LICENSE IN <file>', () => {
  for (const id of SPDX_LICENSES) {
    expect(buildPackageJson({ name: 'x', license: id }).object.license).toBe(id);
  }
  expect(buildPackageJson({ name: 'x', license: 'UNLICENSED' }).object.license).toBe('UNLICENSED');
  expect(buildPackageJson({ name: 'x', license: 'SEE LICENSE IN LICENSE.txt' }).object.license).toBe(
    'SEE LICENSE IN LICENSE.txt',
  );
});

it('refuses a licence identifier not on the offered list', () => {
  const { object, problems } = buildPackageJson({ name: 'x', license: 'WTFPL' });
  expect(object.license).toBeUndefined();
  expect(problems.some((p) => p.startsWith('license:'))).toBe(true);
});

it('writes a repository URL as { type: "git", url }', () => {
  const { object } = buildPackageJson({ name: 'x', repository: 'https://example.invalid/repo.git' });
  expect(object.repository).toEqual({ type: 'git', url: 'https://example.invalid/repo.git' });
});

it('a valid engines.node range is written, an invalid one is refused', () => {
  expect(buildPackageJson({ name: 'x', engineNode: '>=20.0.0' }).object.engines).toEqual({ node: '>=20.0.0' });
  const bad = buildPackageJson({ name: 'x', engineNode: 'not-a-range' });
  expect(bad.object.engines).toBeUndefined();
  expect(bad.problems.some((p) => p.startsWith('engines.node:'))).toBe(true);
});

it('PackageJsonError is a real Error subclass', () => {
  expect(new PackageJsonError('x')).toBeInstanceOf(Error);
});

it('output is valid JSON reflecting the object', () => {
  const { output, object } = buildPackageJson({ name: 'x', version: '1.0.0', license: 'MIT' });
  expect(JSON.parse(output)).toEqual(object);
});

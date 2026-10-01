import { test, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from '../lib/catalog.mjs';

/**
 * Drives the real `scripts/check-licenses.mjs` as a subprocess against a throwaway fixture root (the
 * `FODT_CHECK_LICENSES_ROOT` hook), like the other check-licenses tests. A package that reaches a visitor through a
 * dependency of a dependency, or through a peer dependency, ships its code just as surely as a direct one, so its
 * notice must be preserved however deep it is.
 */
function makeFixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'fodt-check-licenses-deep-'));
  mkdirSync(join(root, 'docs'), { recursive: true });
  mkdirSync(join(root, 'tools', 'fake-tool', 'src'), { recursive: true });
  mkdirSync(join(root, 'apps', 'web'), { recursive: true });
  writeFileSync(join(root, 'apps', 'web', 'package.json'), JSON.stringify({ name: '@fodt/web', dependencies: {} }));
  return root;
}

/** Writes a fake installed MIT package with its own licence text and the extra manifest fields given. */
function writeFakePackage(root, name, extra = {}) {
  const dir = join(root, 'node_modules', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', license: 'MIT', ...extra }));
  writeFileSync(join(dir, 'LICENSE'), `Licence text of ${name}, used only by this test.\n`);
}

function declareDependency(root, pkgName) {
  writeFileSync(
    join(root, 'tools', 'fake-tool', 'package.json'),
    JSON.stringify({ name: '@fodt/fake-tool', version: '1.0.0', dependencies: { [pkgName]: '1.0.0' } }),
  );
}

function runCheckLicenses(root) {
  try {
    const output = execFileSync('node', [join(ROOT, 'scripts', 'check-licenses.mjs')], {
      env: { ...process.env, FODT_CHECK_LICENSES_ROOT: root },
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { status: 0, output };
  } catch (err) {
    return { status: err.status ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

test('a dependency of a dependency of a dependency, and a peer dependency, get their notices in THIRD-PARTY.md', () => {
  const root = makeFixtureRoot();
  try {
    writeFakePackage(root, 'fake-parent', { dependencies: { 'fake-child': '1.0.0' } });
    writeFakePackage(root, 'fake-child', { dependencies: { 'fake-grandchild': '1.0.0' } });
    // The grandchild needs the parent back (a cycle) and a peer, which must not hang the walk.
    writeFakePackage(root, 'fake-grandchild', {
      dependencies: { 'fake-parent': '1.0.0' },
      peerDependencies: { 'fake-peer': '1.0.0' },
    });
    writeFakePackage(root, 'fake-peer');
    declareDependency(root, 'fake-parent');
    const { status, output } = runCheckLicenses(root);
    expect(status, output).toBe(0);
    const notices = readFileSync(join(root, 'docs', 'THIRD-PARTY.md'), 'utf8');
    for (const name of ['fake-parent', 'fake-child', 'fake-grandchild', 'fake-peer']) {
      expect(notices).toContain(`Licence text of ${name}, used only by this test.`);
    }
    expect(notices).toContain('transitive (via fake-child)');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a deep dependency with no licence file fails the licence gate, and an uninstalled optional peer is ignored', () => {
  const root = makeFixtureRoot();
  try {
    writeFakePackage(root, 'fake-parent', {
      dependencies: { 'fake-child': '1.0.0' },
      peerDependencies: { 'fake-not-installed': '1.0.0' },
      peerDependenciesMeta: { 'fake-not-installed': { optional: true } },
    });
    writeFakePackage(root, 'fake-child', { dependencies: { 'fake-grandchild': '1.0.0' } });
    writeFakePackage(root, 'fake-grandchild');
    rmSync(join(root, 'node_modules', 'fake-grandchild', 'LICENSE'));
    declareDependency(root, 'fake-parent');
    const { status, output } = runCheckLicenses(root);
    expect(status).not.toBe(0);
    expect(output).toContain('fake-grandchild@1.0.0 ships no licence file');
    expect(output).not.toContain('fake-not-installed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a licence file named in lower case, such as license.md, is found on every platform', () => {
  const root = makeFixtureRoot();
  try {
    const dir = join(root, 'node_modules', 'fake-lower');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fake-lower', version: '1.0.0', license: 'MIT' }));
    writeFileSync(join(dir, 'license.md'), 'Lower-case licence text of fake-lower, used only by this test.\n');
    declareDependency(root, 'fake-lower');
    const result = runCheckLicenses(root);
    expect(result.output).not.toContain('ships no licence file');
    expect(result.status).toBe(0);
    expect(readFileSync(join(root, 'docs', 'THIRD-PARTY.md'), 'utf8')).toContain(
      'Lower-case licence text of fake-lower',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

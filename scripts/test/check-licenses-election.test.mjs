import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from '../lib/catalog.mjs';

/**
 * Drives the real `scripts/check-licenses.mjs` script as a subprocess against
 * a throwaway fixture root, the same way `scripts/test/bundled-data.test.mjs`
 * drives `collectBundledData` against a throwaway `toolsDir`, but a level up:
 * this script is not a set of exported pure functions, it is a CLI that
 * reads `FODT_CHECK_LICENSES_ROOT` (falling back to the real repository
 * root) and calls `process.exit`. Never edits the real repository's own
 * dependency tree.
 */
function makeFixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'fodt-check-licenses-'));
  mkdirSync(join(root, 'docs'), { recursive: true });
  mkdirSync(join(root, 'tools', 'fake-tool', 'src'), { recursive: true });
  mkdirSync(join(root, 'apps', 'web'), { recursive: true });
  writeFileSync(join(root, 'apps', 'web', 'package.json'), JSON.stringify({ name: '@fodt/web', dependencies: {} }));
  return root;
}

/** Writes a fake installed package at `<root>/node_modules/<name>` with the given licence string. */
function writeFakePackage(root, name, version, licence) {
  const dir = join(root, 'node_modules', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version, license: licence }));
  writeFileSync(join(dir, 'LICENSE'), `${licence} licence text for ${name}@${version}, used only by this test.\n`);
}

/** Declares `pkgName` as a runtime dependency of the fixture root's one throwaway tool. */
function declareDependency(root, pkgName, range) {
  writeFileSync(
    join(root, 'tools', 'fake-tool', 'package.json'),
    JSON.stringify({ name: '@fodt/fake-tool', version: '1.0.0', dependencies: { [pkgName]: range } }),
  );
}

/** Runs the real script against `root`, never throwing: returns `{ status, output }`. */
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

it('an exactly elected dual licence expression passes the licence gate', () => {
  const root = makeFixtureRoot();
  try {
    writeFakePackage(root, 'fake-dompurify', '1.0.0', '(MPL-2.0 OR Apache-2.0)');
    declareDependency(root, 'fake-dompurify', '1.0.0');
    const { status, output } = runCheckLicenses(root);
    expect(status, output).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('a single MPL-2.0 licence is still blocked by the licence gate', () => {
  const root = makeFixtureRoot();
  try {
    writeFakePackage(root, 'fake-mpl-only', '1.0.0', 'MPL-2.0');
    declareDependency(root, 'fake-mpl-only', '1.0.0');
    const { status, output } = runCheckLicenses(root);
    expect(status).not.toBe(0);
    expect(output).toContain('MPL-2.0');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('a dual expression that is not on the reviewed list is still refused', () => {
  const root = makeFixtureRoot();
  try {
    writeFakePackage(root, 'fake-mpl-gpl', '1.0.0', '(MPL-2.0 OR GPL-3.0)');
    declareDependency(root, 'fake-mpl-gpl', '1.0.0');
    const { status, output } = runCheckLicenses(root);
    expect(status).not.toBe(0);
    expect(output).toContain('MPL-2.0 OR GPL-3.0');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

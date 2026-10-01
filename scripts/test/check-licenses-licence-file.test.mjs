import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from '../lib/catalog.mjs';

/**
 * Drives the real `scripts/check-licenses.mjs` script as a subprocess against a
 * throwaway fixture root (the `FODT_CHECK_LICENSES_ROOT` hook), the same way
 * `check-licenses-election.test.mjs` does. Some published packages spell the
 * licence file `LICENCE.md`; the gate must find it, and must still refuse a
 * package that ships no licence file under any accepted name.
 */
function makeFixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'fodt-check-licenses-file-'));
  mkdirSync(join(root, 'docs'), { recursive: true });
  mkdirSync(join(root, 'tools', 'fake-tool', 'src'), { recursive: true });
  mkdirSync(join(root, 'apps', 'web'), { recursive: true });
  writeFileSync(join(root, 'apps', 'web', 'package.json'), JSON.stringify({ name: '@fodt/web', dependencies: {} }));
  return root;
}

/** Writes a fake installed MIT package; `licenceFile` names the notice file, or is null for none. */
function writeFakePackage(root, name, version, licenceFile, text) {
  const dir = join(root, 'node_modules', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version, license: 'MIT' }));
  if (licenceFile) writeFileSync(join(dir, licenceFile), text);
}

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

it('a dependency whose licence file is named LICENCE.md passes the licence gate and its notice is preserved', () => {
  const root = makeFixtureRoot();
  try {
    const text = 'MIT licence text kept in LICENCE.md, used only by this test.';
    writeFakePackage(root, 'fake-licence-md', '1.0.0', 'LICENCE.md', `${text}\n`);
    declareDependency(root, 'fake-licence-md', '1.0.0');
    const { status, output } = runCheckLicenses(root);
    expect(status, output).toBe(0);
    expect(readFileSync(join(root, 'docs', 'THIRD-PARTY.md'), 'utf8')).toContain(text);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('a dependency with no licence file under any accepted name still fails the licence gate', () => {
  const root = makeFixtureRoot();
  try {
    writeFakePackage(root, 'fake-no-licence', '1.0.0', null, '');
    declareDependency(root, 'fake-no-licence', '1.0.0');
    const { status, output } = runCheckLicenses(root);
    expect(status).not.toBe(0);
    expect(output).toContain('ships no licence file');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

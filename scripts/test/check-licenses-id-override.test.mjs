import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from '../lib/catalog.mjs';

/**
 * Drives the real `scripts/check-licenses.mjs` script as a subprocess against a throwaway fixture root (the
 * `FODT_CHECK_LICENSES_ROOT` hook), the same way `check-licenses-licence-file.test.mjs` does. A package whose manifest
 * has no `license` field is accepted only when its exact name and version are on the licence-id override list, and the
 * list never overrides a licence the manifest does state.
 */
function makeFixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'fodt-check-licenses-id-'));
  mkdirSync(join(root, 'docs'), { recursive: true });
  mkdirSync(join(root, 'tools', 'fake-tool', 'src'), { recursive: true });
  mkdirSync(join(root, 'apps', 'web'), { recursive: true });
  writeFileSync(join(root, 'apps', 'web', 'package.json'), JSON.stringify({ name: '@fodt/web', dependencies: {} }));
  return root;
}

/** Writes a fake installed package with its own licence file; `manifestLicence` null leaves the field out. */
function writeFakePackage(root, name, version, manifestLicence, text) {
  const dir = join(root, 'node_modules', name);
  mkdirSync(dir, { recursive: true });
  const manifest = { name, version };
  if (manifestLicence !== null) manifest.license = manifestLicence;
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
  writeFileSync(join(dir, 'license'), text);
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

it('a package with no licence field passes the licence gate only at the exact overridden version', () => {
  const text = 'MIT licence text kept in the licence file, used only by this test.';
  const exact = makeFixtureRoot();
  const nextPatch = makeFixtureRoot();
  try {
    writeFakePackage(exact, 'khroma', '2.1.0', null, `${text}\n`);
    declareDependency(exact, 'khroma', '2.1.0');
    const accepted = runCheckLicenses(exact);
    expect(accepted.status, accepted.output).toBe(0);
    expect(readFileSync(join(exact, 'docs', 'THIRD-PARTY.md'), 'utf8')).toContain(text);

    writeFakePackage(nextPatch, 'khroma', '2.1.1', null, `${text}\n`);
    declareDependency(nextPatch, 'khroma', '2.1.1');
    const refused = runCheckLicenses(nextPatch);
    expect(refused.status).not.toBe(0);
    expect(refused.output).toContain('khroma@2.1.1');
    expect(refused.output).toContain('UNKNOWN');
  } finally {
    rmSync(exact, { recursive: true, force: true });
    rmSync(nextPatch, { recursive: true, force: true });
  }
});

it('a package that is not on the licence id override list still fails when its manifest names no licence', () => {
  const root = makeFixtureRoot();
  try {
    writeFakePackage(root, 'fake-no-licence-field', '1.0.0', null, 'Some licence text.\n');
    declareDependency(root, 'fake-no-licence-field', '1.0.0');
    const { status, output } = runCheckLicenses(root);
    expect(status).not.toBe(0);
    expect(output).toContain('fake-no-licence-field@1.0.0');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('the licence id override never replaces a licence the manifest does state', () => {
  const root = makeFixtureRoot();
  try {
    writeFakePackage(root, 'khroma', '2.1.0', 'GPL-3.0-only', 'Some licence text.\n');
    declareDependency(root, 'khroma', '2.1.0');
    const { status, output } = runCheckLicenses(root);
    expect(status).not.toBe(0);
    expect(output).toContain('GPL-3.0-only');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import { test, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from '../lib/catalog.mjs';

/**
 * A compiled engine hides its own licence inside a permissively licensed wrapper: the wrapper's package.json says MIT
 * while the WebAssembly inside it carries a standard library, a runtime or a parser under other terms. The licence gate
 * reads only package.json, so it needs a second rule: a dependency that ships a .wasm file must come with a bundledData
 * notice in the tool that declares it. Drives the real scripts/check-licenses.mjs against a throwaway fixture root, the
 * same way scripts/test/check-licenses-election.test.mjs does. Never edits the real repository's dependency tree.
 */
function makeFixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'fodt-check-licenses-wasm-'));
  mkdirSync(join(root, 'docs'), { recursive: true });
  mkdirSync(join(root, 'tools', 'fake-tool', 'src'), { recursive: true });
  mkdirSync(join(root, 'apps', 'web'), { recursive: true });
  writeFileSync(join(root, 'apps', 'web', 'package.json'), JSON.stringify({ name: '@fodt/web', dependencies: {} }));
  return root;
}

/** Writes a fake installed MIT package; `wasmFile` (a path inside the package) adds a small file of that name. */
function writeFakePackage(root, name, wasmFile) {
  const dir = join(root, 'node_modules', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', license: 'MIT' }));
  writeFileSync(join(dir, 'LICENSE'), `MIT licence text for ${name}@1.0.0, used only by this test.\n`);
  if (wasmFile) {
    const file = join(dir, wasmFile);
    mkdirSync(join(file, '..'), { recursive: true });
    // The eight bytes every WebAssembly module starts with.
    writeFileSync(file, Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
  }
}

/** Declares `pkgName` for the fixture's one tool, with or without a bundledData notice for the compiled engine. */
function declareTool(root, pkgName, withNotice) {
  const toolDir = join(root, 'tools', 'fake-tool');
  writeFileSync(
    join(toolDir, 'package.json'),
    JSON.stringify({ name: '@fodt/fake-tool', version: '1.0.0', dependencies: { [pkgName]: '1.0.0' } }),
  );
  const meta = { id: 'fake-tool', name: 'Fake Tool' };
  if (withNotice) {
    writeFileSync(
      join(toolDir, 'src', 'engine-LICENSE.txt'),
      'BSD-3-Clause licence text of the engine, used only by this test.\n',
    );
    meta.bundledData = [
      {
        name: 'Fake engine',
        source: 'https://example.invalid/engine',
        licence: 'BSD-3-Clause',
        licenceUrl: 'https://example.invalid/engine/LICENSE',
        attribution: 'Copyright the engine authors. Compiled into the WebAssembly module of the dependency.',
        noticeFile: 'src/engine-LICENSE.txt',
      },
    ];
  }
  writeFileSync(join(toolDir, 'src', 'meta.json'), JSON.stringify(meta));
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

test('a dependency that ships a wasm file fails the licence gate when its tool declares no bundled engine notice', () => {
  const root = makeFixtureRoot();
  try {
    writeFakePackage(root, 'fake-engine', 'dist/engine.wasm');
    declareTool(root, 'fake-engine', false);
    const { status, output } = runCheckLicenses(root);
    expect(status, output).not.toBe(0);
    expect(output).toContain('fake-tool');
    expect(output).toContain('fake-engine');
    expect(output).toContain('engine.wasm');
    expect(output).toContain('WebAssembly');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the same dependency passes once its tool declares a bundled engine notice', () => {
  const root = makeFixtureRoot();
  try {
    writeFakePackage(root, 'fake-engine', 'dist/engine.wasm');
    declareTool(root, 'fake-engine', true);
    const { status, output } = runCheckLicenses(root);
    expect(status, output).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a dependency without a wasm file needs no bundled engine notice', () => {
  const root = makeFixtureRoot();
  try {
    writeFakePackage(root, 'fake-plain', null);
    declareTool(root, 'fake-plain', false);
    const { status, output } = runCheckLicenses(root);
    expect(status, output).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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
    writeFileSync(file, new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
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

/**
 * The rules below decide per dependency, not per tool: a notice only covers a WebAssembly package when it names that
 * package. They use the helpers above plus these two, which let a test choose the tool's dependencies and notices.
 */
function writeNotice(root, fileName) {
  writeFileSync(
    join(root, 'tools', 'fake-tool', 'src', fileName),
    'Permissive licence text of the bundled item, used only by this test.\n',
  );
}

function bundledEntry(name, attribution, noticeFile) {
  return {
    name,
    source: 'https://example.invalid/item',
    licence: 'CC0-1.0',
    licenceUrl: 'https://example.invalid/item/LICENSE',
    attribution,
    noticeFile,
  };
}

function declareToolWith(root, dependencies, bundledData) {
  const toolDir = join(root, 'tools', 'fake-tool');
  writeFileSync(
    join(toolDir, 'package.json'),
    JSON.stringify({ name: '@fodt/fake-tool', version: '1.0.0', dependencies }),
  );
  const meta = { id: 'fake-tool', name: 'Fake Tool' };
  if (bundledData) meta.bundledData = bundledData;
  writeFileSync(join(toolDir, 'src', 'meta.json'), JSON.stringify(meta));
}

/** Writes a fake installed MIT package that itself depends on other packages. */
function writeWrapperPackage(root, name, dependencies) {
  const dir = join(root, 'node_modules', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', license: 'MIT', dependencies }));
  writeFileSync(join(dir, 'LICENSE'), `MIT licence text for ${name}@1.0.0, used only by this test.\n`);
}

test('a bundled data entry about something else does not cover a dependency that ships a wasm file', () => {
  const root = makeFixtureRoot();
  try {
    writeFakePackage(root, 'fake-engine', 'dist/engine.wasm');
    writeNotice(root, 'word-list-NOTICE.txt');
    declareToolWith(root, { 'fake-engine': '1.0.0' }, [
      bundledEntry(
        'Attribution word list',
        'A list of plain English words, unrelated to any engine.',
        'src/word-list-NOTICE.txt',
      ),
    ]);
    const { status, output } = runCheckLicenses(root);
    expect(status, output).not.toBe(0);
    expect(output).toContain('fake-tool');
    expect(output).toContain('fake-engine');
    expect(output).toContain('engine.wasm');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a wasm package reached only through a wrapper dependency is found', () => {
  const root = makeFixtureRoot();
  try {
    writeWrapperPackage(root, 'fake-wrapper', { 'fake-engine': '1.0.0' });
    writeFakePackage(root, 'fake-engine', 'dist/engine.wasm');
    declareToolWith(root, { 'fake-wrapper': '1.0.0' }, null);
    const { status, output } = runCheckLicenses(root);
    expect(status, output).not.toBe(0);
    expect(output).toContain('fake-tool');
    expect(output).toContain('fake-engine');
    expect(output).toContain('fake-wrapper');
    expect(output).toContain('engine.wasm');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a bundled data entry that names the wasm package covers it, even when it is reached through a wrapper', () => {
  const root = makeFixtureRoot();
  try {
    writeWrapperPackage(root, 'fake-wrapper', { '@fake-scope/fake-engine': '1.0.0' });
    writeFakePackage(root, '@fake-scope/fake-engine', 'dist/engine.wasm');
    writeNotice(root, 'engine-NOTICE.txt');
    declareToolWith(root, { 'fake-wrapper': '1.0.0' }, [
      bundledEntry(
        'Fake engine library',
        'Copyright the engine authors. Compiled into the WebAssembly module that @fake-scope/fake-engine 1.0.0 ships.',
        'src/engine-NOTICE.txt',
      ),
    ]);
    const { status, output } = runCheckLicenses(root);
    expect(status, output).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('one notice covers only the wasm package it names when a tool reaches two', () => {
  const root = makeFixtureRoot();
  try {
    writeFakePackage(root, 'fake-engine', 'dist/engine.wasm');
    writeFakePackage(root, 'other-engine', 'build/other.wasm');
    writeNotice(root, 'engine-NOTICE.txt');
    declareToolWith(root, { 'fake-engine': '1.0.0', 'other-engine': '1.0.0' }, [
      bundledEntry(
        'Engine library',
        'Compiled into the WebAssembly module of fake-engine 1.0.0.',
        'src/engine-NOTICE.txt',
      ),
    ]);
    const { status, output } = runCheckLicenses(root);
    expect(status, output).not.toBe(0);
    expect(output).toContain('other-engine');
    expect(output).not.toMatch(/fake-tool reaches fake-engine/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reaching the search depth limit is reported, not treated as no wasm file', () => {
  const root = makeFixtureRoot();
  try {
    writeFakePackage(root, 'fake-deep', 'a/b/c/d/e/f/g/h/i/j/k/l/engine.wasm');
    declareToolWith(root, { 'fake-deep': '1.0.0' }, null);
    const { status, output } = runCheckLicenses(root);
    expect(status, output).not.toBe(0);
    expect(output).toContain('fake-deep');
    expect(output).toMatch(/too deep|depth/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { inspect, type Report } from '../src/index';

/*
 * Real modules from the repository's own dependencies, read through require.resolve so a standalone copy of this folder
 * (which installs the same two packages as development dependencies) finds them: the Go (TinyGo) module of @wasm-fmt/gofmt
 * and the Rust (wasm-bindgen) module of @wasm-fmt/ruff_fmt. V8 in Node is the second opinion, and a test may compile where
 * the package under test never does: the imports, the exports and the size of every custom section must equal what V8
 * gives for the same bytes.
 */

const require = createRequire(import.meta.url);

const MODULES: readonly { label: string; specifier: string }[] = [
  { label: 'the Go module of @wasm-fmt/gofmt', specifier: '@wasm-fmt/gofmt/wasm' },
  { label: 'the Rust module of @wasm-fmt/ruff_fmt', specifier: '@wasm-fmt/ruff_fmt/wasm' },
];

const kindOf = (kind: string): string => (kind === 'func' ? 'function' : kind);

function agreement(report: Report, bytes: Uint8Array<ArrayBuffer>): { mine: string[]; v8: string[] } {
  const compiled = new WebAssembly.Module(bytes);
  const v8Imports = WebAssembly.Module.imports(compiled).map((i) => `import ${i.module}.${i.name}:${i.kind}`);
  const v8Exports = WebAssembly.Module.exports(compiled).map((e) => `export ${e.name}:${e.kind}`);
  const names = [...new Set(report.customs.rows.map((c) => c.name))].sort();
  const v8Customs = names.map(
    (name) =>
      `custom ${name}: ${WebAssembly.Module.customSections(compiled, name)
        .map((b) => b.byteLength)
        .join(',')}`,
  );
  const mineCustoms = names.map(
    (name) =>
      `custom ${name}: ${report.customs.rows
        .filter((c) => c.name === name)
        .map((c) => c.size)
        .join(',')}`,
  );
  return {
    mine: [
      ...report.imports.rows.map((i) => `import ${i.module}.${i.field}:${kindOf(i.kind)}`),
      ...report.exports.rows.map((e) => `export ${e.name}:${kindOf(e.kind)}`),
      ...mineCustoms,
    ],
    v8: [...v8Imports, ...v8Exports, ...v8Customs],
  };
}

it('real Go and Rust modules give the imports, exports and custom section sizes V8 gives', () => {
  for (const { label, specifier } of MODULES) {
    const bytes = new Uint8Array(readFileSync(require.resolve(specifier)));
    const report = inspect(bytes);
    expect(report.kind, label).toBe('module');
    expect(report.findings, `${label} reads with no finding`).toEqual([]);
    expect(report.imports.leftOut + report.exports.leftOut, `${label} fits in the rows kept`).toBe(0);
    const { mine, v8 } = agreement(report, bytes);
    expect(mine, label).toEqual(v8);
    // The function count and the section sizes are what the bytes hold.
    expect(report.functions.defined, label).toBeGreaterThan(100);
    expect(
      report.sections.reduce((sum, s) => sum + s.size, 0),
      label,
    ).toBeLessThan(bytes.length);
    expect(report.imports.count + report.exports.count, label).toBeGreaterThan(0);
  }
});

it('the producers and target features of the real modules are decoded when they have them', () => {
  const rust = inspect(new Uint8Array(readFileSync(require.resolve('@wasm-fmt/ruff_fmt/wasm'))));
  const names = rust.customs.rows.map((c) => c.name);
  if (names.includes('producers')) {
    expect(rust.producers.length, 'producers lists at least one field').toBeGreaterThan(0);
    for (const field of rust.producers) {
      expect(field.field.length).toBeGreaterThan(0);
      expect(field.values.length).toBeGreaterThan(0);
    }
  }
  if (names.includes('target_features')) expect(rust.targetFeatures.length).toBeGreaterThan(0);
});

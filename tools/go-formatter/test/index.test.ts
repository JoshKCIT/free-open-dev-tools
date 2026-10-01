import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { loadEngine, formatGo, meta as toolMeta } from '../src/index';
import { IMPORT_INPUT, IMPORT_GOLDEN } from './fixtures/go-gofmt-testdata/golden';

// The engine entry is wrapped only to COUNT calls, so a test can prove blank input never reaches the
// engine. The wrapper calls straight through; it is a spy, never an oracle.
const engineCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock('@wasm-fmt/gofmt/web', async (importOriginal) => {
  const real = await importOriginal<typeof import('@wasm-fmt/gofmt/web')>();
  return {
    ...real,
    format: (source: string) => {
      engineCalls.count += 1;
      return real.format(source);
    },
  };
});

const require = createRequire(import.meta.url);
const wasmBytes = (): Buffer => readFileSync(require.resolve('@wasm-fmt/gofmt/wasm'));

let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeAll(() => {
  loadEngine(wasmBytes());
});

beforeEach(() => {
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  for (const spy of consoleSpies) spy.mockRestore();
});

// Fixture: src/cmd/gofmt/testdata/import.input and import.golden at tag go1.25.5.
// URL: https://github.com/golang/go/tree/go1.25.5/src/cmd/gofmt/testdata
// Licence: BSD-3-Clause (vendored beside the fixture module as LICENSE).
it('gofmt testdata import golden: the import fixture formats byte for byte as gofmt does', () => {
  const result = formatGo(IMPORT_INPUT);
  expect(result).not.toBeNull();
  expect(result!.output).toBe(IMPORT_GOLDEN);
  // The first import block of the golden is the sorted block named by the fixture itself.
  expect(result!.output).toContain('import (\n\t"errors"\n\t"fmt"\n\t"io"\n\t"log"\n\t"math"\n)\n');
  expect(result!.inputBytes).toBe(new TextEncoder().encode(IMPORT_INPUT).length);
  expect(result!.outputBytes).toBe(new TextEncoder().encode(IMPORT_GOLDEN).length);
});

it('blank or whitespace-only source is not sent to the engine and gives no result', () => {
  const before = engineCalls.count;
  expect(formatGo('')).toBeNull();
  expect(formatGo('   ')).toBeNull();
  expect(formatGo('\n\t \r\n')).toBeNull();
  expect(engineCalls.count).toBe(before);
  // Real source does reach the engine, so the counter itself is proven to work.
  expect(formatGo('package p\n')).not.toBeNull();
  expect(engineCalls.count).toBe(before + 1);
});

it('loadEngine can be called twice and the engine prints nothing to the console', () => {
  expect(() => loadEngine(wasmBytes())).not.toThrow();
  expect(() => loadEngine(wasmBytes())).not.toThrow();
  formatGo('package main\n\nfunc main() {}\n');
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
});

it('meta pins the gofmt engine exactly and declares the Go and TinyGo licence notices', () => {
  expect(toolMeta.id).toBe('go-formatter');
  expect(toolMeta.dependencies).toEqual({ '@wasm-fmt/gofmt': '0.7.3' });
  const names = toolMeta.bundledData.map((entry) => entry.name);
  expect(names).toEqual(['Go standard library 1.25.5', 'TinyGo runtime']);
  for (const entry of toolMeta.bundledData) {
    expect(entry.licence).toBe('BSD-3-Clause');
    const noticeUrl = new URL(`../${entry.noticeFile}`, import.meta.url);
    expect(existsSync(noticeUrl)).toBe(true);
    expect(readFileSync(noticeUrl, 'utf8').trim().length).toBeGreaterThan(0);
  }
});

import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { loadEngine, formatCFamily, styleFor, meta as toolMeta } from '../src/index';
import * as F from './fixtures/llvm-clang-format/golden';

// The engine entry is wrapped only to COUNT calls and to RECORD the file name and style it is called with, so a
// test can prove blank input never reaches the engine and that the style string is exactly what the package
// builds. Otherwise the wrapper calls straight through; it is a spy, never an oracle.
const engineControl = vi.hoisted(() => ({
  count: 0,
  lastFileName: undefined as undefined | string,
  lastStyle: undefined as undefined | string,
}));
vi.mock('@wasm-fmt/clang-format/web', async (importOriginal) => {
  const real = await importOriginal<typeof import('@wasm-fmt/clang-format/web')>();
  return {
    ...real,
    format: (...args: Parameters<typeof real.format>) => {
      engineControl.count += 1;
      engineControl.lastFileName = args[1];
      engineControl.lastStyle = args[2];
      return real.format(...args);
    },
  };
});

const require = createRequire(import.meta.url);
const wasmBytes = (): Uint8Array => new Uint8Array(readFileSync(require.resolve('@wasm-fmt/clang-format/wasm')));

let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeAll(() => {
  loadEngine(wasmBytes());
});

beforeEach(() => {
  engineControl.count = 0;
  engineControl.lastFileName = undefined;
  engineControl.lastStyle = undefined;
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  for (const spy of consoleSpies) spy.mockRestore();
});

// Fixture: clang/docs/ClangFormatStyleOptions.rst at tag llvmorg-23.1.1, section IndentWidth.
// URL: https://github.com/llvm/llvm-project/blob/llvmorg-23.1.1/clang/docs/ClangFormatStyleOptions.rst
// Licence: Apache-2.0 WITH LLVM-exception (see ./fixtures/llvm-clang-format/LICENSE)

it('clang-format 23.1.1 documentation: the IndentWidth 3 example reproduces exactly', () => {
  const result = formatCFamily(F.INDENT_WIDTH_DOC_INPUT, { language: 'cpp', preset: 'LLVM', indentWidth: 3 });
  expect(result?.output).toBe(F.INDENT_WIDTH_DOC_OUTPUT);
  expect(result?.inputBytes).toBe(new TextEncoder().encode(F.INDENT_WIDTH_DOC_INPUT).length);
  expect(result?.outputBytes).toBe(new TextEncoder().encode(F.INDENT_WIDTH_DOC_OUTPUT).length);

  // The page's defaults (C++, LLVM, no indent width) use the preset's own width, which is two.
  expect(formatCFamily(F.INDENT_WIDTH_DOC_INPUT)?.output).toContain('\n  someFunction();\n');
});

it('the style string is a preset name alone or BasedOnStyle with an IndentWidth', () => {
  expect(styleFor('LLVM')).toBe('LLVM');
  expect(styleFor('GNU', undefined)).toBe('GNU');
  expect(styleFor('Google', 4)).toBe('{BasedOnStyle: Google, IndentWidth: 4}');

  // The same strings are what reaches the engine, with the language's file name.
  formatCFamily('int x;\n', { language: 'cpp', preset: 'Mozilla' });
  expect(engineControl.lastStyle).toBe('Mozilla');
  expect(engineControl.lastFileName).toBe('input.cpp');
  formatCFamily('int x;\n', { language: 'cpp', preset: 'Mozilla', indentWidth: 8 });
  expect(engineControl.lastStyle).toBe('{BasedOnStyle: Mozilla, IndentWidth: 8}');
});

it('blank or whitespace-only source is not sent to the engine and gives no result', () => {
  expect(formatCFamily('')).toBeNull();
  expect(formatCFamily('   \n\t \r\n')).toBeNull();
  expect(engineControl.count).toBe(0);
});

it('loadEngine can be called twice and the engine prints nothing to the console', async () => {
  // Loading again must not throw, and formatting afterwards still works.
  expect(() => loadEngine(wasmBytes())).not.toThrow();
  expect(formatCFamily(F.INDENT_WIDTH_DOC_INPUT, { indentWidth: 3 })?.output).toBe(F.INDENT_WIDTH_DOC_OUTPUT);

  // A first load in a fresh copy of the package, with the console spies already in place, prints nothing either.
  vi.resetModules();
  const fresh = await import('../src/index');
  fresh.loadEngine(wasmBytes());
  expect(fresh.formatCFamily(F.INDENT_WIDTH_DOC_INPUT, { indentWidth: 3 })?.output).toBe(F.INDENT_WIDTH_DOC_OUTPUT);

  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
});

it('meta pins clang-format exactly and declares the LLVM licence notice', () => {
  expect(toolMeta.dependencies).toEqual({ '@wasm-fmt/clang-format': '23.1.1' });
  expect(toolMeta.bundledData.map((b) => b.name)).toEqual(['LLVM clang-format 23.1.1']);
  const notice = toolMeta.bundledData[0];
  expect(notice?.licence).toBe('Apache-2.0 WITH LLVM-exception');
  const noticePath = new URL(`../${notice?.noticeFile ?? ''}`, import.meta.url);
  expect(existsSync(noticePath)).toBe(true);
  const text = readFileSync(noticePath, 'utf8');
  expect(text).toContain('The LLVM Project is under the Apache License v2.0 with LLVM Exceptions');
  expect(text).toContain('LLVM Exceptions to the Apache 2.0 License');
});

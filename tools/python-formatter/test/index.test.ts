import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { loadEngine, formatPython, meta as toolMeta } from '../src/index';
import * as R from './fixtures/ruff-formatter/golden';

// The engine entry is wrapped only to COUNT calls, so a test can prove blank input never reaches the
// engine. Otherwise the wrapper calls straight through; it is a spy, never an oracle.
const engineControl = vi.hoisted(() => ({ count: 0 }));
vi.mock('@wasm-fmt/ruff_fmt/web', async (importOriginal) => {
  const real = await importOriginal<typeof import('@wasm-fmt/ruff_fmt/web')>();
  return {
    ...real,
    format: (...args: Parameters<typeof real.format>) => {
      engineControl.count += 1;
      return real.format(...args);
    },
  };
});

const require = createRequire(import.meta.url);
const wasmBytes = (): Uint8Array => new Uint8Array(readFileSync(require.resolve('@wasm-fmt/ruff_fmt/wasm')));

let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeAll(() => {
  loadEngine(wasmBytes());
});

beforeEach(() => {
  engineControl.count = 0;
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  for (const spy of consoleSpies) spy.mockRestore();
});

// Fixtures: crates/ruff_python_formatter/resources/test/fixtures/ruff/quote_style.py and
// crates/ruff_python_formatter/tests/snapshots/format@quote_style.py.snap at tag 0.15.20.
// URL: https://github.com/astral-sh/ruff/tree/0.15.20/crates/ruff_python_formatter (MIT, see ./fixtures/ruff-formatter/LICENSE)

it('Ruff 0.15.20 quote_style snapshot: the double quote output reproduces byte for byte', () => {
  // Output 2 of the snapshot is produced with quote-style = Double, line-width 88, indent-width 4, spaces: the page defaults.
  const result = formatPython(R.QUOTE_STYLE_INPUT);
  expect(result).not.toBeNull();
  expect(result?.output).toBe(R.QUOTE_STYLE_DOUBLE_OUTPUT);
  expect(result?.outputBytes).toBe(new TextEncoder().encode(R.QUOTE_STYLE_DOUBLE_OUTPUT).length);
  expect(result?.inputBytes).toBe(new TextEncoder().encode(R.QUOTE_STYLE_INPUT).length);
});

it('blank source gives no result and a line already formatted by Ruff comes back unchanged', () => {
  expect(formatPython('')).toBeNull();
  expect(formatPython('   \n\t\r\n')).toBeNull();
  expect(engineControl.count).toBe(0);

  // A line taken from the published double-quote output: already in Ruff's style, so formatting it alone changes nothing.
  const line = R.QUOTE_STYLE_DOUBLE_OUTPUT.split('\n').find((l) => l === 'rb"br double"');
  expect(line).toBe('rb"br double"');
  expect(formatPython(`${line}\n`)?.output).toBe(`${line}\n`);
  expect(engineControl.count).toBe(1);
});

it('loadEngine can be called twice and the engine prints nothing to the console', () => {
  expect(() => loadEngine(wasmBytes())).not.toThrow();
  expect(() => loadEngine(wasmBytes())).not.toThrow();
  expect(formatPython('x = 1\n')?.output).toBe('x = 1\n');
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
});

it('meta pins Ruff exactly and declares the Ruff licence notice', () => {
  expect(toolMeta.dependencies).toEqual({ '@wasm-fmt/ruff_fmt': '0.15.20' });
  const notices = toolMeta.bundledData;
  expect(notices).toHaveLength(1);
  const ruff = notices[0];
  expect(ruff?.name).toBe('Ruff 0.15.20 formatter');
  expect(ruff?.licence).toBe('MIT');
  expect(ruff?.attribution).toContain('Charles Marsh');
  const noticePath = new URL(`../${ruff?.noticeFile ?? 'missing'}`, import.meta.url);
  expect(existsSync(noticePath)).toBe(true);
  const text = readFileSync(noticePath, 'utf8');
  expect(text).toContain('MIT License');
  expect(text).toContain('Charles Marsh');
});

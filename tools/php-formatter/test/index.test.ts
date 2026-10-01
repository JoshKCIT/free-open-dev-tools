import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { formatPhp, meta as toolMeta } from '../src/index';
import { PUBLISHED_CASES } from './fixtures/prettier-plugin-php/golden';

// Prettier's own entry is wrapped only to COUNT calls, so a test can prove blank input never reaches it.
// Otherwise the wrapper calls straight through; it is a spy, never an oracle.
const engineControl = vi.hoisted(() => ({ count: 0 }));
vi.mock('prettier/standalone', async (importOriginal) => {
  const real = await importOriginal<typeof import('prettier/standalone')>();
  const wrapped = {
    ...real,
    format: (...args: Parameters<typeof real.format>) => {
      engineControl.count += 1;
      return real.format(...args);
    },
  };
  return { ...wrapped, default: wrapped };
});

let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  engineControl.count = 0;
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  for (const spy of consoleSpies) spy.mockRestore();
});

// Fixture: the Prettier PHP plugin's own snapshot tests/array/__snapshots__/jsfmt.spec.mjs.snap at tag v0.25.0
// URL: https://github.com/prettier/plugin-php/tree/v0.25.0/tests/array (MIT, see ./fixtures/prettier-plugin-php/LICENSE)

it('prettier plugin-php 0.25.0 array snapshot: the first published case reproduces with its options', async () => {
  const first = PUBLISHED_CASES[0];
  expect(first?.name).toBe('arrays.php 1');
  if (!first) return;
  // The spec run passed no PHP version, which the plugin resolves to the newest it lists, 8.5; the page cannot use
  // the plugin's automatic detection, so the version is passed explicitly.
  const result = await formatPhp(first.input, { printWidth: first.printWidth, phpVersion: first.phpVersion ?? '8.5' });
  expect(result?.output).toBe(first.output);
});

it('blank or whitespace-only source is not sent to the engine and gives no result', async () => {
  expect(await formatPhp('')).toBeNull();
  expect(await formatPhp('   \n\t  \n')).toBeNull();
  expect(engineControl.count).toBe(0);
});

it('formatting twice in a row works and nothing is printed to the console', async () => {
  const first = PUBLISHED_CASES[0];
  if (!first) throw new Error('the published fixture has no cases');
  const options = { printWidth: first.printWidth, phpVersion: first.phpVersion ?? '8.5' };
  const a = await formatPhp(first.input, options);
  const b = await formatPhp(first.input, options);
  expect(a?.output).toBe(first.output);
  expect(b?.output).toBe(first.output);
  expect(engineControl.count).toBe(2);
  // The byte counts are UTF-8 lengths of the text in and out.
  expect(a?.inputBytes).toBe(new TextEncoder().encode(first.input).length);
  expect(a?.outputBytes).toBe(new TextEncoder().encode(first.output).length);
});

it('meta pins the PHP plugin and Prettier exactly', () => {
  expect(toolMeta.id).toBe('php-formatter');
  expect(toolMeta.dependencies).toEqual({ '@prettier/plugin-php': '0.25.0', prettier: '3.9.9' });
  expect(toolMeta.limits.length).toBeGreaterThan(0);
});

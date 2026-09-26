import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { translateEslintConfig, EslintToBiomeError } from '../src/index';
import { assertNeverRan, NEVER_RUN_JS } from './never-evaluates';

const FIXTURES_DIR = join(__dirname, 'fixtures', 'configs');

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf8');
}

it('a flat config is read from its syntax tree and only literal values are used', () => {
  const result = translateEslintConfig('export default [{ rules: { "no-debugger": "error" } }];', {
    format: 'flat',
  });
  expect(result.mapped).toEqual([{ eslint: 'no-debugger', biome: 'suspicious.noDebugger', level: 'error' }]);
});

it('a CommonJS module.exports flat config maps eqeqeq', () => {
  const result = translateEslintConfig('module.exports = [{ rules: { eqeqeq: "warn" } }];', { format: 'flat' });
  expect(result.mapped).toEqual([{ eslint: 'eqeqeq', biome: 'suspicious.noDoubleEquals', level: 'warn' }]);
});

it('computed values such as spreads, calls and variables are reported as could not read statically', () => {
  const text = readFixture('flat-covers-plugins.config.js');
  const result = translateEslintConfig(text, { format: 'flat' });
  expect(result.mapped.length).toBeGreaterThan(0);

  const spreadText = `import tseslint from 'typescript-eslint';
const shared = { rules: { 'no-debugger': 'error' } };
export default [
  ...tseslint.configs.recommended,
  shared,
  { rules: { eqeqeq: 'warn' } },
];`;
  const spreadResult = translateEslintConfig(spreadText, { format: 'flat' });
  expect(spreadResult.couldNotRead.some((c) => c.what.toLowerCase().includes('spread'))).toBe(true);
  expect(spreadResult.couldNotRead.some((c) => c.what.toLowerCase().includes('variable'))).toBe(true);
  // The literal entries around the unreadable ones are still read.
  expect(spreadResult.mapped).toEqual([{ eslint: 'eqeqeq', biome: 'suspicious.noDoubleEquals', level: 'warn' }]);
});

it('reading a flat config never runs the pasted code', async () => {
  // NEVER_RUN_JS is a full statement (an IIFE call ending in ";"); strip the
  // trailing semicolon so it drops into the array literal as one expression element.
  const payloadCall = NEVER_RUN_JS.replace(/;\s*$/, '');
  const payload = `export default [${payloadCall}, { rules: { "no-debugger": "error" } }];`;
  let result: ReturnType<typeof translateEslintConfig> | undefined;
  await assertNeverRan(() => {
    result = translateEslintConfig(payload, { format: 'flat' });
  });
  expect(result?.mapped).toEqual([{ eslint: 'no-debugger', biome: 'suspicious.noDebugger', level: 'error' }]);
  expect(result?.couldNotRead.some((c) => c.what.toLowerCase().includes('function call'))).toBe(true);
});

it('a syntax error in a flat config is reported with its line and column', () => {
  try {
    translateEslintConfig('export default [{ rules: { "no-debugger": "error" ] }];', { format: 'flat' });
    expect.unreachable('expected an EslintToBiomeError');
  } catch (err) {
    expect(err).toBeInstanceOf(EslintToBiomeError);
    expect((err as EslintToBiomeError).line).toBeGreaterThan(0);
  }
});

it('this repository own flat config yields its literal rules and reports its helper call, spreads and imports', () => {
  // A vendored copy of the repository's own root eslint.config.js (never
  // read from outside this folder -- a tool package must work standalone,
  // copied out with no reference to the rest of this repository, D-XX).
  const text = readFixture('eslint.config.js');
  const result = translateEslintConfig(text, { format: 'flat' });

  // The literal rules object (js and tseslint config helpers aside) still yields its own rules.
  expect(result.mapped.some((m) => m.eslint === 'eqeqeq')).toBe(true);
  expect(result.mapped.some((m) => m.eslint === 'no-var')).toBe(true);

  // The tseslint.config(...) helper call is reported, never resolved.
  expect(result.couldNotRead.some((c) => c.what.toLowerCase().includes('helper call'))).toBe(true);
  // js.configs.recommended (a member access) and ...tseslint.configs.recommended (a spread) are both reported.
  expect(result.couldNotRead.some((c) => c.what.toLowerCase().includes('member'))).toBe(true);
  expect(result.couldNotRead.some((c) => c.what.toLowerCase().includes('spread'))).toBe(true);
  // Every import declaration is named.
  expect(result.notCarried.some((n) => n.includes('@eslint/js'))).toBe(true);
  expect(result.notCarried.some((n) => n.includes('typescript-eslint'))).toBe(true);
});

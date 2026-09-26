import { it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { convertEnv, parseEnv, readTarget, meta, DotenvError } from '../src/index';
import { writeEnv } from '../src/targets';
import { readUpstreamShas, gitBlobShaOfFile } from './upstream';

const FIXTURES_DIR = join(__dirname, 'fixtures', 'dotenv');
const ENV_NAME = '.env';
const ENV_MULTILINE_NAME = '.env.multiline';

/** Decodes the small set of JS string escapes the upstream test files actually use (\\n, \\r, \\\\, \\' , \\"). */
function decodeJsStringEscapes(raw: string): string {
  return raw.replace(/\\(n|r|\\|'|")/g, (_m, ch: string) => {
    if (ch === 'n') return '\n';
    if (ch === 'r') return '\r';
    return ch;
  });
}

/** Extracts every `t.equal(parsed.KEY, 'value' | "value", ...)` assertion from an upstream tap test file, in source order. Never retyped by hand: read straight from the vendored file. */
function readUpstreamAssertions(testFileText: string): { key: string; value: string }[] {
  const results: { key: string; value: string }[] = [];
  const pattern = /t\.equal\(parsed\.([A-Za-z0-9_]+),\s*(['"])((?:\\.|(?!\2).)*)\2/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(testFileText)) !== null) {
    results.push({ key: match[1]!, value: decodeJsStringEscapes(match[3]!) });
  }
  return results;
}

/** Documented, deliberate differences from the upstream fixture's own assertions -- expected empty. */
const KNOWN_DIFFERENCES: string[] = [];

it('the upstream dotenv parse fixtures give the values the upstream tests expect, apart from the listed differences', () => {
  const differences: string[] = [];

  for (const [envFile, testFile] of [
    [ENV_NAME, 'test-parse.js'],
    [ENV_MULTILINE_NAME, 'test-parse-multiline.js'],
  ] as const) {
    const envText = readFileSync(join(FIXTURES_DIR, envFile), 'utf8');
    const testText = readFileSync(join(FIXTURES_DIR, testFile), 'utf8');
    const assertions = readUpstreamAssertions(testText);
    expect(assertions.length, `${testFile} yielded no readable assertions`).toBeGreaterThan(5);

    const { entries } = parseEnv(envText);
    const byKey = new Map(entries.map((e) => [e.key, e.value]));

    for (const assertion of assertions) {
      const actual = byKey.get(assertion.key);
      if (actual !== assertion.value) {
        differences.push(
          `${envFile}:${assertion.key}: expected ${JSON.stringify(assertion.value)}, got ${JSON.stringify(actual)}`,
        );
      }
    }
  }

  expect(differences, differences.join('\n')).toEqual(KNOWN_DIFFERENCES);
});

it('lines dotenv ignores, duplicate keys and invalid key names are reported with their line numbers', () => {
  const text = ['GOOD=1', 'not a line at all', 'BAD NAME=2', 'GOOD=3', '# a comment', ''].join('\n');
  const { entries, problems } = parseEnv(text);

  expect(entries.find((e) => e.key === 'GOOD')?.value).toBe('3');
  expect(problems.some((p) => p.line === 2)).toBe(true);
  expect(problems.some((p) => p.line === 3 && p.message.includes('BAD NAME'))).toBe(true);
  expect(problems.some((p) => p.line === 4 && p.message.toLowerCase().includes('already'))).toBe(true);
});

const ROUND_TRIP_VALUES = [
  'plain',
  'a=b',
  'has a # hash',
  'has \'single\' and "double" quotes',
  'has `backtick`',
  'has $DOLLAR and $$',
  'has\\backslash',
  '  leading and trailing  ',
  '',
  'line1\nline2',
  'line1\r\nline2',
  'café naïve résumé',
  '你好世界',
  '😀',
];

it('a value survives conversion to Compose environment, a Kubernetes ConfigMap, a Kubernetes Secret, shell export and JSON and back unchanged', () => {
  for (const target of ['compose', 'configmap', 'secret', 'shell', 'json'] as const) {
    for (const value of ROUND_TRIP_VALUES) {
      const source = `VALUE=${writeEnv([{ key: 'VALUE', value, line: 1, quote: 'none' }]).output.replace(/^VALUE=/, '')}`;
      const { entries: sourceEntries } = parseEnv(source);
      expect(sourceEntries[0]?.value, `writeEnv/.env source for ${JSON.stringify(value)}`).toBe(value);

      const converted = convertEnv(source, { to: target, serviceName: 'app', resourceName: 'app-config' });
      if (converted.unrepresentable.some((u) => u.key === 'VALUE')) continue; // listed, not altered -- covered by its own test
      const readBack = readTarget(converted.output, target);
      const found = readBack.entries.find((e) => e.key === 'VALUE');
      expect(found, `${target}: ${JSON.stringify(value)} -> ${converted.output}`).toBeDefined();
      expect(found!.value, `${target}: ${JSON.stringify(value)}`).toBe(value);
    }
  }
});

it('a dollar sign is written as a double dollar in Compose output as the Compose interpolation rules require', () => {
  const { output } = convertEnv('PRICE=5$\n', { to: 'compose', serviceName: 'app' });
  expect(output).toContain('$$');
  const readBack = readTarget(output, 'compose');
  expect(readBack.entries.find((e) => e.key === 'PRICE')?.value).toBe('5$');
});

it('Secret data is base64 of the UTF-8 value and decodes back to it', () => {
  const { output } = convertEnv('TOKEN=hello world\n', { to: 'secret', resourceName: 'app-secret' });
  expect(output).toMatch(/TOKEN:\s*aGVsbG8gd29ybGQ=/);
  const readBack = readTarget(output, 'secret');
  expect(readBack.entries.find((e) => e.key === 'TOKEN')?.value).toBe('hello world');
});

it('a value dotenv cannot represent without changing it is listed with its key instead of being altered', () => {
  // Mixes a newline with all three quote characters, so none of the four
  // .env quoting forms (unquoted, single, double, backtick) can hold it
  // unchanged.
  const hostile = 'has\nnewline and "double" and \'single\' and `backtick`';
  const result = writeEnv([{ key: 'VALUE', value: hostile, line: 1, quote: 'none' }]);
  expect(result.unrepresentable).toEqual([{ key: 'VALUE', reason: expect.any(String) }]);
  expect(result.output).not.toContain(hostile);
  expect(result.output).not.toContain('VALUE');
});

it('keys that Kubernetes or a POSIX shell does not accept are listed instead of being renamed', () => {
  // "MY.KEY" and "MY-KEY" are both valid dotenv key names, and both are
  // valid Kubernetes data keys (letters, digits, "-", "_" and "."), but
  // neither is a valid POSIX shell variable name (no "." or "-" allowed).
  const text = 'MY.KEY=1\nMY-KEY=2\nGOOD_KEY=3\n';

  const configmap = convertEnv(text, { to: 'configmap', resourceName: 'cfg' });
  expect(configmap.unrepresentable).toEqual([]);

  const shellResult = convertEnv(text, { to: 'shell' });
  expect(shellResult.unrepresentable.map((u) => u.key).sort()).toEqual(['MY-KEY', 'MY.KEY']);
  expect(shellResult.output).toContain('GOOD_KEY');
  expect(shellResult.output).not.toContain('MY.KEY');
  expect(shellResult.output).not.toContain('MY-KEY');
});

it('nothing is written to the console while converting', () => {
  const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    for (const target of ['compose', 'configmap', 'secret', 'shell', 'json'] as const) {
      convertEnv('A=1\nB=\'two\'\nC="th\\nree"\n# comment\nBAD LINE\n', { to: target });
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

it('every vendored upstream file matches the git blob SHA recorded in UPSTREAM.md', () => {
  const upstreamText = readFileSync(join(FIXTURES_DIR, 'UPSTREAM.md'), 'utf8');
  const entries = readUpstreamShas(upstreamText);
  expect(entries.length).toBeGreaterThan(0);
  for (const entry of entries) {
    const actualSha = gitBlobShaOfFile(join(FIXTURES_DIR, entry.path));
    expect(actualSha, entry.path).toBe(entry.sha);
  }
});

it('refuses input over the 1 MB limit', () => {
  const big = 'A=' + 'x'.repeat(1024 * 1024 + 10);
  expect(() => convertEnv(big, { to: 'json' })).toThrowError(DotenvError);
});

it('meta names this tool', () => {
  expect(meta.id).toBe('dotenv-toolkit');
});

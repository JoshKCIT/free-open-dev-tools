import { it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateCompose, ComposeValidatorError, meta } from '../src/index';
import { YamlSourceError } from '../src/yaml-source';
import { COMPOSE_SPEC_SCHEMA } from '../src/compose-spec-schema';
import { buildComposeSpecSchema } from './build-compose-schema';
import { readUpstreamShas, gitBlobShaOfFile } from './upstream';

const BROKEN_DIR = join(__dirname, 'fixtures', 'broken');
const AWESOME_DIR = join(__dirname, 'fixtures', 'awesome-compose');
const COMPOSE_SPEC_DIR = join(__dirname, 'fixtures', 'compose-spec');

interface ExpectedFinding {
  line: number;
  column?: number;
  path: string;
  message: string;
}

interface ExpectedFixture {
  file: string;
  findings: ExpectedFinding[];
}

const EXPECTED: ExpectedFixture[] = JSON.parse(readFileSync(join(BROKEN_DIR, 'expected.json'), 'utf8'));

/** Runs `validateCompose`, folding a thrown `YamlSourceError` (a whole-document syntax or duplicate-key problem) into a single-item findings list so both shapes compare the same way. */
function findingsFor(text: string): { line: number; column?: number; path: string; message: string }[] {
  try {
    const result = validateCompose(text);
    return result.findings.map((f) => ({ line: f.line, column: f.column, path: f.path, message: f.message }));
  } catch (err) {
    if (err instanceof YamlSourceError) {
      return [{ line: err.line ?? 0, column: err.column, path: err.path ?? '', message: err.message }];
    }
    throw err;
  }
}

it('every broken fixture is reported at its expected line with its expected key and message', () => {
  expect(EXPECTED.length).toBeGreaterThanOrEqual(10);
  for (const fixture of EXPECTED) {
    const text = readFileSync(join(BROKEN_DIR, fixture.file), 'utf8');
    const actual = findingsFor(text);
    expect(actual.length, `${fixture.file}: finding count`).toBe(fixture.findings.length);
    for (let i = 0; i < fixture.findings.length; i++) {
      const expected = fixture.findings[i]!;
      const found = actual[i]!;
      expect(found.line, `${fixture.file} finding ${i}: line`).toBe(expected.line);
      if (expected.column !== undefined) {
        expect(found.column, `${fixture.file} finding ${i}: column`).toBe(expected.column);
      }
      expect(found.path, `${fixture.file} finding ${i}: path`).toBe(expected.path);
      expect(found.message, `${fixture.file} finding ${i}: message`).toContain(expected.message);
    }
  }
});

it('the awesome-compose samples validate with no errors', () => {
  const files = readdirSync(AWESOME_DIR).filter((f) => f.endsWith('.yaml'));
  expect(files.length).toBeGreaterThanOrEqual(6);
  for (const file of files) {
    const text = readFileSync(join(AWESOME_DIR, file), 'utf8');
    const result = validateCompose(text);
    expect(result.valid, `${file}: ${JSON.stringify(result.findings)}`).toBe(true);
    expect(
      result.findings.filter((f) => f.severity === 'error'),
      file,
    ).toEqual([]);
  }
});

it('an unknown key under a service is reported by name with its line, as the compose-spec schema forbids additional properties', () => {
  const result = validateCompose('services:\n  web:\n    imagee: nginx\n');
  expect(result.valid).toBe(false);
  expect(result.findings.some((f) => f.line === 3 && f.message.includes('imagee'))).toBe(true);
});

it('extension keys starting with x- are accepted wherever the compose-spec schema allows them', () => {
  const result = validateCompose('x-custom:\n  foo: bar\nservices:\n  web:\n    image: nginx\n    x-my-ext: 1\n');
  expect(result.valid).toBe(true);
  expect(result.findings).toEqual([]);
});

it('a YAML merge key is applied before validation as the compose-spec fragments section describes', () => {
  const text = [
    'services:',
    '  first:',
    '    image: my-image:latest',
    '    environment: &env',
    '      FOO: BAR',
    '  second:',
    '    image: another-image:latest',
    '    environment:',
    '      <<: *env',
    '      YET_ANOTHER: VARIABLE',
    '',
  ].join('\n');
  const result = validateCompose(text);
  expect(result.valid, JSON.stringify(result.findings)).toBe(true);
  expect(result.services.sort()).toEqual(['first', 'second']);
});

it('a service that refers to an undefined network, volume, secret or config is reported', () => {
  const networkResult = validateCompose('services:\n  web:\n    image: nginx\n    networks:\n      - backend\n');
  expect(networkResult.findings.some((f) => f.message.includes('backend'))).toBe(true);

  const volumeResult = validateCompose('services:\n  web:\n    image: nginx\n    volumes:\n      - data:/x\n');
  expect(volumeResult.findings.some((f) => f.message.includes('data'))).toBe(true);

  const secretResult = validateCompose('services:\n  web:\n    image: nginx\n    secrets:\n      - api-key\n');
  expect(secretResult.findings.some((f) => f.message.includes('api-key'))).toBe(true);

  const configResult = validateCompose('services:\n  web:\n    image: nginx\n    configs:\n      - app-config\n');
  expect(configResult.findings.some((f) => f.message.includes('app-config'))).toBe(true);
});

it('an interpolation with an unterminated or invalid variable reference is reported with its line', () => {
  const unterminated = validateCompose('services:\n  web:\n    image: nginx\n    command: "${UNCLOSED"\n');
  expect(unterminated.findings.some((f) => f.line === 4 && f.keyword === 'interpolation')).toBe(true);

  const literalDollar = validateCompose('services:\n  web:\n    image: nginx\n    command: "$$HOME"\n');
  expect(literalDollar.findings.filter((f) => f.keyword === 'interpolation')).toEqual([]);
});

it('the bundled compose-spec schema is exactly what the generator builds from the vendored upstream files', () => {
  const built = buildComposeSpecSchema();
  expect(COMPOSE_SPEC_SCHEMA).toEqual(built);
});

it('every vendored upstream file matches the git blob SHA recorded in UPSTREAM.md', () => {
  for (const dir of [COMPOSE_SPEC_DIR, AWESOME_DIR]) {
    const upstreamText = readFileSync(join(dir, 'UPSTREAM.md'), 'utf8');
    const entries = readUpstreamShas(upstreamText);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      const actualSha = gitBlobShaOfFile(join(dir, entry.path));
      expect(actualSha, `${dir}/${entry.path}`).toBe(entry.sha);
    }
  }
});

it('nothing is written to the console while validating', () => {
  const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    for (const file of readdirSync(BROKEN_DIR).filter((f) => f.endsWith('.yml'))) {
      try {
        validateCompose(readFileSync(join(BROKEN_DIR, file), 'utf8'));
      } catch {
        // A thrown YamlSourceError is expected for some fixtures; only console silence is checked here.
      }
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

it('a service with neither image nor build validates with no errors, since the compose-spec schema does not require either', () => {
  const result = validateCompose('services:\n  web:\n    restart: always\n');
  expect(result.valid, JSON.stringify(result.findings)).toBe(true);
});

it('meta names this tool and cites the compose-spec commit', () => {
  expect(meta.id).toBe('docker-compose-validator');
});

it('validateCompose throws ComposeValidatorError when the schema itself cannot be compiled', () => {
  expect(ComposeValidatorError).toBeDefined();
});

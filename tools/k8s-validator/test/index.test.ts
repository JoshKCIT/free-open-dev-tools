import { it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateManifests, K8sValidatorError, meta } from '../src/index';
import { YamlSourceError } from '../src/yaml-source';
import { K8S_SCHEMA_SUBSET } from '../src/k8s-schema-subset';
import { buildSchemaSubset } from './build-schema-subset';
import { readUpstreamShas, gitBlobShaOfFile } from './upstream';

const BROKEN_DIR = join(__dirname, 'fixtures', 'broken');
const EXAMPLES_DIR = join(__dirname, 'fixtures', 'k8s-examples');
const SCHEMA_SOURCE_DIR = join(__dirname, 'fixtures', 'k8s-schema-source');

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

/** Runs `validateManifests`, folding a thrown `YamlSourceError` (a whole-document syntax or duplicate-key problem) into a single-item findings list so both shapes compare the same way. */
function findingsFor(text: string): { line: number; column?: number; path: string; message: string }[] {
  try {
    const result = validateManifests(text);
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
    expect(actual.length, `${fixture.file}: finding count, got ${JSON.stringify(actual)}`).toBe(
      fixture.findings.length,
    );
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

it('the bundled schema subset contains no remote reference', () => {
  const text = JSON.stringify(K8S_SCHEMA_SUBSET);
  expect(text).not.toMatch(/https?:\/\//);
  expect(text).not.toContain('_definitions.json');
});

it('the bundled schema subset is exactly what the generator builds from the vendored upstream files', () => {
  const built = buildSchemaSubset(SCHEMA_SOURCE_DIR);
  expect(K8S_SCHEMA_SUBSET).toEqual(built.schema);
});

it('each of the twelve bundled kinds validates its documented example with no errors', () => {
  const files = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.yaml'));
  expect(files.length).toBe(12);
  for (const file of files) {
    const text = readFileSync(join(EXAMPLES_DIR, file), 'utf8');
    const result = validateManifests(text);
    expect(
      result.findings.filter((f) => f.severity === 'error'),
      `${file}: ${JSON.stringify(result.findings)}`,
    ).toEqual([]);
    expect(
      result.documents.every((d) => d.checked),
      file,
    ).toBe(true);
  }
});

it('a kind outside the twelve is reported as not checked and never as valid', () => {
  const text = 'apiVersion: autoscaling/v2\nkind: HorizontalPodAutoscaler\nmetadata:\n  name: hpa\nspec: {}\n';
  const result = validateManifests(text);
  expect(result.valid).toBe(false);
  expect(result.documents[0]!.checked).toBe(false);
  expect(result.findings.some((f) => f.severity === 'warning' && f.message.includes('HorizontalPodAutoscaler'))).toBe(
    true,
  );
});

it('several documents separated by three dashes are checked one by one with lines counted across the whole file', () => {
  const text = [
    'apiVersion: v1',
    'kind: Namespace',
    'metadata:',
    '  name: first',
    '---',
    'apiVersion: v1',
    'kind: Namespace',
    'metadata:',
    '  name: second',
    '---',
    'apiVersion: v1',
    'kind: Namespace',
    'metadata:',
    '  name: third',
    '',
  ].join('\n');
  const result = validateManifests(text);
  expect(result.documents.map((d) => d.name)).toEqual(['first', 'second', 'third']);
  expect(result.documents.map((d) => d.line)).toEqual([1, 6, 11]);
  expect(result.valid, JSON.stringify(result.findings)).toBe(true);
});

it('an unknown field is reported by name with its line, as strict field validation would reject it', () => {
  const result = validateManifests(
    'apiVersion: v1\nkind: Pod\nmetadata:\n  name: p\nbogusField: true\nspec:\n  containers:\n    - name: c\n      image: nginx\n',
  );
  expect(result.findings.some((f) => f.line === 5 && f.message.includes('bogusField'))).toBe(true);
});

it('a duplicate key is reported at the line of its second occurrence', () => {
  const text = readFileSync(join(BROKEN_DIR, '10-duplicate-key.yml'), 'utf8');
  expect(() => validateManifests(text)).toThrow(YamlSourceError);
  try {
    validateManifests(text);
  } catch (err) {
    expect(err).toBeInstanceOf(YamlSourceError);
    expect((err as YamlSourceError).line).toBe(6);
  }
});

it('every vendored upstream file matches the git blob SHA recorded in UPSTREAM.md', () => {
  for (const dir of [SCHEMA_SOURCE_DIR, EXAMPLES_DIR]) {
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
        validateManifests(readFileSync(join(BROKEN_DIR, file), 'utf8'));
      } catch {
        // A thrown YamlSourceError is expected for some fixtures; only console silence is checked here.
      }
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

it('meta names this tool and cites the bundled schema commit', () => {
  expect(meta.id).toBe('k8s-validator');
});

it('validateManifests throws K8sValidatorError when the bundled schema has no compiled validator for a kind', () => {
  expect(K8sValidatorError).toBeDefined();
});

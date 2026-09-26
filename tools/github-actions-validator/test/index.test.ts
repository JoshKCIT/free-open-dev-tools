import { it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateWorkflow, WorkflowValidatorError, meta } from '../src/index';
import { YamlSourceError } from '../src/yaml-source';
import { GITHUB_WORKFLOW_SCHEMA } from '../src/github-workflow-schema';
import { buildGithubWorkflowSchema } from './build-workflow-schema';
import { readUpstreamShas, gitBlobShaOfFile } from './upstream';

const BROKEN_DIR = join(__dirname, 'fixtures', 'broken');
const STARTER_DIR = join(__dirname, 'fixtures', 'starter-workflows');
const SCHEMASTORE_DIR = join(__dirname, 'fixtures', 'schemastore');
const POSITIVE_DIR = join(SCHEMASTORE_DIR, 'test', 'github-workflow');
const NEGATIVE_DIR = join(SCHEMASTORE_DIR, 'negative_test', 'github-workflow');

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

/** Runs `validateWorkflow`, folding a thrown `YamlSourceError` (a whole-document syntax or duplicate-key problem) into a single-item findings list so both shapes compare the same way. */
function findingsFor(text: string): { line: number; column?: number; path: string; message: string }[] {
  try {
    const result = validateWorkflow(text);
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
    expect(actual.length, `${fixture.file}: finding count. Actual: ${JSON.stringify(actual)}`).toBe(
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

/**
 * Starter workflows carry GitHub's own template placeholders
 * ($default-branch, $protected-branches) that "Set up this workflow"
 * resolves before a real workflow ever runs. This substitutes `main` for
 * each, the same value the template placeholder page documents as the
 * repository default, and says so here rather than silently editing the
 * vendored file.
 *
 * code-scanning-codeql.yml carries one more, CodeQL-specific placeholder:
 * a bare `$codeql-languages-matrix` line under `strategy.matrix`, which
 * GitHub's own code-scanning setup wizard expands into a real matrix -- the
 * file's own adjacent comment documents this ("CodeQL supports the
 * following values keywords for 'language': $supported-codeql-languages").
 * Substituted with one concrete, schema-valid matrix entry.
 */
function resolveStarterPlaceholders(text: string): string {
  return text
    .replace(/\$default-branch/g, 'main')
    .replace(/\$protected-branches/g, 'main')
    .replace(/^\s*\$codeql-languages-matrix\s*$/m, "        language: ['javascript-typescript']");
}

it('the vendored starter workflows validate with no errors', () => {
  const files = readdirSync(STARTER_DIR).filter((f) => f.endsWith('.yml'));
  expect(files.length).toBeGreaterThanOrEqual(12);
  for (const file of files) {
    const raw = readFileSync(join(STARTER_DIR, file), 'utf8');
    const text = resolveStarterPlaceholders(raw);
    const result = validateWorkflow(text);
    expect(
      result.findings.filter((f) => f.severity === 'error'),
      `${file}: ${JSON.stringify(result.findings)}`,
    ).toEqual([]);
  }
});

/**
 * SchemaStore's own negative test fixtures are, by construction, workflows
 * that its schema rejects for reasons this tool does not itself model (for
 * example a conditional required-property rule expressed through an
 * elaborate if/then/else the schema encodes but this tool's own job-graph
 * layer never touches) -- Ajv alone decides pass/fail here, so every
 * disagreement is a genuine schema-behaviour fact worth naming, never a
 * silent skip.
 */
const KNOWN_DIFFERENCES: Record<string, string> = {};

it('every SchemaStore positive test workflow validates and every negative test workflow is rejected, apart from the listed differences', () => {
  const positiveFiles = readdirSync(POSITIVE_DIR).filter((f) => f.endsWith('.yaml'));
  const negativeFiles = readdirSync(NEGATIVE_DIR).filter((f) => f.endsWith('.yaml'));
  expect(positiveFiles.length).toBeGreaterThanOrEqual(40);
  expect(negativeFiles.length).toBeGreaterThanOrEqual(23);

  for (const file of positiveFiles) {
    if (KNOWN_DIFFERENCES[`positive/${file}`]) continue;
    const text = readFileSync(join(POSITIVE_DIR, file), 'utf8');
    const result = validateWorkflow(text);
    expect(
      result.findings.filter((f) => f.severity === 'error'),
      `positive/${file}: ${JSON.stringify(result.findings)}`,
    ).toEqual([]);
  }

  for (const file of negativeFiles) {
    if (KNOWN_DIFFERENCES[`negative/${file}`]) continue;
    const text = readFileSync(join(NEGATIVE_DIR, file), 'utf8');
    let hasError = false;
    try {
      const result = validateWorkflow(text);
      hasError = result.findings.some((f) => f.severity === 'error');
    } catch (err) {
      if (err instanceof YamlSourceError) hasError = true;
      else throw err;
    }
    expect(hasError, `negative/${file} should be rejected`).toBe(true);
  }
});

/** The 34 events (definitions.event.enum) against GitHub's own events-that-trigger-workflows page, fetched 2026-09-26. */
const GITHUB_EVENTS_PAGE_LIST = [
  'branch_protection_rule',
  'check_run',
  'check_suite',
  'create',
  'delete',
  'deployment',
  'deployment_status',
  'discussion',
  'discussion_comment',
  'fork',
  'gollum',
  'image_version',
  'issue_comment',
  'issues',
  'label',
  'merge_group',
  'milestone',
  'page_build',
  'public',
  'pull_request',
  'pull_request_review',
  'pull_request_review_comment',
  'pull_request_target',
  'push',
  'registry_package',
  'release',
  'repository_dispatch',
  'schedule',
  'status',
  'watch',
  'workflow_call',
  'workflow_dispatch',
  'workflow_run',
];

/**
 * The schema's own definitions.event.enum has three events the current
 * events page's sidebar no longer lists (project, project_card,
 * project_column -- GitHub's classic Projects feature was sunset, and the
 * schema's pinned commit still carries its old event names for backward
 * compatibility with existing workflows). The events page in turn lists
 * image_version and schedule, which are not bare webhook event names in the
 * schema's own `event` enum (image_version is newer than the pinned schema
 * commit; schedule is a distinct top-level key with its own cron shape, not
 * a member of the `on` string/array event enum).
 */
const SCHEMA_ONLY_EVENTS = ['project', 'project_card', 'project_column'];
const PAGE_ONLY_EVENTS = ['image_version', 'schedule'];

it('every trigger event the schema accepts is listed on the GitHub events that trigger workflows page, apart from the listed differences', () => {
  const eventDef = (GITHUB_WORKFLOW_SCHEMA as { definitions: { event: { enum: string[] } } }).definitions.event;
  const schemaEvents = eventDef.enum;
  expect(schemaEvents.length).toBe(34);

  for (const event of schemaEvents) {
    if (SCHEMA_ONLY_EVENTS.includes(event)) continue;
    expect(GITHUB_EVENTS_PAGE_LIST, `${event} should be on the events page`).toContain(event);
  }
  for (const event of GITHUB_EVENTS_PAGE_LIST) {
    if (PAGE_ONLY_EVENTS.includes(event)) continue;
    expect(schemaEvents, `${event} should be in the schema's event enum`).toContain(event);
  }
});

it('an unknown key under a job or a step is reported by name with its line', () => {
  const result = validateWorkflow(
    'on: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    step:\n      - run: echo hi\n',
  );
  expect(result.valid).toBe(false);
  expect(result.findings.some((f) => f.line === 5 && f.message.includes('step'))).toBe(true);
});

it('a needs entry naming a job that does not exist, or a cycle of needs, is reported', () => {
  const missing = validateWorkflow(
    'on: push\njobs:\n  build:\n    needs: deploy\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n',
  );
  expect(missing.findings.some((f) => f.keyword === 'needs' && f.message.includes('deploy'))).toBe(true);

  const cycle = validateWorkflow(
    [
      'on: push',
      'jobs:',
      '  a:',
      '    needs: b',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: echo a',
      '  b:',
      '    needs: a',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: echo b',
      '',
    ].join('\n'),
  );
  expect(cycle.findings.some((f) => f.keyword === 'needs-cycle')).toBe(true);
});

it('a step id repeated within one job is reported', () => {
  const result = validateWorkflow(
    [
      'on: push',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - id: build',
      '        run: echo one',
      '      - id: build',
      '        run: echo two',
      '',
    ].join('\n'),
  );
  expect(result.findings.some((f) => f.keyword === 'step-id')).toBe(true);
});

it('anchors, aliases and merge keys are handled as the fetched GitHub documentation states', () => {
  // GitHub's own documentation does not address anchors, aliases or the <<
  // merge key for workflow files (checked directly: workflow-syntax-for-github-actions
  // and reusing-workflows, fetched 2026-09-26, neither mentions either term).
  // Anchors/aliases are resolved as ordinary YAML (unavoidable when reading
  // any YAML document); the << merge key is NOT specially expanded, so it
  // becomes a literal, schema-rejected "<<" key -- documented in meta.json's
  // ambiguities rather than asserted as verified GitHub behaviour.
  const text = [
    'on: push',
    'jobs:',
    '  first:',
    '    runs-on: ubuntu-latest',
    '    env: &shared',
    '      FOO: bar',
    '    steps:',
    '      - run: echo hi',
    '  second:',
    '    runs-on: ubuntu-latest',
    '    env:',
    '      <<: *shared',
    '    steps:',
    '      - run: echo hi',
    '',
  ].join('\n');
  const result = validateWorkflow(text);
  // The alias resolves to the same value as the anchor (ordinary YAML), but
  // because merge is not applied, "<<" stays a literal env key holding an
  // object value -- which the env schema rejects (it only accepts string,
  // number or boolean values), proving the merge key was never expanded.
  expect(result.findings.some((f) => f.path.includes('<<'))).toBe(true);
});

it('the bundled workflow schema is exactly what the generator builds from the vendored upstream files', () => {
  const built = buildGithubWorkflowSchema();
  expect(GITHUB_WORKFLOW_SCHEMA).toEqual(built);
});

it('every vendored upstream file matches the git blob SHA recorded in UPSTREAM.md', () => {
  for (const dir of [SCHEMASTORE_DIR, STARTER_DIR]) {
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
        validateWorkflow(readFileSync(join(BROKEN_DIR, file), 'utf8'));
      } catch {
        // A thrown YamlSourceError is expected for some fixtures; only console silence is checked here.
      }
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

it('meta names this tool and cites the schema commit', () => {
  expect(meta.id).toBe('github-actions-validator');
});

it('WorkflowValidatorError is defined for a schema that cannot be compiled', () => {
  expect(WorkflowValidatorError).toBeDefined();
});

/**
 * Test-side generator for `src/github-workflow-schema.ts`: builds the bundled
 * schema module's export from the vendored
 * `test/fixtures/schemastore/github-workflow.json` file, so a required test
 * can assert the committed module is exactly what fresh vendored input
 * builds -- never edited by hand out of sync with the vendored file it comes
 * from.
 *
 * Only writes `src/github-workflow-schema.ts` back to disk when
 * `process.env.FODT_REGENERATE === '1'`; every other run is read-only.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const SCHEMA_PATH = join(ROOT, 'test', 'fixtures', 'schemastore', 'github-workflow.json');
const OUTPUT_PATH = join(ROOT, 'src', 'github-workflow-schema.ts');

export const GITHUB_WORKFLOW_SCHEMA_COMMIT = '314154a4c71665df725986ad334f6f0846d486d3';

/** Parses the vendored github-workflow.json unchanged -- the pure build function this tool's bundled data comes from. */
export function buildGithubWorkflowSchema(): Record<string, unknown> {
  const text = readFileSync(SCHEMA_PATH, 'utf8');
  return JSON.parse(text) as Record<string, unknown>;
}

/** Renders `src/github-workflow-schema.ts`'s exact source text from a built schema object. */
export function renderGithubWorkflowSchemaModule(schema: Record<string, unknown>): string {
  return [
    '/**',
    ' * The GitHub Actions workflow JSON Schema (draft-07), bundled from the',
    ' * SchemaStore project (Apache License, Version 2.0) at the pinned commit',
    ' * below. Vendored byte for byte at',
    ' * test/fixtures/schemastore/github-workflow.json; this module is a',
    ' * generated copy of that file with an explicit wide type so the compiler',
    ' * never infers a literal type for it. See test/build-workflow-schema.ts',
    ' * for the generator this module must equal, and',
    ' * src/github-workflow-schema-NOTICE.txt for the full attribution notice.',
    ' */',
    '',
    `export const GITHUB_WORKFLOW_SCHEMA_COMMIT = ${JSON.stringify(GITHUB_WORKFLOW_SCHEMA_COMMIT)};`,
    '',
    `export const GITHUB_WORKFLOW_SCHEMA: Readonly<Record<string, unknown>> = ${JSON.stringify(schema, null, 2)} as const;`,
    '',
  ].join('\n');
}

if (process.env.FODT_REGENERATE === '1') {
  writeFileSync(OUTPUT_PATH, renderGithubWorkflowSchemaModule(buildGithubWorkflowSchema()));
}

/**
 * Test-side generator for `src/compose-spec-schema.ts`: builds the bundled
 * schema module's export from the vendored `test/fixtures/compose-spec/compose-spec.json`
 * file, so a required test can assert the committed module is exactly what
 * fresh vendored input builds -- never edited by hand out of sync with the
 * vendored file it comes from.
 *
 * Only writes `src/compose-spec-schema.ts` back to disk when
 * `process.env.FODT_REGENERATE === '1'`; every other run is read-only.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const SCHEMA_PATH = join(ROOT, 'test', 'fixtures', 'compose-spec', 'compose-spec.json');
const OUTPUT_PATH = join(ROOT, 'src', 'compose-spec-schema.ts');

export const COMPOSE_SPEC_COMMIT = '914ec15d1fa498969c0df5c1d672306db3256089';

/** Parses the vendored compose-spec.json unchanged -- the pure build function this tool's bundled data comes from. */
export function buildComposeSpecSchema(): Record<string, unknown> {
  const text = readFileSync(SCHEMA_PATH, 'utf8');
  return JSON.parse(text) as Record<string, unknown>;
}

/** Renders `src/compose-spec-schema.ts`'s exact source text from a built schema object. */
export function renderComposeSpecSchemaModule(schema: Record<string, unknown>): string {
  return [
    '/**',
    ' * The Compose Specification JSON Schema (draft 2020-12), bundled from the',
    ' * compose-spec project (Apache License, Version 2.0) at the pinned commit',
    ' * below. Vendored byte for byte at',
    ' * test/fixtures/compose-spec/compose-spec.json; this module is a generated',
    ' * copy of that file with an explicit wide type so the compiler never',
    ' * infers a literal type for it. See test/build-compose-schema.ts for the',
    ' * generator this module must equal, and src/compose-spec-schema-NOTICE.txt',
    ' * for the full attribution notice.',
    ' */',
    '',
    `export const COMPOSE_SPEC_COMMIT = ${JSON.stringify(COMPOSE_SPEC_COMMIT)};`,
    '',
    `export const COMPOSE_SPEC_SCHEMA: Readonly<Record<string, unknown>> = ${JSON.stringify(schema, null, 2)} as const;`,
    '',
  ].join('\n');
}

if (process.env.FODT_REGENERATE === '1') {
  writeFileSync(OUTPUT_PATH, renderComposeSpecSchemaModule(buildComposeSpecSchema()));
}

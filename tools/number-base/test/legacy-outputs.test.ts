import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { it, expect } from 'vitest';
import * as api from '../src/index';
import { runMatrix, type LegacyApi } from './legacy-matrix';

const FIXTURE = fileURLToPath(new URL('./fixtures/legacy-outputs.json', import.meta.url));

/** Rows as plain JSON, so NaN and undefined compare the way the file stores them. */
const rowsNow = () => JSON.parse(JSON.stringify(runMatrix(api as unknown as LegacyApi))) as unknown[];

// Recording is allowed once, before the calculator exists: RECORD_LEGACY=1 with a fixture file that is not there yet.
// It never overwrites an existing file.
if (process.env.RECORD_LEGACY === '1' && !existsSync(FIXTURE)) {
  mkdirSync(fileURLToPath(new URL('./fixtures/', import.meta.url)), { recursive: true });
  const cases = rowsNow();
  const text = [
    '{',
    `  "recordedAt": ${JSON.stringify(new Date().toISOString())},`,
    `  "head": ${JSON.stringify(process.env.LEGACY_HEAD ?? 'unknown')},`,
    '  "cases": [',
    cases.map((row) => `    ${JSON.stringify(row)}`).join(',\n'),
    '  ]',
    '}',
    '',
  ].join('\n');
  writeFileSync(FIXTURE, text);
}

it('every earlier export gives the legacy answers recorded before the calculator existed', () => {
  const recorded = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { recordedAt: string; head: string; cases: unknown[] };
  expect(typeof recorded.recordedAt).toBe('string');
  expect(recorded.head).toMatch(/^[0-9a-f]{40}$/);
  expect(recorded.cases.length).toBeGreaterThan(5000);
  const now = rowsNow();
  expect(now.length).toBe(recorded.cases.length);
  // Compare row by row first so a difference names its own call, then the whole list.
  for (let i = 0; i < now.length; i++) {
    if (JSON.stringify(now[i]) !== JSON.stringify(recorded.cases[i])) expect(now[i]).toEqual(recorded.cases[i]);
  }
  expect(now).toEqual(recorded.cases);
});

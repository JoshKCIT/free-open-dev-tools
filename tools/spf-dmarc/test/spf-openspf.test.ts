import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { parseSpf } from '../src/index';
import { gitBlobShaOfFile, readUpstreamShas } from './upstream';

// The syntax cases of the OpenSPF rfc7208 test suite (pyspf commit 4bf96ea6), curated by hand from the cases whose checked
// domain holds exactly one SPF record. The suite is used for syntax only: a case is valid or a syntax error, never evaluated.
// test/fixtures/openspf/README.md says how each case was judged and why the dropped ones were dropped.

const DIR = join(__dirname, 'fixtures', 'openspf');

interface Case {
  section: string;
  name: string;
  spec: string | null;
  record: string;
  suiteResult: string;
  expect: 'syntax-error' | 'valid';
  reviewed: boolean;
  why: string;
}

interface Dropped {
  section: string;
  name: string;
  record: string;
  suiteResult: unknown;
  why: string;
}

const curated = JSON.parse(readFileSync(join(DIR, 'syntax-cases.json'), 'utf8')) as {
  suiteCommit: string;
  cases: Case[];
  dropped: Dropped[];
};

it('the curated OpenSPF rfc7208-tests cases are judged valid or a syntax error as the suite says', () => {
  expect(curated.suiteCommit).toBe('4bf96ea63af4999663809bae9b5530bce25e6f16');
  expect(curated.cases.length).toBeGreaterThanOrEqual(60);
  const verdicts = new Set(curated.cases.map((c) => c.expect));
  expect([...verdicts].sort()).toEqual(['syntax-error', 'valid']);
  // Every case was reviewed by hand and says why; every case that was left out says why too, so none is dropped silently.
  for (const c of curated.cases) {
    expect(c.reviewed, `${c.section} / ${c.name}`).toBe(true);
    expect(c.why.length, `${c.section} / ${c.name}`).toBeGreaterThan(10);
  }
  expect(curated.dropped.length).toBeGreaterThan(0);
  for (const d of curated.dropped) expect(d.why.length, `${d.section} / ${d.name}`).toBeGreaterThan(10);
  expect(curated.cases.length + curated.dropped.length).toBe(189);

  // Each record is judged by the parser alone: no DNS and no evaluation, so the verdict is the grammar's.
  const wrong: string[] = [];
  for (const c of curated.cases) {
    const record = parseSpf(c.record);
    const syntaxError = record.errors.length > 0;
    if (syntaxError !== (c.expect === 'syntax-error')) {
      wrong.push(
        `${c.section} / ${c.name} (${JSON.stringify(c.record)}): the suite says ${c.suiteResult}, curated ${c.expect}, the parser found ${record.errors.length} errors`,
      );
    }
  }
  expect(wrong).toEqual([]);

  // The same record never appears twice among the kept cases.
  const records = curated.cases.map((c) => c.record);
  expect(new Set(records).size).toBe(records.length);
});

it('the vendored OpenSPF files match the git blob SHAs recorded in UPSTREAM.md', () => {
  const entries = readUpstreamShas(readFileSync(join(DIR, 'UPSTREAM.md'), 'utf8'));
  expect(entries.map((e) => e.path).sort()).toEqual([
    'rfc7208-tests.CHANGES',
    'rfc7208-tests.LICENSE',
    'rfc7208-tests.yml',
  ]);
  for (const entry of entries) expect(gitBlobShaOfFile(join(DIR, entry.path)), entry.path).toBe(entry.sha);
});

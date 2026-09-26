import { it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { lintDockerfile, meta, RULES } from '../src/index';

const BROKEN_DIR = join(__dirname, 'fixtures', 'broken');

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

it('every broken fixture is reported at its expected line with its expected key and message', () => {
  expect(EXPECTED.length).toBeGreaterThanOrEqual(12);
  for (const fixture of EXPECTED) {
    const text = readFileSync(join(BROKEN_DIR, fixture.file), 'utf8');
    const actual = lintDockerfile(text).findings;
    expect(actual.length, `${fixture.file}: finding count (actual: ${JSON.stringify(actual)})`).toBe(
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

it('every rule carries an identifier, a plain explanation and a link to a Docker documentation page', () => {
  expect(RULES.length).toBeGreaterThanOrEqual(15);
  for (const rule of RULES) {
    expect(rule.id, 'id').toBeTruthy();
    expect(rule.title.length, `${rule.id} title`).toBeGreaterThan(0);
    expect(rule.explanation.length, `${rule.id} explanation`).toBeGreaterThan(20);
    expect(rule.docsUrl.startsWith('https://docs.docker.com/'), `${rule.id} docsUrl`).toBe(true);
    expect(['error', 'warning']).toContain(rule.severity);
  }
  const ids = new Set(RULES.map((r) => r.id));
  expect(ids.size).toBe(RULES.length);
});

it('nothing is written to the console while linting', () => {
  const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    for (const file of readdirSync(BROKEN_DIR).filter((f) => f.endsWith('.Dockerfile'))) {
      try {
        lintDockerfile(readFileSync(join(BROKEN_DIR, file), 'utf8'));
      } catch {
        // A thrown DockerfileLintError is expected for none of these fixtures today, but would be fine too.
      }
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

it('meta names this tool', () => {
  expect(meta.id).toBe('dockerfile-lint');
});

it('a Dockerfile with no problems reports no findings', () => {
  const result = lintDockerfile('FROM alpine:3.19\nUSER app\nCOPY . /app\nCMD ["/app/run"]\n');
  expect(result.findings).toEqual([]);
  expect(result.stages).toEqual([{ index: 0, line: 1, name: undefined, baseImage: 'alpine:3.19' }]);
});

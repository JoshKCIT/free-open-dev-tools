import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  collectFindings,
  decodeFindings,
  decodeMap,
  lookup,
  parseMap,
  type Finding,
  type ParsedMap,
} from '../src/index';
import { FIXTURES, readFixture } from './helpers';

/*
 * The tc39/source-map-tests suite at commit 9ea66b466fd37e8a4050033d23b3e1480973c3dc, vendored byte for byte (see
 * fixtures/tc39/UPSTREAM.md). Validity verdicts come from the decoder's own strict reader alone: the libraries are only
 * ever lookup oracles (oracles.test.ts). Every case and every action of the suite is run; the one kind the decoder does
 * not implement (a map of a map) is listed by name, never dropped.
 */

interface Action {
  actionType: 'checkMapping' | 'checkMappingTransitive' | 'checkIgnoreList';
  generatedLine: number;
  generatedColumn: number;
  originalSource: string | null;
  originalLine: number | null;
  originalColumn: number | null;
  mappedName: string | null;
  present?: string[];
  intermediateMaps?: string[];
}
interface SuiteTest {
  name: string;
  sourceMapFile: string;
  sourceMapIsValid: boolean;
  testActions?: Action[];
}

const SUITE = (JSON.parse(readFixture('tc39', 'source-map-spec-tests.json')) as { tests: SuiteTest[] }).tests;
const mapTextOf = (test: SuiteTest): string => readFixture('tc39', 'resources', test.sourceMapFile);

/** Everything the strict reader says about a map: its own findings and those of the pass over its mappings. */
function allFindings(text: string, positions: { line: number; column: number }[] = []): Finding[] {
  const map = parseMap(text, 'suite');
  return [...collectFindings(map), ...decodeFindings(decodeMap(map, positions))];
}

/** The transitive actions are the only kind this decoder does not do: a map of a map is out of scope (see the limits). */
const NOT_DONE_TRANSITIVE: { name: string; actions: number }[] = [
  { name: 'transitiveMapping', actions: 8 },
  { name: 'transitiveMappingWithThreeSteps', actions: 8 },
];

it('the 32 valid maps of the tc39 source-map-tests suite read with no finding', () => {
  const valid = SUITE.filter((test) => test.sourceMapIsValid);
  expect(valid).toHaveLength(32);
  const flagged = valid
    .map((test) => ({ name: test.name, findings: allFindings(mapTextOf(test)) }))
    .filter((entry) => entry.findings.length > 0);
  expect(flagged).toEqual([]);
});

it('the 67 invalid maps of the tc39 suite each get at least one finding', () => {
  const invalid = SUITE.filter((test) => !test.sourceMapIsValid);
  expect(invalid).toHaveLength(67);
  const missed = invalid.filter((test) => allFindings(mapTextOf(test)).length === 0).map((test) => test.name);
  expect(missed).toEqual([]);
});

it('every checkMapping action of the tc39 suite gives its expected original position', () => {
  let checked = 0;
  const wrong: string[] = [];
  for (const test of SUITE) {
    const actions = (test.testActions ?? []).filter((action) => action.actionType === 'checkMapping');
    if (actions.length === 0) continue;
    const map = parseMap(mapTextOf(test), test.name);
    const decoded = decodeMap(
      map,
      actions.map((action) => ({ line: action.generatedLine, column: action.generatedColumn })),
    );
    for (const action of actions) {
      checked++;
      const found = lookup(decoded, action.generatedLine, action.generatedColumn);
      if (action.originalLine === null) {
        // The single-field segment: the mapping is there but it names no original position.
        if (found.kind !== 'unmapped' || action.originalSource !== null)
          wrong.push(`${test.name} ${action.generatedColumn}`);
        continue;
      }
      const same =
        found.kind === 'mapped' &&
        found.source === action.originalSource &&
        found.line === action.originalLine &&
        found.column === action.originalColumn &&
        found.name === (action.mappedName ?? null);
      if (!same) wrong.push(`${test.name} ${action.generatedLine}:${action.generatedColumn}`);
    }
  }
  expect(checked).toBe(77);
  expect(wrong).toEqual([]);
});

it('every checkIgnoreList action of the tc39 suite gives its expected list', () => {
  let checked = 0;
  for (const test of SUITE) {
    for (const action of test.testActions ?? []) {
      if (action.actionType !== 'checkIgnoreList') continue;
      checked++;
      const map = parseMap(mapTextOf(test), test.name) as ParsedMap;
      const ignored = [...map.ignored].map((index) => map.sources[index]).sort();
      expect(ignored).toEqual([...(action.present ?? [])].sort());
    }
  }
  expect(checked).toBe(1);
});

it('the 16 transitive mapping actions of the tc39 suite are listed by name as not done', () => {
  const found = SUITE.map((test) => ({
    name: test.name,
    actions: (test.testActions ?? []).filter((action) => action.actionType === 'checkMappingTransitive').length,
  })).filter((entry) => entry.actions > 0);
  expect(found).toEqual(NOT_DONE_TRANSITIVE);
  expect(found.reduce((sum, entry) => sum + entry.actions, 0)).toBe(16);
  // The maps those actions need are vendored and valid, so only the multi-step lookup is left out, not the maps.
  for (const test of SUITE.filter((t) => NOT_DONE_TRANSITIVE.some((n) => n.name === t.name))) {
    expect(test.sourceMapIsValid).toBe(true);
    for (const action of test.testActions ?? []) {
      for (const name of action.intermediateMaps ?? [])
        expect(existsSync(join(FIXTURES, 'tc39', 'resources', name))).toBe(true);
    }
  }
});

it('every vendored file of the tc39 suite is the upstream blob named in UPSTREAM.md', () => {
  const upstream = readFixture('tc39', 'UPSTREAM.md');
  expect(upstream).toContain('9ea66b466fd37e8a4050033d23b3e1480973c3dc');
  expect(upstream).toContain('602ba8dbd7270a7b4980cff2ad46468e696af3b8');
  const rows = [...upstream.matchAll(/^\| (\S+) \| ([0-9a-f]{40}) \| (\d+) \|$/gm)].map((m) => ({
    path: m[1] ?? '',
    sha: m[2] ?? '',
    size: Number(m[3]),
  }));
  expect(rows.length).toBe(102);
  for (const row of rows) {
    // Upstream files hold no carriage return, so a checkout that turned line feeds into pairs is undone first.
    const bytes = readFileSync(join(FIXTURES, 'tc39', row.path));
    const text = bytes.toString('latin1').split('\r\n').join('\n');
    const normal = Buffer.from(text, 'latin1');
    const sha = createHash('sha1').update(`blob ${normal.length}\0`).update(normal).digest('hex');
    expect(sha, row.path).toBe(row.sha);
    expect(normal.length, row.path).toBe(row.size);
  }
  // Every map the suite names is vendored, and nothing else sits in resources.
  const wanted = new Set<string>();
  for (const test of SUITE) {
    wanted.add(test.sourceMapFile);
    for (const action of test.testActions ?? []) for (const name of action.intermediateMaps ?? []) wanted.add(name);
  }
  const present = new Set(readdirSync(join(FIXTURES, 'tc39', 'resources')));
  expect([...present].sort()).toEqual([...wanted].sort());
  expect(readFixture('tc39', 'LICENSE.md')).toContain('Ecma International');
});

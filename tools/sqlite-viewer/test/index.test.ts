import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { loadEngine, runSqlite, meta as toolMeta, type SqliteRunOptions } from '../src/index';

const require = createRequire(import.meta.url);
const here = (name: string): string => fileURLToPath(new URL(name, import.meta.url));

const OPTIONS: SqliteRunOptions = { displayRows: 500, exportFormat: 'none', includeDatabase: false };

let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeAll(async () => {
  await loadEngine(readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm')));
});

// The package must print nothing of its own: a visitor's page console stays empty (D-177).
beforeEach(() => {
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  for (const spy of consoleSpies) spy.mockRestore();
});

it('a query on an empty in-memory database returns its rows and the 64-bit integer 9007199254740993 exactly', () => {
  // SQLite documents INTEGER as a signed integer of up to 8 bytes (https://www.sqlite.org/datatype3.html), so
  // 9007199254740993 (2 to the 53, plus 1) must come back with every digit, not rounded to ...992 as a double would.
  const result = runSqlite(
    null,
    "create table t(a integer, b text); insert into t values (9007199254740993, 'exact'), (-9223372036854775808, 'min'); select a, b from t order by rowid;",
    OPTIONS,
  );
  expect(result.results).toHaveLength(1);
  expect(result.results[0]!.columns).toEqual(['a', 'b']);
  expect(result.results[0]!.rows).toEqual([
    ['9007199254740993', 'exact'],
    ['-9223372036854775808', 'min'],
  ]);
  expect(result.results[0]!.total).toBe(2);
  expect(result.results[0]!.truncated).toBe(false);
  expect(consoleSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
});

it('blank SQL on the committed fixture lists its table, view and index as sqlite_master records them', () => {
  // Fixture: test/fixtures/make-fixture.py (Python standard library sqlite3) wrote sample.sqlite with
  // PRAGMA page_size=1024, a table people, a view named_people and an index people_name, created in that order.
  // The names below are literals from that script, and the order is the order sqlite_master holds them in.
  const bytes = new Uint8Array(readFileSync(here('./fixtures/sample.sqlite')));
  const result = runSqlite(bytes, '   ', OPTIONS);
  expect(result.statements).toBe(0);
  expect(result.results).toEqual([]);
  expect(result.schema.map((entry) => [entry.type, entry.name, entry.table])).toEqual([
    ['table', 'people', 'people'],
    ['view', 'named_people', 'named_people'],
    ['index', 'people_name', 'people'],
  ]);
  expect(result.schema[0]!.sql).toBe(
    'CREATE TABLE people(id INTEGER PRIMARY KEY, name TEXT NOT NULL, big INTEGER, photo BLOB, note TEXT)',
  );
});

it('meta pins sql.js exactly and declares the SQLite and Emscripten notices', () => {
  expect(toolMeta.dependencies).toEqual({ 'sql.js': '1.14.2' });
  const names = toolMeta.bundledData.map((entry) => entry.name);
  expect(names).toEqual(['SQLite 3.49.1', 'Emscripten runtime']);
  for (const entry of toolMeta.bundledData) {
    const file = here(`../${entry.noticeFile}`);
    expect(existsSync(file), entry.noticeFile).toBe(true);
    expect(readFileSync(file, 'utf8').trim().length, entry.noticeFile).toBeGreaterThan(200);
    expect(entry.attribution).toContain('sql.js 1.14.2');
  }
  expect(toolMeta.bundledData[0]!.licence).toBe('Public domain');
  expect(toolMeta.bundledData[1]!.licence).toBe('MIT');
});

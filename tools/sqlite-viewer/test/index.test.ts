import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import {
  loadEngine,
  runSqlite,
  checkDatabaseSize,
  SqliteViewerError,
  MAX_DATABASE_BYTES,
  MAX_DISPLAY_ROWS,
  MAX_EXPORT_ROWS,
  meta as toolMeta,
  type SqliteRunOptions,
} from '../src/index';

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

/** The error a run must throw, or a failure of the test when it returns. */
function failureOf(bytes: Uint8Array | null, sql: string): SqliteViewerError {
  try {
    runSqlite(bytes, sql, OPTIONS);
  } catch (err) {
    expect(err).toBeInstanceOf(SqliteViewerError);
    expect((err as Error).name).toBe('SqliteViewerError');
    return err as SqliteViewerError;
  }
  throw new Error('runSqlite returned a result where an error was expected');
}

const sampleBytes = (): Uint8Array => new Uint8Array(readFileSync(here('./fixtures/sample.sqlite')));

it('PRAGMA table_info columns are cid, name, type, notnull, dflt_value and pk as the SQLite documentation lists', () => {
  // https://www.sqlite.org/pragma.html#pragma_table_info: the result has the columns cid, name, type, notnull,
  // dflt_value and pk; pk is zero for a column outside the primary key, otherwise its 1-based position in it;
  // dflt_value is the default as written, quotes included.
  const asStatement = runSqlite(
    null,
    "create table t(a, b text not null default 'x', c integer default 5, primary key (b, a)); pragma table_info(t);",
    OPTIONS,
  );
  expect(asStatement.results[0]!.columns).toEqual(['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk']);
  expect(asStatement.results[0]!.rows).toEqual([
    ['0', 'a', '', '0', 'NULL', '2'],
    ['1', 'b', 'TEXT', '1', "'x'", '1'],
    ['2', 'c', 'INTEGER', '0', '5', '0'],
  ]);
  // The same six facts in the schema the package reports for every table.
  expect(asStatement.schema).toHaveLength(1);
  expect(asStatement.schema[0]!.columns).toEqual([
    { cid: 0, name: 'a', type: '', notnull: false, dflt_value: '', pk: 2 },
    { cid: 1, name: 'b', type: 'TEXT', notnull: true, dflt_value: "'x'", pk: 1 },
    { cid: 2, name: 'c', type: 'INTEGER', notnull: false, dflt_value: '5', pk: 0 },
  ]);
  // A view lists its columns too; an index and a trigger list none.
  const withObjects = runSqlite(
    null,
    'create table t(a, b); create view v as select a from t; create index ti on t(b); create trigger tr after insert on t begin select 1; end;',
    OPTIONS,
  );
  expect(withObjects.schema.map((e) => [e.type, e.name, e.columns.length])).toEqual([
    ['table', 't', 2],
    ['view', 'v', 1],
    ['index', 'ti', 0],
    ['trigger', 'tr', 0],
  ]);
});

it('a BLOB shows as X quote hex quote with its length and only the first 32 bytes', () => {
  // https://www.sqlite.org/lang_expr.html#literal_values_constants_ writes a BLOB literal as x'hex', for example
  // X'53514C697465' for the five bytes of SQLite. 32 bytes show whole; the 33rd byte and later are replaced by an
  // ellipsis, and the full length is always printed.
  const result = runSqlite(
    null,
    "select x'DEADBEEF' as a, x'' as b, zeroblob(32) as c, zeroblob(40) as d, x'53514C697465' as e, x'0aff' as f;",
    OPTIONS,
  );
  expect(result.results[0]!.rows).toEqual([
    [
      "X'DEADBEEF' (4 bytes)",
      "X'' (0 bytes)",
      `X'${'00'.repeat(32)}' (32 bytes)`,
      `X'${'00'.repeat(32)}…' (40 bytes)`,
      "X'53514C697465' (6 bytes)",
      "X'0AFF' (2 bytes)",
    ],
  ]);
});

it('an error carries the SQLite message: no such table, incomplete input, file is not a database', () => {
  expect(failureOf(null, 'select * from nope;').message).toBe('no such table: nope');
  expect(failureOf(null, 'select * from').message).toBe('incomplete input');
  // The earlier statements of a failed run give no result: the error is all that comes back.
  expect(failureOf(null, 'create table t(a); select 1; select * from nope;').message).toBe('no such table: nope');
  // Four bytes that are not a database: the first statement, and a blank run that only reads the schema, both fail.
  const notADatabase = new Uint8Array([1, 2, 3, 4]);
  expect(failureOf(notADatabase, 'select 1;').message).toBe('file is not a database');
  expect(failureOf(notADatabase, '').message).toBe('file is not a database');
  // A syntax error names SQLite's own text.
  expect(failureOf(null, 'select 1 from where;').message).toMatch(/syntax error/);
});

it('results stop at the display cap with the total counted and exports stop at 200000 rows with a warning', () => {
  expect(MAX_DISPLAY_ROWS).toBe(500);
  expect(MAX_EXPORT_ROWS).toBe(200000);
  const rows = (n: number) =>
    `with recursive c(x) as (select 1 union all select x + 1 from c where x < ${n}) select x from c;`;

  const capped = runSqlite(null, rows(600), OPTIONS);
  expect(capped.results[0]!.rows).toHaveLength(500);
  expect(capped.results[0]!.rows[499]).toEqual(['500']);
  expect(capped.results[0]!.total).toBe(600);
  expect(capped.results[0]!.truncated).toBe(true);

  const hundred = runSqlite(null, rows(600), { ...OPTIONS, displayRows: 100 });
  expect(hundred.results[0]!.rows).toHaveLength(100);
  expect(hundred.results[0]!.total).toBe(600);
  expect(hundred.results[0]!.truncated).toBe(true);

  const whole = runSqlite(null, rows(500), OPTIONS);
  expect(whole.results[0]!.rows).toHaveLength(500);
  expect(whole.results[0]!.truncated).toBe(false);

  // One row more than the export limit: the export holds the header and 200000 rows, and says so.
  const exported = runSqlite(null, rows(200001), { ...OPTIONS, exportFormat: 'csv' });
  expect(exported.results[0]!.total).toBe(200001);
  expect(exported.exports).toHaveLength(1);
  const lines = exported.exports[0]!.content.split('\r\n');
  expect(lines).toHaveLength(200001);
  expect(lines[0]).toBe('x');
  expect(lines[200000]).toBe('200000');
  expect(exported.warnings).toEqual(['Result 1 has 200001 rows. Its export holds the first 200000.']);

  // Exactly the limit is not a cut.
  const exact = runSqlite(null, rows(200000), { ...OPTIONS, exportFormat: 'csv' });
  expect(exact.warnings).toEqual([]);
});

it('a database over 100 MiB is refused before it is opened and exactly 100 MiB is accepted', () => {
  expect(MAX_DATABASE_BYTES).toBe(104857600);
  expect(() => checkDatabaseSize(104857600)).not.toThrow();
  expect(() => checkDatabaseSize(0)).not.toThrow();
  const sentence =
    'This file is 100.1 MiB. The limit is 100 MiB because the database is copied into memory up to three times while it is open.';
  expect(() => checkDatabaseSize(104857601)).toThrow(SqliteViewerError);
  expect(() => checkDatabaseSize(104857601)).toThrow(sentence);
  // runSqlite refuses by length alone: the bytes are all zero, which the engine would call "file is not a database"
  // if it ever opened them.
  expect(failureOf(new Uint8Array(104857601), 'select 1;').message).toBe(sentence);
});

it('the changed database downloads and reopens with the change, while the input bytes are unchanged', () => {
  const input = sampleBytes();
  const before = Uint8Array.from(input);
  const changed = runSqlite(
    input,
    "update people set name = 'Zed' where id = 1; insert into people(id, name) values (5, 'New'); select count(*) from people;",
    { ...OPTIONS, includeDatabase: true },
  );
  expect(changed.results[0]!.rows).toEqual([['5']]);
  expect(changed.database).toBeInstanceOf(Uint8Array);
  // https://www.sqlite.org/fileformat2.html: every database file starts with the 16 bytes "SQLite format 3" and a NUL.
  expect(Buffer.from(changed.database!.subarray(0, 16)).toString('latin1')).toBe('SQLite format 3\u0000');

  const reopened = runSqlite(changed.database!, 'select id, name from people where id in (1, 5) order by id;', OPTIONS);
  expect(reopened.results[0]!.rows).toEqual([
    ['1', 'Zed'],
    ['5', 'New'],
  ]);
  // The array the caller handed in is byte for byte what it was.
  expect(Buffer.compare(Buffer.from(input), Buffer.from(before))).toBe(0);
  // And a run without the option offers no database.
  expect(runSqlite(sampleBytes(), 'select 1;', OPTIONS).database).toBeUndefined();
  // A second run on the original bytes starts from them again, not from the first run's change.
  const again = runSqlite(input, 'select name from people where id = 1;', OPTIONS);
  expect(again.results[0]!.rows).toEqual([['Ada']]);
});

it('rows read from the fixture agree with Python sqlite3 on the same file', () => {
  // Second opinion: Python 3.14.3 with its own SQLite 3.50.4 (an independent build from the 3.49.1 in the engine)
  // read test/fixtures/sample.sqlite with `python make-fixture.py --print` and printed these values. Python's
  // reading of each value is shown by the rule documented in meta.json (NULL, integer digits, the text, X'hex').
  const pythonMaster = [
    [
      'table',
      'people',
      'people',
      'CREATE TABLE people(id INTEGER PRIMARY KEY, name TEXT NOT NULL, big INTEGER, photo BLOB, note TEXT)',
    ],
    [
      'view',
      'named_people',
      'named_people',
      "CREATE VIEW named_people AS SELECT id, name FROM people WHERE name <> ''",
    ],
    ['index', 'people_name', 'people', 'CREATE INDEX people_name ON people(name)'],
  ];
  const pythonTableInfo = [
    [0, 'id', 'INTEGER', 0, null, 1],
    [1, 'name', 'TEXT', 1, null, 0],
    [2, 'big', 'INTEGER', 0, null, 0],
    [3, 'photo', 'BLOB', 0, null, 0],
    [4, 'note', 'TEXT', 0, null, 0],
  ];
  const pythonRows = [
    ['1', 'Ada', '9007199254740993', 'NULL', 'é€漢'],
    ['2', 'Alan', '-42', "X'000102030405060708090A0B0C0D0E0F101112131415161718191A1B1C1D1E1F…' (40 bytes)", 'NULL'],
    ['3', 'Grace', 'NULL', "X'DEADBEEF' (4 bytes)", 'plain text'],
    ['4', 'Linus', '9223372036854775807', 'NULL', ''],
  ];
  const result = runSqlite(sampleBytes(), 'select * from people order by id; pragma page_size;', OPTIONS);
  expect(result.results[0]!.rows).toEqual(pythonRows);
  expect(result.results[1]!.rows).toEqual([['1024']]);
  expect(result.schema.map((e) => [e.type, e.name, e.table, e.sql])).toEqual(pythonMaster);
  expect(
    result.schema[0]!.columns.map((c) => [
      c.cid,
      c.name,
      c.type,
      c.notnull ? 1 : 0,
      c.dflt_value === '' ? null : c.dflt_value,
      c.pk,
    ]),
  ).toEqual(pythonTableInfo);
  // The view reads through the same file.
  const view = runSqlite(sampleBytes(), 'select * from named_people order by id;', OPTIONS);
  expect(view.results[0]!.rows).toEqual([
    ['1', 'Ada'],
    ['2', 'Alan'],
    ['3', 'Grace'],
    ['4', 'Linus'],
  ]);
});

it('CSV export follows RFC 4180 and JSON export keeps integers beyond 2 to the 53 as strings', () => {
  // RFC 4180 section 2: records end with CRLF; a field with a comma, a double quote or a line break is enclosed in
  // double quotes; a double quote inside such a field is written twice. NULL is an empty field.
  const sql =
    "select 'a,b' as \"x\"\"y\", 'say \"hi\"' as q, 'two' || char(13) || char(10) || 'lines' as l, null as n, x'0AFF' as b, 9007199254740993 as big, 1.5 as r, 'plain' as p; select 1 as one union all select 2;";
  const csv = runSqlite(null, sql, { ...OPTIONS, exportFormat: 'csv' });
  expect(csv.exports.map((e) => [e.name, e.mime])).toEqual([
    ['query-1.csv', 'text/csv;charset=utf-8'],
    ['query-2.csv', 'text/csv;charset=utf-8'],
  ]);
  expect(csv.exports[0]!.content).toBe(
    '"x""y",q,l,n,b,big,r,p\r\n"a,b","say ""hi""","two\r\nlines",,X\'0AFF\',9007199254740993,1.5,plain',
  );
  expect(csv.exports[1]!.content).toBe('one\r\n1\r\n2');
  expect(csv.warnings).toEqual([]);

  // JSON: an array of objects keyed by column. 2 to the 53 and below are numbers; a larger integer is a string, with a
  // warning, so no reader rounds it (9007199254740993 read as a double is 9007199254740992).
  const json = runSqlite(null, sql, { ...OPTIONS, exportFormat: 'json' });
  expect(json.exports.map((e) => [e.name, e.mime])).toEqual([
    ['query-1.json', 'application/json'],
    ['query-2.json', 'application/json'],
  ]);
  expect(JSON.parse(json.exports[0]!.content)).toEqual([
    {
      'x"y': 'a,b',
      q: 'say "hi"',
      l: 'two\r\nlines',
      n: null,
      b: "X'0AFF'",
      big: '9007199254740993',
      r: 1.5,
      p: 'plain',
    },
  ]);
  expect(json.exports[0]!.content).toContain('"big": "9007199254740993"');
  expect(json.warnings).toEqual([
    'Result 1: 1 integer outside plus or minus 9007199254740992 is written as a string in the JSON export, so no reader rounds it.',
  ]);
  const edge = runSqlite(
    null,
    'select 9007199254740992 as a, -9007199254740992 as b, 9007199254740993 as c, -9007199254740993 as d;',
    {
      ...OPTIONS,
      exportFormat: 'json',
    },
  );
  expect(JSON.parse(edge.exports[0]!.content)).toEqual([
    { a: 9007199254740992, b: -9007199254740992, c: '9007199254740993', d: '-9007199254740993' },
  ]);
  // A repeated column name would lose a value in a JSON object, so the later ones are renamed and the page says so.
  const repeated = runSqlite(null, 'select 1 as a, 2 as a, 3 as a;', { ...OPTIONS, exportFormat: 'json' });
  expect(JSON.parse(repeated.exports[0]!.content)).toEqual([{ a: 1, a_2: 2, a_3: 3 }]);
  expect(repeated.warnings).toEqual([
    'Result 1 repeats the column name a, so the JSON export writes the later ones as a_2, a_3.',
  ]);
  // With no export asked for, none is built.
  expect(runSqlite(null, 'select 1;', OPTIONS).exports).toEqual([]);
});

it('extension loading is unavailable and ATTACH stays inside the in-memory engine', () => {
  // The SQLite documentation: load_extension() is defined only when extension loading is enabled
  // (https://www.sqlite.org/c3ref/enable_load_extension.html); in this build it is not.
  expect(failureOf(null, "select load_extension('x');").message).toBe('no such function: load_extension');
  // ATTACH works, in the engine's own memory file system: nothing appears on the machine running the engine.
  const name = 'fodt-attach-probe.db';
  const result = runSqlite(
    sampleBytes(),
    `attach database '${name}' as extra; create table extra.q(a); insert into extra.q values (7); select a from extra.q;`,
    OPTIONS,
  );
  expect(result.results[0]!.rows).toEqual([['7']]);
  expect(existsSync(name)).toBe(false);
  expect(existsSync(`${process.cwd()}/${name}`)).toBe(false);
  // The attached database is not part of the copy the run keeps: the schema is the main database's.
  expect(result.schema.map((e) => e.name)).toEqual(['people', 'named_people', 'people_name']);
  // And the next run knows nothing of it.
  expect(failureOf(null, 'select a from extra.q;').message).toBe('no such table: extra.q');
});

it('write statements report the rows changed and the statement count', () => {
  // https://www.sqlite.org/c3ref/total_changes.html counts the rows changed by INSERT, UPDATE and DELETE, triggers
  // included; a SELECT or a CREATE changes none, and a statement after a write must not count it again.
  const writes = runSqlite(
    null,
    'create table t(a); insert into t values (1), (2), (3); update t set a = a + 1 where a > 1; delete from t where a = 3;',
    OPTIONS,
  );
  expect(writes.statements).toBe(4);
  expect(writes.changes).toBe(3 + 2 + 1);
  expect(writes.results).toEqual([]);

  const reads = runSqlite(
    null,
    'create table t(a); insert into t values (1); select * from t; select * from t; create table u(b);',
    OPTIONS,
  );
  expect(reads.statements).toBe(5);
  expect(reads.changes).toBe(1);
  expect(reads.results).toHaveLength(2);

  const trigger = runSqlite(
    null,
    'create table t(a); create table log(x); create trigger tr after insert on t begin insert into log values (new.a); end; insert into t values (9);',
    OPTIONS,
  );
  expect(trigger.changes).toBe(2);

  // Blank SQL runs nothing.
  const none = runSqlite(sampleBytes(), '', OPTIONS);
  expect(none.statements).toBe(0);
  expect(none.changes).toBe(0);
});

/**
 * Uses sql.js (a WebAssembly build of real SQLite, a devDependency-only test
 * oracle per shared procedure C, never shipped in the bundle) to prove the
 * SQLite output is not merely plausible-looking text: it actually runs, and
 * reading the rows back gives the original input.
 */
import initSqlJs from 'sql.js';
import { it, expect, beforeAll } from 'vitest';
import { dataToSql } from '../src/index';

let SQL: Awaited<ReturnType<typeof initSqlJs>>;

beforeAll(async () => {
  SQL = await initSqlJs();
});

it('SQLite output runs in sql.js and reads back the input rows', () => {
  const rows = [
    { id: 1, name: 'Ada', active: true, score: 9.5, tags: ['x', 'y'] },
    { id: 2, name: 'Alan', active: false, score: null, tags: [] },
  ];
  const result = dataToSql(JSON.stringify(rows), { dialect: 'sqlite', table: 'people', createTable: true });

  const db = new SQL.Database();
  db.run(result.output);
  const [out] = db.exec('SELECT id, name, active, score, tags FROM people ORDER BY id');
  expect(out).toBeDefined();
  expect(out!.values).toEqual([
    [1, 'Ada', 1, 9.5, '["x","y"]'],
    [2, 'Alan', 0, null, '[]'],
  ]);
  db.close();
});

it('a column named order is quoted and works in sql.js', () => {
  const result = dataToSql('[{"order":1,"name":"a"},{"order":2,"name":"b"}]', {
    dialect: 'sqlite',
    table: 'items',
    createTable: true,
  });
  expect(result.output).toContain('"order"');

  const db = new SQL.Database();
  db.run(result.output);
  const [out] = db.exec('SELECT "order", name FROM items ORDER BY "order"');
  expect(out!.values).toEqual([
    [1, 'a'],
    [2, 'b'],
  ]);
  db.close();
});

it('a value crafted to end a string literal runs safely in sql.js instead of altering the schema', () => {
  const payload = "'; DROP TABLE people; --";
  const result = dataToSql(JSON.stringify([{ id: 1, note: payload }]), {
    dialect: 'sqlite',
    table: 'people',
    createTable: true,
  });

  const db = new SQL.Database();
  db.run(result.output);
  const [out] = db.exec('SELECT note FROM people');
  expect(out!.values).toEqual([[payload]]);
  // The table still exists: a real injection would have dropped it.
  expect(() => db.exec('SELECT COUNT(*) FROM people')).not.toThrow();
  db.close();
});

it('multi-row inserts split at 1000 rows all run and every row is read back', () => {
  const rows = Array.from({ length: 1500 }, (_, i) => ({ n: i }));
  const result = dataToSql(JSON.stringify(rows), { dialect: 'sqlite', table: 'nums', createTable: true });

  const db = new SQL.Database();
  db.run(result.output);
  const [out] = db.exec('SELECT COUNT(*) FROM nums');
  expect(out!.values).toEqual([[1500]]);
  db.close();
});

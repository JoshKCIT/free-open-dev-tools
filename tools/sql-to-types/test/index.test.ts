import { it, expect } from 'vitest';
import { sqlToTypes, SqlToTypesError, type Dialect } from '../src/index';

it('columns, NULL and NOT NULL, primary keys and defaults are read for all four dialects', () => {
  const cases: Record<Dialect, string> = {
    postgresql:
      'CREATE TABLE users (id integer PRIMARY KEY, email text NOT NULL, bio text, joined timestamp DEFAULT CURRENT_TIMESTAMP);',
    mysql:
      'CREATE TABLE users (id int PRIMARY KEY AUTO_INCREMENT, email varchar(255) NOT NULL, bio text, active tinyint(1) DEFAULT 1);',
    sqlite: 'CREATE TABLE users (id integer PRIMARY KEY AUTOINCREMENT, email text NOT NULL, bio text);',
    sqlserver:
      'CREATE TABLE users (id int IDENTITY(1,1) PRIMARY KEY, email nvarchar(255) NOT NULL, bio nvarchar(max));',
  };

  for (const [dialect, sql] of Object.entries(cases) as [Dialect, string][]) {
    const result = sqlToTypes(sql, { dialect, target: 'typescript' });
    expect(result.tables).toHaveLength(1);
    const table = result.tables[0]!;
    expect(table.name).toBe('users');

    const id = table.columns.find((c) => c.name === 'id')!;
    expect(id.primaryKey).toBe(true);
    expect(id.nullable).toBe(false);

    const email = table.columns.find((c) => c.name === 'email')!;
    expect(email.nullable).toBe(false);
    expect(email.typeKind).toBe('string');

    const bio = table.columns.find((c) => c.name === 'bio')!;
    expect(bio.nullable).toBe(true);

    expect(result.output).toContain('id: number;');
    expect(result.output).toContain('email: string;');
    expect(result.output).toContain('bio: string | null;');
  }

  const postgres = sqlToTypes(
    'CREATE TABLE users (id integer PRIMARY KEY, email text NOT NULL, bio text, joined timestamp DEFAULT CURRENT_TIMESTAMP);',
    { dialect: 'postgresql' },
  );
  const joined = postgres.tables[0]!.columns.find((c) => c.name === 'joined')!;
  expect(joined.default).toEqual({ kind: 'now' });

  const mysql = sqlToTypes(
    'CREATE TABLE users (id int PRIMARY KEY AUTO_INCREMENT, email varchar(255) NOT NULL, bio text, active tinyint(1) DEFAULT 1);',
    { dialect: 'mysql' },
  );
  const id = mysql.tables[0]!.columns.find((c) => c.name === 'id')!;
  expect(id.autoIncrement).toBe(true);
  const active = mysql.tables[0]!.columns.find((c) => c.name === 'active')!;
  expect(active.typeKind).toBe('boolean');
});

it('a table-level composite PRIMARY KEY marks every named column', () => {
  const result = sqlToTypes(
    'CREATE TABLE order_items (order_id integer, product_id integer, PRIMARY KEY (order_id, product_id));',
    {
      dialect: 'postgresql',
    },
  );
  const table = result.tables[0]!;
  expect(table.columns.find((c) => c.name === 'order_id')!.primaryKey).toBe(true);
  expect(table.columns.find((c) => c.name === 'product_id')!.primaryKey).toBe(true);
});

it('quoted identifiers in double quotes, backticks and brackets are read', () => {
  const postgres = sqlToTypes('CREATE TABLE "Order Items" ("Item Name" text NOT NULL);', { dialect: 'postgresql' });
  expect(postgres.tables[0]!.name).toBe('Order Items');
  expect(postgres.tables[0]!.columns[0]!.name).toBe('Item Name');
  expect(postgres.output).toContain('export interface OrderItems');
  expect(postgres.output).toContain('"Item Name": string;');

  const mysql = sqlToTypes('CREATE TABLE `order items` (`item name` text NOT NULL);', { dialect: 'mysql' });
  expect(mysql.tables[0]!.name).toBe('order items');

  const sqlserver = sqlToTypes('CREATE TABLE [order items] ([item name] text NOT NULL);', { dialect: 'sqlserver' });
  expect(sqlserver.tables[0]!.name).toBe('order items');
});

it('constructs outside the documented subset are reported with their line, not guessed', () => {
  const sql = [
    'CREATE TABLE users (',
    '  id integer PRIMARY KEY,',
    '  email text NOT NULL CHECK (email <> (SELECT 1)),',
    '  manager_id integer REFERENCES users (id),',
    '  tag text UNIQUE,',
    '  weird_type some_made_up_type',
    ');',
    'CREATE INDEX idx_users_email ON users (email);',
  ].join('\n');

  const result = sqlToTypes(sql, { dialect: 'postgresql' });
  expect(result.tables).toHaveLength(1);

  const reasons = result.notConverted.map((n) => n.reason);
  expect(reasons).toContain('unsupported CHECK constraint');
  expect(reasons).toContain('unsupported REFERENCES constraint');
  expect(reasons).toContain('unsupported UNIQUE constraint');
  expect(reasons).toContain('CREATE INDEX statement');

  // The column is still converted using its known name and type, even
  // though its unrecognized-subset constraint was reported separately.
  const email = result.tables[0]!.columns.find((c) => c.name === 'email')!;
  expect(email.typeKind).toBe('string');
  const managerId = result.tables[0]!.columns.find((c) => c.name === 'manager_id')!;
  expect(managerId.typeKind).toBe('int');

  const weird = result.tables[0]!.columns.find((c) => c.name === 'weird_type')!;
  expect(weird).toBeUndefined();
  // The column with the unrecognized type name is not modeled with a real
  // type; instead it is reported as its own notConverted entry.
  expect(result.notConverted.some((n) => n.text.includes('weird_type'))).toBe(true);

  for (const entry of result.notConverted) {
    expect(typeof entry.line).toBe('number');
    expect(entry.line).toBeGreaterThan(0);
  }
});

it('multiple CREATE TABLE statements each become their own interface', () => {
  const result = sqlToTypes(
    'CREATE TABLE a (id integer PRIMARY KEY); CREATE TABLE b (id integer PRIMARY KEY, a_id integer NOT NULL);',
    { dialect: 'postgresql' },
  );
  expect(result.tables.map((t) => t.name)).toEqual(['a', 'b']);
  expect(result.output).toContain('export interface A');
  expect(result.output).toContain('export interface B');
});

it('an unterminated string or identifier is refused with its line and column', () => {
  expect(() => sqlToTypes("CREATE TABLE t (name text DEFAULT 'unterminated);", { dialect: 'postgresql' })).toThrow();
  try {
    sqlToTypes("CREATE TABLE t (name text DEFAULT 'unterminated);", { dialect: 'postgresql' });
  } catch (err) {
    expect(err).toBeInstanceOf(SqlToTypesError);
    expect(typeof (err as SqlToTypesError).line).toBe('number');
    expect(typeof (err as SqlToTypesError).column).toBe('number');
  }

  expect(() => sqlToTypes('CREATE TABLE t ("unterminated name text);', { dialect: 'postgresql' })).toThrow(
    SqlToTypesError,
  );
});

it('a document with no CREATE TABLE statement in the subset is refused', () => {
  expect(() => sqlToTypes('CREATE INDEX idx ON users (email);', { dialect: 'postgresql' })).toThrow(SqlToTypesError);
});

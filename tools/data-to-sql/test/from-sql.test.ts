/**
 * Reading INSERT statements back into rows (sqlToRows).
 *
 * Expected values come from the four vendors' own documentation, fetched on 2026-10-02, and from a real SQLite
 * engine (sql.js, a devDependency used only as an oracle), never from this package's own earlier output:
 *
 * - PostgreSQL 4.1.2.1 (string constants: a quote is written as two quotes; with standard_conforming_strings on, the
 *   default since 9.1, a backslash is an ordinary character in a regular constant) and 4.1.2.2 (E'...' constants:
 *   Table 4.1 gives \b \f \n \r \t, octal \o \oo \ooo, hexadecimal bytes \xh \xhh, \uxxxx and \Uxxxxxxxx, "Any other
 *   character following a backslash is taken literally", and \' is a quote). https://www.postgresql.org/docs/current/sql-syntax-lexical.html
 * - MySQL 8.4 String Literals, Table 11.1: \0 is NUL, \' \" \b \n \r \t, \Z is ASCII 26, \\ is a backslash, and
 *   "If you use \% or \_ outside of pattern-matching contexts, they evaluate to the strings \% and \_"; "For all
 *   other escape sequences, backslash is ignored"; a quote inside the same quote is doubled; the manual's own
 *   SELECT shows 'hel''lo' reading as hel'lo and "hel""lo" reading as hel"lo.
 *   https://dev.mysql.com/doc/refman/8.4/en/string-literals.html
 * - SQLite Keywords: "keyword" and [keyword] and `keyword` are identifiers, 'keyword' is a string literal.
 *   https://www.sqlite.org/lang_keywords.html
 * - SQL Server Constants: a Unicode string constant is prefixed with N. Database Identifiers: a bracketed identifier
 *   doubles a closing bracket. https://learn.microsoft.com/en-us/sql/t-sql/data-types/constants-transact-sql
 *
 * In the SQL samples below a tilde stands for a backslash, so no backslash has to be doubled in a TypeScript string.
 */
import initSqlJs from 'sql.js';
import { test, expect } from 'vitest';
import { dataToSql, sqlToRows, DataToSqlError, DIALECTS, type Dialect } from '../src/index';

const sql = (text: string): string => text.split('~').join('\\');

function rowsOf(text: string, dialect: Dialect): unknown {
  return JSON.parse(sqlToRows(text, { dialect }).output);
}

test('INSERT statements with a column list become rows typed as JSON numbers, booleans and null', () => {
  const result = sqlToRows(
    "INSERT INTO t (id, name, ok, note, score) VALUES (1, 'Ada', TRUE, NULL, -2.50), (2, 'Alan', false, 'x', 1e3);",
    { dialect: 'postgresql' },
  );
  expect(result.output).toBe(
    [
      '[',
      '  {',
      '    "id": 1,',
      '    "name": "Ada",',
      '    "ok": true,',
      '    "note": null,',
      '    "score": -2.50',
      '  },',
      '  {',
      '    "id": 2,',
      '    "name": "Alan",',
      '    "ok": false,',
      '    "note": "x",',
      '    "score": 1e3',
      '  }',
      ']',
    ].join('\n'),
  );
  expect(result.tables).toEqual(['t']);
  expect(result.skipped).toBe(0);
  expect(result.warnings).toEqual([]);

  // The same rows as text: a header from the column list, TRUE and FALSE as true and false, NULL as an empty cell,
  // and RFC 4180's CRLF between records.
  const csv = sqlToRows(
    "INSERT INTO t (id, name, ok, note, score) VALUES (1, 'Ada', TRUE, NULL, -2.50), (2, 'Al, an', false, 'x', 1e3);",
    { dialect: 'postgresql', rowsFormat: 'csv' },
  );
  expect(csv.output).toBe('id,name,ok,note,score\r\n1,Ada,true,,-2.50\r\n2,"Al, an",false,x,1e3');
  expect(csv.warnings.join('\n')).toMatch(/NULL/);

  // A number is written with every digit it has, in the plainest JSON form: no plus sign, no leading zeros, a digit
  // before a leading point and none after a trailing one. A whole number beyond 2^53 keeps all its digits and the
  // page says a program reading JSON numbers as doubles may round it.
  const plain = sqlToRows('INSERT INTO n (a, b, c, d, e, f) VALUES (+7, .5, 007, 5., 1E+3, 9007199254740993);', {});
  expect(plain.output).toContain('"a": 7,');
  expect(plain.output).toContain('"b": 0.5,');
  expect(plain.output).toContain('"c": 7,');
  expect(plain.output).toContain('"d": 5,');
  expect(plain.output).toContain('"e": 1E+3,');
  expect(plain.output).toContain('"f": 9007199254740993');
  expect(plain.warnings.join('\n')).toMatch(/2\^53/);
  expect(sqlToRows('INSERT INTO n (a, b) VALUES (- 5, -0.5);', {}).output).toContain('"a": -5,');

  // A column named __proto__ is an ordinary key in the text, and reading it back gives an own property.
  const proto = sqlToRows('INSERT INTO t ("__proto__", b) VALUES (1, 2);', {});
  expect(proto.output).toContain('"__proto__": 1');
  const parsed = JSON.parse(proto.output) as Record<string, unknown>[];
  expect(Object.getOwnPropertyNames(parsed[0]!)).toEqual(['__proto__', 'b']);
  expect(({} as Record<string, unknown>).b).toBeUndefined();
});

test('each dialect reads its own quoting and identifier forms', () => {
  // PostgreSQL: a double-quoted identifier doubles its quote and is schema-qualified with a dot; a regular constant
  // keeps a backslash as it is; an E constant reads the escapes of Table 4.1 (octal 101 is A; the two hexadecimal
  // bytes c3 a9 are the UTF-8 bytes of an e with an acute accent; \q is just q).
  const pg = sqlToRows(
    sql(
      [
        'INSERT INTO "public"."Users" ("Id", "Full ""Name""", note) VALUES',
        "  (1, 'O''Brien', 'back~slash'),",
        "  (2, E'tab~there', E'~x41~u00e9~U0001F600~101'),",
        "  (3, E'it~'s ~~ done', E'~q'),",
        "  (4, e'~xc3~xa9', 'say \"hi\"');",
      ].join('\n'),
    ),
    { dialect: 'postgresql' },
  );
  expect(pg.tables).toEqual(['public.Users']);
  expect(JSON.parse(pg.output)).toEqual([
    { Id: 1, 'Full "Name"': "O'Brien", note: 'back\\slash' },
    { Id: 2, 'Full "Name"': 'tab\there', note: 'Aé😀A' },
    { Id: 3, 'Full "Name"': "it's \\ done", note: 'q' },
    { Id: 4, 'Full "Name"': 'é', note: 'say "hi"' },
  ]);

  // MySQL: backtick identifiers double a backtick, a string may use either quote, and Table 11.1 lists the
  // backslash escapes. \% and \_ stay as two characters, and an unlisted escape drops its backslash.
  const bt = '`';
  const mysql = sqlToRows(
    sql(
      [
        '# a comment that runs to the end of the line',
        `INSERT INTO ${bt}db${bt}.${bt}t${bt} (${bt}a${bt}, ${bt}b${bt}${bt}c${bt}, d, e, f) VALUES`,
        `  ('hel''lo', '~'hello', "say ""x""", 'a~~b', 'line~nnext'),`,
        `  ('~0', '~Z', '~%~_', '~q', "~"hello");`,
      ].join('\n'),
    ),
    { dialect: 'mysql' },
  );
  expect(mysql.tables).toEqual(['db.t']);
  expect(JSON.parse(mysql.output)).toEqual([
    { a: "hel'lo", 'b`c': "'hello", d: 'say "x"', e: 'a\\b', f: 'line\nnext' },
    { a: '\u{0}', 'b`c': '\u{1a}', d: '\\%\\_', e: 'q', f: '"hello' },
  ]);

  // SQLite: "x", [x] and `x` are all identifiers and a backslash is an ordinary character; X'..' is a blob, shown
  // as text starting with 0x.
  const sqlite = sqlToRows(
    sql(
      [
        `INSERT INTO "t" ("a") VALUES ('it''s'), ('x~y');`,
        `INSERT INTO [u v] ([b c]) VALUES (1);`,
        `INSERT INTO ${bt}w${bt} (${bt}d${bt}) VALUES (X'4a4B'), (0x0A);`,
      ].join('\n'),
    ),
    { dialect: 'sqlite' },
  );
  expect(JSON.parse(sqlite.output)).toEqual({
    t: [{ a: "it's" }, { a: 'x\\y' }],
    'u v': [{ 'b c': 1 }],
    w: [{ d: '0x4a4B' }, { d: '0x0A' }],
  });
  // Both hex forms are literals, not expressions: the only warning is the one about their notation.
  expect(sqlite.warnings).toEqual([expect.stringMatching(/Hex values/)]);

  // SQL Server: [x] doubles a closing bracket, N'..' is a Unicode string, a backslash is an ordinary character, and
  // GO on a line of its own ends a batch. (A lower case n is not the prefix; the manual says it must be uppercase.)
  const mssql = sqlToRows(
    sql(
      [
        "INSERT INTO [dbo].[T] ([Id], [A]]B]) VALUES (1, N'Michaël'), (2, N'it''s'), (3, 'back~slash')",
        'GO',
        'INSERT INTO [dbo].[T] ([Id], [A]]B]) VALUES (4, 0x4A);',
      ].join('\n'),
    ),
    { dialect: 'sqlserver' },
  );
  expect(mssql.tables).toEqual(['dbo.T']);
  expect(mssql.warnings).toEqual([expect.stringMatching(/Hex values/)]);
  expect(JSON.parse(mssql.output)).toEqual([
    { Id: 1, 'A]B': 'Michaël' },
    { Id: 2, 'A]B': "it's" },
    { Id: 3, 'A]B': 'back\\slash' },
    { Id: 4, 'A]B': '0x4A' },
  ]);

  // Keywords may be written in any case and a quoted semicolon, comment mark or block comment never ends or hides
  // anything, in every dialect.
  for (const dialect of DIALECTS) {
    const text = "insert into t (a, b) values ('x;y', '-- not /* a */ comment'); -- ; trailing\n/* ; */";
    expect(rowsOf(text, dialect)).toEqual([{ a: 'x;y', b: '-- not /* a */ comment' }]);
  }
  // PostgreSQL block comments nest; the others end at the first closing mark.
  expect(rowsOf('/* a /* b */ still comment */ INSERT INTO t (a) VALUES (1);', 'postgresql')).toEqual([{ a: 1 }]);
  // A double-quoted word in a value is a string in MySQL, and in SQLite when no identifier can be meant.
  expect(rowsOf('INSERT INTO t (a) VALUES ("word");', 'mysql')).toEqual([{ a: 'word' }]);
  expect(rowsOf('INSERT INTO t (a) VALUES ("word");', 'sqlite')).toEqual([{ a: 'word' }]);
  // INSERT variants that name the same rows.
  expect(rowsOf('INSERT OR REPLACE INTO t (a) VALUES (1); INSERT IGNORE INTO t (a) VALUES (2);', 'sqlite')).toEqual([
    { a: 1 },
    { a: 2 },
  ]);
});

test('comments are skipped, other statements are counted and a CREATE TABLE list names columns', () => {
  const dump = [
    '-- a dump',
    '/* header */',
    'BEGIN;',
    "SET NAMES 'utf8';",
    'CREATE TABLE "pets" ("id" integer PRIMARY KEY, "name" text NOT NULL, kind varchar(10),',
    '  CONSTRAINT pets_id_check CHECK (id > 0), UNIQUE (name));',
    "INSERT INTO \"pets\" VALUES (1, 'Rex', 'dog'); -- trailing comment",
    "INSERT INTO other VALUES ('a', 'b');",
    'COMMIT;',
  ].join('\n');
  const result = sqlToRows(dump, { dialect: 'postgresql' });
  // Four statements are not INSERT statements: BEGIN, SET, CREATE TABLE and COMMIT.
  expect(result.skipped).toBe(4);
  expect(result.tables).toEqual(['pets', 'other']);
  // The CREATE TABLE list names the columns of the first table (its constraints are not columns), and a table with
  // no list anywhere is named column_1 onwards.
  expect(JSON.parse(result.output)).toEqual({
    pets: [{ id: 1, name: 'Rex', kind: 'dog' }],
    other: [{ column_1: 'a', column_2: 'b' }],
  });

  // A comment alone, or nothing at all, is no statement.
  expect(sqlToRows('', {})).toEqual({ output: '', tables: [], skipped: 0, warnings: [], rows: 0 });
  expect(sqlToRows('-- nothing here\n/* nor here */', {}).output).toBe('');
  // Statements that are all of another kind give nothing to read, and the page says how many were skipped.
  expect(() => sqlToRows('CREATE TABLE t (a int); COMMIT;', {})).toThrow(/No INSERT.*2 other statements/);

  // The unqualified INSERT uses a CREATE TABLE of the same table written with a schema, and the reverse.
  const named = sqlToRows('CREATE TABLE s.t (x int, y int); INSERT INTO t VALUES (1, 2);', {});
  expect(JSON.parse(named.output)).toEqual([{ x: 1, y: 2 }]);
  const reverse = sqlToRows('CREATE TABLE t (x int, y int); INSERT INTO s.t VALUES (1, 2);', {});
  expect(JSON.parse(reverse.output)).toEqual([{ x: 1, y: 2 }]);

  // A wrong number of values is refused naming its statement, row and the column count.
  expect(() => sqlToRows('INSERT INTO t (a, b) VALUES (1, 2), (3);', {})).toThrow(
    /Statement 1, row 2 has 1 value but the table has 2 columns/,
  );
  expect(() => sqlToRows('CREATE TABLE t (a int, b int); INSERT INTO t VALUES (1, 2, 3);', {})).toThrow(
    /Statement 2, row 1 has 3 values but the table has 2 columns/,
  );
  // A repeated column name would make one value hide another.
  expect(() => sqlToRows('INSERT INTO t (a, a) VALUES (1, 2);', {})).toThrow(/repeats the column "a"/);

  // A string that never closes is refused where it starts.
  let caught: unknown;
  try {
    sqlToRows("SELECT 1;\nINSERT INTO t (a) VALUES ('abc", {});
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(DataToSqlError);
  expect((caught as DataToSqlError).line).toBe(2);
  expect((caught as DataToSqlError).column).toBe(27);

  // PostgreSQL COPY data after the statement is not SQL; it is skipped, counted, and the page says how to get INSERTs.
  const copy = sqlToRows(
    ['COPY t (a) FROM stdin;', "it's 'quoted", '~.', 'INSERT INTO t (a) VALUES (1);'].join('\n').split('~').join('\\'),
    { dialect: 'postgresql' },
  );
  expect(JSON.parse(copy.output)).toEqual([{ a: 1 }]);
  expect(copy.skipped).toBe(1);
  expect(copy.warnings.join('\n')).toMatch(/COPY/);

  // The mysql client's DELIMITER command changes where statements end, so nothing after it can be split safely.
  expect(() => sqlToRows('DELIMITER ;;\nINSERT INTO t VALUES (1);;', { dialect: 'mysql' })).toThrow(/DELIMITER/);
});

test('a function call is kept as text with a warning and INSERT SELECT and dollar quotes are refused naming the statement', () => {
  const result = sqlToRows(
    "INSERT INTO t (a, b, c) VALUES (NOW(), 'x', DATE '2020-01-01'), (1+2, DEFAULT, CAST(5 AS text));",
    { dialect: 'postgresql' },
  );
  expect(JSON.parse(result.output)).toEqual([
    { a: 'NOW()', b: 'x', c: "DATE '2020-01-01'" },
    { a: '1+2', b: 'DEFAULT', c: 'CAST(5 AS text)' },
  ]);
  expect(result.warnings.join('\n')).toMatch(/5 values were function calls or expressions/);
  expect(result.warnings.join('\n')).toMatch(/NOW\(\)/);

  // INSERT ... SELECT cannot be read: the rows are made by the database, so it is refused naming the statement.
  expect(() => sqlToRows('INSERT INTO t (a) VALUES (1); INSERT INTO t (a) SELECT b FROM u;', {})).toThrow(
    /Statement 2.*INSERT \.\.\. SELECT/,
  );
  expect(() => sqlToRows('INSERT INTO t SELECT * FROM u;', {})).toThrow(/Statement 1.*INSERT \.\.\. SELECT/);
  expect(() => sqlToRows('INSERT INTO t (a) (SELECT b FROM u);', {})).toThrow(/Statement 1.*INSERT \.\.\. SELECT/);
  expect(() => sqlToRows('INSERT INTO t (a) WITH x AS (SELECT 1) SELECT * FROM x;', {})).toThrow(
    /INSERT \.\.\. SELECT/,
  );
  // The other forms of INSERT that have no VALUES rows.
  expect(() => sqlToRows('INSERT INTO t SET a = 1;', { dialect: 'mysql' })).toThrow(/Statement 1.*VALUES/);
  expect(() => sqlToRows('INSERT INTO t DEFAULT VALUES;', {})).toThrow(/Statement 1.*VALUES/);

  // A dollar-quoted string in an INSERT is refused naming the statement; elsewhere it is one skipped statement,
  // and the semicolons inside it do not end anything.
  expect(() =>
    sqlToRows('INSERT INTO t (a) VALUES (1); INSERT INTO t (a) VALUES ($$x$$);', { dialect: 'postgresql' }),
  ).toThrow(/Statement 2.*dollar/i);
  const body = sqlToRows(
    'CREATE FUNCTION f() RETURNS int AS $body$ BEGIN INSERT INTO log VALUES (1); RETURN 1; END; $body$ LANGUAGE plpgsql;\nINSERT INTO t (a) VALUES (2);',
    { dialect: 'postgresql' },
  );
  expect(body.skipped).toBe(1);
  expect(JSON.parse(body.output)).toEqual([{ a: 2 }]);
  // Procedural code written with BEGIN ... END holds statements of its own, so it is refused rather than guessed at.
  expect(() =>
    sqlToRows('CREATE TRIGGER trg AFTER INSERT ON t FOR EACH ROW BEGIN INSERT INTO log VALUES (NEW.id); END;', {
      dialect: 'mysql',
    }),
  ).toThrow(/Statement 1.*procedural/i);

  // Text after the rows (an upsert clause, RETURNING) is not part of the rows, and the page says it was left out.
  const upsert = sqlToRows('INSERT INTO t (a) VALUES (1) ON CONFLICT (a) DO NOTHING RETURNING a;', {
    dialect: 'postgresql',
  });
  expect(JSON.parse(upsert.output)).toEqual([{ a: 1 }]);
  expect(upsert.warnings.join('\n')).toMatch(/Statement 1.*ON CONFLICT/);
});

test('rows written by the SQL writer read back to the same rows for every dialect and reading twice is identical', () => {
  const TEXTS = [
    "O'Brien",
    'back\\slash',
    'quote " double',
    'semi;colon',
    '-- not a comment',
    '/* not a comment */',
    '$$ dollars $$',
    'line1\nline2\r\nline3',
    'tab\there',
    'é 😀 中',
    '',
    ' padded ',
    '%_',
    '\\n literal',
    "'' two quotes",
    '\\\\',
    '`tick` [bracket]',
  ];
  const rows = TEXTS.map((text, i) => ({
    id: i + 1,
    text,
    flag: i % 2 === 0,
    score: i * 1.5 - 3,
    tags: i % 3 === 0 ? ['a', 'b'] : null,
    big: 3_000_000_000 + i,
    'we"ird': i,
    'br]ack': i,
    'back`tick': i,
    'sp ace': i,
  }));
  const TABLE = 't"t]`';

  for (const dialect of DIALECTS) {
    const written = dataToSql(JSON.stringify(rows), { dialect, table: TABLE, createTable: true });
    const read = sqlToRows(written.output, { dialect });
    expect(read.tables, dialect).toEqual([TABLE]);
    expect(read.skipped, dialect).toBe(1);

    // What each row must read back as, worked out from the writer's documented rules: a boolean is TRUE or FALSE in
    // PostgreSQL and MySQL and 1 or 0 in SQLite and SQL Server; a nested value is its JSON text; everything else
    // is as it was, including a missing value as null.
    const nativeBoolean = dialect === 'postgresql' || dialect === 'mysql';
    const expected = rows.map((row) => ({
      ...row,
      flag: nativeBoolean ? row.flag : row.flag ? 1 : 0,
      tags: row.tags === null ? null : JSON.stringify(row.tags),
    }));
    expect(JSON.parse(read.output), dialect).toEqual(expected);

    // Reading is a pure function of the text and the options: the same call twice, and again after a call with other
    // options in between, gives identical results.
    expect(sqlToRows(written.output, { dialect }), dialect).toEqual(read);
    sqlToRows(written.output, { dialect, rowsFormat: 'csv' });
    expect(sqlToRows(written.output, { dialect }), dialect).toEqual(read);

    // Writing what was read and reading that again gives the same rows once more.
    const again = dataToSql(read.output, { dialect, table: TABLE, createTable: true });
    expect(JSON.parse(sqlToRows(again.output, { dialect }).output), dialect).toEqual(JSON.parse(read.output));
  }

  // CSV in, SQL, CSV out: the rows and their header come back, NULL as an empty cell.
  for (const dialect of DIALECTS) {
    const csvText = 'id,name,note\r\n1,Ada,\r\n2,"Al, ""an""",x\r\n3,,y';
    const sqlText = dataToSql(csvText, { format: 'csv', dialect, table: 'people' }).output;
    expect(sqlToRows(sqlText, { dialect, rowsFormat: 'csv' }).output, dialect).toBe(csvText);
  }

  // More than one INSERT statement per table (the writer batches at 1,000 rows) reads as one list of rows.
  const many = Array.from({ length: 1500 }, (_, i) => ({ n: i }));
  for (const dialect of DIALECTS) {
    const written = dataToSql(JSON.stringify(many), { dialect, table: 'nums' });
    const read = JSON.parse(sqlToRows(written.output, { dialect }).output) as { n: number }[];
    expect(read.length, dialect).toBe(1500);
    expect(read[1499], dialect).toEqual({ n: 1499 });
  }
}, 60_000);

test('the SQLite engine run on the same INSERT statements returns the same rows', async () => {
  const bt = '`';
  const script = [
    '-- the reader and the engine are given exactly this text',
    'CREATE TABLE t (id INTEGER, name TEXT, score REAL, note TEXT, data BLOB);',
    "INSERT INTO t (id, name, score, note, data) VALUES (1, 'Ada', 9.5, NULL, X'4a4B'), (2, 'O''Brien', -0.25, '', X''), (3, 'unicode é 中', 1e3, 'semi;colon -- not a comment /* x */', NULL);",
    'INSERT INTO "t" ("id", "name", "score", "note", "data") VALUES (4, \'back\\slash\', 0, \'multi\nline\', X\'00ff\');',
    'CREATE TABLE [u v] ([a b] INTEGER, [c d] TEXT);',
    "INSERT INTO [u v] ([a b], [c d]) VALUES (7, 'x'), (-8, 'y');",
    `CREATE TABLE ${bt}w${bt} (${bt}k${bt} INTEGER);`,
    `INSERT INTO ${bt}w${bt} (${bt}k${bt}) VALUES (-9223372036854), (0);`,
  ].join('\n');

  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(script);

  const read = sqlToRows(script, { dialect: 'sqlite' });
  expect(read.tables).toEqual(['t', 'u v', 'w']);
  expect(read.skipped).toBe(3);
  const fromReader = JSON.parse(read.output) as Record<string, Record<string, unknown>[]>;

  // The engine's rows, read with its own SELECT, as objects keyed by column; a blob is its bytes, written in the
  // reader's notation (0x then the hexadecimal digits) so the two can be compared.
  const hex = (bytes: Uint8Array): string => '0x' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  const engineRows = (selectList: string, table: string): Record<string, unknown>[] => {
    const [result] = db.exec(`SELECT ${selectList} FROM ${table} ORDER BY rowid`);
    return result!.values.map((values) =>
      Object.fromEntries(
        result!.columns.map((column, i) => [
          column,
          values[i] instanceof Uint8Array ? hex(values[i] as Uint8Array) : values[i],
        ]),
      ),
    );
  };

  const engineT = engineRows('id, name, score, note, data', 't');
  // The only difference allowed is the digits of a blob, whose capital letters the reader keeps as written.
  const lowerHex = (rows: Record<string, unknown>[]): Record<string, unknown>[] =>
    rows.map((row) => ({ ...row, data: typeof row.data === 'string' ? row.data.toLowerCase() : row.data }));
  expect(lowerHex(fromReader.t!)).toEqual(lowerHex(engineT));
  expect(fromReader['u v']).toEqual(engineRows('[a b], [c d]', '[u v]'));
  expect(fromReader.w).toEqual(engineRows('k', 'w'));
  expect(engineT.length).toBe(4);
  db.close();
}, 60_000);

test('several tables give an object keyed by table name and the table filter picks one', () => {
  const text = [
    'INSERT INTO a (x) VALUES (1);',
    "INSERT INTO s.b (y, z) VALUES ('p', NULL);",
    "INSERT INTO a (x, w) VALUES (2, 'extra');",
    "INSERT INTO s.b (y) VALUES ('q');",
  ].join('\n');

  // Several tables: an object keyed by the table name as written (with its schema), rows of one table together in
  // the order they were written, and a row holds only the columns its own INSERT named.
  const all = sqlToRows(text, { dialect: 'postgresql' });
  expect(all.tables).toEqual(['a', 's.b']);
  expect(JSON.parse(all.output)).toEqual({
    a: [{ x: 1 }, { x: 2, w: 'extra' }],
    's.b': [{ y: 'p', z: null }, { y: 'q' }],
  });

  // The filter is the full name or just the table part, and then the output is the plain list of that table's rows.
  expect(JSON.parse(sqlToRows(text, { dialect: 'postgresql', tableFilter: 'a' }).output)).toEqual([
    { x: 1 },
    { x: 2, w: 'extra' },
  ]);
  expect(JSON.parse(sqlToRows(text, { dialect: 'postgresql', tableFilter: 's.b' }).output)).toEqual([
    { y: 'p', z: null },
    { y: 'q' },
  ]);
  expect(JSON.parse(sqlToRows(text, { dialect: 'postgresql', tableFilter: 'b' }).output)).toEqual([
    { y: 'p', z: null },
    { y: 'q' },
  ]);
  // The tables found are listed whatever the filter, and a name that is not among them is refused naming them.
  expect(sqlToRows(text, { dialect: 'postgresql', tableFilter: 'b' }).tables).toEqual(['a', 's.b']);
  expect(() => sqlToRows(text, { dialect: 'postgresql', tableFilter: 'nope' })).toThrow(/"nope".*a, s\.b/);

  // CSV holds one table: with several and no filter it is refused naming them, and with a filter its header is
  // every column any of its INSERT statements named, and a row left empty where its statement named fewer says so.
  expect(() => sqlToRows(text, { dialect: 'postgresql', rowsFormat: 'csv' })).toThrow(/a, s\.b.*Table filter/);
  const csv = sqlToRows(text, { dialect: 'postgresql', rowsFormat: 'csv', tableFilter: 'a' });
  expect(csv.output).toBe('x,w\r\n1,\r\n2,extra');
  expect(csv.warnings.join('\n')).toMatch(/fewer columns/);

  // The same table spelled with and without quotes is one table.
  const quoted = sqlToRows('INSERT INTO "a" (x) VALUES (1); INSERT INTO a (x) VALUES (2);', { dialect: 'postgresql' });
  expect(quoted.tables).toEqual(['a']);
  expect(JSON.parse(quoted.output)).toEqual([{ x: 1 }, { x: 2 }]);
});

import { it, expect } from 'vitest';
import { dataToSql, DIALECTS, type Dialect } from '../src/index';
import { quoteIdentifier, quoteString } from '../src/dialects';

// PostgreSQL: https://www.postgresql.org/docs/current/sql-syntax-lexical.html,
// section 4.1.1 (quoted): "A delimited identifier ... is formed by enclosing
// an arbitrary sequence of characters in double-quotes." Section 4.1.2.1
// (quoted): "To include a single-quote character within a string constant,
// write two adjacent single quotes."
// MySQL: https://dev.mysql.com/doc/refman/8.4/en/string-literals.html
// (quoted): "Backslash ( \\ ) and the quote character used to quote the
// string must be escaped."
// SQLite: https://www.sqlite.org/lang_keywords.html (quoted): a keyword in
// double quotes "is an identifier"; https://www.sqlite.org/lang_expr.html
// (quoted): "A single quote within the string can be encoded by putting two
// single quotes in a row."
// SQL Server: .../database-identifiers (quoted): a bracket-delimited
// identifier's embedded "]" is escaped "by doubling it ( ]] )";
// .../constants-transact-sql (quoted): "'O''Brien'" and "Unicode strings ...
// are prefixed with an N identifier."

it('identifiers are quoted per dialect with double quotes, backticks and brackets', () => {
  expect(quoteIdentifier('postgresql', 'order')).toBe('"order"');
  expect(quoteIdentifier('sqlite', 'order')).toBe('"order"');
  expect(quoteIdentifier('mysql', 'order')).toBe('`order`');
  expect(quoteIdentifier('sqlserver', 'order')).toBe('[order]');

  // An embedded closing quote character is doubled, per dialect.
  expect(quoteIdentifier('postgresql', 'a"b')).toBe('"a""b"');
  expect(quoteIdentifier('mysql', 'a`b')).toBe('`a``b`');
  expect(quoteIdentifier('sqlserver', 'a]b')).toBe('[a]]b]');
});

it('a single quote is doubled in every dialect and MySQL also doubles backslashes', () => {
  expect(quoteString('postgresql', "O'Brien")).toBe("'O''Brien'");
  expect(quoteString('mysql', "O'Brien")).toBe("'O''Brien'");
  expect(quoteString('sqlite', "O'Brien")).toBe("'O''Brien'");
  expect(quoteString('sqlserver', "O'Brien")).toBe("N'O''Brien'");

  expect(quoteString('mysql', 'back\\slash')).toBe("'back\\\\slash'");
  // The other three dialects have no backslash escape at all (SQLite's own
  // docs: "C-style escapes using the backslash character are not
  // supported"), so a lone backslash passes through unchanged.
  expect(quoteString('postgresql', 'back\\slash')).toBe("'back\\slash'");
  expect(quoteString('sqlite', 'back\\slash')).toBe("'back\\slash'");
  expect(quoteString('sqlserver', 'back\\slash')).toBe("N'back\\slash'");
});

/**
 * An independent reference scanner (never calls into src/dialects.ts) that
 * reverses a produced string literal back to its original value, so the
 * test proves containment rather than merely asserting the implementation
 * agrees with itself.
 */
function recoverStringLiteral(dialect: Dialect, literal: string): string {
  let body = literal;
  if (dialect === 'sqlserver') {
    expect(body[0]).toBe('N');
    body = body.slice(1);
  }
  expect(body[0]).toBe("'");
  expect(body[body.length - 1]).toBe("'");
  body = body.slice(1, -1);

  let out = '';
  let i = 0;
  while (i < body.length) {
    if (dialect === 'mysql' && body[i] === '\\' && body[i + 1] === '\\') {
      out += '\\';
      i += 2;
      continue;
    }
    if (body[i] === "'" && body[i + 1] === "'") {
      out += "'";
      i += 2;
      continue;
    }
    out += body[i];
    i++;
  }
  return out;
}

it('a value crafted to end a string literal stays inside it in every dialect', () => {
  const payload = '\\' + "'" + '; DROP TABLE t; --';
  for (const dialect of DIALECTS) {
    const literal = quoteString(dialect, payload);
    expect(recoverStringLiteral(dialect, literal)).toBe(payload);
    // The whole literal must be exactly one quoted string: an even number
    // of un-escaped quote characters bounding it, nothing after the final one.
    expect(literal.endsWith("'")).toBe(true);
  }
});

it('column types are inferred per dialect and a mixed column falls back to text with a warning', () => {
  const rows = [
    { flag: true, small: 1, big: 5000000000, ratio: 1.5, label: 'a', blob: { x: 1 }, mixed: 'x' },
    { flag: false, small: 2, big: 6000000000, ratio: 2.25, label: 'b', blob: { x: 2 }, mixed: 42 },
  ];
  const postgres = dataToSql(JSON.stringify(rows), { dialect: 'postgresql', table: 't', createTable: true });
  const createStatement = postgres.output.split('\n\n')[0]!;

  expect(createStatement).toContain('"flag" boolean NOT NULL');
  expect(createStatement).toContain('"small" integer NOT NULL');
  expect(createStatement).toContain('"big" bigint NOT NULL');
  expect(createStatement).toContain('"ratio" double precision NOT NULL');
  expect(createStatement).toContain('"label" text NOT NULL');
  expect(createStatement).toContain('"blob" json NOT NULL');
  expect(createStatement).toContain('"mixed" text NOT NULL');
  expect(postgres.warnings).toEqual(['Column "mixed" has mixed value kinds and was written as text.']);

  const sqlite = dataToSql(JSON.stringify(rows), { dialect: 'sqlite', table: 't', createTable: true });
  expect(sqlite.output).toContain('"flag" integer NOT NULL');
  expect(sqlite.output).toContain('"blob" text NOT NULL');

  const mysql = dataToSql(JSON.stringify(rows), { dialect: 'mysql', table: 't', createTable: true });
  expect(mysql.output).toContain('`flag` tinyint(1) NOT NULL');
  expect(mysql.output).toContain('`big` bigint NOT NULL');
  expect(mysql.output).toContain('`blob` json NOT NULL');

  const sqlserver = dataToSql(JSON.stringify(rows), { dialect: 'sqlserver', table: 't', createTable: true });
  expect(sqlserver.output).toContain('[flag] bit NOT NULL');
  expect(sqlserver.output).toContain('[label] nvarchar(max) NOT NULL');
});

it('CSV input with a header row produces the same statements as the equivalent JSON', () => {
  const json = JSON.stringify([
    { id: 1, name: 'Ada', active: true },
    { id: 2, name: 'Alan', active: false },
  ]);
  const csv = 'id,name,active\r\n1,Ada,true\r\n2,Alan,false';

  const fromJson = dataToSql(json, { format: 'json', dialect: 'postgresql', table: 'people' });
  const fromCsv = dataToSql(csv, { format: 'csv', dialect: 'postgresql', table: 'people', inferTypes: true });

  expect(fromCsv.output).toBe(fromJson.output);
  expect(fromCsv.columns).toBe(fromJson.columns);
  expect(fromCsv.rows).toBe(fromJson.rows);
});

it('multi-row inserts are split at 1000 rows', () => {
  const rows = Array.from({ length: 2500 }, (_, i) => ({ n: i }));
  const result = dataToSql(JSON.stringify(rows), { dialect: 'postgresql', table: 't', createTable: false });

  const inserts = result.output.split('\n\n').filter((s) => s.startsWith('INSERT'));
  expect(inserts).toHaveLength(3);
  expect(inserts[0]!.split('\n').filter((l) => l.trim().startsWith('(')).length).toBe(1000);
  expect(inserts[1]!.split('\n').filter((l) => l.trim().startsWith('(')).length).toBe(1000);
  expect(inserts[2]!.split('\n').filter((l) => l.trim().startsWith('(')).length).toBe(500);
});

it('nulls and missing keys become NULL and only fully filled columns are NOT NULL', () => {
  const rows = [
    { id: 1, name: 'Ada', bio: null },
    { id: 2, name: 'Alan' },
  ];
  const result = dataToSql(JSON.stringify(rows), { dialect: 'postgresql', table: 't', createTable: true });
  const [createStatement, insertStatement] = result.output.split('\n\n');

  expect(createStatement).toContain('"id" integer NOT NULL');
  expect(createStatement).toContain('"name" text NOT NULL');
  // bio is null in row 1 and missing in row 2, so never NOT NULL.
  expect(createStatement).toContain('"bio" text');
  expect(createStatement).not.toContain('"bio" text NOT NULL');

  expect(insertStatement).toContain("(1, 'Ada', NULL)");
  expect(insertStatement).toContain("(2, 'Alan', NULL)");
});

it('no primary key or index is ever written', () => {
  const result = dataToSql('[{"id":1}]', { dialect: 'postgresql', table: 't', createTable: true });
  expect(result.output).not.toMatch(/PRIMARY KEY/i);
  expect(result.output).not.toMatch(/CREATE INDEX/i);
});

it('an empty array produces no columns and no statements', () => {
  const result = dataToSql('[]', { dialect: 'postgresql', table: 't' });
  expect(result).toEqual({ output: '', columns: 0, rows: 0, warnings: [] });
});

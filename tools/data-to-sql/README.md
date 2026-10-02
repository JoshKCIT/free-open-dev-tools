# CSV & JSON to SQL

Generate CREATE TABLE and INSERT statements for a chosen SQL dialect, or turn INSERT statements back into CSV or JSON rows.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Turns a JSON array of objects, or CSV text with a header row, into a CREATE TABLE statement and multi-row INSERT statements for PostgreSQL, MySQL, SQLite or SQL Server, or does the reverse: reads INSERT statements in one of those dialects back into JSON or CSV rows. Column types are inferred from the values given; identifiers are always quoted and string values are always escaped for the chosen dialect, so a value crafted to end a string literal early stays inside it. Reading never runs anything: the text is split into tokens and the values are read, not evaluated.

## Supported

- PostgreSQL, MySQL, SQLite and SQL Server, each with its own identifier-quoting character, string-escaping rule and type names
- JSON input: an array of objects, with columns in first-appearance key order
- CSV input: a required header row, with delimiter and type inference options
- A column's type is inferred from its non-null values: boolean, a 32-bit integer, a larger safe integer, a floating-point number, text, or JSON text for a nested object or array
- A column that has a value in every row is written NOT NULL
- INSERT statements are split into batches of at most 1,000 rows, the tightest limit any of the four dialects places on a single statement
- An optional CREATE TABLE statement, toggled independently of the INSERT statements
- SQL to rows: INSERT ... VALUES statements with a column list become JSON rows (numbers, booleans and null typed) or CSV rows, with each dialect's own quoting read correctly: doubled quotes everywhere, backslash escapes in MySQL strings and PostgreSQL E strings, the N prefix, and double-quoted, backtick and bracket identifiers, with schema-qualified table names
- SQL to rows: comments are skipped, other statements are counted, a CREATE TABLE column list names the columns of an INSERT that has none, several tables give an object keyed by table name, and a table filter picks one

## Limits

- No key or index is ever created; a primary key is never invented from the data
- Types are inferred only from the values given in this input; nothing is read from an existing database schema
- A column whose values mix kinds (for example a string in one row and a number in another) is written as text with a warning naming the column
- MySQL output assumes the server's default SQL mode (backslash escapes active, ANSI_QUOTES off); a server configured otherwise needs different escaping than this tool writes
- Dates and times are written as plain text; this tool does not parse or validate date formats
- A value or identifier containing a NUL character (U+0000) is refused outright, since none of the four dialects can round-trip one inside a quoted literal
- SQL to rows reads INSERT ... VALUES statements in the chosen dialect; INSERT ... SELECT, dollar-quoted strings and procedural code are refused.
- Function calls and expressions in values are kept as text, with a warning; nothing is evaluated.
- Statements that are not INSERT statements are skipped and counted; a CREATE TABLE column list names the columns of an INSERT that has none, and otherwise the columns are column_1 onwards.
- Hex values (X'..' and 0x..) are shown as text starting with 0x, and in CSV rows a NULL cannot be told from an empty string; the page says so each time it happens.
- A whole number beyond 2^53 keeps all its digits in the JSON text, but a program that reads JSON numbers as ordinary doubles may round it; the page says so.

## Ambiguous cases, and what this does about them

- An integer within the 32-bit signed range becomes an integer column; a larger integer that is still an exact (safe) integer becomes a bigint column; anything else numeric becomes a floating-point column, matching the widest value seen in that column
- SQLite has no separate boolean storage class, so boolean columns are written INTEGER with 0/1 literals; SQL Server booleans are written BIT with 0/1 literals; PostgreSQL and MySQL use their own TRUE/FALSE keyword
- PostgreSQL strings are read with standard_conforming_strings on (the default since 9.1): a backslash is an ordinary character except inside an E string; MySQL strings are read in the default SQL mode, where a backslash escapes and a double-quoted word is a string
- A table is named as written, with its schema when it has one, and unquoted and quoted spellings of the same name are one table; names are not case-folded
- In SQLite and SQL Server a boolean was written as 0 or 1, so it reads back as a number, while PostgreSQL and MySQL TRUE and FALSE read back as booleans

## Defined by

- [PostgreSQL — Lexical Structure (identifiers and string constants)](https://www.postgresql.org/docs/current/sql-syntax-lexical.html)
- [MySQL 8.4 Reference Manual — Schema Object Names](https://dev.mysql.com/doc/refman/8.4/en/identifiers.html)
- [MySQL 8.4 Reference Manual — String Literals](https://dev.mysql.com/doc/refman/8.4/en/string-literals.html)
- [SQLite — Keywords](https://www.sqlite.org/lang_keywords.html)
- [SQLite — Datatypes In SQLite](https://www.sqlite.org/datatype3.html)
- [Database Identifiers (SQL Server) — Transact-SQL](https://learn.microsoft.com/en-us/sql/relational-databases/databases/database-identifiers)
- [Table Value Constructor (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/queries/table-value-constructor-transact-sql)
- [PostgreSQL — String Constants with C-Style Escapes (E strings)](https://www.postgresql.org/docs/current/sql-syntax-lexical.html#SQL-SYNTAX-STRINGS-ESCAPE)
- [Constants (Transact-SQL) — Unicode strings with the N prefix](https://learn.microsoft.com/en-us/sql/t-sql/data-types/constants-transact-sql)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/data-to-sql data-to-sql
cd data-to-sql
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/data-to-sql
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { dataToSql, DIALECTS } from '@fodt/data-to-sql';

dataToSql('[{"id":1,"name":"Ada"}]', { format: 'json', dialect: 'postgresql', table: 'users' });
// { output: 'CREATE TABLE "users" (...);\n\nINSERT INTO "users" (...) VALUES\n  (1, \'Ada\');', columns: 2, rows: 1, warnings: [] }

import { sqlToRows } from '@fodt/data-to-sql';

sqlToRows("INSERT INTO users (id, name) VALUES (1, 'Ada');", { dialect: 'postgresql' });
// { output: '[\n  {\n    "id": 1,\n    "name": "Ada"\n  }\n]', tables: ['users'], skipped: 0, warnings: [], rows: 1 }
```

`dialects.ts` holds the per-dialect quoting, escaping and type-name lookup (`quoteIdentifier`, `quoteString`, `quoteBoolean`, `TYPE_NAMES`); `index.ts` reads the input, infers each column's kind, and renders CREATE TABLE and INSERT statements from that shared table. `sqlToRows(text, { dialect, rowsFormat, tableFilter })` in `from-sql.ts` goes the other way and returns `{ output, tables, skipped, warnings, rows }`: `output` is JSON (an array for one table, an object keyed by table name for several) or CSV (one table), `tables` lists every table an INSERT named, `skipped` counts the statements that were not INSERT statements and `rows` counts the rows in the output. It throws `DataToSqlError` (with `line` and `column` when a position is known) for an unclosed string, a row with the wrong number of values, INSERT ... SELECT, a dollar-quoted string in an INSERT, procedural code, a table that is not in the text, or CSV of several tables.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The SQLite output is proven by running it in sql.js (a WebAssembly build of real SQLite used only as a devDependency test oracle, never shipped) and reading the rows back; the other three dialects are proven by grammar-level assertions against the fetched vendor references, since running a real PostgreSQL, MySQL or SQL Server server is outside this project's test environment. Reading is proven against the escape tables of the PostgreSQL and MySQL manuals (quoted in the test), the SQLite and SQL Server identifier rules, a round trip of this package's own writer for every dialect (with identifiers and values that hold every quote character), and the same INSERT statements run in sql.js, whose rows must equal the reader's.

## Licence

MIT. See [LICENSE](./LICENSE).

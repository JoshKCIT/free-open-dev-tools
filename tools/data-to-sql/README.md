# CSV & JSON to SQL

Generate CREATE TABLE and INSERT statements for a chosen SQL dialect.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Turns a JSON array of objects, or CSV text with a header row, into a CREATE TABLE statement and multi-row INSERT statements for PostgreSQL, MySQL, SQLite or SQL Server. Column types are inferred from the values given; identifiers are always quoted and string values are always escaped for the chosen dialect, so a value crafted to end a string literal early stays inside it.

## Supported

- PostgreSQL, MySQL, SQLite and SQL Server, each with its own identifier-quoting character, string-escaping rule and type names
- JSON input: an array of objects, with columns in first-appearance key order
- CSV input: a required header row, with delimiter and type inference options
- A column's type is inferred from its non-null values: boolean, a 32-bit integer, a larger safe integer, a floating-point number, text, or JSON text for a nested object or array
- A column that has a value in every row is written NOT NULL
- INSERT statements are split into batches of at most 1,000 rows, the tightest limit any of the four dialects places on a single statement
- An optional CREATE TABLE statement, toggled independently of the INSERT statements

## Limits

- No key or index is ever created; a primary key is never invented from the data
- Types are inferred only from the values given in this input; nothing is read from an existing database schema
- A column whose values mix kinds (for example a string in one row and a number in another) is written as text with a warning naming the column
- MySQL output assumes the server's default SQL mode (backslash escapes active, ANSI_QUOTES off); a server configured otherwise needs different escaping than this tool writes
- Dates and times are written as plain text; this tool does not parse or validate date formats
- A value or identifier containing a NUL character (U+0000) is refused outright, since none of the four dialects can round-trip one inside a quoted literal

## Ambiguous cases, and what this does about them

- An integer within the 32-bit signed range becomes an integer column; a larger integer that is still an exact (safe) integer becomes a bigint column; anything else numeric becomes a floating-point column, matching the widest value seen in that column
- SQLite has no separate boolean storage class, so boolean columns are written INTEGER with 0/1 literals; SQL Server booleans are written BIT with 0/1 literals; PostgreSQL and MySQL use their own TRUE/FALSE keyword

## Defined by

- [PostgreSQL — Lexical Structure (identifiers and string constants)](https://www.postgresql.org/docs/current/sql-syntax-lexical.html)
- [MySQL 8.4 Reference Manual — Schema Object Names](https://dev.mysql.com/doc/refman/8.4/en/identifiers.html)
- [MySQL 8.4 Reference Manual — String Literals](https://dev.mysql.com/doc/refman/8.4/en/string-literals.html)
- [SQLite — Keywords](https://www.sqlite.org/lang_keywords.html)
- [SQLite — Datatypes In SQLite](https://www.sqlite.org/datatype3.html)
- [Database Identifiers (SQL Server) — Transact-SQL](https://learn.microsoft.com/en-us/sql/relational-databases/databases/database-identifiers)
- [Table Value Constructor (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/queries/table-value-constructor-transact-sql)

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
```

`dialects.ts` holds the per-dialect quoting, escaping and type-name lookup (`quoteIdentifier`, `quoteString`, `quoteBoolean`, `TYPE_NAMES`); `index.ts` reads the input, infers each column's kind, and renders CREATE TABLE and INSERT statements from that shared table.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The SQLite output is proven by running it in sql.js (a WebAssembly build of real SQLite used only as a devDependency test oracle, never shipped) and reading the rows back; the other three dialects are proven by grammar-level assertions against the fetched vendor references, since running a real PostgreSQL, MySQL or SQL Server server is outside this project's test environment.

## Licence

MIT. See [LICENSE](./LICENSE).

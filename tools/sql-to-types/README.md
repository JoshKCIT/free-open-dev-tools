# SQL Schema to TypeScript

Turn CREATE TABLE statements into TypeScript, Prisma or Drizzle definitions.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Parses a documented subset of CREATE TABLE (columns, types, NULL/NOT NULL, primary keys and defaults) for PostgreSQL, MySQL, SQLite and SQL Server, and renders TypeScript interfaces. Anything outside that subset -- other constraints, other statements, other default expressions, table options and unrecognized types -- is listed with its line and never guessed at.

## Supported

- PostgreSQL, MySQL, SQLite and SQL Server CREATE TABLE syntax, including multi-word types (double precision, character varying, timestamp with time zone), MySQL's unsigned modifier, and each dialect's own quoted-identifier form
- Columns, NOT NULL / NULL, single-column and composite table-level PRIMARY KEY, and a literal or CURRENT_TIMESTAMP/now() DEFAULT
- Auto-increment markers: MySQL AUTO_INCREMENT, SQLite AUTOINCREMENT, SQL Server IDENTITY(...), PostgreSQL GENERATED ... AS IDENTITY and the serial/bigserial types
- TypeScript interfaces, one per table, with nullable columns typed as a union with null
- Multiple CREATE TABLE statements in one document, each becoming its own interface

## Limits

- Only the documented subset converts; CHECK, UNIQUE, FOREIGN KEY/REFERENCES, EXCLUDE, computed (GENERATED ... AS (expr)) columns, other default expressions and table options (ENGINE=, INHERITS, WITH (...)) are reported in a Not converted list with their line, never guessed at
- A statement that is not a CREATE TABLE (CREATE INDEX, ALTER TABLE, and so on) is reported and skipped, not parsed
- Native type details such as a VARCHAR length or a NUMERIC precision are read but not carried into the TypeScript output; only the value's kind (string, number, and so on) is
- bigint and decimal are typed as TypeScript string, not number, since a JavaScript number cannot hold every value either can without losing precision

## Ambiguous cases, and what this does about them

- bigint and decimal are typed as string to stay exact; the driver a visitor actually uses may return a JavaScript number, a string, or a bigint for these depending on its own configuration
- A quoted table or column name with spaces or punctuation is read literally; the emitted TypeScript identifier is derived from it (PascalCase for a type name, quoted with the original text as a property name when it is not a valid identifier)
- datetime columns are typed as TypeScript Date, except under the SQLite dialect, which has no native date/time storage class of its own and keeps the column typed as string

## Defined by

- [PostgreSQL — CREATE TABLE](https://www.postgresql.org/docs/current/sql-createtable.html)
- [MySQL 8.4 Reference Manual — CREATE TABLE Statement](https://dev.mysql.com/doc/refman/8.4/en/create-table.html)
- [SQLite — CREATE TABLE](https://www.sqlite.org/lang_createtable.html)
- [CREATE TABLE (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/statements/create-table-transact-sql)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/sql-to-types sql-to-types
cd sql-to-types
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/sql-to-types
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { sqlToTypes } from '@fodt/sql-to-types';

sqlToTypes('CREATE TABLE users (id integer PRIMARY KEY, email text NOT NULL);', { dialect: 'postgresql', target: 'typescript' });
// { output: 'export interface Users {\n  id: number;\n  email: string;\n}\n', tables: [...], notConverted: [] }
```

`tokenize.ts` reads the source into a flat token stream (identifiers, strings, numbers, punctuation, comments skipped); `parse.ts` groups tokens into CREATE TABLE statements and column definitions over the documented subset, collecting anything outside it into `notConverted`; each `emit-<target>.ts` renders the parsed tables into one target's source text.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

TypeScript output is checked directly with the real TypeScript compiler under strict mode, asserting zero diagnostics for a correctly typed value and at least one for a wrongly typed one, the same devDependency-only compiler-host pattern this project's json-to-code tool established.

## Licence

MIT. See [LICENSE](./LICENSE).

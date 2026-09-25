# SQL Schema to TypeScript

Turn CREATE TABLE statements into TypeScript, Prisma or Drizzle definitions.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Parses a documented subset of CREATE TABLE (columns, types, NULL/NOT NULL, primary keys and defaults) for PostgreSQL, MySQL, SQLite and SQL Server, and renders TypeScript interfaces, a Prisma schema, or Drizzle table definitions. Anything outside that subset -- other constraints, other statements, other default expressions, table options and unrecognized types -- is listed with its line and never guessed at.

## Supported

- PostgreSQL, MySQL, SQLite and SQL Server CREATE TABLE syntax, including multi-word types (double precision, character varying, timestamp with time zone), MySQL's unsigned modifier, and each dialect's own quoted-identifier form
- Columns, NOT NULL / NULL, single-column and composite table-level PRIMARY KEY, and a literal or CURRENT_TIMESTAMP/now() DEFAULT
- Auto-increment markers: MySQL AUTO_INCREMENT, SQLite AUTOINCREMENT, SQL Server IDENTITY(...), PostgreSQL GENERATED ... AS IDENTITY and the serial/bigserial types
- TypeScript interfaces, one per table, with nullable columns typed as a union with null
- Prisma schema output: a datasource block for the chosen dialect, one model per table, @id/@@id, @default, @map/@@map for a name that needed sanitizing
- Drizzle output for PostgreSQL, MySQL and SQLite: one pgTable/mysqlTable/sqliteTable per table, using each dialect's own column builders, .notNull(), .primaryKey(), .default()/.defaultNow(), auto-increment, and the composite-primary-key helper
- Multiple CREATE TABLE statements in one document, each becoming its own type or model

## Limits

- Only the documented subset converts; CHECK, UNIQUE, FOREIGN KEY/REFERENCES, EXCLUDE, computed (GENERATED ... AS (expr)) columns, other default expressions and table options (ENGINE=, INHERITS, WITH (...)) are reported in a Not converted list with their line, never guessed at
- A statement that is not a CREATE TABLE (CREATE INDEX, ALTER TABLE, and so on) is reported and skipped, not parsed
- Native type details such as a VARCHAR length or a NUMERIC precision are read but not carried into the output; only the value's kind (string, number, and so on) is
- bigint and decimal are typed as TypeScript string, not number, since a JavaScript number cannot hold every value either can without losing precision
- The Drizzle target has no SQL Server output at all: drizzle-orm 0.45 ships no SQL Server table builder, so that combination is refused with a plain message rather than guessed at
- Prisma output targets the classic inline datasource url = env("DATABASE_URL") form rather than the newer prisma.config.ts connection setup, since this tool emits one portable schema.prisma file and cannot also emit a companion config file

## Ambiguous cases, and what this does about them

- bigint and decimal are typed as string to stay exact; the driver a visitor actually uses may return a JavaScript number, a string, or a bigint for these depending on its own configuration
- A quoted table or column name with spaces or punctuation is read literally; the emitted TypeScript identifier is derived from it (PascalCase for a type name, quoted with the original text as a property name when it is not a valid identifier); Prisma and Drizzle sanitize a field name the same way and keep the original name recoverable with @map or the builder's own name argument
- datetime columns are typed as TypeScript Date, except under the SQLite dialect, which has no native date/time storage class of its own and keeps the column typed as string; the Drizzle SQLite output keeps the same column as plain text for the same reason
- Drizzle bigint columns use { mode: 'bigint' }, a native JavaScript bigint, rather than { mode: 'number' }, to stay exact the same way this tool's TypeScript and Prisma output do
- A Prisma model name is almost always given @@map back to the original table name, since a snake_case or lowercase SQL table name essentially never matches Prisma's own PascalCase model-naming convention exactly

## Defined by

- [PostgreSQL — CREATE TABLE](https://www.postgresql.org/docs/current/sql-createtable.html)
- [MySQL 8.4 Reference Manual — CREATE TABLE Statement](https://dev.mysql.com/doc/refman/8.4/en/create-table.html)
- [SQLite — CREATE TABLE](https://www.sqlite.org/lang_createtable.html)
- [CREATE TABLE (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/statements/create-table-transact-sql)
- [Prisma Schema Reference (Prisma ORM v6)](https://www.prisma.io/docs/orm/v6/reference/prisma-schema-reference)
- [Drizzle ORM — PostgreSQL column types](https://orm.drizzle.team/docs/column-types/pg)
- [Drizzle ORM — MySQL column types](https://orm.drizzle.team/docs/column-types/mysql)
- [Drizzle ORM — SQLite column types](https://orm.drizzle.team/docs/column-types/sqlite)
- [Drizzle ORM — Indexes & Constraints](https://orm.drizzle.team/docs/indexes-constraints)

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

`tokenize.ts` reads the source into a flat token stream (identifiers, strings, numbers, punctuation, comments skipped); `parse.ts` groups tokens into CREATE TABLE statements and column definitions over the documented subset, collecting anything outside it into `notConverted`; `emit-typescript.ts`, `emit-prisma.ts` and `emit-drizzle.ts` each render the parsed tables into one target's source text from the same shared table data.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

TypeScript and Drizzle output are checked directly with the real TypeScript compiler under strict mode -- TypeScript's own generated interfaces, and Drizzle's generated table definitions resolved against the real drizzle-orm package -- asserting zero diagnostics for a correct case and at least one for a wrongly typed or misspelt one. Prisma has no equivalent devDependency-only oracle available to this project, so its output is checked against the documented datasource/model/attribute/type syntax instead.

## Licence

MIT. See [LICENSE](./LICENSE).

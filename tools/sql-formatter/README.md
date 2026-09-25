# SQL Formatter

Format SQL for a chosen dialect, or minify it.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Formats a pasted SQL query for a chosen dialect using a reviewed grammar-aware formatter, or minifies it with a quote-aware lexer that removes comments and collapses whitespace without ever changing a string literal, a quoted identifier or a token. Minifying and then formatting a query gives the same result as formatting it directly.

## Supported

- Every SQL dialect the pinned formatter package supports, each with its own keyword case and indent options
- Minifying that keeps string literals, quoted identifiers and dollar-quoted strings exactly as written, even when they hold comment markers, quotes or line breaks
- PostgreSQL dollar-quoted strings, MySQL and MariaDB backtick identifiers and hash comments, SQL Server and SQLite bracket and quoted identifiers
- Executable comments (/*! ... */) and optimiser hints (/*+ ... */) kept in minified output; ordinary comments removed
- A query the chosen dialect's grammar cannot parse refused with its line and column

## Limits

- Formatting follows the pinned formatter package's own grammar for the chosen dialect; a query it cannot parse is refused rather than partially formatted
- Minifying removes ordinary line and block comments; only executable comments and optimiser hints survive
- A stored-procedure body written in a dialect this tool's minifier does not special-case is treated as ordinary tokens, which is safe but not always the tightest possible minification
- This does not connect to a database, execute a query, or check that a table or column referenced in it exists
- Formatting a deeply nested parenthesised expression runs in a background worker with a fixed time limit, so a pathological input is stopped rather than freezing the tab

## Ambiguous cases, and what this does about them

- Whitespace between two tokens is collapsed to a single space rather than removed outright whenever removing it could join two tokens into a different one (for example a minus sign next to a minus sign, or a slash next to a star)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/sql-formatter sql-formatter
cd sql-formatter
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/sql-formatter
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { formatSql, SQL_DIALECTS } from '@fodt/sql-formatter';

formatSql('SELECT * FROM tbl', { mode: 'format', dialect: 'mysql' });
// { output: 'SELECT\n  *\nFROM\n  tbl', warnings: [] }
```

`formatSql(source, { mode, dialect, keywordCase, indent })` returns `{ output, warnings }` or throws `SqlFormatterError` with `line`/`column`. `mode` defaults to `format` (the other value is `minify`); `dialect` defaults to `sql` (Standard SQL); `keywordCase` defaults to `preserve`; `indent` defaults to 2. `minifySql(source, dialect)` is exported separately from `minify.ts` for direct use. `SQL_DIALECTS` lists every dialect value and label the pinned package supports.

## Dependencies

- `sql-formatter` 15.9.0

## Tests

```sh
npm test
```

No publishing body defines SQL formatting or minification as a single interchange format across dialects; this tool's grammar-level behaviour is proven against the installed sql-formatter package's own documented example, and its minifier is proven against the vendor lexical documentation for quoting in PostgreSQL, MySQL, SQLite and SQL Server with format(minify(x)) === format(x) as the token-preservation oracle across a corpus of queries in every tested dialect.

## Licence

MIT. See [LICENSE](./LICENSE).

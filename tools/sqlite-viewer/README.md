# SQLite Database Viewer

Browse a SQLite database's tables and schema, run SQL on an in-memory copy, export results and download the changed file.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Opens a SQLite database file in your browser, lists its tables, views, indexes and triggers with their columns, and runs SQL you type against an in-memory copy of it. SQLite 3.49.1, compiled to WebAssembly through sql.js, runs in a background worker, so a runaway query can be stopped. The file is never uploaded, never changed and never stored; with no file attached, your SQL runs on an empty in-memory database.

## Supported

- SQLite 3 database files of any page size, picked with the file chooser
- Several SQL statements separated by semicolons, including writes (INSERT, UPDATE, DELETE, CREATE), PRAGMA, common table expressions and window functions
- The schema of tables, views, indexes and triggers with each column's type, NOT NULL flag, default and primary key position
- Each result as its own table, with 64-bit integers shown exactly and BLOBs shown as X'hex' with their length
- Results exported as CSV (RFC 4180) or JSON, and the changed database offered as a download
- An empty in-memory database when no file is attached

## Limits

- Databases up to 100 MiB, because the file is copied into memory up to three times while it is open.
- A run that takes longer than 10 seconds is stopped with a message.
- Results show at most 500 rows (100 if you choose) and exports stop at 200,000 rows; the count of all rows is shown.
- Every Run works on a fresh in-memory copy; nothing is saved, and your file is never changed.
- REAL values are printed in JavaScript's shortest form, so 1.0 shows as 1; integers of any size are exact.
- Extensions cannot be loaded, and ATTACH creates only in-memory databases.

## Ambiguous cases, and what this does about them

- SQLite has no date or time type: a column shows whatever text or number is stored in it, and nothing is converted
- A BLOB is shown as X'hex' with its first 32 bytes and its length; longer values are cut for display only, never in an export
- NULL is shown as the word NULL, which looks the same as a text value that spells NULL
- In a CSV export NULL is an empty field, and in a JSON export it is null; a BLOB is written whole as X'hex' in both
- The schema shown is the database as it is when the run finishes, so a table you create in the same run is listed

## Defined by

- [SQLite Database File Format](https://www.sqlite.org/fileformat2.html)
- [Datatypes In SQLite](https://www.sqlite.org/datatype3.html)
- [PRAGMA table_info](https://www.sqlite.org/pragma.html#pragma_table_info)
- [RFC 4180: Common Format and MIME Type for CSV Files](https://www.rfc-editor.org/rfc/rfc4180)

## Bundled data

This folder ships a data file that is not an npm dependency, so it travels with the folder when it is
copied out on its own:

- **SQLite 3.49.1** (Public domain) — [source](https://sqlite.org/2025/sqlite-amalgamation-3490100.zip). SQLite 3.49.1 is dedicated to the public domain by its authors. It is compiled into the WebAssembly module that sql.js 1.14.2 ships (select sqlite_version() prints 3.49.1). sql.js also compiles in the SQLite contributed file extension-functions.c, which carries no licence text of its own and is distributed from sqlite.org's contributed code area.
- **Emscripten runtime** (MIT) — [source](https://github.com/emscripten-core/emscripten/tree/2.0.15). Copyright (c) 2010-2014 Emscripten authors. The Makefile of sql.js 1.14.2 says its WebAssembly was last built with Emscripten 2.0.15, and the Emscripten runtime and C library are part of that module. Emscripten is offered under the MIT licence and the University of Illinois/NCSA licence; the MIT licence is the one relied on here, and the notice file holds both texts.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/sqlite-viewer sqlite-viewer
cd sqlite-viewer
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/sqlite-viewer
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadEngine, runSqlite } from '@fodt/sqlite-viewer';

const require = createRequire(import.meta.url);
await loadEngine(readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm')));

const result = runSqlite(null, 'create table t(a); insert into t values (1); select a from t;', {
  displayRows: 500,
  exportFormat: 'none',
  includeDatabase: false,
});
// result.results[0].rows is [['1']]; pass a Uint8Array of a database file instead of null to query it.
```

`loadEngine(wasmBinary)` gives the sql.js WebAssembly bytes to the engine once and caches it; calling it again does nothing, and no file is ever located or fetched. `runSqlite(bytes, sql, options)` opens a fresh in-memory copy of `bytes` (or an empty database for `null`), runs every statement of `sql` in order, closes the copy and returns `{ schema, results, changes, statements, exports, database?, warnings }`; the caller's array is never touched. Blank SQL returns the schema only. Every engine error is thrown as `SqliteViewerError` carrying SQLite's own message, and no partial results are ever returned with it. Values are text: NULL, the decimal digits of an integer of any size, JavaScript's shortest form of a REAL, the text itself, or X'hex' with the length for a BLOB. `changes` counts every row changed by the run, including rows changed by triggers. `checkDatabaseSize(byteLength)` throws the plain refusal sentence for a file over `MAX_DATABASE_BYTES`.

## Dependencies

- `sql.js` 1.14.2

## Tests

```sh
npm test
```

The SQLite documentation is the specification: the tests assert behaviour it states (type affinity, the six columns of PRAGMA table_info, BLOB literal syntax, integer range). Python's standard sqlite3 module is the independent second opinion: test/fixtures/make-fixture.py writes sample.sqlite, and the rows this package reads from that file are compared with what Python printed for the same file.

## Licence

MIT. See [LICENSE](./LICENSE).

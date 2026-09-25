# CSV Viewer

View, sort and filter delimited data, with automatic delimiter detection.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Reads a delimited text file or pasted text, automatically detecting whether it is separated by commas, semicolons, tabs or pipes, and lets a visitor sort and filter the result. Large files are read in a background thread with a time limit, so a big file never freezes the tab.

## Supported

- Automatic delimiter detection among comma, semicolon, tab and pipe, quote-aware per RFC 4180
- An explicit delimiter choice, overriding detection
- Sorting any column ascending or descending, by code point or by numeric value
- Filtering rows by a literal substring, in any column or a chosen one
- A header row naming the columns, or generated column numbers when there is none
- Opening a local file, or pasting text directly
- A row with fewer or more fields than the header, handled with a warning rather than an error

## Limits

- At most 500 matching rows are shown at a time; the full row and match counts are always reported
- Text sorts by code point, not by any language's own collation rules
- A filter is a literal substring match, never a regular expression
- The whole file is held in memory at once
- Files are read as UTF-8; a file in another encoding may show garbled text

## Ambiguous cases, and what this does about them

- Detection is a heuristic over up to the first 64 KB: a comma inside a quoted field never counts toward a different delimiter's score, but an unusually shaped file can still be misdetected -- the delimiter can always be chosen explicitly
- 'Auto' sorting treats a column as numeric only when every one of its non-empty cells is a plain RFC 8259 number; otherwise the whole column sorts as text

## Defined by

- [RFC 4180 — Common Format for CSV Files](https://www.rfc-editor.org/rfc/rfc4180)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/csv-viewer csv-viewer
cd csv-viewer
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/csv-viewer
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { viewCsv } from '@fodt/csv-viewer';

viewCsv(text, { delimiter: 'auto', header: true, sortColumn: 'age', sortDirection: 'desc' });
```

`detectDelimiter` is exported on its own for anything that only needs the guess; `viewCsv` calls it internally whenever `delimiter` is 'auto' or omitted. `MAX_DISPLAY_ROWS` (500) is the fixed cap this package itself enforces, exported so a page can explain a truncated result without hard-coding the number twice.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Delimiter detection is proven against hand-built fixtures for each candidate, including one with a delimiter character living inside an RFC 4180 quoted field, and against a genuinely single-column file. Sorting and filtering are proven with a seeded 1200-row fixture generated in the test file itself, checking the returned row and match counts as well as the 500-row cap.

## Licence

MIT. See [LICENSE](./LICENSE).

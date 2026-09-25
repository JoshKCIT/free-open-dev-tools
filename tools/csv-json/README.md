# CSV & JSON Converter

Convert between RFC 4180 CSV and JSON with delimiter, quoting and header control.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Converts RFC 4180 CSV to JSON and back, with control over the delimiter, whether the first row is a header, whether cells are type-inferred, and how the output is quoted and line-ended. A document with quotes, delimiters and line breaks inside fields survives a round trip unchanged.

## Supported

- Reading CRLF, LF or a lone CR as a record separator, and a last record with no trailing line break
- Quoted fields holding the delimiter, a line break or a doubled quote, per RFC 4180 rules 5 through 7
- Comma, semicolon, tab or pipe as the delimiter, both reading and writing
- A header row turned into object keys, or turned off for an array of arrays
- Optional type inference: true, false, null and RFC 8259 numbers become those values instead of staying strings
- Writing CSV from an array of objects (columns are the union of keys, in first-appearance order) or an array of arrays
- Choosing CRLF or LF line endings and whether every field is quoted, not only the ones that need it

## Limits

- Every CSV value is read as text unless type inference is switched on; even with it on, a value that is not exactly true, false, null or a plain number stays a string
- A missing key in one object becomes an empty cell, and an empty cell converts back to an empty string, not null; the two are not distinguishable in CSV
- A nested object or array in JSON input is written into its cell as JSON text, since CSV cells cannot themselves nest
- CSV itself has no comments, and no way to say a column is a number instead of a string

## Ambiguous cases, and what this does about them

- A stray double quote inside a field that does not itself start with a quote is read as a literal character, matching how spreadsheet programs read files that were not written to the letter of RFC 4180.
- A row shorter or longer than the header is refused rather than padded or truncated, since silently guessing which column is missing would be more surprising than an error naming the row.

## Defined by

- [RFC 4180 — Common Format and MIME Type for Comma-Separated Values (CSV) Files](https://www.rfc-editor.org/rfc/rfc4180)
- [RFC 8259 — The JavaScript Object Notation (JSON) Data Interchange Format](https://www.rfc-editor.org/rfc/rfc8259)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/csv-json csv-json
cd csv-json
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/csv-json
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { csvToJson, jsonToCsv } from '@fodt/csv-json';

csvToJson('name,quote\nAda,"Hello, world"');
// { output: '[{...}]', rows: 1, columns: 2 }

jsonToCsv('[{"name":"Ada","note":"a, b"}]');
```

Both functions return `{ output, rows, columns }` and throw `CsvJsonError` on a problem: a CSV syntax error carries `line`/`column`, a header or shape problem names the row or column, and a JSON syntax error carries `line`/`column` from the same RFC 8259 reader this tool bundles.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every quoting rule (5, 6 and 7) and the optional-trailing-line-break rule (2) are checked against RFC 4180's own worked examples. A format-then-parse round trip is asserted for fields carrying quotes, delimiters and embedded line breaks.

## Licence

MIT. See [LICENSE](./LICENSE).

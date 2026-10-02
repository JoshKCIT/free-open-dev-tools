# Spreadsheet Converter (XLSX, CSV, TSV, JSON, XML)

Turn an .xlsx sheet into CSV, TSV, JSON or XML, or CSV, TSV and JSON into an .xlsx file, without uploading anything.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Reads and writes the Office Open XML spreadsheet format (.xlsx) directly in your browser, in a background worker, with no spreadsheet library. Pick a sheet by name or number and get CSV, TSV, JSON or XML, with cell text, numbers and dates shown as the file stores them; or paste CSV, TSV or JSON and download an .xlsx file with a preview of how each cell was stored. The file is never uploaded, never changed and never stored.

## Supported

- The .xlsx package of ECMA-376 Part 1 (SpreadsheetML): shared strings, inline strings, rich text runs, numbers, booleans, errors and the saved (cached) value of formulas
- Built-in and custom date formats, the 1900 date system with its leap-day quirk and the 1904 date system, or serial numbers shown as stored
- Sheets chosen by name or by number, hidden sheets listed with their state
- CSV per RFC 4180, TSV per the IANA text/tab-separated-values registration, JSON (an array of objects or an array of arrays) and a fixed XML layout
- Writing one sheet from CSV, TSV or JSON, with numbers and TRUE or FALSE stored as such only when you ask for it

## Limits

- Files up to 20 MiB and 100 MiB of unzipped sheet data; Excel's own limits of 1,048,576 rows and 16,384 columns apply.
- A conversion that takes longer than 30 seconds is stopped with a message.
- Formulas are not calculated: the value the spreadsheet program saved is shown, and a formula with no saved value is empty.
- A cell is a date when its number format is a date format; choose to see serial numbers instead and nothing is interpreted.
- Older .xls files, .ods files and password-protected files are not read.
- Text to spreadsheet writes one sheet; digit strings with a leading zero or more than 15 digits stay text so a spreadsheet program cannot round them.

## Ambiguous cases, and what this does about them

- A number is shown with the digits the file stores, never re-printed: 0.1 stays 0.1 and a long digit string is not rounded
- Serial 60 in the 1900 date system is shown as 1900-02-29, a day that never existed; Excel counts it for compatibility with an older program
- A time of day (a serial below 1) is shown as HH:MM:SS, and a date with a time as YYYY-MM-DDTHH:MM:SS, with no time zone because a spreadsheet stores none
- Hidden rows and columns are included, and a merged range holds its value only in its top left cell
- Empty cells are empty text in CSV and TSV, null in JSON when keep types is on, and left out of the XML
- A sheet is chosen by position when you type a whole number, and by exact name otherwise; a number that is no position falls back to a sheet with that name
- Text to spreadsheet keeps every cell as text unless detect types is on; then only TRUE and FALSE become booleans and only plain numbers become numbers, so +5, .5 and -0 stay text

## Defined by

- [ECMA-376 Office Open XML File Formats](https://ecma-international.org/publications-and-standards/standards/ecma-376/)
- [RFC 4180: Common Format and MIME Type for CSV Files](https://www.rfc-editor.org/rfc/rfc4180)
- [IANA text/tab-separated-values](https://www.iana.org/assignments/media-types/text/tab-separated-values)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/spreadsheet-converter spreadsheet-converter
cd spreadsheet-converter
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/spreadsheet-converter
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { readFileSync } from 'node:fs';
import { readXlsx, pickSheet, sheetToText } from '@fodt/spreadsheet-converter';

const workbook = readXlsx(new Uint8Array(readFileSync('book.xlsx')), { datesAsSerials: false });
const sheet = pickSheet(workbook, ''); // the first visible sheet; '2' is the second sheet, 'Data' the sheet named Data
const { text, warnings } = sheetToText(sheet, 'csv', { header: true, keepTypes: false });
// text is the sheet as CSV; warnings lists anything that was renamed or could not be carried exactly.
```

`readXlsx(bytes, options)` unzips the package with fflate, refuses a file over `MAX_FILE_BYTES` before unzipping and parts that declare more than `MAX_UNZIPPED_BYTES` together, and returns `{ sheets, date1904, warnings }`; every cell is `{ kind, text, ref }` where `text` is exactly what the file stores (numbers keep their digits, dates are shown by their number format unless `datesAsSerials` is true). Pass `sheet` to read only that sheet's cells. `pickSheet(workbook, selector)` chooses a sheet; `sheetToText(sheet, format, options)` writes CSV, TSV, JSON or XML. `parseTextTable(text, format)` reads CSV, TSV or JSON into rows and `writeXlsx(rows, options)` writes a one-sheet package with a fixed modification time, so the same input always gives the same bytes. `convertSpreadsheet(job)` does either direction in one call. Every expected failure is a `SpreadsheetConverterError` with a plain message and, where it applies, the cell, the part or the line.

## Dependencies

- `fflate` 0.8.3

## Tests

```sh
npm test
```

ECMA-376 and the Microsoft pages it cites are the specification: cell types come from CellValues, the 1900 leap-day quirk from Microsoft's own support article. openpyxl 3.1.5 is the independent second opinion: test/fixtures/make-fixtures.py writes the committed files and re-reads a file cell by cell, and the writer's output for a fixed input is compared byte for byte with a committed file that openpyxl re-read to the values quoted in the test.

## Licence

MIT. See [LICENSE](./LICENSE).

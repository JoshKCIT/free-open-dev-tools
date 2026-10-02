# Table Builder

Build a table visually or import one from HTML, CSV, TSV or Markdown, and export it as Markdown, HTML, CSV, TSV or JSON.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Builds a table cell by cell in an editable grid, or imports one from pasted HTML, CSV, TSV or Markdown, then writes it out as a GitHub Flavored Markdown table, an HTML table, RFC 4180 CSV, TSV or JSON. Every format is generated from the same rectangular grid of cells, so switching format never loses a row, a column, or a character typed into a cell. An imported table replaces the grid for that run and the grid keeps what was typed.

## Supported

- A GitHub Flavored Markdown table with a header row and a delimiter row, escaping a pipe as a backslash-pipe and a line break as an HTML line break, so the table's shape survives
- An HTML table with thead and tbody, with every cell and attribute value escaped so markup typed into a cell stays text
- Column alignment (left, center, right or none) rendered as GFM delimiter colons and as HTML align attributes
- RFC 4180 CSV with a chosen delimiter (comma, semicolon, tab or pipe) and CRLF record separators
- JSON keyed by the header row, with a blank header named column_N and a duplicate header suffixed _2, _3 and so on; without a header row, JSON is written as an array of arrays
- Short rows padded with empty cells so the grid is always rectangular before it is written out
- Fully empty trailing rows and fully empty trailing columns dropped before the table is written
- Import from pasted HTML: the first table is read as a tree with parse5 (th and td text, a br as a line break, character references decoded), and nothing the markup names is fetched, shown or run
- Import from a GFM pipe table (header row, delimiter row with colons, escaped pipes, br line breaks, short rows padded and long rows trimmed as the specification shows), from RFC 4180 CSV with a chosen delimiter, and from TSV
- TSV export as text/tab-separated-values, one record per line with fields separated by a tab

## Limits

- No merged cells and no cell formatting beyond plain text: bold, links, images and nested tables are not supported inside a cell
- The grid holds at most 50 rows and 20 columns
- JSON output never infers a type: every cell value is always a string, including numbers and true/false/null
- CSV has no way to express column alignment or to mark a row as a header distinct from the data
- A cell's own leading or trailing space is not kept in the Markdown or HTML export, because GFM trims the space between a table pipe and a cell's content; CSV and JSON keep it
- Import reads the first table of pasted HTML, CSV, TSV or Markdown, up to 10,000 cells, and a warning says how many tables the pasted HTML held when there was more than one; the imported rows replace the grid for that run.
- HTML is read as a tree and never run; spans are expanded into repeated cells with a warning and nested tables are not read.
- TSV export refuses a cell holding a tab or line break, because TSV has no quoting.
- In HTML, white space written across source lines inside a cell is read as one space and the spaces at the start and end of each line are removed, except inside a pre, whose lines and spaces are kept as written; in Markdown, formatting marks such as bold or links stay as typed text, while backslash escapes and character references are read.

## Ambiguous cases, and what this does about them

- A row typed shorter than the others is padded with empty cells rather than refused, since a partially filled row is a normal state while editing a grid
- An alignment word that is not left, center, right or none (or their single-letter forms) is treated as no alignment, with a warning, rather than refused
- A Markdown row with more cells than its header has the extra cells dropped, as the GFM specification says, and the page lists what was dropped; a shorter row is padded with empty cells
- HTML rows are read in the order a browser lists them (header rows, then body rows, then footer rows), wherever the footer was written

## Defined by

- [GitHub Flavored Markdown Spec 0.29-gfm, section 4.10 Tables (extension)](https://github.github.com/gfm/#tables-extension-)
- [RFC 4180 — Common Format and MIME Type for Comma-Separated Values (CSV) Files](https://www.rfc-editor.org/rfc/rfc4180)
- [RFC 8259 — The JavaScript Object Notation (JSON) Data Interchange Format](https://www.rfc-editor.org/rfc/rfc8259)
- [HTML Living Standard — Tables](https://html.spec.whatwg.org/multipage/tables.html)
- [IANA media type text/tab-separated-values](https://www.iana.org/assignments/media-types/text/tab-separated-values)
- [HTML Living Standard — Parsing HTML documents](https://html.spec.whatwg.org/multipage/parsing.html)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/table-builder table-builder
cd table-builder
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/table-builder
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { buildTable } from '@fodt/table-builder';

buildTable([['foo', 'bar'], ['baz', 'bim']], { format: 'markdown' });
// { output: '| foo | bar |\n| --- | --- |\n| baz | bim |', rows: 2, columns: 2, warnings: [] }

buildTable([['foo', 'bar'], ['baz', 'bim']], { format: 'json' });
// { output: '[{"foo":"baz","bar":"bim"}]', rows: 2, columns: 2, warnings: [] }

import { importTable } from '@fodt/table-builder';

importTable('<table><tr><th>a</th></tr><tr><td>1</td></tr></table>', 'html');
// { rows: [['a'], ['1']], warnings: [] }

buildTable([['a', 'b'], ['1', '2']], { format: 'tsv' });
// { output: 'a\tb\n1\t2', rows: 2, columns: 2, warnings: [] }
```

buildTable(rows, options) takes a rectangular-or-not grid of strings and returns { output, rows, columns, warnings }. options.format selects markdown (default), html, csv, tsv or json. options.headerRow (default true) treats the first row as a header; when off, markdown and html still write a blank header row to stay valid, and json is written as an array of arrays instead of an array of objects. options.alignments is a comma list of left, center, right or none (or l, c, r, -), one per column. options.pad (markdown, default true) pads cell text to its column's width. options.csvDelimiter (csv, default a comma) and options.pretty (html and json, default true) control those two formats. Throws TableBuilderError when the grid has no cells left after trimming, or, for tsv, when a cell holds a tab or a line break (the message names its row and column). importTable(text, from, { delimiter }) reads the first table of pasted text, where from is html, csv, tsv or markdown, and returns { rows, warnings }; rows may differ in length, so pass them to buildTable to write them out. Empty text gives no rows. It throws TableImportError when no table is found, when a CSV quote is never closed, or when the table holds more than 10,000 cells. formatTsv(rows) writes TSV directly.

## Dependencies

- `parse5` 8.0.1

## Tests

```sh
npm test
```

The Markdown output is proven against the GitHub Flavored Markdown spec's own worked table examples, and against 200 seeded random grids rendered through micromark with the GFM extension as an independent parsing oracle, asserting the parsed result equals this tool's own direct HTML output. CSV output is proven by parsing it back with this tool's own RFC 4180 reader. A header cell named __proto__ is proven to become an ordinary own property with Object.prototype left untouched. Import is proven against examples 198 to 205 of the same specification (cells read off the HTML it prints for each), the RFC 4180 and IANA examples, and the HTML Living Standard's row order and span limits; 200 seeded random grids exported as Markdown are rendered by micromark and read back through the HTML reader, and read directly through the Markdown reader, and both give the same cells. A pasted script, handlers, image and stylesheet addresses are proven never to run or be requested, and the cell limit is proven at 10,000 and 10,001.

## Licence

MIT. See [LICENSE](./LICENSE).

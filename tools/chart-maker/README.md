# Chart Maker (Bar, Line, Pie)

Paste a table and get a bar, line or pie chart as SVG or PNG with a text description for screen readers.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Pasted rows become a bar, line or pie chart drawn as SVG by this package's own code, with a title, axis labels and a text description that screen readers can use. Put the labels in the first column and one or more columns of numbers after it, separated by commas or tabs. The chart can be copied or downloaded as SVG, or as a PNG that the page draws from the same SVG; the data is also shown as a table, so nothing depends on seeing the picture.

## Supported

- Comma or tab separated rows, with the quoting rules of RFC 4180 (a value in double quotes may hold commas, line breaks and doubled quotes); the delimiter is a tab when the first line holds one, otherwise a comma
- An optional header row that names the label column and each series
- Bar charts and line charts with one to eight series, and pie charts from the first number column
- A title, a horizontal and a vertical axis label, a legend and value labels on the marks
- Four palettes: default, colour-blind (the eight colours of Okabe and Ito), grayscale and high contrast
- An SVG whose root has the role graphics-document with a title and a description, and whose bars, points and slices are graphics-symbols with a label and a value; the page also gives an image description, a written description and the data as a table
- PNG export at twice the SVG size, drawn from the same SVG on a canvas in the page

## Limits

- Pastes up to 64 KiB, at most 200 points per series and 8 series; a pie chart takes at most 24 slices from the first number column.
- Numbers are read as written with a point for decimals; thousands separators and decimal commas are refused with the row and column, and so is a number larger than 1e100 in size, which cannot be drawn.
- A pie chart needs values of zero or more and a total above zero; a negative value or a total of zero is refused.
- Labels longer than 40 characters are shortened with an ellipsis in the chart, the table and the description; titles are shortened to 60 characters and axis labels to 40.
- Numbers are shown with at most 6 significant digits.
- Text in the chart uses this browser's fonts, so a PNG can look slightly different between browsers.
- The chart is a fixed 800 by 480 pixels; with many points the labels under the bars or points are thinned out and the marks become very thin.

## Ambiguous cases, and what this does about them

- A bar chart always starts its value axis at zero; a line chart's axis covers its own values and includes zero only when they cross it or are all the same
- A row that has fewer values than the header is read as having empty cells, and an empty cell in a number column is refused; a column that is empty in every row, including its header, is left out with a note
- Number reading is strict: an optional sign, digits, an optional point with digits and an optional exponent, with spaces around the number ignored; a leading or trailing point, a thousands separator and a decimal comma are not numbers
- A quote in the middle of an unquoted value is kept as it is; a quote that is opened at the start of a value must be closed before the next separator

## Defined by

- [WAI-ARIA Graphics Module 1.0 (graphics-document, graphics-object and graphics-symbol)](https://www.w3.org/TR/graphics-aria-1.0/)
- [Scalable Vector Graphics (SVG) 2](https://www.w3.org/TR/SVG2/)
- [RFC 4180: Common Format and MIME Type for Comma-Separated Values (CSV) Files](https://www.rfc-editor.org/rfc/rfc4180)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/chart-maker chart-maker
cd chart-maker
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/chart-maker
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { makeChart } from '@fodt/chart-maker';

const chart = makeChart('Fruit,Count\nApples,3\nPears,5', { type: 'bar', title: 'Fruit sold' });
// chart.svg is the whole SVG file as text; chart.alt is the one-line image description
// chart.description is a list of sentences, chart.table holds the headers and rows, chart.notes holds any notes
const nothing = makeChart('   ', { type: 'pie' });
// nothing is null: a blank paste has no chart
```

makeChart(text, options) reads the rows, checks every limit and returns { svg, alt, description, table, notes }, or null for a blank paste; options are type ('bar', 'line' or 'pie'), title, xLabel, yLabel, header (default true), legend (default true), values (default false) and palette ('default', 'colour-blind', 'grayscale' or 'high-contrast'). Anything it refuses is thrown as a ChartError with a plain sentence that names a row and column but never repeats the pasted text. parseTable(text, { header }) is the reader on its own, chartSvg(table, options) is the SVG writer, niceTicks(min, max, count) and formatValue(n) are the axis helpers, and altText, describeChart and tableRows write the text that goes with the chart. PALETTES maps each palette name to its colours.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Rows are read exactly as RFC 4180 describes, and a table of tricky cases (quotes, doubled quotes, line breaks inside quotes, trailing empty values, tabs) was also read by Python's csv module and the results are written into the test. Bar heights, line points and pie angles are read back from the written SVG and compared with values worked out in the test from the inputs. The axis ticks are checked to be 1, 2 or 5 times a power of ten, the palette named colour-blind is the published list of eight colours of Okabe and Ito, every chart is checked to be well-formed XML with no link, foreign object or address reference, and in a browser the same geometry is measured with getBBox and the PNG is decoded.

## Licence

MIT. See [LICENSE](./LICENSE).

# CSS Grid Generator

Lay out grid tracks and areas with a live preview.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Types column and row track sizes and draws named areas as rows of names, showing the live grid of labelled cells next to the exact CSS. Built for exploring a page layout or a card grid before pasting the result into a real project.

## Supported

- Column and row track lists built from the CSS Grid Layout Level 2 track sizes this tool supports: a fixed length or percentage, fr, auto, min-content, max-content, minmax() and repeat()
- Named grid areas drawn as one line of names per row, with the CSS Grid Level 2 rule that every named area must form a single filled rectangle and every row have the same number of cells
- Automatic item placement (no areas given) with a chosen item count, or one item placed per named area with grid-area
- column-gap and row-gap from CSS Box Alignment Level 3, and justify-items/align-items

## Limits

- Only the track sizes listed above are accepted; line names, auto-fill, auto-fit, subgrid and masonry are not offered
- Area names are case-sensitive and limited to lower-case letters, digits and hyphens, exactly as this tool accepts them; a name typed with an upper-case letter is refused rather than silently lower-cased
- Browsers may round fractional track sizes slightly differently from one another
- Placement of real content inside a grid area depends on the visitor's own page; the preview shows only a labelled placeholder cell

## Ambiguous cases, and what this does about them

- A track list or area block that fails to parse falls back to this tool's own default (1fr 1fr 1fr for columns, auto auto for rows, or no areas) with a warning naming the problem, rather than refusing the whole result
- When areas are given, the column and row counts implied by grid-template-columns/rows must match the area grid; a mismatch is reported as a warning rather than silently reconciled

## Defined by

- [CSS Grid Layout Module Level 2 — Explicit Track Sizing and Named Areas](https://www.w3.org/TR/css-grid-2/)
- [CSS Box Alignment Module Level 3 — Row and Column Gutters](https://www.w3.org/TR/css-align-3/#gap-shorthand)
- [CSS Color Module Level 4 — RGB Hexadecimal Notations](https://www.w3.org/TR/css-color-4/#hex-notation)
- [CSS Syntax Module Level 3 — Escaping and comments](https://www.w3.org/TR/css-syntax-3/#escaping)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/grid-generator grid-generator
cd grid-generator
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/grid-generator
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { generateGrid } from '@fodt/grid-generator';

generateGrid({
  columns: '200px 1fr',
  rows: 'auto 1fr auto',
  areas: 'header header\nsidebar main\nfooter footer',
});
// { css: '.grid {\n  display: grid;\n  ...\n}', tree: { className: 'grid', children: [...] }, ... }
```

generateGrid({ columns, rows, areas, itemCount, columnGap, rowGap, justifyItems, alignItems, width, height }) parses columns and rows through parseTrackList and areas through parseTemplateAreas (both from grid-syntax.ts), rewriting the parsed result rather than passing typed text through. Returns { css, tree, warnings }: css is one .grid rule (plus one .area-<name> or .cell-<n> rule per area or auto-placed item) built through the canonical stylesheetText writer; tree is the element tree the CSS styles; warnings names any parse failure or clamped field. Throws GridError only if the canonical safety writer itself refuses the finished CSS, which validated input never reaches.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The track list and area grammars, the filled-rectangle rule and the CSS Grid Level 2 areas example are each quoted from the specification and asserted directly, including against the installed css-tree 3.2.1 lexer (no KNOWN_DIFFERENCES were found for this tool). Hostile field values are checked against the shared HOSTILE_VALUES battery.

## Licence

MIT. See [LICENSE](./LICENSE).

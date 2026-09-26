# Flexbox Playground

Experiment with flex container and item properties against a live preview.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Sets every flex container property and up to five items' own grow, shrink, basis, order and alignment, showing the live result next to the exact CSS. Built for exploring how flex-direction, wrapping, justification and per-item flexibility interact before pasting the result into a real layout.

## Supported

- Every flex-direction, flex-wrap, justify-content, align-items and align-content keyword CSS Flexible Box Layout Level 1 defines, written only when the value differs from its own initial value
- One to five items, each with an independent grow factor, shrink factor, basis, order and align-self, written with the flex shorthand the specification encourages
- The gap property from CSS Box Alignment Level 3, applied to both the main and cross axis
- The reordering-and-accessibility warning the specification itself requires whenever an item's order is changed

## Limits

- Rendering differs slightly between browsers for baseline alignment, since it depends on the fonts the visitor's own browser picks
- Changing order only changes the visual order of the items; it never changes the reading order or the tab order, so it must not be used to convey meaning, exactly as the specification itself warns
- Items are fixed demo boxes with a short label, so content-driven sizing behaviour in the visitor's own page may differ from the preview
- Only one to five items are shown; a real layout with more items behaves the same way, but is not modelled here

## Ambiguous cases, and what this does about them

- An empty basis field means the initial 'auto' keyword, not zero
- align-content is only written when wrapping is switched on, since the specification states it has no effect on a single-line flex container
- A zero length is written without a unit ('0', not '0px') everywhere this tool's own output uses one, including the flex shorthand's own basis component -- one of the two forms CSS itself allows

## Defined by

- [CSS Flexible Box Layout Module Level 1](https://www.w3.org/TR/css-flexbox-1/)
- [CSS Box Alignment Module Level 3 — Row and Column Gutters](https://www.w3.org/TR/css-align-3/#gap-shorthand)
- [CSS Color Module Level 4 — RGB Hexadecimal Notations](https://www.w3.org/TR/css-color-4/#hex-notation)
- [CSS Syntax Module Level 3 — Escaping and comments](https://www.w3.org/TR/css-syntax-3/#escaping)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/flexbox-playground flexbox-playground
cd flexbox-playground
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/flexbox-playground
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { generateFlexbox } from '@fodt/flexbox-playground';

generateFlexbox({
  container: { direction: 'column', justifyContent: 'space-between', gap: 12 },
  items: [{}, { grow: 1, shrink: 1, basis: 0 }],
});
// { css: '.container {\n  display: flex;\n  ...\n}', tree: { className: 'container', children: [...] }, ... }
```

generateFlexbox({ container, items }) takes an optional container object (direction, wrap, justifyContent, alignItems, alignContent, gap 0-64px, width 120-640px, height 80-480px) and one to five items, each an optional { grow, shrink, basis, order, alignSelf }. Returns { css, tree, warnings }: css is the .container and .item rules (plus one .item-<n> rule per item whose values differ from the flex initial values) built through the canonical stylesheetText writer; tree is the element tree the CSS styles; warnings names any field a value was clamped or replaced in, plus the reordering-and-accessibility note whenever an item's order is non-zero. Throws FlexboxError only if the canonical safety writer itself refuses the finished CSS, which validated input never reaches.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every keyword list, the flex shorthand's own value order, the initial-value omission rule, the reordering-and-accessibility warning and the gap property are each quoted from CSS Flexible Box Layout Level 1 and CSS Box Alignment Level 3 and asserted directly. Every declaration is checked against the css-tree 3.2.1 lexer (no KNOWN_DIFFERENCES were found for this tool). Hostile field values are checked against the shared HOSTILE_VALUES battery.

## Licence

MIT. See [LICENSE](./LICENSE).

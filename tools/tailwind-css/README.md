# Tailwind & CSS Converter

Convert Tailwind utility classes to CSS and back for the core utility set.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Converts Tailwind CSS 4 core utility classes into the plain CSS declarations the real Tailwind compiler would give them, with every theme value resolved, and converts CSS declarations back into the fewest core classes that produce exactly those declarations. Theme values (spacing, colour palette, font sizes, font weights, radii and more) are transcribed from the pinned tailwindcss package's own theme file and checked by test against it; the real Tailwind compiler runs only in this folder's own tests as the oracle for every supported class, never in a visitor's browser.

## Supported

- Spacing utilities (padding, margin with negative values, gap) over quarter steps 0 to 96, resolved to a single folded length
- Sizing utilities (width, height, size, min and max variants) with spacing numbers, fractions, full, screen, auto, min, max, fit and container sizes for max-width
- Colour utilities (text, background, border and its sides, fill, stroke) over the full palette plus black, white, transparent, current and inherit, with a 5-step opacity modifier producing the same color-mix value the pinned compiler emits
- Typography utilities: font size with its matching line height, font weight, font family, letter spacing, line height, text alignment, italics, case, underline and truncation
- Flex and grid utilities: display, direction, wrap, grow, shrink, basis, order, alignment and grid placement
- Border utilities: width, style, per-side variants and border radius including every corner and side form
- Classes to CSS in a per-class or a combined single-rule form, with later classes winning for a repeated property
- CSS declarations back to a class list, with a round trip that gives back the same declarations for every supported class

## Limits

- Core utilities of one pinned Tailwind CSS 4 release only: no variants (hover:, md:, dark:), no arbitrary values, no plugins and no user configuration or @theme overrides
- space-*, divide-*, shadows, rings, transforms, transitions and animations are not converted
- Reverse colour matching only recognises the exact oklch values Tailwind CSS 4 uses: a hex, rgb or hsl colour is listed as unmatched even when it is visually identical
- Reverse matching only recognises shorthand and longhand declarations written exactly as Tailwind itself writes them
- The reverse direction is a greedy cover, not a guaranteed-minimal one: an unusual declaration set can in principle be covered by fewer classes than this tool finds
- @media and other at-rules in pasted CSS are reported and skipped, never converted

## Ambiguous cases, and what this does about them

- In the combined output mode, classes are applied in the order they are written, later classes winning for a repeated property, the same order Tailwind's own utility layer applies them in
- Reverse matching prefers the candidate covering the most remaining declarations at once, then the earliest match in this tool's own candidate list, so two equally good covers resolve the same way every time
- A declaration this tool cannot express as one class combination, such as an unusual shorthand grouping, is left in the unmatched list rather than guessed at

## Defined by

- [Tailwind CSS v4.3 documentation (pinned release)](https://tailwindcss.com/docs)

## Bundled data

This folder ships a data file that is not an npm dependency, so it travels with the folder when it is
copied out on its own:

- **Tailwind CSS 4.3.3 default theme** (MIT) — [source](https://github.com/tailwindlabs/tailwindcss/blob/v4.3.3/packages/tailwindcss/theme.css). Theme values transcribed from "tailwindcss" (c) Tailwind Labs, Inc., https://github.com/tailwindlabs/tailwindcss, MIT licensed.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/tailwind-css tailwind-css
cd tailwind-css
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/tailwind-css
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { classesToCss, cssToClasses } from '@fodt/tailwind-css';

classesToCss('p-4 text-sm'); // { css: '.p-4 {\n  padding: 1rem;\n}...', converted: [...], unknown: [] }
cssToClasses('padding: 1rem;'); // { classes: 'p-4', rules: [...], unmatched: [], warnings: [] }
```

classesToCss(classes, { output }) splits on whitespace, converts every recognised class and lists the rest in unknown; output is 'per-class' (default, one rule per class) or 'combined' (one .element rule, later classes winning for a repeated property). cssToClasses(css, { remIs16px }) parses a declaration list or one or more rules and returns the winning class list per rule; remIs16px (default true) treats a px length that is an exact multiple of 4 as the equivalent rem length so it can match a spacing-based class.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every class in SUPPORTED_CANDIDATES is checked against the real, pinned tailwindcss package's own compiler output (never bundled, devDependency only), with theme variables and internal --tw-* custom properties resolved before comparing. Theme values in theme.ts are checked line by line against the installed package's own theme.css. The round trip test proves classesToCss(cssToClasses(classesToCss(c))) keeps the same declarations as classesToCss(c) for every supported class.

## Licence

MIT. See [LICENSE](./LICENSE).

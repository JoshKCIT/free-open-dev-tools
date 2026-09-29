# Markdown Formatter

Reformat Markdown consistently, aligning tables and normalising lists, emphasis and headings.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Reformats Markdown or MDX with Prettier's own Markdown printer: aligns tables, normalises list markers, emphasis and heading styles, and wraps prose to a chosen width. Fenced code blocks and YAML front matter are always left exactly as written, whichever parser is chosen.

## Supported

- CommonMark 0.31.2 plus GitHub Flavored Markdown 0.29-gfm: tables, strikethrough, task list items and autolinks
- MDX via the mdx parser: import/export statements, JSX and {expression} syntax are carried through, not reformatted or validated
- GFM table column alignment, re-aligned to the widest cell in each column
- List, emphasis (_italic_, **strong**) and heading (ATX and setext) marker normalisation
- Prose wrap: preserve line breaks as written (default), wrap at the print width, or one line per paragraph
- Print width from 20 to 200 (default 80)
- Malformed input refused with Prettier's own message and its line and column

## Limits

- Fenced and indented code blocks, and YAML front matter, are never formatted or reformatted, including any code embedded inside a fenced block
- MDX import/export statements, JSX and {expression} syntax are kept exactly as written and never validated; malformed JSX is passed through rather than refused
- Prettier's mdx parser carries no version-identifying string of its own; direct probes against the installed plugin confirm MDX 2/3-compatible syntax (no blank line required between an import/export statement and following content; an empty {} expression is accepted), but the exact MDX major version it targets could not be confirmed further
- Wrapping (always or never) can move where a soft line break falls, which changes the rendered HTML's whitespace only -- except for two adjacent CJK (Chinese/Japanese/Korean) characters split across a line break, where wrapping removes the break with no space added, changing the rendered text itself
- A document nested thousands of levels deep (for example deeply nested block quotes) is refused with a message rather than crashing
- Extensions outside CommonMark and GFM, such as math, are treated as plain text
- Output line endings are always \n, whatever the input used
- A pathological document (for example a very long run of unmatched [ brackets) is stopped after 5 seconds on the page rather than freezing the tab

## Ambiguous cases, and what this does about them

- Marker choices Prettier makes are kept as this tool's own behaviour, not reconfigurable: emphasis uses _ (single underscore) and strong uses ** (double asterisk); a bullet list uses - by default, alternating with * for an adjacent list so the two stay visibly separate; ordered list numbering follows Prettier's own renumbering rule
- An aligned GFM table wider than the print width is still printed fully aligned rather than truncated or left unaligned (measured at print width 40 against a table with much wider cells)
- With prose wrap 'always' or 'never', a line break between two CJK characters is removed with no space added, so the rendered text changes beyond whitespace; CJK text is therefore only used in this package's own preserve-mode HTML-equality oracle, and the joining behaviour itself is asserted as a literal test

## Defined by

- [CommonMark 0.31.2](https://spec.commonmark.org/0.31.2/)
- [GitHub Flavored Markdown Spec (0.29-gfm)](https://github.github.com/gfm/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/markdown-formatter markdown-formatter
cd markdown-formatter
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/markdown-formatter
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { formatMarkdown } from '@fodt/markdown-formatter';

await formatMarkdown('*a*  __b__', { parser: 'markdown' });
// { output: '_a_ **b**\n', inputBytes: 10, outputBytes: 11 }
```

`formatMarkdown(source, options)` is async and returns `{ output, inputBytes, outputBytes }`, or throws `MarkdownFormatterError` with `line`/`column` (1-based) when Prettier's own parser refuses the input, or with neither for the print-width and too-deeply-nested errors. `parser` is `'markdown'` (default, CommonMark + GFM) or `'mdx'`. `proseWrap` is `'preserve'` (default), `'always'` or `'never'`. `printWidth` is 20-200 (default 80). Empty input returns an empty result without calling Prettier. This package carries no time limit of its own; the page that calls it owns that (see `run-markdown-formatter-in-worker.ts`).

## Dependencies

- `prettier` 3.9.9

## Tests

```sh
npm test
```

Grounded in the CommonMark 0.31.2 and GitHub Flavored Markdown (0.29-gfm) specifications, cited by section and example number. The equality oracle is micromark plus micromark-extension-gfm (a mature independent CommonMark/GFM implementation, used as a second opinion, never the definition): under prose wrap preserve, the rendered HTML of a document must be byte-identical before and after formatting; under always/never, it must be identical after collapsing whitespace runs outside <pre> blocks, since wrapping only moves where a soft line break falls.

## Licence

MIT. See [LICENSE](./LICENSE).

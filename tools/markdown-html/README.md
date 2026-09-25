# Markdown & HTML Converter

Convert Markdown to sanitised HTML and back, with a table of contents option.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Parses Markdown with a CommonMark- and GitHub Flavored Markdown-conformant parser, sanitises the result with the same policy used everywhere else on this site, and previews it in a sandboxed frame. Converts HTML back to Markdown with GitHub Flavored Markdown table, strikethrough and task list rules, proven by a round trip through the same parser.

## Supported

- CommonMark 0.31.2: every construct in the specification's own example set
- GitHub Flavored Markdown 0.29-gfm extensions: tables, strikethrough, autolinks and the task list checkbox rewrite
- A table of contents linking every heading to a unique GitHub-style id, to a chosen depth
- Sanitising raw HTML embedded in Markdown before it is shown, using the shared sanitising policy every rendering page on this site uses
- Images and other resources that load from an address are removed; small inline data images are kept
- HTML back to Markdown: ATX headings, fenced code blocks, dash bullet lists, GFM tables, strikethrough and task list items
- Script and style content, and dangerous link targets, are dropped rather than carried into the Markdown

## Limits

- Math, footnotes and YAML front matter are not supported
- A table with merged cells (colspan or rowspan) or block content in a cell is kept as raw HTML inside the Markdown rather than as a GFM pipe table
- The table of contents heading-id rule follows GitHub's own observed convention, not a published standard
- Inline styles, CSS classes and HTML comments are dropped when converting HTML back to Markdown
- Raw HTML inside Markdown is kept only as far as the sanitiser allows: no scripts, forms, embeds, style elements or event handlers
- A document with more than 20,000 emphasis markers (*, _ or ~) is refused rather than risking a freeze; the same is true converting HTML back to Markdown with more than 6,000 links

## Ambiguous cases, and what this does about them

- GitHub-style heading ids are this project's own observed rule (lower-case; Unicode letters, marks, numbers, connector punctuation, spaces and hyphens kept; spaces become hyphens; a repeated id is suffixed -1, -2, ...), not a published specification
- A heading found inside a raw HTML block joins the table of contents the same as any other heading

## Defined by

- [CommonMark 0.31.2](https://spec.commonmark.org/0.31.2/)
- [GitHub Flavored Markdown Spec (0.29-gfm)](https://github.github.com/gfm/)
- [OWASP XSS Filter Evasion Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.html)
- [HTML Living Standard](https://html.spec.whatwg.org/multipage/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/markdown-html markdown-html
cd markdown-html
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/markdown-html
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { markdownToSafeHtml, htmlToMarkdown } from '@fodt/markdown-html';

markdownToSafeHtml('# Hi\n\n*there*', window, { toc: false });
// { html: '<h1 id="hi">Hi</h1>\n<p><em>there</em></p>', headings: [...], removed: {...}, warnings: [] }

htmlToMarkdown('<h2>Title</h2><p><em>a</em> <strong>b</strong></p>');
// { markdown: '## Title\n\n_a_ **b**', warnings: [] }
```

`markdownToSafeHtml(markdown, win, { toc = false, tocDepth = 3 })` returns `{ html, headings, removed, warnings }`. `win` is the caller's own `window`; this package never reads a DOM global itself. `renderCommonMark(markdown)` is the parser stage's HTML before sanitising, exported only for the conformance tests -- its own doc comment says never to display it; it throws `MarkdownHtmlError` for a document over the emphasis-marker limit, or a genuinely unrecoverable input (sanitising without a usable window). `htmlToMarkdown(html)` returns `{ markdown, warnings }` and throws a plain `Error` for a document over the link-count limit. An ordinary parse quirk is reported through `warnings` instead of thrown.

## Dependencies

- `micromark` 4.0.2
- `micromark-extension-gfm` 3.0.0
- `dompurify` 3.4.16
- `turndown` 7.2.4

## Tests

```sh
npm test
```

Tested against the CommonMark 0.31.2 specification's own example set and the GitHub Flavored Markdown spec's table, strikethrough, autolink, task list and tagfilter extension examples, both vendored at pinned commits. Every difference from the vendored expected HTML is listed by example number with its reason in KNOWN_DIFFERENCES, and the conformance test asserts the failing set equals that list exactly rather than expecting zero differences. Also tested against every payload in the vendored OWASP XSS Filter Evasion Cheat Sheet, in both directions, and against a round-trip corpus proving Markdown to HTML to Markdown to HTML gives the same HTML.

## Licence

MIT. See [LICENSE](./LICENSE).

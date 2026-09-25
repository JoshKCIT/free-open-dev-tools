# BBCode Converter

Convert between BBCode, Markdown and sanitised HTML.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Parses BBCode with a phpBB-style default tag set, Markdown with a CommonMark- and GitHub Flavored Markdown-conformant parser, or HTML with a script-free parser, into one shared document tree, then writes BBCode, Markdown or sanitised HTML from it. HTML output always passes the same sanitising policy used everywhere else on this site and previews only in a sandboxed frame.

## Supported

- BBCode to HTML, BBCode to Markdown, and HTML or Markdown to BBCode, over one shared document tree
- phpBB's documented default tag set: b, i, u, s, url, url=, img, quote, quote=name, code, code=lang, list, list=1, list=a, *, color=, size=, center, left, right
- CommonMark Markdown input and output, including emphasis, strong, strikethrough, links, images, blockquotes, code, lists and headings
- HTML input and output without a DOM, including formatting elements, links, images, blockquotes, code, lists and colour or alignment styling
- Sanitising all HTML output with the same policy every rendering page on this site uses; the preview always renders in a sandboxed frame
- url, img and color values are checked against an allow list before being kept; anything unsafe is dropped with a warning
- Round trips: BBCode to HTML to BBCode and Markdown to BBCode to Markdown keep the same content for the supported tag set

## Limits

- No standards body defines BBCode; the tag set follows phpBB's own documented defaults, not a universal specification
- Tables, spoilers, video embeds, attachments and other forum-specific BBCode tags are not converted
- A BBCode tag outside the supported set, or left unclosed, is kept as literal text rather than converted
- Underline, colour, size and text alignment have no CommonMark Markdown form and are dropped with a warning when converting to Markdown
- HTML output never loads anything from another address: images and other references from outside addresses lose their source
- Text that itself looks like a supported BBCode tag (for example a literal [b] in Markdown or HTML input) is read back as that tag

## Ambiguous cases, and what this does about them

- A tag written with mismatched case, such as [B], is read the same as its lower-case form, matching common forum software
- Text that already contains BBCode-shaped syntax cannot be distinguished from an intended tag; it is always parsed as a tag

## Defined by

- [CommonMark 0.31.2](https://spec.commonmark.org/0.31.2/)
- [HTML Living Standard](https://html.spec.whatwg.org/multipage/)
- [OWASP XSS Filter Evasion Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.html)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/bbcode bbcode
cd bbcode
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/bbcode
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { convertMarkup } from '@fodt/bbcode';

convertMarkup('[b]bold[/b]', { from: 'bbcode', to: 'html' }, window);
// { output: '<strong>bold</strong>', preview: '<strong>bold</strong>', removed: {...}, warnings: [] }

convertMarkup('[b]bold[/b]', { from: 'bbcode', to: 'markdown' });
// { output: '**bold**', warnings: [] }
```

`convertMarkup(input, { from, to }, win)` returns `{ output, preview, removed, warnings }`. `from` and `to` are each one of `bbcode`, `markdown`, `html`. `win` is the caller's own `window`; it is read only when `to` is `html` (sanitising needs a DOM) and this package never reads a DOM global itself otherwise. `preview` equals `output` for an HTML target and is empty for the other two. Throws `BbcodeError` for input this package cannot parse at all; an unsupported feature during conversion is instead reported through `warnings`.

## Dependencies

- `@bbob/parser` 4.4.1
- `dompurify` 3.4.16
- `mdast-util-from-markdown` 2.0.3
- `mdast-util-gfm` 3.1.0
- `micromark-extension-gfm` 3.0.0
- `htmlparser2` 12.0.0

## Tests

```sh
npm test
```

No standards body defines BBCode; tests follow phpBB's own documented default tag set (fetched from phpBB's community BBCode guide) rather than a specification. HTML output is tested against every payload in the vendored OWASP XSS Filter Evasion Cheat Sheet. Markdown output and input are tested for CommonMark 0.31.2 conformance on the supported construct subset.

## Licence

MIT. See [LICENSE](./LICENSE).

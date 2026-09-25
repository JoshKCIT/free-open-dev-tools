# XML Formatter & Validator

Format, minify and well-formedness check XML, with external entities disabled.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Checks a pasted document for XML 1.0 well-formedness, formats it with indentation or minifies it, changing only whitespace between markup. Any document declaring a DOCTYPE is refused before it is parsed, so an entity bomb or an external entity reference is never expanded.

## Supported

- XML 1.0 well-formedness checking, reporting an error's line and column
- Formatting with a chosen indent, adding whitespace only between elements whose content is only elements, comments, processing instructions or CDATA
- Minifying by removing whitespace-only text between markup, and comments when asked
- xml:space="preserve" and mixed content (text interleaved with child elements) kept exactly as written, in every mode
- Any DOCTYPE declaration refused before parsing, in any letter case, so entity bombs and external entities are never read
- An entity reference other than the five predefined entities or a numeric character reference refused with its position, since no DOCTYPE is ever read to declare one
- Tags, attribute order, attribute quoting, text and CDATA content kept exactly as written; nothing but whitespace between markup is ever rewritten

## Limits

- No DTD or schema validation is performed; only well-formedness is checked
- Any document with a DOCTYPE declaration is refused outright, even one with no entities, since this page never reads DTDs
- A very long single-line document is not wrapped onto multiple lines
- Comments are removed on minify only when asked; the XML declaration and processing instructions are never removed
- Attribute values are never re-quoted or reordered, even when minifying

## Ambiguous cases, and what this does about them

- An element with no child elements and only whitespace text (for example a self-closing tag written with extra internal spacing) is treated as element-only content, not mixed content

## Defined by

- [Extensible Markup Language (XML) 1.0 (Fifth Edition)](https://www.w3.org/TR/xml/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/xml-formatter xml-formatter
cd xml-formatter
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/xml-formatter
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { formatXml } from '@fodt/xml-formatter';

formatXml('<a><b>1</b></a>', { mode: 'format', indent: 2 });
// { output: '<a>\n  <b>1</b>\n</a>', elements: 2, attributes: 0, maxDepth: 2 }
```

`formatXml(source, options)` returns `{ output, elements, attributes, maxDepth }` and throws `XmlFormatterError` with `line`/`column` for a DOCTYPE, a well-formedness error or an undeclared entity reference. `options.mode` is `'format'` (default), `'minify'` or `'check'`; `options.indent` (default 2, spaces per level) applies to `format`; `options.removeComments` (default false) applies to `minify`.

## Dependencies

- `fast-xml-parser` 5.11.1

## Tests

```sh
npm test
```

A hand-written linear tokenizer (no backtracking regular expressions) splits already-validated text into markup tokens, then only whitespace-only text nodes between element-only content are added or removed; a seeded property test over 200 random documents proves the non-whitespace token sequence is identical before and after formatting or minifying. DOCTYPE refusal and the undeclared-entity refusal are each checked against a billion-laughs document and an external-entity document.

## Licence

MIT. See [LICENSE](./LICENSE).

# XML Formatter & Validator

Format, minify, check, canonicalize and compare XML and view it as a tree, with external entities disabled.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Checks a pasted document for XML 1.0 well-formedness, formats it with indentation or minifies it, changing only whitespace between markup. It can also show the document as a collapsible tree, write its Canonical XML form (Canonical XML 1.0, Exclusive Canonical XML 1.0 or Canonical XML 1.1, with or without comments) and say whether two documents are equivalent once canonicalized. Canonical XML and the comparison are computed by libxml2, compiled to WebAssembly, in a background worker that can be cancelled. Any document declaring a DOCTYPE is refused before it is parsed, so an entity bomb or an external entity reference is never expanded.

## Supported

- XML 1.0 well-formedness checking, reporting an error's line and column
- Formatting with a chosen indent, adding whitespace only between elements whose content is only elements, comments, processing instructions or CDATA
- Minifying by removing whitespace-only text between markup, and comments when asked
- xml:space="preserve" and mixed content (text interleaved with child elements) kept exactly as written, in every mode
- Any DOCTYPE declaration refused before parsing, in any letter case, so entity bombs and external entities are never read
- An entity reference other than the five predefined entities or a numeric character reference refused with its position, since no DOCTYPE is ever read to declare one
- Tags, attribute order, attribute quoting, text and CDATA content kept exactly as written; nothing but whitespace between markup is ever rewritten
- Canonical XML 1.0, Exclusive Canonical XML 1.0 and Canonical XML 1.1, with or without comments, reproducing the worked examples of the W3C recommendations
- An equivalence check that says whether two documents are the same after canonicalization, comments left out, and shows where their canonical forms first differ
- A collapsible tree of the document in a sandboxed view that runs no script, with the first two levels open, every character shown as text and nothing loaded

## Limits

- No DTD or schema validation is performed; only well-formedness is checked
- Any document with a DOCTYPE declaration is refused outright, even one with no entities, since this page never reads DTDs; a DOCTYPE is refused in every mode, so DTD defaults are never applied
- A very long single-line document is not wrapped onto multiple lines
- Comments are removed on minify only when asked; the XML declaration and processing instructions are never removed
- Attribute values are never re-quoted or reordered, even when minifying
- Canonical XML and comparison run in a background worker; a run longer than 20 seconds is stopped with a message.
- Canonical XML and comparison read documents up to 10 MiB each; a larger document is refused before anything starts.
- Comparison ignores attribute order, quoting, empty-element form and whitespace inside tags; whitespace between elements and namespace prefix choice still count, so documents that differ only in those are reported as different.
- The tree shows at most 2,000 elements.
- A namespace name that libxml2 reads as a relative address, such as one with no scheme or a one-letter scheme like x:y, cannot be canonicalized; use an absolute name such as urn:x or http://example.com/ns.

## Ambiguous cases, and what this does about them

- An element with no child elements and only whitespace text (for example a self-closing tag written with extra internal spacing) is treated as element-only content, not mixed content
- Canonical XML 1.0 example 3.5 (an external entity) and example 3.3 (a default attribute from a DTD) cannot be reproduced, because no DTD or external entity is ever read; the other worked examples are reproduced exactly
- libxml2 limits one text node to ten million bytes and nesting to 256 levels, and says so in its own words, which mention an option this page does not offer
- The encoding named in an XML declaration is ignored for Canonical XML and comparison, since a pasted document is already text and canonical output is always UTF-8

## Defined by

- [Extensible Markup Language (XML) 1.0 (Fifth Edition)](https://www.w3.org/TR/xml/)
- [Canonical XML Version 1.0](https://www.w3.org/TR/2001/REC-xml-c14n-20010315)
- [Exclusive XML Canonicalization Version 1.0](https://www.w3.org/TR/2002/REC-xml-exc-c14n-20020718/)
- [Canonical XML Version 1.1](https://www.w3.org/TR/2008/REC-xml-c14n11-20080502/)

## Bundled data

This folder ships a data file that is not an npm dependency, so it travels with the folder when it is
copied out on its own:

- **libxml2** (MIT) — [source](https://github.com/jameslan/libxml2/tree/f52e859efe97cf3f0b78d731976402748878529a). Copyright (C) 1998-2012 Daniel Veillard and The Libxml2 Contributors. libxml2 2.15.1 (the VERSION file of the source commit that libxml2-wasm 0.7.2 builds) is compiled into the WebAssembly module that libxml2-wasm 0.7.2 embeds in lib/libxml2raw.mjs. libxml2 is offered under the MIT licence; the files dict.c and list.c carry a similar licence with different copyright notices.
- **Emscripten runtime** (MIT) — [source](https://github.com/emscripten-core/emscripten/tree/5.0.2). Copyright (c) 2010-2014 Emscripten authors. The build workflow of libxml2-wasm 0.7.2 names Emscripten 5.0.2, and the Emscripten runtime and C library are part of the module that libxml2-wasm 0.7.2 embeds. Emscripten is offered under the MIT licence and the University of Illinois/NCSA licence; the MIT licence is the one relied on here, and the notice file holds both texts.

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

`formatXml(source, options)` returns `{ output, elements, attributes, maxDepth }` and throws `XmlFormatterError` with `line`/`column` for a DOCTYPE, a well-formedness error or an undeclared entity reference. `options.mode` is `'format'` (default), `'minify'` or `'check'`; `options.indent` (default 2, spaces per level) applies to `format`; `options.removeComments` (default false) applies to `minify`. `canonicalizeXml(engine, text, { mode, withComments })` and `compareXml(engine, first, second, { mode })` take the libxml2-wasm module as their first argument, so the package never imports the engine itself; `mode` is `'1.0'`, `'exclusive'` or `'1.1'`. They refuse a document over 10 MiB (`checkC14nInput`, counted in UTF-8 bytes) or with a DOCTYPE before anything is parsed, parse with no external entities and no network, and dispose every document before returning. `compareXml` returns `{ equivalent, first? }` where `first` holds both canonical forms and the 0-based offset of the first character that differs. `buildTreeHtml(text, { maxElements, openLevels })` returns `{ html, elements, totalElements, truncated }`, with every character of the document escaped.

## Dependencies

- `fast-xml-parser` 5.11.1
- `libxml2-wasm` 0.7.2

## Tests

```sh
npm test
```

The W3C Canonical XML 1.0 worked examples 3.1 (with and without comments), 3.2 and 3.4 and the Exclusive XML Canonicalization worked example are extracted from the recommendations by a script and must be reproduced exactly; 3.6 is compared as bytes, and 3.3 and 3.5 are named as left out with their reasons. Python lxml 6.1.1 (libxml2 2.11.9) canonical output for documents with namespaces, comments and references is a second opinion on the engine's libxml2 2.15.1. A local HTTP server named in an entity and a DTD must see no request. The tree is tested for escaping every markup character, for the levels that start open and for the 2,000 element stop. A hand-written linear tokenizer (no backtracking regular expressions) splits already-validated text into markup tokens, then only whitespace-only text nodes between element-only content are added or removed; a seeded property test over 200 random documents proves the non-whitespace token sequence is identical before and after formatting or minifying. DOCTYPE refusal and the undeclared-entity refusal are each checked against a billion-laughs document and an external-entity document.

## Licence

MIT. See [LICENSE](./LICENSE).

# XML & JSON Converter

Convert between XML and JSON with explicit attribute and text node handling.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Converts a pasted document between XML and JSON, with a chosen prefix for attributes and a chosen key for text content, both ways. Any document declaring a DOCTYPE is refused before it is parsed, so an entity bomb or an external entity reference is never expanded.

## Supported

- XML elements, attributes and text mapped to a JSON object under a chosen attribute prefix and text key
- Repeated sibling elements becoming a JSON array, with an always-array option for a single child too
- Predefined XML entities and numeric character references decoding to their characters on the way to JSON
- Markup characters in text and attribute values escaped on the way to XML
- Any DOCTYPE declaration refused before parsing, in any letter case, so entity bombs and external entities are never read
- A well-formedness error reported with a line and column
- A JSON key that is not a valid XML 1.0 name refused by its RFC 6901 path rather than written as broken XML

## Limits

- Comments, processing instructions and the XML declaration are read and dropped; converting JSON back to XML never restores them
- CDATA sections become plain text; the distinction between a CDATA section and ordinary text is not kept
- Mixed content (text interleaved with child elements) keeps its element order only when the order option is on; otherwise text and elements are grouped separately
- Without the always-array option, one child element and several children of the same name produce different JSON shapes
- A namespace prefix stays part of the element or attribute name; no namespace resolution is performed
- Attribute and text values are read as strings unless value parsing is switched on
- Any document with a DOCTYPE declaration is refused outright, even one with no entities, since this page never reads DTDs

## Ambiguous cases, and what this does about them

- A single child element and an array of one look identical unless the always-array option is on; this tool cannot tell which the input intended

## Defined by

- [Extensible Markup Language (XML) 1.0 (Fifth Edition)](https://www.w3.org/TR/xml/)
- [RFC 8259 — The JavaScript Object Notation (JSON) Data Interchange Format](https://www.rfc-editor.org/rfc/rfc8259)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/xml-json xml-json
cd xml-json
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/xml-json
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { xmlToJson, jsonToXml } from '@fodt/xml-json';

xmlToJson('<book id="1"><title>Moby Dick</title></book>', { attributePrefix: '@_', textKey: '#text' });
// { output: '{\n  "book": {\n    "@_id": "1",...', warnings: [] }
```

`xmlToJson(text, options)` and `jsonToXml(text, options)` both return `{ output, warnings }` and throw `XmlJsonError` with `line`/`column` for a malformed document or `path` (an RFC 6901 pointer) for a JSON key that is not a valid XML name. Options default to `attributePrefix: '@_'`, `textKey: '#text'`, `alwaysArray: false`, `keepOrder: false`, `parseValues: false`; `jsonToXml` also takes `indent` (default 2) and `declaration` (default true).

## Dependencies

- `fast-xml-parser` 5.11.1

## Tests

```sh
npm test
```

A billion-laughs DOCTYPE and an external-entity DOCTYPE are each checked to be refused before parsing, and the configured parser is also called directly with a DOCTYPE document to prove entity expansion stays off even if the earlier refusal were bypassed. The XML 1.0 Name production is checked from the fetched specification's own grammar.

## Licence

MIT. See [LICENSE](./LICENSE).

# XPath Tester

Evaluate XPath 1.0 expressions against an XML document.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Evaluates an XPath 1.0 expression against a pasted XML document and shows a typed result: a node-set with each matching node's location, string value and markup, or a plain string, number or boolean. Namespace prefixes can be mapped by hand or read from the document's own root element. Any document declaring a DOCTYPE is refused before it is parsed, so an entity bomb or an external entity reference is never expanded.

## Supported

- XPath 1.0 expressions, evaluated by the same engine in this page and in this package's own tests
- Node-set results listed by type, name, an absolute path such as /catalog[1]/book[2]/@id, string value and up to 1,000 nodes of markup, with a count of the rest
- String, number and boolean results, numbers formatted by XPath 1.0's own number-to-string rule
- Namespace prefixes mapped by hand, or read from xmlns declarations on the document's root element
- Any DOCTYPE declaration refused before parsing, in any letter case, so entity bombs and external entities are never read
- A runaway expression stopped after 1.5 seconds so the page stays responsive

## Limits

- XPath 1.0 only: no XPath 2.0 or 3.1 functions or types
- Any document with a DOCTYPE declaration is refused outright, even one with no entities, since this page never reads DTDs
- At most 1,000 node-set rows are listed, with a count of the rest
- A number whose exact decimal form needs more digits than JavaScript's own shortest round-trip formatting, or one large or small enough that JavaScript would switch to exponential notation, is not converted to XPath 1.0's plain decimal form

## Ambiguous cases, and what this does about them

- A namespace prefix given by hand and the same prefix declared on the document's root element can disagree; the hand-given mapping wins

## Defined by

- [XML Path Language (XPath) Version 1.0](https://www.w3.org/TR/1999/REC-xpath-19991116/)
- [Extensible Markup Language (XML) 1.0 (Fifth Edition)](https://www.w3.org/TR/xml/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/xpath-tester xpath-tester
cd xpath-tester
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/xpath-tester
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { evaluateXPath } from '@fodt/xpath-tester';

evaluateXPath('<a><b>1</b></a>', '/a/b', {});
// { kind: 'nodeset', total: 1, nodes: [{ type: 'element', name: 'b', path: '/a[1]/b[1]', value: '1', markup: '<b>1</b>' }] }
```

`evaluateXPath(xml, expression, options)` returns `{ kind, value?, nodes?, total? }` and throws `XPathTesterError` with `kind` (`'xml'` or `'expression'`) and `line`/`column` where meaningful. `options.namespaces` (default `{}`) maps a prefix to a URI; `options.maxNodes` (default 1000) caps the node-set rows returned; `options.rootNamespaces` (default true) also resolves a prefix from an `xmlns:prefix` declaration on the document's own root element.

## Dependencies

- `xpath` 0.0.34
- `@xmldom/xmldom` 0.9.12

## Tests

```sh
npm test
```

The XML parser (@xmldom/xmldom) is called directly on external-entity, parameter-entity and billion-laughs payloads with fetch and XMLHttpRequest replaced by throwing spies, and the result recorded, before this package's own DOCTYPE guard is relied on as the sole defence in normal use (D-83). Section 2.5's abbreviated-syntax examples and section 4.2's string-function examples are quoted from the fetched recommendation and checked against real evaluation.

## Licence

MIT. See [LICENSE](./LICENSE).

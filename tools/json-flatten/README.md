# JSON Flatten & Unflatten

Flatten nested JSON to a path-keyed map and rebuild it losslessly.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Flattens a nested JSON document into a single-level map whose keys are RFC 6901 JSON Pointers and whose values are the leaves, and rebuilds the original document from that map. Rebuilding any document this flattens gives back exactly the original, including an empty key, a digit-only key, a key containing a slash or tilde, and a key named __proto__.

## Supported

- Flattening any JSON value, including a scalar or an empty object or array at the root
- RFC 6901 JSON Pointer paths for every leaf, with ~ and / correctly escaped as ~0 and ~1
- A lossless rebuild: flatten then unflatten returns a value deep-equal to the original, for every input this accepts
- An object whose keys look like array indices rebuilds as an object, never mistaken for an array
- Refusing a document nested more than 512 levels deep before walking it, so a hostile document cannot freeze the tab
- Reporting a broken flat map (a value and nested entries at the same pointer, or an invalid pointer) by naming the pointer

## Limits

- Paths are RFC 6901 JSON Pointers such as /a/b~1c, not the dollar-dot notation another JSON viewer on this site prints
- The flat map's own JSON representation is not itself schema-validated beyond being an object; a value at a pointer that is neither a leaf nor an empty-container marker but also has children is refused
- JSON has no native way to tell an empty object from an empty array except by remembering which one it started as; this keeps that information as a small marker rather than guessing
- A document nested deeper than 512 levels is refused outright rather than flattened

## Ambiguous cases, and what this does about them

- This uses RFC 6901 JSON Pointer syntax (/a/b, with ~ and / escaped) for every path, not the $.a.b notation the JSON formatter on this site uses; the two are not interchangeable.
- An object whose keys are all valid array-index tokens (for example {"0":"a","1":"b"}) is still an object, not an array; a hidden marker at its pointer keeps unflatten from guessing it was an array just because its keys look numeric.

## Defined by

- [RFC 6901 — JavaScript Object Notation (JSON) Pointer](https://www.rfc-editor.org/rfc/rfc6901)
- [RFC 8259 — The JavaScript Object Notation (JSON) Data Interchange Format](https://www.rfc-editor.org/rfc/rfc8259)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/json-flatten json-flatten
cd json-flatten
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/json-flatten
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { flatten, unflatten, flattenText, unflattenText } from '@fodt/json-flatten';

flatten({ user: { name: 'Ada', tags: ['a', 'b'] } });
// { '/user/name': 'Ada', '/user/tags/0': 'a', '/user/tags/1': 'b' }

unflatten({ '/user/name': 'Ada' }); // { user: { name: 'Ada' } }
```

`flatten`/`unflatten` work on already-parsed JSON values. `flattenText`/`unflattenText` parse JSON text first (through the same RFC 8259 reader this tool bundles) and return `{ output, leaves, maxDepth }`, throwing `FlattenError` on a JSON syntax problem (with `line`/`column`) or a structural problem (with `path`).

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every value from RFC 6901 section 5's own example document is checked against the documented table. A 500-document seeded fuzz pass asserts flatten-then-unflatten is deep-equal to the original for randomly generated documents that deliberately include the empty key, a digit-only key, and keys containing / and ~.

## Licence

MIT. See [LICENSE](./LICENSE).

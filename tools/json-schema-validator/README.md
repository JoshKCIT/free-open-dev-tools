# JSON Schema Validator

Validate data against JSON Schema draft-07 and 2020-12 with readable error paths.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Validates a pasted JSON document against a pasted JSON Schema, for both draft-07 and 2020-12, and lists every violation with an RFC 6901 JSON Pointer path, the failing keyword and a plain message. Built on Ajv, checked case by case against the official JSON-Schema-Test-Suite.

## Supported

- JSON Schema draft-07 and 2020-12, detected automatically from the schema's own $schema declaration or chosen explicitly
- Every violation reported with an RFC 6901 JSON Pointer to the offending location, the failing keyword, a plain message and the schema location that produced it
- Format keywords (date-time, email, uri and the rest ajv-formats defines) checked when format checking is switched on
- An invalid schema refused with a readable message before any data is checked
- The official JSON-Schema-Test-Suite draft-07 and 2020-12 cases, vendored as test data, checked one by one against this tool's own answer
- A runaway schema pattern stopped after 1.5 seconds instead of freezing the tab

## Limits

- No remote $ref is ever fetched; a schema that references another document over the network is refused rather than resolved
- Only draft-07 and 2020-12 are supported; a schema declaring another draft (draft-04, draft-06, 2019-09) is refused naming it
- 2020-12 treats format as an annotation by default; this tool asserts it as a validation keyword whenever format checking is on, in both drafts, so a visitor who wants format checked gets a straight answer either way
- 60 of the official test suite's cases are answered differently by this tool than the suite documents (6 of 900 in draft-07, 54 of 1244 in 2020-12), every one named in this package's own test file rather than silently skipped: 14 are this tool's own deliberate always-assert-format choice above; the rest are genuine Ajv 8.20.0 behaviour (an object's inherited constructor/toString read as present even with no such own property; a RangeError inside Ajv's own URI library refusing to compile one self-referencing relative-$id shape; several $dynamicRef/unevaluatedItems/unevaluatedProperties dynamic-scope edge cases)
- A validation that runs longer than 1.5 seconds on the page is stopped rather than risking the tab, because a schema's own pattern or patternProperties keys are visitor-written regular expressions

## Ambiguous cases, and what this does about them

- Every error path is an RFC 6901 JSON Pointer (for example /a/b~1c), the same notation json-diff and json-flatten use on this site, not a dollar-dot path
- format is asserted as a validation keyword when format checking is switched on, even under 2020-12, where the specification treats it as an annotation only by default

## Defined by

- [JSON Schema draft-07 (core and validation)](https://json-schema.org/specification-links#draft-7)
- [JSON Schema 2020-12 (core and validation)](https://json-schema.org/specification-links#2020-12)
- [RFC 6901 — JavaScript Object Notation (JSON) Pointer](https://www.rfc-editor.org/rfc/rfc6901)
- [RFC 8259 — The JavaScript Object Notation (JSON) Data Interchange Format](https://www.rfc-editor.org/rfc/rfc8259)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/json-schema-validator json-schema-validator
cd json-schema-validator
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/json-schema-validator
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { validateJson } from '@fodt/json-schema-validator';

const result = validateJson(
  '{"type":"object","properties":{"age":{"type":"integer","minimum":0}},"required":["age"]}',
  '{"age":-1}',
);
result.valid; // false
result.errors; // [{ path: '/age', keyword: 'minimum', message: '...', schemaPath: '#/properties/age/minimum' }]
```

`validateJson(schemaText, dataText, { draft, checkFormats })` parses both texts through this package's own RFC 8259 reader, builds a fresh Ajv instance per call (never reused, so one schema's keywords never leak into the next call), and returns `{ valid, draft, errors }`. A broken schema or data document, or a schema declaring an unsupported draft, throws `SchemaValidatorError` with a `kind` of `schema-json`, `data-json`, `schema` or `draft`.

## Dependencies

- `ajv` 8.20.0
- `ajv-formats` 3.0.1

## Tests

```sh
npm test
```

Checked against the vendored JSON-Schema-Test-Suite (json-schema-org/JSON-Schema-Test-Suite) for both drafts, case by case, with every answer that differs from the suite's own expectation named in KNOWN_DIFFERENCES. Ajv's error-object shape (instancePath, schemaPath, keyword, message) is checked directly against Ajv's own published API reference (ajv.js.org/api.html), quoted in this package's own test file.

## Licence

MIT. See [LICENSE](./LICENSE).

# JSON Schema Generator

Infer a JSON Schema from one or more sample documents.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Infers a JSON Schema, draft-07 or 2020-12, from one or more pasted sample documents. Merges the types and keys seen across every sample at each location, so the generated schema accepts every sample it was built from -- checked directly by Ajv as an independent oracle.

## Supported

- A single document, a JSON array of sample documents, or JSON Lines (one document per non-blank line) as input
- Types null, boolean, integer, number, string, array and object, told apart by the parsed value (an integer-valued number becomes integer, any other becomes number, and a mix of the two becomes number)
- A key present in every sample at a location becomes required; a key present in only some samples is left optional
- Array items from every sample at a location merged into one item schema
- Detecting the string formats date-time, date, uuid and ipv4 when every string sample at a location matches, using definitions no looser than ajv-formats' own full mode
- A key named __proto__ or constructor kept as an ordinary property, never reaching Object.prototype
- The generated schema checked against its own draft's metaschema and proven to accept every sample it was inferred from, using Ajv as an independent oracle

## Limits

- Inference only sees the samples it is given; a field never seen with a particular value is never inferred to require or forbid it
- required means present in every sample at that location, nothing more -- it is not a claim about any document outside the samples given
- No enum, bound (minimum, maximum, minLength, maxLength) or pattern is ever inferred, even when every sample happens to share one
- additionalProperties is never set, so extra keys beyond the inferred properties are always allowed
- A document nested deeper than 512 levels is refused outright rather than inferred from
- Only date-time, date, uuid and ipv4 are detected as formats; other ajv-formats formats (email, hostname, and the rest) are never inferred

## Ambiguous cases, and what this does about them

- integer versus number is decided by JavaScript's own parsed representation (Number.isInteger), not by how the sample text was written, so 1.0 in the input is indistinguishable from 1 and both infer as integer
- Several types at one location are written as a JSON array of type names in a fixed order (null, boolean, integer, number, string, array, object), matching the order this package checks them in, not sample order

## Defined by

- [JSON Schema draft-07 (validation vocabulary)](https://json-schema.org/draft-07/json-schema-validation)
- [JSON Schema 2020-12 (validation vocabulary)](https://json-schema.org/draft/2020-12/json-schema-validation)
- [RFC 8259 — The JavaScript Object Notation (JSON) Data Interchange Format](https://www.rfc-editor.org/rfc/rfc8259)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/json-schema-generator json-schema-generator
cd json-schema-generator
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/json-schema-generator
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { generateSchema } from '@fodt/json-schema-generator';

const result = generateSchema('[{"id":1,"name":"Ada"},{"id":2}]', { samplesAre: 'array' });
result.schema; // { $schema: '...', type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } }, required: ['id'] }
result.sampleCount; // 2
```

`generateSchema(samplesText, { samplesAre, draft, detectFormats })` parses `samplesText` per `samplesAre` (`single`, `array` or `lines`) through this package's own RFC 8259 reader, applies the 512-level depth limit to every sample, and returns `{ schema, output, sampleCount }` -- `schema` is the plain generated-schema value, `output` is its 2-space pretty-printed JSON text. Throws `SchemaGeneratorError` on a parse problem (with `line`/`column` for JSON Lines, naming which line) or a structural problem (`array` mode given non-array JSON).

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every generated schema is compiled with Ajv (draft-07) or Ajv2020 (2020-12) plus ajv-formats as an independent oracle: validateSchema confirms it is valid against its own draft's metaschema, every sample it was built from validates against it, and a sample with one value changed to the wrong type does not.

## Licence

MIT. See [LICENSE](./LICENSE).

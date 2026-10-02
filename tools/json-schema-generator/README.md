# JSON Schema Generator

Infer a JSON Schema from one or more sample JSON, YAML or XML documents.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Infers a JSON Schema, draft-07 or 2020-12, from one or more pasted sample documents written in JSON, YAML or XML. Merges the types and keys seen across every sample at each location, so the generated schema accepts every sample it was built from -- checked directly by Ajv as an independent oracle.

## Supported

- A single document, a JSON array of sample documents, or JSON Lines (one document per non-blank line) as input
- Types null, boolean, integer, number, string, array and object, told apart by the parsed value (an integer-valued number becomes integer, any other becomes number, and a mix of the two becomes number)
- A key present in every sample at a location becomes required; a key present in only some samples is left optional
- Array items from every sample at a location merged into one item schema
- Detecting the string formats date-time, date, uuid and ipv4 when every string sample at a location matches, using definitions no looser than ajv-formats' own full mode
- A key named __proto__ or constructor kept as an ordinary property, never reaching Object.prototype
- The generated schema checked against its own draft's metaschema and proven to accept every sample it was inferred from, using Ajv as an independent oracle
- Samples written in JSON (the default), YAML 1.2 or XML 1.0; YAML and XML go through the same inference as JSON
- For YAML the three sample choices keep their meaning: one document, a list at the top whose items are the samples, or a --- stream with one document per sample; XML reads one document
- XML attributes become properties named with @_, an element's text beside attributes or child elements becomes #text, and repeated sibling elements become an array

## Limits

- Inference only sees the samples it is given; a field never seen with a particular value is never inferred to require or forbid it
- required means present in every sample at that location, nothing more -- it is not a claim about any document outside the samples given
- No enum, bound (minimum, maximum, minLength, maxLength) or pattern is ever inferred, even when every sample happens to share one
- additionalProperties is never set, so extra keys beyond the inferred properties are always allowed
- A document nested deeper than 512 levels is refused outright rather than inferred from
- Only date-time, date, uuid and ipv4 are detected as formats; other ajv-formats formats (email, hostname, and the rest) are never inferred
- YAML samples follow the same samples modes as JSON; XML reads one document, with attributes as @_ properties and text as #text.
- With the XML array or lines choice the one document is used and a warning says so.
- XML text is read as numbers and booleans only while Read numbers and booleans is on; with it off every XML value is a string, and with it on text counts as a number only when it is written the way JSON writes one (no leading zeros, no plus sign, no hexadecimal).
- YAML input refuses a repeated key, an alias count at the library's limit of 100, an expansion past 2,000,000 values once every alias is copied out, and nesting beyond 512 levels, and names the line and column of a syntax error; a YAML anchor and its aliases are expanded into separate copies and a tag outside the core schema is not interpreted, each reported as a warning.
- On the site, a YAML sample is read in a background worker with a fixed 5 second time limit and a Cancel button, because checking a mapping's keys for duplicates takes time that grows with the square of the key count (about 2 seconds at 20,000 keys); a JSON or XML sample is read on the page with no such limit
- A YAML merge key (<<) stays an ordinary key and a %YAML 1.1 directive switches the document to the YAML 1.1 rules (yes is true, 0777 is octal), each reported as a warning; two keys that become the same name as text (1 and "1", null and an empty name) are refused with their line.
- An XML document with a DOCTYPE is refused before it is read, so no entity is ever declared, loaded or expanded; comments, processing instructions and the XML declaration are dropped with a warning.

## Ambiguous cases, and what this does about them

- integer versus number is decided by JavaScript's own parsed representation (Number.isInteger), not by how the sample text was written, so 1.0 in the input is indistinguishable from 1 and both infer as integer
- Several types at one location are written as a JSON array of type names in a fixed order (null, boolean, integer, number, string, array, object), matching the order this package checks them in, not sample order
- YAML 1.0 is read as the number 1, so it infers as integer exactly as JSON 1.0 does; only a value with a fractional part is number
- A plain YAML date such as 2001-01-01 is text under the YAML 1.2 core schema, so it is a string that can be detected as the date format, as in JSON
- Within an object made from an XML element, the properties for its child elements come first and the properties for its attributes after them

## Defined by

- [JSON Schema draft-07 (validation vocabulary)](https://json-schema.org/draft-07/json-schema-validation)
- [JSON Schema 2020-12 (validation vocabulary)](https://json-schema.org/draft/2020-12/json-schema-validation)
- [RFC 8259 — The JavaScript Object Notation (JSON) Data Interchange Format](https://www.rfc-editor.org/rfc/rfc8259)
- [YAML Ain't Markup Language (YAML) version 1.2.2](https://yaml.org/spec/1.2.2/)
- [Extensible Markup Language (XML) 1.0 (Fifth Edition)](https://www.w3.org/TR/xml/)

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

`generateSchema(samplesText, { samplesAre, draft, detectFormats })` parses `samplesText` per `samplesAre` (`single`, `array` or `lines`) through this package's own RFC 8259 reader, applies the 512-level depth limit to every sample, and returns `{ schema, output, sampleCount }` -- `schema` is the plain generated-schema value, `output` is its 2-space pretty-printed JSON text. Throws `SchemaGeneratorError` on a parse problem (with `line`/`column` for JSON Lines, naming which line) or a structural problem (`array` mode given non-array JSON). `generateSchemaFromValues(values, { draft, detectFormats })` takes already parsed samples, so every input format reaches the same inference; `generateSchema` reads JSON unless `inputFormat` says `yaml` or `xml`, `parseValues` turns XML text written like a JSON number or boolean into one (off by default in the package, so every XML value is a string unless you pass `parseValues: true`; the page's Read numbers and booleans box starts on), and the result carries `warnings` only when a reader had something to report.

## Dependencies

- `yaml` 2.9.1
- `fast-xml-parser` 5.11.1

## Tests

```sh
npm test
```

Every generated schema is compiled with Ajv (draft-07) or Ajv2020 (2020-12) plus ajv-formats as an independent oracle: validateSchema confirms it is valid against its own draft's metaschema, every sample it was built from validates against it, and a sample with one value changed to the wrong type does not. YAML and XML samples are checked against equivalent JSON samples written by hand from the YAML 1.2.2 core schema, the XML 1.0 rules and the RFC 8259 number grammar, and the schema inferred from a YAML sample is checked to accept that sample under Ajv.

## Licence

MIT. See [LICENSE](./LICENSE).

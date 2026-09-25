# JSON to GraphQL Schema

Infer GraphQL type definitions from sample JSON.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Infers a GraphQL schema definition (SDL) from a sample JSON document or array of samples, so you have a starting schema for data you already have. Every inferred document is checked, in this project's own tests, against the official graphql-js reference implementation: it must build, validate, and let the sample resolve against it with no errors.

## Supported

- A single sample object, or an array of samples merged into one shape
- Nested objects become named GraphQL object types; nested arrays become GraphQL lists
- ID detection for a field named id, or ending in Id or _id
- A field present and non-null in every sample becomes GraphQL non-null (!), optionally
- An integer within GraphQL's signed 32-bit Int range stays Int; anything else becomes Float with a warning
- A JSON key that is not a valid GraphQL Name, or that starts with two underscores, is renamed with a warning
- An optional root Query field so the inferred schema is directly usable

## Limits

- Every string becomes GraphQL's String scalar: no date, URL or enum detection from string shape
- A key whose value kind changes between samples falls back to String with a warning
- GraphQL unions and interfaces are never inferred, only object types
- A renamed key needs its own resolver mapping back to the original JSON key

## Ambiguous cases, and what this does about them

- A key that sanitizes to the same GraphQL name as another key already seen on the same object is disambiguated by a numeric suffix in the order the keys were first encountered, which may not match a hand-written resolver's own preferred field order

## Defined by

- [GraphQL Specification (September 2025 Edition)](https://spec.graphql.org/September2025/)
- [RFC 8259 (The JavaScript Object Notation (JSON) Data Interchange Format)](https://www.rfc-editor.org/rfc/rfc8259)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/json-to-graphql json-to-graphql
cd json-to-graphql
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/json-to-graphql
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { jsonToGraphql } from '@fodt/json-to-graphql';

jsonToGraphql('{"id":1,"name":"Ada"}', { rootName: 'Root' });
// { output: 'type Root {\n  id: ID!\n  name: String!\n}\n\ntype Query {\n  root: Root\n}\n', types: 1, warnings: [] }
```

jsonToGraphql(text, { samplesAre = 'single' | 'array', rootName = 'Root', nonNullWhenAlwaysPresent = true, idFields = true, addQuery = true }) returns { output, types, warnings }, or throws JsonToGraphqlError (message, line, column, path) for text that cannot be parsed as JSON.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every inferred schema is proven against the graphql package (a devDependency, used only in tests as a correctness oracle -- never a runtime dependency of this package): buildSchema and validateSchema over the output, and graphqlSync resolving the original samples through it with no errors, across 300 seeded random documents as well as the named cases below.

## Licence

MIT. See [LICENSE](./LICENSE).

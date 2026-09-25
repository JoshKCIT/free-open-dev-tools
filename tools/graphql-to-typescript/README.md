# GraphQL SDL to TypeScript

Generate TypeScript types from a GraphQL schema definition.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Parses a pasted GraphQL schema definition (SDL) with the official graphql-js reference implementation, validates it, and turns every type in it into a matching TypeScript type. Nothing is executed: only the schema's shape is read, never a query against it.

## Supported

- Object, interface, union, enum, input object and scalar type definitions, per the GraphQL specification's Type System section
- Non-null (!), list ([...]) and nested combinations of both, mapped to TypeScript's required, array and null-union forms
- A field's own arguments, emitted as a matching TypeScript arguments type
- A union-of-string-literals or a TypeScript enum for GraphQL enum values, your choice
- An optional __typename discriminant field on object and interface types
- A custom scalar mapped to a TypeScript type you provide, or left as unknown
- Descriptions and @deprecated reasons carried into JSDoc comments on the generated types
- A malformed or invalid schema refused with the reference implementation's own message and its line and column

## Limits

- Only the schema is typed: operations (queries, mutations, subscriptions) written against it are not
- Directives other than @deprecated are read but otherwise ignored
- An interface's own fields are folded into each implementing type's TypeScript interface rather than expressed as a TypeScript extends clause
- A scalar mapping that is not a plain TypeScript type expression (identifiers, |, [], null, string literals) is rejected and the scalar stays unknown, with a warning

## Defined by

- [GraphQL Specification (September 2025 Edition)](https://spec.graphql.org/September2025/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/graphql-to-typescript graphql-to-typescript
cd graphql-to-typescript
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/graphql-to-typescript
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { graphqlToTypeScript } from '@fodt/graphql-to-typescript';

graphqlToTypeScript('type Person { name: String age: Int! }', { enumStyle: 'union' });
// { output: 'export interface Person {\n  name: string | null;\n  age: number;\n}\n', types: 1, warnings: [] }
```

graphqlToTypeScript(sdl, { enumStyle = 'union', includeTypename = false, scalars = {} }) returns { output, types, warnings }, or throws GraphqlToTypeScriptError (message, line, column) for a schema graphql-js's own buildSchema or validateSchema refuses.

## Dependencies

- `graphql` 17.0.2

## Tests

```sh
npm test
```

Every generated TypeScript source is compiled in memory with the installed typescript compiler in strict mode and asserted to produce zero diagnostics; sample values are also assigned to the generated types to prove they type-check as intended.

## Licence

MIT. See [LICENSE](./LICENSE).

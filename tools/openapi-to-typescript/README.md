# OpenAPI to TypeScript

Generate TypeScript types from an OpenAPI document.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Reads a pasted Swagger 2.0 or OpenAPI 3.0, 3.1 or 3.2 document, in JSON or YAML, and generates plain TypeScript source text for its named schemas (components.schemas in 3.x, definitions in 2.0) and, on request, for each operation's path, query and header parameters, JSON request body and JSON responses by status. The generated types compile under the TypeScript compiler's strict mode and are checked, for every component schema, to be mutually assignable with an independent generator's own output for the same document.

## Supported

- Swagger 2.0 and OpenAPI 3.0, 3.1 and 3.2 documents in JSON or YAML
- Named schemas from components.schemas (3.x) or definitions (2.0), as export interface or export type declarations
- allOf as a TypeScript intersection, oneOf and anyOf as a union, enum and const as literal types
- A 3.0 nullable: true schema and a 3.1 or 3.2 type array containing null both become a union with null
- additionalProperties as an index signature, typed unknown alongside named properties so every property stays assignable
- Operation path, query and header parameters, JSON request bodies and JSON responses by status, named from the operation's operationId or its method and path
- Schema names that are not valid TypeScript identifiers, or that collide once turned into one, get distinct valid names
- descriptions, deprecated, readOnly and writeOnly become a JSDoc comment above the generated property or type

## Limits

- A $ref to another file or another address, or a local reference that is not a top-level named schema, becomes unknown with a warning; nothing is ever fetched
- discriminator is not read; not becomes unknown with a warning
- Only a JSON request body and JSON responses are read; other content types on an operation are not represented
- A recursive inline schema with no name is not specially handled and may produce a very large or incorrect type
- The document is not validated beyond what generating types needs; a separate structural check against the official schema is not performed here

## Ambiguous cases, and what this does about them

- declarationStyle chooses export interface vs export type for object-shaped named schemas; a schema that is not a plain object (a union, an array, a scalar) always emits export type, since TypeScript interfaces can only declare object types
- Operation types are always named from operationId when present, falling back to the operation's method and path otherwise, and always follow the same PascalCase collision-avoidance rule as schema names

## Defined by

- [OpenAPI Specification 2.0 (Swagger)](https://spec.openapis.org/oas/v2.0.html)
- [OpenAPI Specification 3.0.4](https://spec.openapis.org/oas/v3.0.4.html)
- [OpenAPI Specification 3.1.2](https://spec.openapis.org/oas/v3.1.2.html)
- [OpenAPI Specification 3.2.1](https://spec.openapis.org/oas/v3.2.1.html)
- [TypeScript Handbook — Object Types](https://www.typescriptlang.org/docs/handbook/2/objects.html)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/openapi-to-typescript openapi-to-typescript
cd openapi-to-typescript
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/openapi-to-typescript
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { openApiToTypeScript } from '@fodt/openapi-to-typescript';

const result = openApiToTypeScript(
  '{"openapi":"3.0.4","info":{"title":"t","version":"1"},"paths":{},"components":{"schemas":{"Pet":{"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}}}}',
);
result.output; // 'export interface Pet {\n  name: string;\n}\n'
```

openApiToTypeScript(text, { format, includeOperations, declarationStyle }) reads the document with this package's own canonical reader (readOpenApiDocument), then walks its named schemas and, when includeOperations is on (the default), its operations, emitting one export interface or export type declaration per schema and per operation artefact. Returns { output, types, operations, warnings }. A broken document throws OpenApiToTypeScriptError.

## Dependencies

- `yaml` 2.9.1

## Tests

```sh
npm test
```

Every official OpenAPI Initiative example document is compiled in strict mode by the real TypeScript compiler as an in-memory oracle, and cross-checked for mutual assignability against the openapi-typescript package's own generated types for the same document, both devDependency-only oracles never bundled at runtime.

## Licence

MIT. See [LICENSE](./LICENSE).

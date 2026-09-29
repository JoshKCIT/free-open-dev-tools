# GraphQL Formatter & Minifier

Beautify or minify GraphQL queries, fragments and schema definitions.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Beautifies a GraphQL document with Prettier's own GraphQL printer, or minifies it with graphql-js's stripIgnoredCharacters. Both modes first parse the input with graphql-js, the reference implementation, so a syntax error is refused the same way in either mode, with its own message, line and column.

## Supported

- Executable documents: operations (query, mutation, subscription, and the query shorthand), fragments, variables and directives
- Type system documents: schema definitions, scalar, object, interface, union, enum and input object type definitions, directive definitions, type extensions, and descriptions
- Beautify with a chosen indent (2 spaces, 4 spaces, or a tab) and a print width from 20 to 200 (default 80)
- Minify per the GraphQL Specification section 2.1.7 Ignored Tokens: whitespace, line terminators, commas, comments and a leading byte order mark are removed; block strings are kept
- Counts of operations, fragments and type definitions
- Malformed GraphQL refused with graphql-js's own message and its line and column, in either mode

## Limits

- Minifying removes every comment (# ...); a comment cannot be recovered from minified output
- Beautifying follows Prettier's own GraphQL printer; only indent and print width are adjustable, not brace or quote style
- Only syntax is checked, never against a schema: an unknown field, type or variable is not reported
- Fragment variable definitions (an experimental, not-yet-standard proposal) are refused, matching graphql-js's own default parser
- A document needs at least one operation, fragment or type definition, so empty or comments-only input is refused
- A block string's own content is re-indented in both modes; its value (after the specification's own dedent rule) is unchanged
- A document nested thousands of levels deep is refused with a message rather than crashing
- Output line endings are always \n, whatever the input used

## Ambiguous cases, and what this does about them

- `typeDefinitions` in the stats counts only the six named type definition kinds (scalar, object, interface, union, enum, input object); schema definitions, directive definitions and type extensions are parsed but not counted in any of the three stats

## Defined by

- [GraphQL Specification (September 2025 Edition)](https://spec.graphql.org/September2025/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/graphql-formatter graphql-formatter
cd graphql-formatter
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/graphql-formatter
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { formatGraphql } from '@fodt/graphql-formatter';

await formatGraphql('query Q{a}', { mode: 'beautify' });
// { output: 'query Q {\n  a\n}\n', inputBytes: 10, outputBytes: 15, stats: { operations: 1, fragments: 0, typeDefinitions: 0 } }
```

`formatGraphql(source, options)` is async and returns `{ output, inputBytes, outputBytes, stats }`, or throws `GraphqlFormatterError` with `line`/`column` (1-based) when graphql-js's own parser refuses the input, or with neither for the print-width and too-deeply-nested errors. `mode` is `'beautify'` (default) or `'minify'`. Beautify options: `indent` (`2` default, `4`, or `'tab'`) and `printWidth` (20-200, default 80). `stats` always reflects the parsed input, in every mode.

## Dependencies

- `prettier` 3.9.9
- `graphql` 17.0.2

## Tests

```sh
npm test
```

Grounded in the GraphQL Specification (September 2025 Edition) sections 2.3 Operations, 2.8 Fragments, 2.9.4 String Value (block strings), 3.2 Descriptions and 3.13 Directives, plus a generated large schema and query. The equality oracle is graphql-js's own print(parse(x)), a mature independent printer used as a second opinion: input, beautified output and minified output must all parse to the same document. The documented stripIgnoredCharacters example from graphql-js's own JSDoc is checked literally.

## Licence

MIT. See [LICENSE](./LICENSE).

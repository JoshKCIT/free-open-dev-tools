# tsconfig.json Builder

Assemble a tsconfig with explanations of each option.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Assembles a tsconfig.json from a starting preset and a set of options, each explained in plain words with a link to the TSConfig Reference. Every option and value offered is one the pinned TypeScript 5.x compiler's own parser and option diagnostics accept, so the file this tool hands back is never one the compiler would reject.

## Supported

- 61 compiler options across Type Checking (the whole category), Modules, Emit, Interop Constraints, Language and Environment, Projects and Completeness, each with its category, type, accepted values, documented default, an explanation and a reference link
- Four starting presets (Node.js library, Node.js application, bundled for the browser, every strict-family and extra type-checking rule), each citing the TypeScript handbook page that recommends it
- A conflict warning for an option combination the compiler itself reports an option diagnostic for (for example module: nodenext with moduleResolution: bundler), cited to the compiler's own diagnostic code
- A TypeScript 6.0 deprecation or removal flag on an option or value the 6.0 release notes list, quoting the note
- Optional explanation comments written above each option in the output, which still parses to the exact same configuration as the plain output
- include, exclude and extends fields

## Limits

- This tool cannot know which TypeScript version the visitor's own project actually runs; options and values were checked against TypeScript 5.9.3, the version pinned here (D-80). A later major version, especially TypeScript 7's native compiler, may reject an option flagged here as fine, which only running that compiler on the visitor's own project can show.
- paths and project references (composite project graphs beyond the single composite flag) are not generated, since they need a real multi-project layout this single-file tool has no way to know.
- A conflict warning covers only the option combinations this tool's own battery found the compiler reporting; it is not a substitute for actually running tsc against the finished project.

## Ambiguous cases, and what this does about them

- The TSConfig Reference groups options under a small, fixed set of category headings; this tool follows those headings exactly, so an option that could arguably fit more than one category (for example declarationMap, which affects both Emit and Projects) is filed wherever the reference itself files it.
- paths is not offered as a settable option: the compiler requires it to be an object mapping (a specifier to one or more replacement paths), which this tool's flat name=value Extra options field has no way to express, so it is left out of the catalogue entirely rather than accepted and silently mis-typed.

## Defined by

- [TSConfig Reference](https://www.typescriptlang.org/tsconfig/)
- [TypeScript Handbook — Modules: Choosing Compiler Options](https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html)
- [TypeScript 6.0 Release Notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/tsconfig-builder tsconfig-builder
cd tsconfig-builder
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/tsconfig-builder
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { buildTsconfig } from '@fodt/tsconfig-builder';

const { output, warnings, conflicts } = buildTsconfig({ preset: 'node-library', options: { strict: true } });
```

`buildTsconfig(input)` always returns `{ output, object, warnings, conflicts }`; it only throws `TsconfigBuilderError` for an unrecognised `preset` id. An option name or value the catalogue does not recognise is left out of the output and reported in `warnings`, never written. `conflicts` lists only combinations the pinned compiler's own `getOptionsDiagnostics()` was confirmed (in this package's own tests) to report, each carrying that diagnostic's numeric code.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every catalogued option and every value it offers is checked against the real, pinned TypeScript 5.9.3 compiler's own `parseJsonConfigFileContent` and `Program.getOptionsDiagnostics()` (a devDependency-only oracle, never shipped to visitors, per D-80). Every conflict rule was found by first reproducing it against the real compiler and reading off its diagnostic code, not guessed.

## Licence

MIT. See [LICENSE](./LICENSE).

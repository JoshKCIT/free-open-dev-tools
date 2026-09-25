# TypeScript to JavaScript

Strip TypeScript types to plain JavaScript without running the code.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Erases TypeScript's type-only syntax (annotations, interfaces, type aliases) and rewrites run-time-only syntax (enums, namespaces) into plain JavaScript, using the TypeScript compiler's own syntactic transform. The pasted code is never executed, only parsed and rewritten.

## Supported

- Type annotations, interfaces and type aliases erased, matching the TypeScript handbook's own Erased Types example
- Enums and namespaces rewritten into the JavaScript that defines them at run time
- A chosen ECMAScript target from ES2015 through ESNext
- A chosen module format: kept as written, or rewritten to CommonJS
- A chosen JSX mode: kept as written, rewritten to React.createElement calls, or rewritten to the automatic JSX runtime
- An option to drop comments from the output
- A syntax error reported with its line and column while the emitted output still shows

## Limits

- No type checking is performed: a type error is never reported, only a syntax error
- const enum values are not inlined across separate files, since only one file is ever transpiled at a time
- Declaration merging across multiple files is not resolved
- Decorators are emitted exactly as the TypeScript compiler's own transform emits them for the chosen target
- Output is never minified; only types and comments (optionally) are removed

## Ambiguous cases, and what this does about them

- The output file name TypeScript's compiler is told to use ends in .tsx only when the JSX mode is not 'preserve' or the input source itself contains JSX; this only affects internal diagnostics, never the returned text

## Defined by

- [TypeScript Handbook — TypeScript for JavaScript Programmers (Erased Types)](https://www.typescriptlang.org/docs/handbook/typescript-in-5-minutes.html)
- [ECMAScript 2025 Language Specification (ECMA-262)](https://tc39.es/ecma262/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/ts-to-js ts-to-js
cd ts-to-js
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/ts-to-js
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { stripTypes } from '@fodt/ts-to-js';

stripTypes('function greet(person: string, date: Date) {}', { target: 'ES2022' });
// { output: 'function greet(person, date) { }\n', diagnostics: [] }
```

`stripTypes(source, options)` returns `{ output, diagnostics }`; `diagnostics` is `{ message, line, column }[]` (1-based). Options default to `target: 'ES2022'`, `module: 'preserve'`, `jsx: 'preserve'`, `removeComments: false`. Calls `ts.transpileModule` only: it never creates a `Program`, never type-checks and never emits to disk, so the pasted code is only parsed and rewritten, never executed. Throws `TsToJsError` only for a completely unparsable input; an ordinary syntax error is reported in `diagnostics` alongside a best-effort output.

## Dependencies

- `typescript` ^5.9.3

## Tests

```sh
npm test
```

The `typescript` dependency is pinned to the 5.x line (D-80): the npm `latest` dist-tag is now TypeScript 7, a native compiler with no in-process transpile API, so a test asserts the installed major stays 5. A test proves stripping types never runs the pasted code, and a second test proves that same check would itself catch code that does run.

## Licence

MIT. See [LICENSE](./LICENSE).

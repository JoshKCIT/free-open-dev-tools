# Code Complexity Analyzer

Report cyclomatic complexity and function length for JavaScript and TypeScript.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Parses pasted JavaScript or TypeScript to a syntax tree with Babel's parser and walks it with a hand-rolled, iterative counter, reporting cyclomatic complexity, physical length and code-line length for every function, method, class field initializer and static block. The code is never run. Complexity counting follows the ESLint complexity rule's own classic-variant rules, checked against that rule in tests.

## Supported

- Cyclomatic complexity for every function declaration, function expression, arrow function, object method, class method, class field initializer and class static block
- A length in physical lines and a second length counting only lines holding code, excluding blank lines and comment-only lines
- JavaScript, TypeScript, and TSX source, with generics, type assertions and non-null assertions adding no complexity
- A configurable threshold (1 to 100) marking which functions are flagged as over it
- A syntax error reported with its line and column

## Limits

- Counts follow the ESLint complexity rule's classic variant: a switch statement itself adds nothing, but each case with its own test adds one
- Top-level code outside any function, method, field initializer or static block is not reported
- Flow syntax and decorators beyond what Babel's TypeScript plugin parses are not supported
- The code is never run, so dynamic or generated code shape is not measured, only what is written

## Ambiguous cases, and what this does about them

- A class field initializer is reported both as its own unit and, when the assigned value is itself a function, as that function's own separate unit, matching how the ESLint rule's own code-path analysis treats the two as distinct paths

## Defined by

- [ESLint — complexity rule documentation](https://eslint.org/docs/latest/rules/complexity)
- [NIST SP 500-235 — Structured Testing: A Testing Methodology Using the Cyclomatic Complexity Metric](https://www.mccabe.com/pdf/mccabe-nist235r.pdf)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/code-complexity code-complexity
cd code-complexity
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/code-complexity
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { analyseComplexity } from '@fodt/code-complexity';

analyseComplexity('function f(a) { if (a) { return 1; } return 2; }');
// { functions: [{ name: 'f', kind: 'function declaration', line: 1, column: 1, complexity: 2, lines: 1, codeLines: 1 }], over: [], highest: 2, average: 2 }
```

`analyseComplexity(source, options)` returns `{ functions, over, highest, average }`; `functions` is `{ name, kind, line, column, complexity, lines, codeLines }[]`, one row per reported unit, excluding top-level code. `options.language` is `'javascript'` (default), `'typescript'` or `'tsx'`; `options.threshold` (default 10) only affects `over`, a subset of `functions`. Throws `CodeComplexityError` (with `line`/`column`) only for a syntax error; the code is parsed with `@babel/parser` and walked with an explicit stack, never run and never recursively, so deeply nested input cannot overflow the call stack.

## Dependencies

- `@babel/parser` ^7.29.9

## Tests

```sh
npm test
```

Complexity counting is ported from the installed eslint package's own `lib/rules/complexity.js` (classic variant), cited by file and version in a source comment, and checked against that same installed rule run through ESLint's `Linter` class over a hand-written corpus covering every counted construct. `eslint` is a devDependency-only oracle, never a runtime dependency. A second oracle strips a TypeScript corpus's types with the `typescript` compiler and asserts the same complexity numbers on the type-stripped JavaScript.

## Licence

MIT. See [LICENSE](./LICENSE).

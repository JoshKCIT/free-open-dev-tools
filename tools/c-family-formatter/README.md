# C, C++, C#, Java, Objective-C & Protobuf Formatter

Format C, C++, C#, Java, Objective-C and Protocol Buffers source with clang-format under a named style preset and a chosen indent width.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Formats C, C++, C#, Java, Objective-C and Protocol Buffers source with clang-format, the formatter of the LLVM project, compiled to WebAssembly and run in a background worker in your browser. You choose the language, one of seven named style presets (LLVM, Google, Chromium, Mozilla, WebKit, Microsoft or GNU) and, if you like, an indent width that replaces the preset's own. Nothing is sent anywhere.

## Supported

- Six languages, each read as the file name the engine is given: C (input.c), C++ (input.cpp), C# (input.cs), Java (Input.java), Objective-C (input.m) and Protocol Buffers (input.proto)
- Seven named presets, each with its own indent width and column limit: LLVM, Google, Chromium, Mozilla, WebKit, Microsoft and GNU
- An optional indent width from 1 to 16 that replaces the preset's own; leave it blank to keep the preset's width
- Comments, preprocessor lines and string literals are kept
- Code that does not parse is still formatted as well as it can be, never refused

## Limits

- Malformed code is formatted best effort and never refused: clang-format reports no syntax errors.
- A run that takes longer than 10 seconds is stopped with a message, so a pathological input cannot freeze the page.
- Only a named preset and an indent width can be set; other clang-format style options use the preset's values.
- The language comes from your choice, not from the code: a C file formatted as Java may be changed in ways that are wrong for C.
- The indent width must be a whole number from 1 to 16; leave it blank to use the preset's own width.
- A source nested thousands of levels deep (for example 2000 nested parentheses) is refused with a plain message instead of crashing the page.
- The engine is about 2.5 MB of WebAssembly, so this page is larger than most and takes a moment longer to load.

## Ambiguous cases, and what this does about them

- The preset names the style, not the language: Google style for Java and Google style for C++ differ in the rules clang-format applies to each, and some presets (such as Microsoft and GNU) were written with one language in mind
- A blank indent width and an indent width equal to the preset's own width give the same output; only a different width changes the result
- A column limit still applies: the presets differ in how long a line may be before it is wrapped (WebKit has none), and the page does not offer a way to change it

## Defined by

- [ClangFormat style options](https://clang.llvm.org/docs/ClangFormatStyleOptions.html)
- [ClangFormat](https://clang.llvm.org/docs/ClangFormat.html)

## Bundled data

This folder ships a data file that is not an npm dependency, so it travels with the folder when it is
copied out on its own:

- **LLVM clang-format 23.1.1** (Apache-2.0 WITH LLVM-exception) — [source](https://github.com/llvm/llvm-project/tree/llvmorg-23.1.1/clang/lib/Format). The LLVM Project is under the Apache License v2.0 with LLVM Exceptions. The clang-format library is compiled into the WebAssembly module that @wasm-fmt/clang-format 23.1.1 ships.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/c-family-formatter c-family-formatter
cd c-family-formatter
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/c-family-formatter
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadEngine, formatCFamily } from '@fodt/c-family-formatter';

const require = createRequire(import.meta.url);
loadEngine(readFileSync(require.resolve('@wasm-fmt/clang-format/wasm')));

formatCFamily('void f() { someFunction(); }', { language: 'cpp', preset: 'LLVM', indentWidth: 3 });
// { output: 'void f() {\n   someFunction();\n}\n', inputBytes: 28, outputBytes: 33 }
```

`loadEngine(wasm)` hands the clang-format WebAssembly bytes (or a compiled module) to the engine once; calling it again does nothing. `formatCFamily(source, options?)` returns `{ output, inputBytes, outputBytes }`, or `null` for blank or whitespace-only source without calling the engine. The options are `language` ('c', 'cpp', 'csharp', 'java', 'objc' or 'proto'; the default is 'cpp'), `preset` ('LLVM', 'Google', 'Chromium', 'Mozilla', 'WebKit', 'Microsoft' or 'GNU'; the default is 'LLVM') and `indentWidth` (a whole number from 1 to 16, or left out to keep the preset's width). The language is passed to the engine as a file name and the style as a string built only from the preset name and the indent width, so no text of yours ever reaches the engine's style parser. It throws `CFamilyFormatterError` for every failure and never returns partly formatted code. `C_FAMILY_LANGUAGES` and `C_FAMILY_PRESETS` list the choices.

## Dependencies

- `@wasm-fmt/clang-format` 23.1.1

## Tests

```sh
npm test
```

The oracle is clang-format's own published material at llvmorg-23.1.1: the IndentWidth 3 example of ClangFormatStyleOptions.rst is reproduced exactly, one two-argument verifyFormat case from each of clang's unit test files for C++, C#, Java, Objective-C and Protocol Buffers is reproduced under the preset that file sets up, and the indent width of every preset is checked against the values Format.cpp gives it. The vendored fixtures keep the LLVM licence and a record of where each case came from. Tests that provoke a WebAssembly trap load their own fresh copy of the package, because a trap leaves an engine instance unusable.

## Licence

MIT. See [LICENSE](./LICENSE).

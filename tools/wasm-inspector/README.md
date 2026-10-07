# WebAssembly Module Inspector

Open a .wasm file to read its sections, types, imports, exports, memories, data and names without compiling or running it.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Open a .wasm file and read what is inside it: the sections with their offsets and sizes, the types, imports and exports, the functions (the largest by size), tables, memories, globals, tags, element and data segments, and the custom sections and names the producer's tools added. The bytes are read by a parser written for the WebAssembly 3.0 core binary format. The module is never compiled, validated or run, and everything happens on this device.

## Supported

- The WebAssembly 3.0 core binary format: all fourteen section ids, value, reference and heap types, recursive groups with sub and sub final types, struct and array types with packed fields, tags, 64-bit memory and table limits, multiple memories, element segments of every flag and data segments of every flag
- Constant expressions in globals, segment offsets and table initialisers, shown as text, including the extended constant instructions and the GC allocation forms
- The name section with its core subsections (module, function, local, type, field and tag names) and the extended name section proposal's subsections, each labelled with where it is defined
- The producers, target_features, sourceMappingURL and external_debug_info custom sections decoded, and the dynamic linking, linking, relocation and debug sections listed with their sizes
- Printable text found inside data segments, the size of every function body with the largest listed by name, and the features the module uses, worked out from what its sections hold
- A component model binary is recognised by its eight byte header and reported, not read

## Limits

- The module is only read: it is never compiled, instantiated or run, and the page's policy does not let the browser compile one. The structure is read but not validated, so this page cannot tell you that a module is valid, safe or that a browser will accept it.
- Function bodies are measured, not decoded: their sizes are listed, but instructions are not shown, so a fault inside a body (a bad opcode, a missing end) is not reported. A constant expression made of an instruction this page does not decode ends the reading of that section, and says so.
- Names from the name section and the custom sections come from the producer's tools and can be missing, wrong or invented. Sections defined by tool conventions and proposals are decoded as those documents describe, and each is labelled as outside the core specification.
- A sourceMappingURL or external debug address inside the module is shown as text and is never requested.
- Component model binaries are recognised by their header only. A file over 64 MiB is refused before it is read. Tables list at most 2,000 rows, the 50 largest functions are named, at most 200 pieces of text are listed from data segments (6 or more printable bytes, within the first 8 MiB of data), the module tree holds at most 2,000 items and at most 200 findings and notes are listed; each cut says how much was left out.

## Ambiguous cases, and what this does about them

- The shared forms of memory and table limits belong to the threads proposal, not the core text, and are shown as shared (threads proposal).
- A name is read as UTF-8 by its byte length, as the specification says; one that is not valid UTF-8 is reported at its offset and shown with the replacement character.
- Which features a module uses is worked out from the sections alone, because function bodies are not decoded, so a feature that is used only by instructions inside a body is not listed.

## Defined by

- [WebAssembly 3.0 core specification: binary format](https://webassembly.github.io/spec/core/binary/index.html)
- [WebAssembly 3.0 core specification: custom sections and the name section](https://webassembly.github.io/spec/core/appendix/custom.html)
- [Extended name section proposal](https://github.com/WebAssembly/extended-name-section/blob/main/proposals/extended-name-section/Overview.md)
- [WebAssembly tool conventions: producers section](https://github.com/WebAssembly/tool-conventions/blob/main/ProducersSection.md)
- [WebAssembly tool conventions: dynamic linking](https://github.com/WebAssembly/tool-conventions/blob/main/DynamicLinking.md)
- [ECMA-426 Source map format: the sourceMappingURL custom section](https://tc39.es/ecma426/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/wasm-inspector wasm-inspector
cd wasm-inspector
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/wasm-inspector
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { inspect } from '@fodt/wasm-inspector';

const report = inspect(bytes); // bytes: a Uint8Array holding a .wasm file

report.kind; // 'module', or 'component' for a component model binary
report.imports; // [{ module: 'env', field: 'log', kind: 'func', ... }]
report.exports; // [{ name: 'add', kind: 'func', index: 1 }]
report.sections; // id, name, offset and size of every section
report.findings; // what could not be read, each with an offset
```

`inspect(bytes)` walks the sections (`walkSections`), reads each one (`readModule`), the name section (`readNameSection`) and the custom sections (`readCustomSections`), lists printable text in data segments (`findStrings`) and works out the features used (`usedFeatures`). Faults in the structure are findings with an offset, never thrown; only a file over 64 MiB is refused, with a `WasmInspectorError`. Counts read from the file are compared with the bytes that remain before any array is sized, function bodies are kept as two typed arrays of offset and size, and the functions hold no state between calls. Nothing in the package touches the WebAssembly object, generates code or imports at run time, and a test reads every source file to prove it.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Expected values come from the specification and from recorded second opinions. The 62 binary modules of the WebAssembly testsuite (Apache-2.0, commit b464a4cd100d98175ae6e3890db89a2e6c8302f7) read with no finding, and its malformed binary modules are flagged except the faults that sit inside function bodies, which are listed by file, index and message in the test. The Go module of @wasm-fmt/gofmt and the Rust module of @wasm-fmt/ruff_fmt give the imports, exports and custom section sizes that V8 (Node 22) gives. A 329 byte module assembled with wabt 1.0.39 is compared with V8 the same way. Modules that wabt 1.0.39 and V8 12.4 cannot write or accept (GC types, multiple memories, 64-bit memories and tables, tags) are written as hex with a comment on every group of bytes and read as those comments say. LEB128 limits, counts larger than the bytes that remain, section order, names and caps are tested, and every reader is held to a doubling ratio of 6 and a four times ratio of 12 on hostile input.

## Licence

MIT. See [LICENSE](./LICENSE).

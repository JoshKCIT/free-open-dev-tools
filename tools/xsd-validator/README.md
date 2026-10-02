# XML Schema (XSD) Validator

Validate an XML document against a pasted XML Schema and list each error with its line number.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Checks a pasted XML document against a pasted XML Schema and lists every error with its line number, in the words of libxml2. libxml2, compiled to WebAssembly, runs in a background worker in this page, so a validation that never finishes can be stopped. Nothing a schema or document names is read: imports, includes and external entities are listed as not loaded, and a document with a DOCTYPE is refused before it is parsed.

## Supported

- XML Schema 1.0 as libxml2 implements it, with the built-in types of Part 2, local and global types, groups, keys and keyrefs, and namespaces
- Each validation error with its line number and libxml2's own message, in document order; a document that is not well formed is reported with its line and column
- Warnings from libxml2, shown only when you ask for them
- Locations named by xs:import, xs:include, xs:redefine and xs:override listed as not loaded, with the line they are on
- Line numbers above 65,535 reported exactly
- A document or schema that is blank shows nothing and starts no background worker

## Limits

- Documents up to 10 MiB and schemas up to 2 MiB.
- A validation that takes longer than 20 seconds is stopped with a message.
- Nothing a schema or document names is loaded: xs:import, xs:include, xs:redefine and xs:override locations are listed as not loaded, and xsi:schemaLocation is ignored.
- A schema that includes another file cannot be used until the included declarations are pasted into it; a missing import is only a warning.
- XML Schema 1.0 only; DTDs and RELAX NG are not read and a DOCTYPE is refused.
- Validation errors have a line but no column; the first 200 are listed.

## Ambiguous cases, and what this does about them

- libxml2 words its messages itself, so another validator can say the same thing differently while agreeing that the document is not valid
- A schema with no global element for the document's root reports libxml2's own no matching global declaration error
- After the first error inside an element, libxml2 may skip the rest of that element, so fixing one error can reveal others
- A missing xs:import is only a warning in libxml2, and later errors can follow from the declarations that were not imported

## Defined by

- [XML Schema Part 1: Structures Second Edition](https://www.w3.org/TR/xmlschema-1/)
- [XML Schema Part 2: Datatypes Second Edition](https://www.w3.org/TR/xmlschema-2/)
- [XML Schema Part 0: Primer Second Edition](https://www.w3.org/TR/xmlschema-0/)

## Bundled data

This folder ships a data file that is not an npm dependency, so it travels with the folder when it is
copied out on its own:

- **libxml2** (MIT) — [source](https://github.com/jameslan/libxml2/tree/f52e859efe97cf3f0b78d731976402748878529a). Copyright (C) 1998-2012 Daniel Veillard and The Libxml2 Contributors. libxml2 2.15.1 (the VERSION file of the source commit that libxml2-wasm 0.7.2 builds) is compiled into the WebAssembly module that libxml2-wasm 0.7.2 embeds in lib/libxml2raw.mjs. libxml2 is offered under the MIT licence; the files dict.c and list.c carry a similar licence with different copyright notices.
- **Emscripten runtime** (MIT) — [source](https://github.com/emscripten-core/emscripten/tree/5.0.2). Copyright (c) 2010-2014 Emscripten authors. The build workflow of libxml2-wasm 0.7.2 names Emscripten 5.0.2, and the Emscripten runtime and C library are part of the module that libxml2-wasm 0.7.2 embeds. Emscripten is offered under the MIT licence and the University of Illinois/NCSA licence; the MIT licence is the one relied on here, and the notice file holds both texts.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/xsd-validator xsd-validator
cd xsd-validator
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/xsd-validator
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import * as libxml2 from 'libxml2-wasm';
import { validateXml } from '@fodt/xsd-validator';

const schema = '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="note" type="xs:string"/></xs:schema>';
const result = validateXml(libxml2, schema, '<note>a short note</note>', { showWarnings: false });
// result.valid is true and result.issues is []; a document that does not match lists each error with its line.
```

`validateXml(engine, schemaText, xmlText, { showWarnings })` takes the libxml2-wasm module as its first argument, so the package never imports the engine itself; it returns null when either text is blank. It refuses a DOCTYPE in either text first, lists xs:import, xs:include, xs:redefine and xs:override locations as not loaded, compiles the schema and validates the document, and returns `{ valid, issues, total, notLoaded }` with at most 200 issues. Problems with the input (size, DOCTYPE, a schema that cannot be compiled, a document that is not well formed) are thrown as `XsdValidatorError` with `part` set to schema or document and a line when libxml2 gave one.

## Dependencies

- `libxml2-wasm` 0.7.2

## Tests

```sh
npm test
```

libxml2's own wording is checked against a first-draft run of the same schema and document through libxml2 itself.

## Licence

MIT. See [LICENSE](./LICENSE).

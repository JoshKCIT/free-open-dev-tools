# JSON to Typed Code

Generate TypeScript, Go, Rust, Python, Java, C#, Kotlin and PHP types from JSON.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Infers a type model from a pasted JSON sample and renders typed source text in eight languages -- TypeScript, Go, Rust, Python, Java, C#, Kotlin and PHP -- checked directly against each language's own naming rules; the TypeScript output is also checked with the real TypeScript compiler under strict mode.

## Supported

- TypeScript, Go, Rust, Python, Java, C#, Kotlin and PHP output from the same inferred model
- Nested objects become named types; an object seen inside an array becomes one merged item type
- A key missing from some merged instances becomes optional; a value that was ever null makes its field nullable
- An integer mixed with any other number widens to a floating number; any other mix of value kinds widens to the any-JSON type, listed in warnings
- Keys that are not valid identifiers, or that collide with a keyword, get an escaped name per language, with the original key kept in a struct tag, a rename attribute, a docblock line or the key text itself
- A generated type name that would shadow a language-provided type name gets a Type suffix
- Java records and C# and Kotlin properties box or make optional numbers and booleans nullable rather than using an unboxed primitive

## Limits

- Output is source text only; no compiler, formatter or package manager runs for any target language, and none of their output is executed by this tool
- Unions beyond the integer/floating-number rule are not modelled; a key with genuinely mixed value kinds becomes the language's any-JSON type instead of a union
- A JSON key containing a quotation mark, backslash or comma cannot be written exactly into a Go struct tag; the tag still carries the key for reference, but Go's own decoder would fall back to the generated field name
- The inferred model comes from one sample only; a shape never seen in the sample is never inferred
- A document nested deeper than 512 levels is refused outright rather than inferred from
- Java targets records with Jackson, C# targets System.Text.Json with nullable reference types, Kotlin targets kotlinx.serialization, and PHP targets 8.1 or later

## Ambiguous cases, and what this does about them

- An object whose keys are seen at two different locations with an identical shape still gets two separate named types; nothing here deduplicates by shape, only by name
- Python output targets 3.11 or later, the first version with typing.NotRequired

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/json-to-code json-to-code
cd json-to-code
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/json-to-code
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { jsonToCode, LANGUAGES } from '@fodt/json-to-code';

jsonToCode('{"id":1,"name":"Ada"}', { language: 'typescript', rootName: 'User' });
// { output: 'export interface User {\n  id: number;\n  name: string;\n}\n', warnings: [] }
```

`inferModel` builds one language-independent model shared by every emitter; each `emit-<language>.ts` file renders that model and returns its own extra warnings alongside the model's own structural ones. `naming.ts` holds every language's fetched keyword list and escaping rule.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

No standards body defines JSON-to-typed-code inference; correctness is checked instead by compiling the TypeScript output with the real TypeScript compiler under strict mode, and by asserting every emitted identifier matches its own language's fetched identifier rule and keyword list.

## Licence

MIT. See [LICENSE](./LICENSE).

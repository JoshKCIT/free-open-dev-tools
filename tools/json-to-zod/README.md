# JSON to Zod Schema

Generate a Zod validation schema from a JSON sample or JSON Schema.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Turns a pasted JSON sample or a JSON Schema document into Zod source text: source only, never bundled or executed by this tool. Sample mode infers the same simplified shape as the typed-code generator; schema mode converts a documented subset of JSON Schema draft-07 and 2020-12 keywords to the matching Zod calls, listing anything outside that subset instead of guessing at it.

## Supported

- Sample mode: an object, array, or scalar sample becomes a nested z.object/z.array/z.string/z.number/z.boolean/z.unknown expression
- Schema mode: type (including a null-bearing list), properties with required, additionalProperties: false, items, prefixItems, enum, const, anyOf, oneOf, allOf, string length/pattern/format bounds, numeric bounds and multipleOf, array length bounds, description and default
- A local $ref to #/definitions/... or #/$defs/... becomes a named constant, emitted before whatever first uses it
- A $ref cycle is refused, naming the pointer that closes the loop
- A keyword outside the supported subset is listed by its RFC 6901 path in warnings, never guessed at
- The generated schema is checked with Zod itself: it accepts the sample or the schema's own valid instances, and rejects a wrongly typed value

## Limits

- Zod is a devDependency-only test oracle; the shipped package never bundles or evaluates Zod, and the generated text is never executed by this tool
- oneOf's exclusivity (exactly one branch matches) is not enforced; it converts to the same z.union as anyOf, with a warning
- The generated source targets Zod 4 (tested against 4.6.5); it uses the chained string-format methods (.email(), .uuid(), .url()) that Zod 3 also has rather than Zod 4's newer top-level z.email() form, since Zod 4's own changelog marks the chained forms deprecated but still functional -- pasting the output into a Zod 3 project should still work
- A recursive $ref is refused outright rather than emitting a self-referential lazy schema
- Sample mode never infers a bound, pattern, enum or format; only schema mode does, and only from a keyword this tool understands

## Ambiguous cases, and what this does about them

- Sample mode's inference and another tool's own JSON-to-typed-code inference are two independent implementations of the same simplification rules (D-23 forbids importing between tool folders); a difference between them would be a bug in one, not an intentional divergence
- A draft-07 array items as a list (tuple-typed items) and 2020-12's prefixItems both become z.tuple; draft-07's own items list historically forbids extra items by default, which this tool does not model separately

## Defined by

- [JSON Schema draft-07 (validation vocabulary)](https://json-schema.org/draft-07/json-schema-validation)
- [JSON Schema 2020-12 (validation vocabulary)](https://json-schema.org/draft/2020-12/json-schema-validation)
- [RFC 8259 — The JavaScript Object Notation (JSON) Data Interchange Format](https://www.rfc-editor.org/rfc/rfc8259)
- [RFC 6901 — JavaScript Object Notation (JSON) Pointer](https://www.rfc-editor.org/rfc/rfc6901)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/json-to-zod json-to-zod
cd json-to-zod
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/json-to-zod
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { jsonToZod } from '@fodt/json-to-zod';

jsonToZod('{"id":1,"name":"Ada"}', { source: 'sample', exportName: 'userSchema' });
// { output: "import { z } from 'zod';\n\nexport const userSchema = z.object({ id: z.number().int(), name: z.string() });\n", warnings: [] }
```

Sample mode's inference lives directly in index.ts, deliberately smaller than the type inference behind the eight-language code generator elsewhere on this site, and never imported from it (D-23). Schema mode walks the schema tree once, resolving $ref pointers with pointer.ts and collecting unsupported keywords by their RFC 6901 path as it goes.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

No standards body defines JSON-to-Zod conversion itself; correctness is checked by evaluating the generated source in the test suite with Zod supplied and calling safeParse against the sample or the schema's own instances, both accepting the valid case and rejecting a wrongly typed one.

## Licence

MIT. See [LICENSE](./LICENSE).

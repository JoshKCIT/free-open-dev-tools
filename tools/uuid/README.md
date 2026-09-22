# UUID Generator & Parser

Generate UUID v1, v3, v4, v5 and v7, and parse any UUID back into its fields.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Generates UUIDs of every version that RFC 9562 still defines, and takes any UUID apart to show its version, variant and embedded timestamp. Random values come from the browser cryptographic source, never from Math.random, which is a real collision risk that several tool sites get wrong.

## Supported

- Version 4, random, the usual default
- Version 7, time-ordered, which sorts by creation time and is the better choice for database keys
- Version 1, time-based, with a random node identifier as RFC 9562 permits
- Versions 3 and 5, deterministic from a namespace and a name, with the four standard namespaces built in
- The nil and max UUIDs
- Parsing: version, variant, embedded timestamp, clock sequence, node id, and the hex, URN and Base64url forms
- Bulk generation, uppercase, no hyphens, braces and URN formatting

## Limits

- Version 1 uses a random node identifier with the multicast bit set, not your network card address. A browser cannot read a MAC address, and publishing one would leak a hardware identifier.
- Version 2, the DCE security variant, is not generated. It is effectively unused and RFC 9562 does not specify it.
- Versions 6 and 8 are recognised when parsing but not generated. Version 7 covers what version 6 was for.
- A version 1 or version 7 UUID reveals roughly when it was created. If that matters for your data, use version 4.
- Version 3 uses MD5, which is broken. It exists for compatibility with systems that already use it; choose version 5 for anything new.
- Version 1 can produce at most 10,000 ids per millisecond before the sub-millisecond tick field wraps. Bulk generation past that rate should use version 7.

## Ambiguous cases, and what this does about them

- A UUID with unexpected variant bits is still 32 hex digits and many tools accept it silently. This one parses it, names the variant and says plainly that it was probably not produced by a compliant library.
- Version 1 timestamps count 100-nanosecond intervals from 1582-10-15, so the millisecond precision shown is the best a JavaScript date can express.

## Defined by

- [RFC 9562 — Universally Unique IDentifiers (UUIDs)](https://www.rfc-editor.org/rfc/rfc9562)
- [RFC 9562 appendix A — worked examples and test vectors](https://www.rfc-editor.org/rfc/rfc9562#name-test-vectors)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/uuid uuid
cd uuid
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/uuid
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { v4, v7, v5, parse, isValid, NAMESPACES } from '@fodt/uuid';

v4();                                  // random
v7();                                  // time-ordered, sorts by creation
v5('dns', 'www.example.com');          // deterministic
parse('2ed6657d-e927-568b-95e1-2665a8aea6a2');
isValid(someString, 4);
```

`parse` never throws: it returns a report with `valid` and a `problems` list, so a malformed id can be explained rather than rejected. `generate` is the batch entry point the web page uses.

## Dependencies

- `@noble/hashes` ^2.4.0

## Tests

```sh
npm test
```

The version 3 and version 5 worked examples from RFC 9562 appendix A are asserted exactly. Beyond those: version and variant nibbles across many samples, version 7 lexicographic ordering and timestamp round trip, version 1 uniqueness inside a single millisecond, parsing of the URN and brace forms, rejection of non-RFC variants, 5000 generated ids with no duplicates, and a loose distribution check that would catch a constant or unseeded generator.

## Licence

MIT. See [LICENSE](./LICENSE).

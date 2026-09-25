# JSON, YAML & TOML Converter

Convert between JSON, YAML and TOML, keeping comments and types where the formats allow.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Converts a pasted document between JSON, YAML and TOML in any direction. A YAML document converted to YAML again keeps its comments; every other conversion states in a warning exactly what it drops, such as YAML comments, TOML dates becoming strings, or key order changing.

## Supported

- All nine from/to pairs across JSON, YAML and TOML
- YAML to YAML re-serialising through the parsed document, so comments and their position survive
- The YAML 1.2 core schema, so unquoted yes and no stay strings rather than becoming booleans
- TOML dates and times, read as strings with a warning since JSON and YAML core scalars have no date type
- TOML tables, arrays of tables and inline tables round tripping through JSON and back
- A YAML alias bomb refused by an alias-count limit instead of being expanded
- A key named __proto__ or constructor surviving every conversion as an ordinary key
- A parse error reported with a line and column for both YAML and TOML input

## Limits

- JSON has no comments; a YAML comment survives only a YAML to YAML conversion, never a conversion to JSON or TOML
- TOML has no comment syntax the reader keeps, so every TOML input's comments are dropped even converting TOML to TOML
- TOML has no null; a null anywhere in the input is refused by its RFC 6901 path rather than being dropped, since TOML libraries otherwise drop it silently
- A YAML tag outside the core schema, and a YAML anchor or alias, are resolved to a plain copy on output; the tag or the sharing is not preserved
- TOML has no distinct date type on the JSON/YAML side of a conversion; a TOML date or time becomes a string
- TOML output lists plain keys before any table, which can change the input's key order
- A JSON number beyond double precision is rounded, the same limit JSON.parse itself has
- Writing TOML from a float such as 1.0 can come back as the plain integer 1, since TOML numbers do not separately track a trailing .0

## Ambiguous cases, and what this does about them

- Unquoted yes and no stay strings on the YAML side, per the YAML 1.2 core schema this reads with, not the YAML 1.1 boolean set some tools use
- Which quoting style the YAML writer picks for a given string (plain, single or double quoted) is decided by the yaml package's own rules, not by this tool

## Defined by

- [RFC 8259 — The JavaScript Object Notation (JSON) Data Interchange Format](https://www.rfc-editor.org/rfc/rfc8259)
- [YAML 1.2.2](https://yaml.org/spec/1.2.2/)
- [TOML 1.1.0](https://toml.io/en/v1.1.0)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/data-convert data-convert
cd data-convert
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/data-convert
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { convertData } from '@fodt/data-convert';

convertData('name: Ada\ntags:\n  - a\n  - b', { from: 'yaml', to: 'json' });
// { output: '{\n  "name": "Ada",...', warnings: [] }
```

`convertData(text, { from, to, indent })` returns `{ output, warnings }` for a successful conversion, `indent` defaults to 2 and only affects JSON and YAML output. It throws `DataConvertError` with `line`/`column` for a parse error, or `path` (an RFC 6901 pointer) for a structural problem such as a null on the way to TOML.

## Dependencies

- `yaml` 2.9.1
- `smol-toml` 1.9.0

## Tests

```sh
npm test
```

The JSON to YAML to JSON round trip is checked against a document mixing an array, a string that looks like a number, and a nested object. YAML comment retention, the YAML 1.2 core schema's yes/no handling, and TOML dates, tables and inline tables are each checked against the fetched YAML 1.2.2 and TOML 1.1.0 examples.

## Licence

MIT. See [LICENSE](./LICENSE).

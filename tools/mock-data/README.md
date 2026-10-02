# Mock Data Generator

Generate deterministic fake records from a seed as JSON, JSON Lines, CSV, XML or YAML, with no network calls.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Generates fake records from a short field list and a seed. The same seed, field list and count always produce byte-identical output, on every run and in every browser, so a fixture built here stays stable forever. Nothing is fetched: every value is built from a small seeded generator and a handful of bundled word lists.

## Supported

- Twenty field kinds: id, uuid, firstName, lastName, fullName, email, username, company, city, street, word, sentence, boolean, integer, decimal, date, datetime, ipv4, url, color and oneOf
- A field list written as one "name: kind" line per field, with arguments in parentheses where a kind needs them
- Up to 1000 records per run
- JSON, JSON Lines, CSV, XML or YAML output holding the same records for the same seed, field list and count
- A record count that grows without changing any earlier record's values
- XML as a records element holding one record element per record with one element per field, written with text escaped by the XML 1.0 rules
- YAML as a list with one mapping per record, numbers and booleans written bare and every string that another reader could take for something else (yes, on, null, 1e3, a date) quoted

## Limits

- Values are drawn from a seeded generator; this tool never reads the system clock, calls the platform's own randomness source, or uses locale-aware formatting, so its output cannot be used where genuine unpredictability matters
- Name, city and street lists are small and original to this tool, not representative of any real population or place
- Generated emails, URLs and IPv4 addresses always use reserved example domains and documentation address ranges, never a real host
- At most 1000 records per run
- XML and YAML hold the same records as JSON for the same seed; a field name that is not a valid XML element name is refused for XML.
- YAML quotes values such as yes, null and 1e3 so they stay text.
- A field name that starts with a digit or holds a space or any other character XML 1.0 does not allow in a name is refused for XML output, naming its line in the field list; JSON, JSON Lines, CSV and YAML keep accepting it.
- CSV, JSON and JSON Lines output are written exactly as before; only the XML and YAML formats are new.

## Ambiguous cases, and what this does about them

- The same seed, field list and count always give the same output; changing any one of the three changes every later value, not just the field or record that changed

## Defined by

- [RFC 2606 — Reserved Top and Second Level DNS Names](https://www.rfc-editor.org/rfc/rfc2606)
- [RFC 5737 — IPv4 Address Blocks Reserved for Documentation](https://www.rfc-editor.org/rfc/rfc5737)
- [RFC 9562 — UUID, Version 4](https://www.rfc-editor.org/rfc/rfc9562)
- [Extensible Markup Language (XML) 1.0 (Fifth Edition)](https://www.w3.org/TR/xml/)
- [YAML Ain't Markup Language (YAML) version 1.2.2](https://yaml.org/spec/1.2.2/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/mock-data mock-data
cd mock-data
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/mock-data
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { generateMockData } from '@fodt/mock-data';

generateMockData({ seed: 'demo', count: 10, format: 'json', fields: 'id: id\nname: fullName\nemail: email' });
```

`parseFieldSpec` is exported on its own for anything that only needs the parsed field list without generating records. `fnv1a32` and `mulberry32` are exported because they are this tool's own seeding primitives, proven against published test vectors in this package's tests. `format` is `json`, `jsonl`, `csv`, `xml` or `yaml`; every format is built from the same drawn records, so a seed gives the same records in all of them.

## Dependencies

- `yaml` 2.9.1

## Tests

```sh
npm test
```

Determinism is checked by generating the same input twice and by growing the record count and comparing the shared prefix. The reference seed's output digest is pinned and asserted in this package's tests and in the browser test suite from the same literal, so a change to output shape is caught in both places at once. XML output is compared with XML written by hand from the JSON records and the XML 1.0 escaping rules, and YAML output is read back with the yaml package under both YAML 1.2 and 1.1 and compared with the JSON records; the JSON, JSON Lines and CSV digests for the reference seed are pinned.

## Licence

MIT. See [LICENSE](./LICENSE).

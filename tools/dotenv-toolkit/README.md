# .env Validator & Converter

Validate a .env file and convert it to Compose, Kubernetes, shell or JSON.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Checks a pasted .env file the way dotenv itself reads it, naming every line it would ignore, every duplicate key and every invalid name with its line number. Converts the parsed values to a Compose environment block, a Kubernetes ConfigMap or Secret, shell export lines or JSON, and back, with every value unchanged: dollar signs, quotes, newlines and non-ASCII text all round-trip exactly, and a value no target can hold unchanged is listed with its key instead of being silently altered.

## Supported

- dotenv's own parsing rules: optional export prefix, single/double/backtick quoting, comments, and newline expansion only inside double quotes
- Conversion to a Compose environment mapping, a Kubernetes ConfigMap, a Kubernetes Secret, POSIX/PowerShell shell export lines, and JSON
- Reading each of those five formats back into .env text
- A lossless round trip for values containing =, #, single/double/backtick quotes, a literal dollar sign, newlines and non-ASCII characters
- Reporting lines dotenv ignores, duplicate keys and invalid key names with their line numbers

## Limits

- This tool cannot tell which program will read the generated file, and other readers of a .env-shaped file (Docker Compose's own env_file support, python-dotenv, a shell sourcing the file directly) may expand a dollar sign differently -- only running that program can show that.
- A Kubernetes Secret's data is base64, which is encoding, not encryption; anyone who can read the Secret manifest can read the value.
- Variable expansion (${VAR}) is never performed, because dotenv itself does not perform it -- values are copied exactly as written.
- A value none of the five target formats can hold unchanged (for example one mixing a newline and a double quote in a form the writer cannot escape) is listed as unrepresentable and left out, never silently altered.

## Ambiguous cases, and what this does about them

- An inline comment needs no leading space before the # character (dotenv's own LINE regex excludes # from an unquoted value's character class entirely), so INLINE_COMMENTS_SPACE=a#b parses to just "a", not "a#b" -- confirmed directly against the vendored upstream test fixture rather than assumed.

## Defined by

- [dotenv parsing rules (README and lib/main.js)](https://github.com/motdotla/dotenv/blob/86804c0507aff98d3a82204759729af3bc2ce1a9/README.md)
- [Compose Specification (environment, interpolation)](https://github.com/compose-spec/compose-spec/blob/914ec15d1fa498969c0df5c1d672306db3256089/spec.md)
- [Kubernetes ConfigMap and Secret](https://kubernetes.io/docs/concepts/configuration/secret/)
- [POSIX Shell Command Language 2.2.2](https://pubs.opengroup.org/onlinepubs/9699919799/utilities/V3_chap02.html)
- [RFC 4648 (base64)](https://www.rfc-editor.org/rfc/rfc4648)
- [RFC 8259 (JSON)](https://www.rfc-editor.org/rfc/rfc8259)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/dotenv-toolkit dotenv-toolkit
cd dotenv-toolkit
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/dotenv-toolkit
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { parseEnv, convertEnv } from '@fodt/dotenv-toolkit';

const { entries, problems } = parseEnv(text);
const { output, warnings, unrepresentable } = convertEnv(text, { to: 'json' });
```

`parseEnv` never throws for a malformed line; every line dotenv would ignore, every duplicate key and every invalid name becomes a `problems` entry with its 1-based line. `convertEnv(text, { to, serviceName, resourceName })` composes `parseEnv` with a target writer and returns `{ output, warnings, unrepresentable }`. `readTarget(text, { from })` reads one of the five targets back into entries. At most 1 MB of input is accepted; more is refused rather than risk freezing the tab.

## Dependencies

- `yaml` 2.9.1

## Tests

```sh
npm test
```

The upstream dotenv test fixtures (vendored at the pinned tag) are read and their own t.equal() assertions checked against this tool's parseEnv, not retyped by hand. The round trip for every target is proven over a battery of hostile values (=, #, quotes, backtick, dollar sign, backslash, CRLF/LF, accented letters, CJK text, an emoji).

## Licence

MIT. See [LICENSE](./LICENSE).

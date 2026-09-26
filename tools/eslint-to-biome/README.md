# ESLint to Biome

Translate an ESLint config to the closest Biome equivalent, flagging gaps.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Translates a legacy ESLint configuration (JSON, JSON with comments, YAML, or a package.json's eslintConfig key) into the closest biome.json for a pinned Biome version, using a rule map bundled from Biome's own generated migrate sources. Every rule is either mapped to its Biome equivalent or listed with the reason it has none; every other setting -- extends, plugins, parserOptions, overrides and the rest -- is listed as not carried over rather than silently dropped.

## Supported

- ESLint core rules and rules from six common plugins: @typescript-eslint, react, react-hooks, jsx-a11y, import and unicorn, mapped from Biome's own generated migrate table at a pinned version
- Legacy .eslintrc JSON, JSON with comments, and YAML input, plus a package.json's own eslintConfig key
- The higher severity wins when more than one ESLint rule maps to the same Biome rule, matching Biome's own migrate behaviour
- Global bindings (globals) carried into javascript.globals
- Optional inclusion of Biome's nursery and inspired-by-another-tool rules, matching Biome's own --include-nursery and --include-inspired migrate flags
- The generated biome.json validates against Biome's own published configuration schema for the pinned version

## Limits

- This tool cannot run either ESLint or Biome, so it cannot tell whether Biome reports exactly what ESLint reported on the visitor's own code -- only running both linters on that code can show that.
- Rule options are listed as not carried over, never translated: a rule enabled with custom options migrates at the right severity but without its configuration.
- Only ESLint core rules and the six bundled plugins are mapped (D-108); a rule from any other plugin is listed as outside the bundled plugins.
- The bundled rule map is a snapshot of one pinned Biome version; a rule Biome adds, removes or remaps afterwards is not reflected here.

## Ambiguous cases, and what this does about them

- The generated biome.json always sets linter.rules.recommended to false. This tool lists every migrated rule explicitly; leaving Biome's own recommended set enabled at the same time could silently turn on rules the original ESLint configuration never asked for, which this tool's own never-silently-add principle rules out just as much as never silently dropping a rule.
- A flat eslint.config.js file is read from its syntax tree only (D-107): a value built by a function call, a spread, or a plain variable reference is reported as could not read statically rather than resolved, even when the referenced value is itself a literal elsewhere in the same file.

## Defined by

- [Biome migrate (biomejs.dev)](https://biomejs.dev/guides/migrate-eslint-prettier/)
- [Biome configuration reference (biomejs.dev)](https://biomejs.dev/reference/configuration/)
- [ESLint configuration files (eslint.org)](https://eslint.org/docs/latest/use/configure/configuration-files)

## Bundled data

This folder ships a data file that is not an npm dependency, so it travels with the folder when it is
copied out on its own:

- **Biome ESLint-migrate rule map** (MIT) — [source](https://github.com/biomejs/biome). Rule mapping data built from Biome's own generated ESLint-migrate source, by the Biome contributors, dual-licensed MIT OR Apache-2.0 (MIT elected here). Snapshot taken at tag @biomejs/biome@2.5.14, commit af4365d2b80177d0e0434c0ed4fd2c9171afc56c.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/eslint-to-biome eslint-to-biome
cd eslint-to-biome
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/eslint-to-biome
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { translateEslintConfig } from '@fodt/eslint-to-biome';

const result = translateEslintConfig('{"rules":{"no-debugger":"error"}}', { format: 'json' });
console.log(result.output);
```

`translateEslintConfig` never throws for a rule it cannot map -- an unmapped rule is listed under `unmapped` with a reason instead. It throws `EslintToBiomeError` only when the input itself cannot be read at all: over the size limit, not a recognisable ESLint configuration shape, or (for a flat config) a syntax error.

## Dependencies

- `yaml` 2.9.1
- `acorn` 8.18.0

## Tests

```sh
npm test
```

Correctness is checked against Biome's own generated sources: the bundled rule map is proven identical to a fresh parse of the vendored migrate match arms, every Biome rule name the map cites is proven to exist in Biome's own published configuration schema for the pinned version, and the generated biome.json for a battery of fixtures is proven to validate against that same schema. A never-evaluates test proves a flat config's own JavaScript is never run.

## Licence

MIT. See [LICENSE](./LICENSE).

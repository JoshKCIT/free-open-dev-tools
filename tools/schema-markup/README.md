# JSON-LD Schema Builder

Build schema.org JSON-LD for the common content types.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Builds schema.org JSON-LD for twelve common content types (Article, BlogPosting, Product, Organization, LocalBusiness, Person, Event, Recipe, FAQPage, BreadcrumbList, WebSite, HowTo) from simple property lines, checking every property and nested type against a bundled, versioned subset of the official schema.org vocabulary. Generated JSON-LD is type-checked against schema-dts in this package's own tests, and every value is escaped so a closing script tag typed into a value can never end the script element early.

## Supported

- Building JSON-LD for the twelve common content types from name: value property lines, with dotted paths for nested objects and numbered list items
- Checking every property against the bundled schema.org subset for the chosen type or a parent type, refusing one schema.org does not define
- Nested objects taking a default type from the property's own schema.org range (for example offers becomes an Offer), or an explicit @type line that overrides the default and must itself be in the property's range or a subtype of it
- Checking a value against the format schema.org names for its property: an absolute URL when the range is URL only, ISO 8601 when the range is Date or DateTime only
- Repeating the same simple path to build a list of values
- SearchAction's query-input shorthand text annotation on a WebSite's potentialAction

## Limits

- This tool checks schema.org's own definitions only; it cannot fetch your page or tell whether a search engine will show a rich result for it, which a search engine decides by its own separate rules on its own servers, not something a browser tab can verify without a server
- Pending and attic schema.org terms, and extension vocabularies (health-lifesci, bib, auto, meta), are not offered -- only the twelve content types and the types they reach through their properties' own schema.org ranges
- Only the twelve named content types are covered, not the full schema.org vocabulary of over 800 types

## Ambiguous cases, and what this does about them

- Every simple value is written as a JSON string, even one that looks numeric; schema.org's own JSON-LD examples do the same
- A nested object's default type is this tool's own reading of the property's schema.org range, chosen for being the type Google's and schema.org's own examples actually use in that position, not the only type the range technically allows

## Defined by

- [schema.org vocabulary, release 30.1](https://schema.org/docs/releases.html)
- [JSON-LD 1.1 (W3C)](https://www.w3.org/TR/json-ld11/)
- [schema.org Date and DateTime data types (ISO 8601)](https://schema.org/DateTime)

## Bundled data

This folder ships a data file that is not an npm dependency, so it travels with the folder when it is
copied out on its own:

- **schema.org vocabulary subset** (CC-BY-SA-3.0) — [source](https://github.com/schemaorg/schemaorg/blob/main/data/releases/30.1/schemaorg-current-https.jsonld). schema.org vocabulary, version 30.1, licensed under CC BY-SA 3.0 by Schema.org (https://creativecommons.org/licenses/by-sa/3.0/).

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/schema-markup schema-markup
cd schema-markup
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/schema-markup
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { buildJsonLd, CONTENT_TYPES, NESTED_DEFAULTS } from '@fodt/schema-markup';

buildJsonLd('Organization', 'name: Example Corp\nurl: https://www.example.com/');
```

`buildJsonLd` throws `SchemaMarkupError` only for a type outside `CONTENT_TYPES` or input over the 2,000-line cap; every other problem (an undefined property, a bad nested type, a malformed URL or date) is reported in the `problems` array with its line number, and the rest of the input still builds.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Generated JSON-LD for a real schema.org example of every content type is type-checked against schema-dts (a devDependency-only TypeScript type oracle, never bundled to visitors) with the real TypeScript compiler API. The bundled schema.org subset is re-derived from the vendored release file at test time and asserted equal to what this tool's own extraction produces, so the bundle can never silently drift from its source.

## Licence

MIT. See [LICENSE](./LICENSE).

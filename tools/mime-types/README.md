# MIME Type Lookup

Look up a media type by extension, or an extension by media type.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Looks up a media (MIME) type by file extension or filename, or the extensions registered for a media type, in both directions. Built on the maintained mime-db table, which merges the IANA Media Types registry with the extension conventions Apache, nginx and others actually use, since IANA's own registry does not publish extension mappings at all.

## Supported

- Looking up by a bare extension, a leading-dot extension, or a full filename with any case
- Looking up a media type's registered extensions
- Media type names matched case-insensitively, with any `;parameter` ignored, per RFC 6838
- An extension claimed by more than one type listing every one, IANA-registered first
- Marking each result as IANA-registered (with a link to its registry entry) or naming its non-IANA source (Apache or nginx mime.types)
- The charset and compressible flags mime-db records for a type, when known

## Limits

- File extensions are a convention, not something IANA registers; the extension table comes entirely from mime-db, not from IANA
- The bundled table is a snapshot of one pinned mime-db version; a type added to mime-db after that version was pinned is not found here until the dependency is updated
- This tool never inspects file content (magic bytes); it only maps a name or extension to a declared type
- A type with no source recorded by mime-db is shown as such rather than guessed at

## Ambiguous cases, and what this does about them

- mime-db ranks a type's source as IANA, Apache, nginx or unset (undefined); this tool sorts an extension's candidate types by that same order, IANA first, then Apache, then nginx, then unset, then name, so the most authoritative match leads

## Defined by

- [IANA Media Types Registry](https://www.iana.org/assignments/media-types/media-types.xhtml)
- [RFC 6838 — Media Type Specifications and Registration Procedures](https://www.rfc-editor.org/rfc/rfc6838)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/mime-types mime-types
cd mime-types
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/mime-types
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { lookup, typesForExtension, extensionsForType } from '@fodt/mime-types';

lookup('photo.PNG'); // image/png, with its extensions and source
typesForExtension('.md');
extensionsForType('application/json');
```

`lookup` inspects the query for a `/` to decide direction: a string containing one is treated as a media type, otherwise as an extension or filename. `citationFor` turns a mime-db source string into the citation text the page shows, so the page never has to know mime-db's own source vocabulary.

## Dependencies

- `mime-db` 1.54.0

## Tests

```sh
npm test
```

The IANA-registered assertions are checked against five type names hand-transcribed from the fetched IANA application.csv, text.csv and image.csv (json, pdf, png, html, css), matching RFC 6838 section 4.2's case-insensitive type-name rule.

## Licence

MIT. See [LICENSE](./LICENSE).

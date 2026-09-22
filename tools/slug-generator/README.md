# URL Slug Generator

Turn any title into a clean URL slug, with transliteration and length control.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Turns a title into the kind of short, lowercase, hyphenated string that goes in a URL, a filename or a branch name. It handles accents properly by decomposing them, and carries explicit mappings for the letters that do not decompose, so Straße becomes strasse rather than stra or strae.

## Supported

- Accented Latin letters, via Unicode decomposition: café becomes cafe
- Letters that are not a base plus an accent and need a real mapping: ß, æ, ø, đ, ł, þ and others
- Symbols that carry meaning: & becomes and, % becomes percent, @ becomes at
- Non-Latin scripts either dropped, with a report of what went, or kept as they are
- A custom separator, preserved case, stop-word removal, and a length limit that cuts at a word boundary
- Presets for a URL, a filename, a git branch, a heading anchor and snake case
- Making a slug unique against a list of slugs already in use

## Limits

- There is no transliteration for non-Latin scripts. Cyrillic, Greek, Arabic, Hebrew, Chinese, Japanese and Korean are either dropped or kept verbatim. Doing it properly needs per-language romanisation rules, and a single wrong table is worse than none.
- Emoji and symbols with no obvious word are dropped rather than transliterated.
- Keeping non-Latin characters produces a slug that is valid in a modern URL but has to be percent-encoded in some contexts and may not survive an older system.
- Truncating at a word boundary can cut more than you expect when one word is long. If the first word exceeds the limit it is cut mid-word, since there is no alternative.
- A slug is not unique on its own. Uniqueness against your existing content is your database's job; the helper here only takes a list you supply.

## Ambiguous cases, and what this does about them

- Whether & becomes and, or simply disappears, changes the slug. Expansion is on by default because dropping it silently merges two words, and it can be turned off.
- Removing stop words makes a tidier slug and a less faithful one. It is off by default, and never produces an empty slug even when every word in the title is a stop word.

## Defined by

- [RFC 3986 section 2.3, unreserved characters](https://www.rfc-editor.org/rfc/rfc3986#section-2.3)
- [Unicode Standard Annex 15, normalization forms](https://unicode.org/reports/tr15/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/slug-generator slug-generator
cd slug-generator
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/slug-generator
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { slugify, uniqueSlug, PRESETS } from '@fodt/slug-generator';

slugify('Café & Crème!').slug;                     // 'cafe-and-creme'
slugify('Straße').slug;                            // 'strasse'
slugify(title, { maxLength: 60 });                 // cut at a word boundary
slugify(title, PRESETS.branch);
uniqueSlug('post', ['post', 'post-2']);            // 'post-3'
```

`slugify` returns a report, not just a string: `droppedCharacters` lists anything removed for having no Latin equivalent, and `ascii` says whether the result is safe in any URL without encoding.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Covers accented Latin, the letters that do not decompose, precomposed against decomposed input, non-Latin scripts in both policies, symbol expansion, stop words, and truncation at every limit from 5 to 40 with an assertion that no trailing separator survives. Also asserts idempotence, and that path traversal and markup inputs produce nothing dangerous.

## Licence

MIT. See [LICENSE](./LICENSE).

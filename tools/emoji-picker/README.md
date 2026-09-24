# Emoji Picker

Search emoji by name and copy the character, code points or escape.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Searches every fully-qualified emoji from the latest official Unicode emoji-test.txt by name, and hands back the character in the exact form your code or document needs: the raw character, its code points, a JavaScript escape, a UTF-16 escape, or an HTML entity. The data is bundled into this page's own chunk at build time; nothing is fetched when you search.

## Supported

- Searching by every word in an emoji's full published name, such as 'grinning face' or 'waving hand: light skin tone'
- Multi-code-point sequences, such as a flag or a skin-tone or hair variant, with one escape per code point
- Five copyable forms: the character itself, space-separated code points (U+XXXX), a JavaScript code point escape, a UTF-16 escape, and an HTML numeric entity
- Every group and subgroup Unicode organises emoji into (Smileys & Emotion, People & Body, and so on)

## Limits

- Only fully-qualified sequences are bundled (UTS #51 ED-18); a minimally-qualified, unqualified or component-only form is not a separate search result
- Search matches published names only, not keywords, categories or other languages
- Whether an emoji actually renders as a picture, or falls back to separate characters or a missing-glyph box, depends on fonts installed on your device, not on this tool
- The bundled data is a snapshot of one Unicode emoji-test.txt version; a sequence added after that version was fetched is not found here until the bundle is regenerated

## Ambiguous cases, and what this does about them

- A query is split on whitespace into words; every word must appear somewhere in the emoji's name (case-insensitive) for a match, so 'skin tone' and 'tone skin' match the same names

## Defined by

- [UTS #51 — Unicode Emoji](https://www.unicode.org/reports/tr51)

## Bundled data

This folder ships a data file that is not an npm dependency, so it travels with the folder when it is
copied out on its own:

- **Unicode emoji-test.txt 18.0** (Unicode-3.0) — [source](https://www.unicode.org/Public/emoji/latest/emoji-test.txt). "emoji-test.txt", (c) 2026 Unicode, Inc., from the Unicode Character Database and UTS #51, licensed under the Unicode License V3 (https://www.unicode.org/license.txt).

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/emoji-picker emoji-picker
cd emoji-picker
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/emoji-picker
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { searchEmoji, formsOf } from '@fodt/emoji-picker';

const { results } = searchEmoji('grinning face');
formsOf(results[0]); // { character, codePoints, jsEscape, utf16Escape, htmlEntity }
```

`searchEmoji` ranks an exact name match first, then a name-prefix match, then every other match in the file's own (CLDR) order; it never reorders ties beyond that. `formsOf` returns one escape per Unicode code point in `jsEscape` and `htmlEntity`, and one escape per UTF-16 code unit in `utf16Escape`, which differ for any code point above U+FFFF (every emoji above Unicode 1.0 or so).

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The bundled-count assertion is checked against the number in the fetched emoji-test.txt's own 'fully-qualified' footer line, not counted from the bundle itself. Absence of component/minimally-qualified/unqualified forms is checked against code points hand-picked from the same fetched file (263A alone, 1F3FB alone).

## Licence

MIT. See [LICENSE](./LICENSE).

# HTML Entity Encoder & Decoder

Encode and decode HTML entities, including named, decimal and hexadecimal references.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Converts between characters and HTML entity references in both directions, with the full HTML5 named reference set rather than the handful most tools carry. It also lists every reference it finds in your text with the exact code points it decodes to, which is usually what you actually want to know when something renders as mojibake.

## Supported

- All 2231 HTML5 named references, plus decimal and hexadecimal numeric references
- Five encoding strategies: minimal, everything above ASCII, every character that has a name, XML only, and the set that is safe inside a quoted attribute
- Numeric output in decimal or hexadecimal instead of named references
- Characters above U+FFFF, emitted as a single reference rather than a surrogate pair
- Legacy references with no closing semicolon, as HTML5 requires, and a strict mode that rejects them
- The HTML5 replacement mapping for the 0x80 to 0x9F range, so &#128; decodes to the euro sign
- An inspection view listing every reference found, its code points, and anything unrecognised

## Limits

- Encoding here protects markup, not JavaScript, CSS, URLs or SQL. Each of those needs its own escaping, and using HTML escaping for them is a security bug rather than a formatting choice.
- Decoded output can contain a script tag, because that is what decoding means. Never insert decoded text into a page as HTML.
- This escapes text. It does not sanitise markup: it will not strip a dangerous tag, it will make the whole thing inert. If you need to keep some markup and remove the rest, you need a sanitiser.
- A handful of HTML5 named references decode to two code points. They encode back to the characters, not to the original name.

## Ambiguous cases, and what this does about them

- HTML5 matches the longest valid prefix, so &notit; decodes to the not sign followed by the literal text it;. This is correct and surprises nearly everyone, so the inspection view shows what was actually matched.
- &apos; is defined in XML and HTML5 but not in HTML 4. Minimal encoding emits the numeric &#39; instead, which every parser has always understood.
- Codes 0x80 to 0x9F are control characters in Unicode, but HTML5 maps them to the Windows-1252 characters that real documents meant. That mapping is applied, because not applying it turns euro signs into invisible controls.

## Defined by

- [HTML Standard, named character references](https://html.spec.whatwg.org/multipage/named-characters.html)
- [HTML Standard, numeric character reference end state](https://html.spec.whatwg.org/multipage/parsing.html#numeric-character-reference-end-state)
- [XML 1.0, predefined entities](https://www.w3.org/TR/xml/#sec-predefined-ent)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/html-entities html-entities
cd html-entities
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/html-entities
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { encode, decode, inspect } from '@fodt/html-entities';

encode('<a href="x">a & b</a>');            // '&lt;a href=&quot;x&quot;&gt;a &amp; b&lt;/a&gt;'
encode('café', { strategy: 'non-ascii' });   // 'caf&eacute;'
decode('&notit;');                           // '¬it;'
inspect('&amp; &#169;');                     // what each reference is
```

The named reference tables come from the `entities` package, which implements the HTML Standard exactly. This package adds the strategy choices, the numeric output modes and the inspection report on top.

## Dependencies

- `entities` ^8.1.0

## Tests

```sh
npm test
```

Covers the five predefined entities, the ampersand double-encoding trap, all five strategies, numeric output in both bases, astral characters, the HTML5 legacy 0x80 to 0x9F mapping, references without a semicolon, the longest-prefix &notit; case, multi-code-point references, and a round-trip property test across every strategy over a sample including script tags, non-breaking spaces and a 3000 character string.

## Licence

MIT. See [LICENSE](./LICENSE).

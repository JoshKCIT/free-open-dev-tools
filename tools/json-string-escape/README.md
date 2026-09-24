# JSON String Escaper

Escape and unescape JSON string literals exactly as RFC 8259 defines them.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Escapes and unescapes the contents of a JSON string literal exactly as RFC 8259 section 7 defines it, including the two-escape form a character outside the Basic Multilingual Plane requires. This escapes a string's contents, not a whole JSON document -- for that, use the JSON Formatter. Unescaping is a strict reader that names exactly what is wrong and where, rather than guessing at intent.

## Supported

- All eight two-character escapes RFC 8259 defines: \" \\ \/ \b \f \n \r \t
- The four-hex-digit \uXXXX form for any character, including every control character below the space
- The twelve-character surrogate-pair form for a character outside the Basic Multilingual Plane, exactly as RFC 8259's own worked example shows
- An option to escape every character above ASCII, and an option to escape the forward slash, both off by default
- Wrapping the result in double quotes as a complete string literal, and accepting one on the way in
- A lone (unpaired) surrogate escape, which RFC 8259 section 8.2 permits, accepted with a warning naming the missing half and its position
- An optional strict-Unicode setting that rejects a lone surrogate escape instead of warning, for a caller that needs well-formed Unicode

## Limits

- This escapes and unescapes a string's contents only. It does not parse or validate a whole JSON document -- braces, commas and other structural characters are passed straight through unless they happen to need one of the escapes above.
- When the escape-everything-above-ASCII option is on, a character outside the Basic Multilingual Plane takes two \uXXXX escapes, because that is what the twelve-character surrogate-pair representation the format defines requires. With the option off, such a character is emitted raw as itself, which the format also permits.
- The forward slash escape (\/) is accepted on the way in but never required going out; RFC 8259 permits it without requiring it.
- A lone surrogate escape is accepted by default, with a warning, because RFC 8259 section 8.2 permits it even while calling it problematic for interoperability. Turn on the strict-Unicode option to reject it instead.

## Ambiguous cases, and what this does about them

- The forward slash: RFC 8259 section 7 allows escaping it but does not require it. This tool never requires it on the way out and always accepts it on the way in.
- A lone surrogate escape such as \uDEAD (RFC 8259 section 8.2's own example): the grammar this tool's `standards` cites permits it, so by default it is accepted and produces the lone UTF-16 code unit, with a warning naming which half is missing. The optional strict-Unicode setting rejects it instead, for a caller that specifically needs well-formed Unicode rather than merely RFC-grammar-valid text.

## Defined by

- [RFC 8259 — The JavaScript Object Notation (JSON) Data Interchange Format, section 7](https://www.rfc-editor.org/rfc/rfc8259#section-7)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/json-string-escape json-string-escape
cd json-string-escape
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/json-string-escape
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { escapeString, unescapeString } from '@fodt/json-string-escape';

escapeString('a "quote"').value;                 // 'a \\"quote\\"'
escapeString('\uD834\uDD1E', { escapeAboveAscii: true }).value; // '\\uD834\\uDD1E'
unescapeString('\\uD834\\uDD1E').value;           // the G clef character
unescapeString('\\uDEAD').warnings;               // one warning, no error
```

Both functions return `{ value, warnings }` rather than a bare string. `warnings` is a `{ message, position }[]` that is empty in the ordinary case, and carries one entry per lone surrogate escape accepted under the default (non-strict) setting. `escapeString` walks the input by UTF-16 code unit, deliberately, so an out-of-plane character naturally produces its two escapes without decoding to a code point first.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The eight two-character escapes are asserted individually against RFC 8259 section 7's table. The out-of-plane worked example (the G clef character, U+1D11E, escaping to \uD834\uDD1E) is quoted from the RFC and asserted against a real escapeString call in both directions. RFC 8259 section 8.2's own lone-surrogate example (\uDEAD) is used to assert the default-accept-with-warning behaviour and the strict-rejection behaviour, in both directions (high surrogate alone, low surrogate alone).

## Licence

MIT. See [LICENSE](./LICENSE).

# IDN & Punycode Converter

Convert international domain names between Unicode and their ASCII Punycode form, with invalid labels explained.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Converts international domain names between their Unicode form and the ASCII form that DNS carries (Punycode, the xn-- labels), one name per line, using the Unicode UTS #46 rules with Unicode 17 data. Each name that is not valid is explained label by label in plain words, with every offending code point shown as a U+ value. Nothing is looked up: the page only changes how a name is written.

## Supported

- Unicode to ASCII, ASCII to Unicode, or automatic (a name with a non-ASCII character goes to ASCII, a name with an xn-- label goes to Unicode, any other name is shown both ways)
- A strict profile, as for registering a name (hyphen rules, ASCII letters, digits and hyphens only, label and name lengths), and a browser address bar profile with the hyphen, character and length checks switched off
- Mapping and normalisation as UTS #46 defines them, so capitals, full-width letters and the ideographic full stop are read the way a browser reads them, and the Unicode form shown is the mapped and normalised one, not the pasted spelling
- Explanations by the rule families the Unicode conformance data uses: hyphens, bidirectional text, joiners, characters not allowed in a host name, label and name length, characters or xn-- labels that cannot be processed, and empty labels
- Lengths measured in octets of the ASCII form, as UTS #46 says

## Limits

- Input is limited to 100,000 characters and 5,000 lines; each name to 4,096 characters before conversion.
- The mapping data is Unicode 17; names using code points added in Unicode 18 are judged by the Unicode 17 table.
- Conversion does not judge look-alike characters: a name that converts can still imitate another name. Compare the ASCII form and the code points, not the picture.
- Nothing is looked up: this page does not check whether a name is registered, allowed by a registry or resolves.
- Explanations name the rule families the Unicode conformance data uses; some invalid names fail a basic check first, and then only that is named.
- The browser profile applies the UTS #46 settings the URL Standard names for its domain parser, not the URL parser's other steps (such as keeping an all-ASCII name as typed).

## Ambiguous cases, and what this does about them

- The strict and browser profiles give different answers for the same name: a name with hyphens in the third and fourth positions, a space or an underscore, or a label over 63 octets is invalid when strict and converts under the browser profile.
- The page shows the first label that fails each rule family; a name can break more than one rule, and a name whose characters cannot be processed at all is explained by that alone.
- UTS #46 judges bidirectional text on the whole name: a name is a bidirectional name if any of its labels has a right-to-left character, and then every label is held to the bidirectional rules.

## Defined by

- [UTS #46 — Unicode IDNA Compatibility Processing](https://www.unicode.org/reports/tr46/)
- [RFC 3492 — Punycode](https://www.rfc-editor.org/rfc/rfc3492)
- [RFC 5891 — IDNA: Protocol](https://www.rfc-editor.org/rfc/rfc5891)
- [RFC 5893 — Right-to-Left Scripts for IDNA](https://www.rfc-editor.org/rfc/rfc5893)
- [WHATWG URL Standard — domain to ASCII](https://url.spec.whatwg.org/#concept-domain-to-ascii)

## Bundled data

This folder ships a data file that is not an npm dependency, so it travels with the folder when it is
copied out on its own:

- **Unicode IDNA Mapping Table 17.0.0 compiled into tr46 6.0.0** (Unicode-3.0) — [source](https://www.unicode.org/Public/17.0.0/idna/IdnaMappingTable.txt). "IdnaMappingTable.txt", (c) 2025 Unicode, Inc., from the Unicode Character Database and UTS #46, licensed under the Unicode License V3 (https://www.unicode.org/license.txt), compiled into the tr46 package.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/idn-converter idn-converter
cd idn-converter
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/idn-converter
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
TODO
```

TODO

## Dependencies

- `tr46` 6.0.0

## Tests

```sh
npm test
```

TODO

## Licence

MIT. See [LICENSE](./LICENSE).

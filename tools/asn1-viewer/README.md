# ASN.1 Viewer (DER/BER)

Paste PEM, Base64 or hex, or open a file, and read any DER or BER structure as a tree with offsets, tags, lengths, values and named object identifiers.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Paste PEM, Base64 or hex, or open a file, and read the ASN.1 structure inside it as a tree. Every element shows its offset, header length, length (indefinite lengths are shown as such), tag class and number, whether it is constructed, its decoded value and the name of any object identifier it knows, followed by the findings and the notes where valid BER is not DER. Everything is read on this page; nothing is uploaded or kept.

## Supported

- PEM of any label (several blocks and text around them are fine), Base64 and Base64url, and hex with spaces, colons or line breaks; a file may hold any of these as text or the bytes themselves
- Basic Encoding Rules as ITU-T X.690 (02/2021) defines them: definite and indefinite lengths, long tag numbers, constructed strings, and every universal type from BOOLEAN to BMPString with INTEGER, OBJECT IDENTIFIER, REAL and the time types decoded
- Notes for valid BER that Distinguished Encoding Rules do not allow: an indefinite length, a longer length or INTEGER than needed, a BOOLEAN other than 00 or FF, unused bits that are not zero, a constructed string, an unsorted SET OF, time forms, extra bytes and more than one top-level element, each naming its X.690 clause
- Object identifier names for X.509, PKCS, CMS, OCSP and time-stamping structures from a fixed built-in list, shown beside the dotted digits
- The contents of an OCTET STRING or BIT STRING are shown as a further tree, marked as a guess, only when they read completely as ASN.1

## Limits

- The page shows structure and values only. It does not know what the data means, so it never checks a certificate, a signature or a key, and it cannot say whether a structure is right for its purpose. A private key pasted here is shown on screen in full and is not sent anywhere.
- Context-specific tags are shown as [n] with their class and whether they are constructed, because only the schema says whether they are explicit or implicit. The contents of an OCTET STRING or BIT STRING are shown as ASN.1 only when they read completely, and the label says that is a guess.
- A paste over 5 MiB or a file over 10 MiB is refused before it is read. Nesting deeper than 40 levels is not entered, and reading stops at 100,000 elements; each cut says how much was left out. The tree draws at most 5,000 elements and Copy gives every element that was read.
- Object identifier names come from a fixed built-in list; one that is not in it is shown as dotted digits only.
- Valid BER that is not DER (an indefinite length, a padded length or integer, an unsorted set) is shown with a note and never as an error. At most 200 findings and notes are listed and the rest are counted. Reading stops at the first structure it cannot follow, such as a length that runs past the end of the data, and says where.

## Ambiguous cases, and what this does about them

- A text paste made only of hex digits (an even number of them, with spaces or colons) is read as hex before Base64, so a Base64 string of digits alone needs the input form set to Base64.
- A file that holds only printable text is read as text (PEM, Base64 or hex), and any other file is read as the bytes of the structure.
- Several PEM blocks are joined in the order they appear and read as one run of top-level elements, so offsets count from the start of the first block's bytes.

## Defined by

- [ITU-T X.690 (02/2021) ASN.1 encoding rules: BER, CER and DER](https://www.itu.int/rec/T-REC-X.690-202102-I/en)
- [RFC 7468 Textual encodings of PKIX, PKCS and CMS structures (PEM)](https://www.rfc-editor.org/rfc/rfc7468)
- [RFC 5652 Cryptographic Message Syntax](https://www.rfc-editor.org/rfc/rfc5652)
- [RFC 8018 PKCS #5 password-based cryptography](https://www.rfc-editor.org/rfc/rfc8018)
- [RFC 2985 PKCS #9 selected object classes and attribute types](https://www.rfc-editor.org/rfc/rfc2985)
- [RFC 7292 PKCS #12 personal information exchange syntax](https://www.rfc-editor.org/rfc/rfc7292)
- [RFC 6960 Online Certificate Status Protocol](https://www.rfc-editor.org/rfc/rfc6960)
- [RFC 3161 Time-Stamp Protocol](https://www.rfc-editor.org/rfc/rfc3161)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/asn1-viewer asn1-viewer
cd asn1-viewer
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/asn1-viewer
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { describeStructure } from '@fodt/asn1-viewer';

const result = describeStructure({
  data: '3003020105', // PEM, Base64 or hex text, or the bytes of a file
  format: 'auto', // or 'pem', 'base64', 'hex'
  tryInside: true, // look inside OCTET STRING and BIT STRING contents
});

result.nodes[0].tag; // 16, a SEQUENCE
result.nodes[1].offset; // 2, the INTEGER inside it
result.findings; // what could not be read, and the notes where valid BER is not DER
result.copyText; // the whole tree as indented text
```

`describeStructure(input)` reads the text or bytes (`readInput`), reads the elements with an iterative BER reader (`readBer`) that follows definite and indefinite lengths with an explicit stack, describes each value (`describeValue`), adds the DER notes (`derNotes`), optionally looks inside OCTET STRING and BIT STRING contents (`tryInside`) and builds the tree (`toTree`) and the flat rows (`toFlatRows`). Faults in the structure are findings, never thrown; a paste or file over its size limit, text that is not PEM, Base64 or hex, and an input with no bytes are refused with an `Asn1Error` that names the position and never repeats the input. The functions hold no state between calls, so the same bytes give the same result however many times they are read.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Expected values come from the specification and from recorded second opinions. The worked examples of ITU-T X.690 (02/2021) clause 8 and the personnel record of annex A.3 are retyped with their clause in the test title. OpenSSL 3.5.5 asn1parse was run on certificates, keys, requests, CMS with definite and indefinite lengths, OCSP and time-stamp structures and a PKCS #12 file built for the tests, and the reader equals it on offset, depth, header length, length and form on every line. The 484 ECDSA signature vectors of Project Wycheproof (Apache-2.0, reduced to tcId, comment, flags and sig) never throw, and the valid ones give no finding, all 7 BER ones are flagged as not DER, and 84 of the 92 invalid encodings are flagged (the 8 others are well-formed DER of the wrong shape and are listed by tcId). REAL values equal what pyasn1 0.6.4 recorded. Every extra object identifier name matches OpenSSL's own name for it. Caps, hostile nesting, 20,000 seeded mutations and linear time on doubled input are tested.

## Licence

MIT. See [LICENSE](./LICENSE).

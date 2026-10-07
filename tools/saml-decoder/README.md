# SAML Message Decoder

Decode a SAML request or response from a redirect link, form post or raw XML into formatted XML and a summary, without verifying anything.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Paste a SAML 2.0 request or response as an HTTP-Redirect address or query string, an HTTP-POST form or value, or raw XML, and read which binding was recognised, what was done to the text, the message as formatted XML and a summary of its issuer, destination, ID and type. Everything is decoded on this device with the DEFLATE and Base64 layers undone in the page. Nothing is verified: no signature, certificate or metadata is checked, and no address in the message is requested.

## Supported

- An HTTP-Redirect message: a whole address or a bare query string holding SAMLRequest or SAMLResponse, URL-encoded, Base64 of a raw DEFLATE stream (RFC 1951, Bindings section 3.4.4.1), with RelayState, SigAlg and Signature read from the same address
- Message types AuthnRequest, Response, LogoutRequest and LogoutResponse of SAML 2.0: ID, Version, IssueInstant, Issuer, Destination and InResponseTo

## Limits

- Everything is decoded on this device. No address in the message is requested, and no metadata is fetched.
- The page does not verify signatures, check certificates or decrypt anything. Never accept a message because this page shows it as decoded.
- Time checks use this device's clock, or the time you enter, and allow no clock skew.
- A message that holds a DOCTYPE or an entity declaration is refused. A message over 2 MiB once decompressed, with more than 50,000 tags or nested deeper than 64 levels is refused before the XML is read.

## Ambiguous cases, and what this does about them

- The Bindings document prints the example SigAlg as http://www.w3.org/200/09/xmldsig#rsa-sha1 (200 for 2000); the page shows it exactly as written and says it is not an algorithm address it knows.

## Defined by

- [Bindings for the OASIS Security Assertion Markup Language (SAML) V2.0, OASIS Standard, 15 March 2005](https://docs.oasis-open.org/security/saml/v2.0/saml-bindings-2.0-os.pdf)
- [Assertions and Protocols for the OASIS Security Assertion Markup Language (SAML) V2.0, OASIS Standard, 15 March 2005](https://docs.oasis-open.org/security/saml/v2.0/saml-core-2.0-os.pdf)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/saml-decoder saml-decoder
cd saml-decoder
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/saml-decoder
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { decodeSaml } from '@fodt/saml-decoder';

// The OASIS Bindings 2.0 section 3.4.8 logout request address, read at a time the caller names
const report = decodeSaml(address, { now: Date.UTC(2004, 0, 21, 19, 5, 0) });
report.binding; // 'HTTP-Redirect'
report.summary.pairs; // [['Message', 'LogoutRequest'], ['ID', 'd2b7c388cec36fa7c39c28fd298644a8'], ...]
```

`decodeSaml(text, { now })` runs read input, Base64, inflate, text decoding, the DOCTYPE and entity refusal, the tag and depth pre-scan, parsing and the summary, each step once and in that order, and returns the binding, the steps taken, warnings, the summary and the formatted XML. A refusal is a `SamlDecoderError` whose message names the part and a position and never holds typed text. The package keeps no state between calls, makes no request and prints nothing.

## Dependencies

- `fflate` 0.8.3
- `@xmldom/xmldom` 0.9.12

## Tests

```sh
npm test
```

Expected values come from the OASIS SAML 2.0 Bindings examples: the logout request redirect address of section 3.4.8 is retyped under the OASIS notice and decoded in a test, with Node zlib inflateRawSync as the second opinion on the DEFLATE layer.

## Licence

MIT. See [LICENSE](./LICENSE).

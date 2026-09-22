# JWT Decoder

Decode the header and payload of a JSON Web Token. Decoding is not verification.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Takes a JSON Web Token apart and shows what it claims, with every registered claim explained and every timestamp rendered as a readable date. It deliberately does not check the signature, because that is a different job needing a key, and blurring the two is how people end up trusting a token anyone could have written. The signer and verifier tool does that half.

## Supported

- Three-segment JWS tokens: header, payload and signature
- Five-segment JWE tokens, where the header is shown and the payload is correctly reported as unreadable without the key
- Every claim in the IANA JSON Web Token Claims registry, with a plain description of what it means
- Timestamps rendered as an ISO date plus how long ago or how far ahead they are
- Warnings for an expired token, a not-yet-valid token, a missing expiry, and an alg of none
- Detection of timestamps given in milliseconds instead of seconds, which is the most common JWT bug
- Tokens pasted with a Bearer prefix or surrounding whitespace
- The exact signing input, so you can check a signature in another tool

## Limits

- This does not verify the signature. A token shown here may be expired, forged, or edited by anyone who had it. Use the JWT signer and verifier for that.
- A JWE payload is encrypted. Only its header can be read, and no amount of decoding will reveal the contents without the decryption key.
- Claims are shown as the token states them. Whether an issuer, audience or scope is one you should accept is a policy question this tool cannot answer.
- Relative times are computed against your device clock. If that clock is wrong, the expiry warnings will be wrong too.

## Ambiguous cases, and what this does about them

- Decoding and verifying are routinely conflated, including by tools that show a green tick next to a token whose signature they never checked. This tool is deliberately split in two, and every decode repeats the warning.
- RFC 7519 section 2 defines NumericDate as seconds since the Unix epoch, but passing a JavaScript millisecond timestamp is such a common mistake that it is detected and called out specifically.

## Defined by

- [RFC 7519 — JSON Web Token (JWT)](https://www.rfc-editor.org/rfc/rfc7519)
- [RFC 7515 — JSON Web Signature (JWS)](https://www.rfc-editor.org/rfc/rfc7515)
- [RFC 7516 — JSON Web Encryption (JWE)](https://www.rfc-editor.org/rfc/rfc7516)
- [IANA JSON Web Token Claims registry](https://www.iana.org/assignments/jwt/jwt.xhtml)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/jwt-decoder jwt-decoder
cd jwt-decoder
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/jwt-decoder
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { decodeJwt } from '@fodt/jwt-decoder';

const decoded = decodeJwt(token);
decoded.header;        // { alg: 'HS256', typ: 'JWT' }
decoded.payload;       // the claims as an object
decoded.claims;        // rows with descriptions and readable times
decoded.warnings;      // expiry, alg none, millisecond timestamps
decoded.signingInput;  // exactly what a verifier signs
```

`decodeJwt` never throws: malformed input comes back in `errors` with an explanation. Pass `{ now }` to make expiry checks deterministic, which is what the tests do.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The worked example token from RFC 7519 section 3.1 is decoded and every field asserted, including its URI-named custom claim and its 32 byte HS256 signature. Beyond that: alg none in both cases, expired and not-yet-valid tokens, missing expiry, millisecond timestamps, JWE recognition, non-Base64url segments, segments that decode to something other than a JSON object, and a set of deliberately malformed inputs asserted never to throw.

## Licence

MIT. See [LICENSE](./LICENSE).

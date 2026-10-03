# TOTP & HOTP Code Generator

Make the current and next one-time 2FA codes from a Base32 secret, with the otpauth link and QR code for an app.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Turns a Base32 secret, the kind an authenticator app is given when you turn on two-factor sign-in, into the six, seven or eight digit one-time codes of RFC 4226 and RFC 6238. The codes are computed in the page from the secret you type, with HMAC from the audited @noble/hashes library over SHA-1, SHA-256 or SHA-512; the time comes from this device's clock or from a value you type, so the published test values can be reproduced exactly. The secret is never sent, stored or logged.

## Supported

- A Base32 secret as RFC 4648 section 6 writes it, in upper or lower case, with spaces and hyphens between groups and with or without the = padding, of up to 1,024 characters; the characters 0, 1, 8 and 9 and any other character are refused with the position of the first one and never the character itself
- Time based codes (TOTP, RFC 6238) with HMAC-SHA-1, HMAC-SHA-256 or HMAC-SHA-512, 6, 7 or 8 digits, and a period of 1 to 86,400 seconds (30 is the usual one), counted from 1970-01-01 00:00:00 UTC
- The previous, current, next and following step for the moment of the run, each with the time it starts and the last second it is valid, in UTC, and the seconds that were left in the current step at that moment
- An At this time value as whole Unix seconds (0 to 253402300799) or an ISO 8601 date written YYYY-MM-DD or YYYY-MM-DDTHH:MM with optional :SS, an optional fraction and a Z or +HH:MM offset (read as UTC when no offset is written); left empty, this device's clock is read once for each run

## Limits

- The page uses this device's clock or the time you type, and never fetches network time.
- The page does not refresh by itself: it shows the codes for the moment you last changed a field (the previous, current, next and following step) and the seconds that were left then; edit any field for fresh codes.
- Secrets of up to 1,024 Base32 characters are read; a longer secret is refused.
- A secret shorter than 128 bits is shown with a warning, because RFC 4226 requires at least 128 bits.
- Times from 1970-01-01 to 9999-12-31 are read, and a period must be a whole number of seconds from 1 to 86,400.

## Ambiguous cases, and what this does about them

- A time typed without Z or an offset is read as UTC, not as this device's local time, so the same text gives the same codes everywhere
- RFC 4648 lets a decoder reject the unused bits after the last whole byte; this page does not check them, so a secret whose last character carries stray bits is still read
- 7 digits is allowed by RFC 4226 (6 or more) but many authenticator apps accept only 6 or 8
- The RFC 6238 test table uses the 20 byte secret with SHA-1, a 32 byte secret with SHA-256 and a 64 byte secret with SHA-512, so SHA-256 and SHA-512 codes made from the 20 byte secret differ from the table

## Defined by

- [RFC 4226: HOTP: An HMAC-Based One-Time Password Algorithm](https://www.rfc-editor.org/rfc/rfc4226)
- [RFC 6238: TOTP: Time-Based One-Time Password Algorithm](https://www.rfc-editor.org/rfc/rfc6238)
- [RFC 4648: The Base16, Base32, and Base64 Data Encodings](https://www.rfc-editor.org/rfc/rfc4648)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/totp-generator totp-generator
cd totp-generator
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/totp-generator
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { computeCodes, encodeBase32, parseTimeInput } from '@fodt/totp-generator';

// The RFC 6238 test seed is the ASCII text 12345678901234567890; an app is given it as Base32.
const seed = encodeBase32(new TextEncoder().encode('12345678901234567890'));

// The clock is read by the caller and passed in as whole seconds; the package never reads it.
const result = computeCodes({
  mode: 'totp',
  secret: seed,
  algorithm: 'SHA1',
  digits: 8,
  period: 30,
  seconds: parseTimeInput('59'),
});
result.window[1].code;   // '94287082' (the RFC 6238 value for time 59)
result.secondsLeft;      // 1
```

`computeCodes(options)` takes `{ mode, secret, algorithm, digits, period, counter, seconds }`: `secret` is the Base32 text, `seconds` the whole Unix seconds the caller read from its clock (or from `parseTimeInput`), and `period` and `counter` are read only for the mode that uses them. It returns the window of steps (`label`, `step`, `code`, `startSeconds`, `endSeconds`), `secondsLeft`, `warnings` and `notes`. The lower level `hotp(secret, counter, digits, algorithm)`, `totpStep`, `totpWindow` and `secondsLeft` work on bytes, `decodeBase32` and `encodeBase32` convert the secret, and `parseTimeInput` reads a typed time with bounded character checks, never a lenient date parser. Counters are `bigint` and written as 8 big-endian bytes. Every failure is a `TotpError`, `Base32Error` or `TimeError` whose message is a plain sentence that names a position or a range and never any part of the secret. The package never reads the clock, so no call depends on when it runs.

## Dependencies

- `@noble/hashes` 2.4.0

## Tests

```sh
npm test
```

RFC 4226 Appendix D gives the ten HOTP values for the 20 byte test secret, and RFC 6238 Appendix B the eighteen TOTP values for SHA-1 with that secret, SHA-256 with the 32 byte secret and SHA-512 with the 64 byte secret that the RFC's own reference code uses. RFC 4648 section 10 gives the Base32 vectors. Step boundaries are tested at the last second of a step and the first second of the next, and the period and counter limits at their edges.

## Licence

MIT. See [LICENSE](./LICENSE).

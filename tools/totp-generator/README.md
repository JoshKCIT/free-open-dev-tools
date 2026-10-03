# TOTP & HOTP Code Generator

Make the current and next one-time 2FA codes from a Base32 secret, with the otpauth link and QR code for an app.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Turns a Base32 secret, the kind an authenticator app is given when you turn on two-factor sign-in, into the six, seven or eight digit one-time codes of RFC 4226 and RFC 6238, and into the otpauth link and the QR code an app reads. The codes are computed in the page from the secret you type, with HMAC from the audited @noble/hashes library over SHA-1, SHA-256 or SHA-512, and the QR code is drawn in the page from the link; the time comes from this device's clock or from a value you type, so the published test values can be reproduced exactly. The secret, the link and the picture are never sent, stored, logged or offered as a file.

## Supported

- A Base32 secret as RFC 4648 section 6 writes it, in upper or lower case, with spaces and hyphens between groups and with or without the = padding, of up to 1,024 characters; the characters 0, 1, 8 and 9 and any other character are refused with the position of the first one and never the character itself, and text that looks like hexadecimal or Base64 is called that
- Time based codes (TOTP, RFC 6238) with HMAC-SHA-1, HMAC-SHA-256 or HMAC-SHA-512, 6, 7 or 8 digits, and a period of 1 to 86,400 seconds (30 is the usual one), counted from 1970-01-01 00:00:00 UTC
- The previous, current, next and following step for the moment of the run, each with the time it starts and the last second it is valid in UTC and in this device's time, the seconds that were left in the current step at that moment, and a countdown bar made of style only that drains over those seconds
- An At this time value as whole Unix seconds (0 to 253402300799) or an ISO 8601 date written YYYY-MM-DD or YYYY-MM-DDTHH:MM with optional :SS, an optional fraction and a Z or +HH:MM offset (read as UTC when no offset is written); left empty, this device's clock is read once for each run
- Counter based codes (HOTP, RFC 4226): the codes for a counter from 0 to 9007199254740991 and the four after it, written as an 8 byte counter
- The otpauth link of the Key Uri Format and a QR code of it, when an account name is given, with an issuer, the algorithm, digits, period or counter written into it when they are not the defaults; notes for a secret under 128 bits, for 7 digits and for settings some apps ignore

## Limits

- The page uses this device's clock or the time you type, and never fetches network time.
- The page does not refresh by itself: it shows the codes for the moment you last changed a field (the previous, current, next and following step) and the seconds that were left then; edit any field for fresh codes.
- Secrets of up to 1,024 Base32 characters are read; a longer secret is refused.
- A secret shorter than 128 bits is shown with a warning, because RFC 4226 requires at least 128 bits.
- Times from 1970-01-01 to 9999-12-31 are read (near the end of that range a step that would start after 9999-12-31 is left out of the codes, and the last step is shown as ending at 23:59:59), a period must be a whole number of seconds from 1 to 86,400, and a counter a whole number from 0 to 9,007,199,254,740,991.
- QR codes are drawn in this page from the link; nothing is fetched. The link and the QR code are made only when an account name is given, the issuer and the account name are each limited to 256 characters, and nothing is offered as a download.
- SHA-1, 6 digits and a 30-second period work in every authenticator app; other settings are written into the link but some apps ignore them and show wrong codes, so check the codes in the app against the ones shown here.
- The page does not know which counter an app has reached; it lists the five counters you ask for.

## Ambiguous cases, and what this does about them

- A time typed without Z or an offset is read as UTC, not as this device's local time, so the same text gives the same codes everywhere
- RFC 4648 lets a decoder reject the unused bits after the last whole byte; this page does not check them, so a secret whose last character carries stray bits is still read
- 7 digits is allowed by RFC 4226 (6 or more) but many authenticator apps accept only 6 or 8
- The RFC 6238 test table uses the 20 byte secret with SHA-1, a 32 byte secret with SHA-256 and a 64 byte secret with SHA-512, so SHA-256 and SHA-512 codes made from the 20 byte secret differ from the table
- In the link, a space is written %20 and a slash %2F, and the characters ! ' ( ) * are written as percent forms, so the link can be longer than the shortest form other generators write; apps decode every form to the same names
- The countdown bar and the seconds left are those of the moment the codes were made: an app's own bar keeps moving after that

## Defined by

- [RFC 4226: HOTP: An HMAC-Based One-Time Password Algorithm](https://www.rfc-editor.org/rfc/rfc4226)
- [RFC 6238: TOTP: Time-Based One-Time Password Algorithm](https://www.rfc-editor.org/rfc/rfc6238)
- [RFC 4648: The Base16, Base32, and Base64 Data Encodings](https://www.rfc-editor.org/rfc/rfc4648)
- [Key Uri Format: the otpauth link an authenticator app reads](https://github.com/google/google-authenticator/wiki/Key-Uri-Format)

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
import { computeCodes, encodeBase32, parseTimeInput, qrSvg } from '@fodt/totp-generator';

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
  issuer: 'Example',
  account: 'alice@example.com',
});
result.window[1].code;   // '94287082' (the RFC 6238 value for time 59)
result.secondsLeft;      // 1
result.uri;              // 'otpauth://totp/Example:alice%40example.com?secret=...&issuer=Example&digits=8'
qrSvg(result.uri!);      // the QR code of the link as SVG text
```

`computeCodes(options)` takes `{ mode, secret, algorithm, digits, period, seconds, counter, issuer, account }`: `secret` is the Base32 text, `seconds` the whole Unix seconds the caller read from its clock (or from `parseTimeInput`), and `period` and `seconds` are read only in TOTP mode and `counter` only in HOTP mode. It returns `window` (TOTP: `label`, `step`, `code`, `startSeconds`, `endSeconds`), `counters` (HOTP: `counter` as a `bigint` and `code`), `secondsLeft`, `secretBits`, `warnings`, `notes` and, when an account name was given, `uri`. The lower level `hotp(secret, counter, digits, algorithm)`, `totpStep`, `totpWindow` and `secondsLeft` work on bytes, `decodeBase32` and `encodeBase32` convert the secret, `otpauthUri` writes a link, `qrSvg(link)` draws its QR code as SVG text with the qrcode package's matrix and a small writer of its own (src/svg.ts), `countdownHtml(secondsLeft, period)` returns a style-only countdown bar built from two checked numbers, and `parseTimeInput` reads a typed time with bounded character checks, never a lenient date parser. Counters are `bigint` and written as 8 big-endian bytes. Every failure is a `TotpError`, `Base32Error` or `TimeError` whose message is a plain sentence that names a position or a range and never any part of the secret or the link. The package never reads the clock, so no call depends on when it runs.

## Dependencies

- `@noble/hashes` 2.4.0
- `qrcode` 1.5.4

## Tests

```sh
npm test
```

RFC 4226 Appendix D gives the ten HOTP values for the 20 byte test secret, and RFC 6238 Appendix B the eighteen TOTP values for SHA-1 with that secret, SHA-256 with the 32 byte secret and SHA-512 with the 64 byte secret that the RFC's own reference code uses. RFC 4648 section 10 gives the Base32 vectors. pyotp 2.10.0, an independent implementation, recorded 60 random TOTP cases (all three algorithms, 6, 7 and 8 digits, periods 15, 30 and 60, secrets of 10 to 49 bytes, times to 4,000,000,000), 20 HOTP cases with counters past 32, 53 and 63 bits and four otpauth links (plain, an issuer with a space, a colon and reserved characters, HOTP with a counter, and non-ASCII with SHA-512) that are reproduced byte for byte; 200 more HOTP values are checked against an HMAC built with Node's own crypto. Each link is drawn as a QR code, rasterised and read back with jsQR, and svg.ts is checked to be a byte copy of the QR generator's file. Step boundaries are tested at the last second of a step and the first of the next, and the period, counter, time and length limits at their edges.

## Licence

MIT. See [LICENSE](./LICENSE).

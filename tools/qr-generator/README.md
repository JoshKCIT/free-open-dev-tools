# QR Code Generator

Generate QR codes for text, URLs, WiFi, vCard, email and SMS payloads.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Builds an ISO/IEC 18004 QR code for plain text, a URL, a WiFi network, a vCard contact, an email or an SMS message, shows the exact text it encodes, and offers the result as an SVG or a PNG. The bitmap comes from the qrcode package; the payload text for every non-text, non-URL kind is built here against each scheme's own cited specification, never delegated to the encoder.

## Supported

- Text and URL payloads, encoded exactly as typed
- WiFi network payloads (the WIFI: convention) with WPA, WEP or no password, and a hidden-network flag
- vCard 3.0 and 4.0 contact payloads with name, organisation, title, phone, email, website, address and a note, correctly escaped and line-folded
- Email payloads (a mailto: URI) with subject, body and CC, percent-encoded per RFC 6068
- SMS payloads as either an sms: URI (RFC 5724) or the older SMSTO: convention
- Error correction levels L, M, Q and H, an adjustable scale and quiet zone margin, and custom dark/light colours
- SVG and PNG output, both written by this package with no browser canvas and no image library

## Limits

- WiFi and SMSTO payloads are conventions widely read by phone scanner apps, not standards -- no RFC defines them.
- Text is encoded in QR byte mode as UTF-8 with no ECI marker, which almost every modern phone scanner reads correctly, but a strict reader may show it as Latin-1.
- QR Kanji mode is never used; Kanji text is instead encoded as UTF-8 bytes, which costs more capacity per character.
- Whether a phone actually opens a WiFi network, a contact card or a message from the decoded payload depends on that phone's own scanner app, not on this tool.
- A payload longer than a version 40 symbol can hold at the chosen error correction level is refused rather than silently truncated.
- Low contrast between the dark and light colours, or a quiet zone narrower than four modules, can make a code harder for a scanner to read even though it is generated correctly.

## Ambiguous cases, and what this does about them

- vCard 3.0 (RFC 2426) states line folding at 75 characters while vCard 4.0 (RFC 6350) states 75 octets; this tool applies the octet-safe rule (never splitting a UTF-8 character) to both versions rather than counting characters for 3.0, which is a stricter, safer choice than the letter of RFC 2426 but never produces a line RFC 2426 would call too long.
- The SMSTO: convention has no normative specification this tool's research found; its message component is written as plain text after the second colon (not percent-encoded), matching the form widely observed in the wild rather than a documented grammar.
- The Wi-Fi Alliance's own WPA3 QR code specification text was not reachable without an account during this tool's research, so the WIFI: payload offers only WPA, WEP and no-password (the ZXing/Android convention's own documented values), not a WPA3-specific SAE keyword.

## Defined by

- [ISO/IEC 18004:2015 — Automatic identification and data capture techniques — QR Code bar code symbology specification](https://www.iso.org/standard/62021.html)
- [RFC 6350 — vCard Format Specification (version 4.0)](https://www.rfc-editor.org/rfc/rfc6350)
- [RFC 2426 — vCard MIME Directory Profile (version 3.0)](https://www.rfc-editor.org/rfc/rfc2426)
- [RFC 6068 — The 'mailto' URI Scheme](https://www.rfc-editor.org/rfc/rfc6068)
- [RFC 5724 — URI Scheme for Global System for Mobile Communications (GSM) Short Message Service (SMS)](https://www.rfc-editor.org/rfc/rfc5724)
- [W3C PNG (Third Edition) — Portable Network Graphics Specification](https://www.w3.org/TR/png/)
- [RFC 1950 — ZLIB Compressed Data Format Specification](https://www.rfc-editor.org/rfc/rfc1950)
- [RFC 1951 — DEFLATE Compressed Data Format Specification](https://www.rfc-editor.org/rfc/rfc1951)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/qr-generator qr-generator
cd qr-generator
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/qr-generator
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { generateQr, buildPayload, matrixToSvg, matrixToPng } from '@fodt/qr-generator';

const { payload } = buildPayload('url', { url: 'https://example.invalid/' });
const qr = generateQr({ payload, level: 'M' });
const { output: svg } = matrixToSvg(qr, { scale: 8 });
```

buildPayload and generateQr are separate steps on purpose: buildPayload turns the visitor's fields into the exact text a QR code will encode (and is what the page shows as 'Encoded text'), and generateQr only ever sees that already-built string -- it has no per-kind knowledge at all. matrixToSvg and matrixToPng both take the same { size, modules } matrix shape and the same colour/scale/margin options, so either can render any generateQr result.

## Dependencies

- `qrcode` 1.5.4

## Tests

```sh
npm test
```

ISO/IEC 18004 is not freely published; its format information table, capacity table and quiet zone rule are taken from a fetched public reproduction (Thonky's QR Code Tutorial) and from Denso Wave's own published QR code pages, quoted in test and source comments, not from the paywalled standard text itself. The vCard, mailto and SMS RFCs were fetched from www.rfc-editor.org and quoted directly. jsQR and the ZXing library decode every generated code back to its payload in tests only; neither ships to visitors.

## Licence

MIT. See [LICENSE](./LICENSE).

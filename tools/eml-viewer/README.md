# Email Message Viewer & Header Analyzer

Open a saved email to read its headers, delivery hops, MIME parts, attachments and a closed preview of its HTML, with nothing loaded or sent.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Open a saved email (an .eml file) or paste a message and read it without sending it anywhere: every header with its RFC 2047 encoded words and RFC 2231 parameters decoded, the MIME structure as a tree, the plain text body, every attachment with its cleaned name, type, size and SHA-256, and the HTML body in a fully closed preview where remote images, styles and links do nothing. Nothing is verified, nothing the message names is loaded or opened, and nothing leaves your browser.

## Supported

- A saved message from a file (.eml or any text file of the RFC 5322 form, up to 25 MiB) or pasted text (up to 5 MiB of characters), with CRLF, LF or CR line ends, a leading mbox From line (noted) and a block of headers with no body
- Headers in message order with repeats kept, folded lines unfolded, RFC 2047 encoded words (B and Q, with the language suffix) decoded and adjacent words joined without the white space between them, and the raw text shown beside a decoded value when they differ
- MIME parts per RFC 2045 to 2049: nested multipart (mixed, alternative, related, digest with its message/rfc822 default), nested message/rfc822, boundaries read as whole lines only, transport padding, a preamble and epilogue, a missing closing boundary tolerated and said, Base64 (lenient), quoted-printable and 7bit, 8bit and binary bodies
- Content-Type and Content-Disposition parameters per RFC 2231: continuations (name*0, name*1), character set and language values (name*=us-ascii'en'...) and the two combined, with a gap, a leading zero or more than 100 sections shown raw
- Character sets read with the browser's decoder (UTF-8, windows-1252, ISO-8859-2, GB18030, EUC-KR and the other WHATWG labels); a set it does not know, such as UTF-7, is shown as escaped bytes with the label named
- Attachments named from filename*, then filename, then name, cleaned of paths, control and direction characters, device names and reserved characters, with repeats numbered, each listed with its SHA-256 and saved only when you press Save, always as application/octet-stream
- The HTML body in a closed frame: every remote reference (images, srcset, poster, background, object data, ping, link and base addresses, style url and import, meta refresh) is listed as text and removed, a small PNG, JPEG, GIF or WebP part named by a cid address is shown inline, and every link is listed as text and made inert

## Limits

- Everything is read and shown on this device. Nothing is sent, and no remote image, link, font or style sheet in the message is loaded: the page lists what it blocked and shows links as text. Style blocks in an HTML body are dropped; inline styles are kept without their remote addresses.
- Nothing is verified: no signature, SPF, DKIM, DMARC or ARC result is checked, because that would need DNS or fetched keys. Signed and encrypted content (S/MIME, PGP) is shown as structure only, an Outlook .msg file is not read, and winmail.dat appears as an attachment.
- Attachments are never opened or previewed. They are saved only when you press Save, under a cleaned name, and a saved file can still be harmful when you open it. Only the first 200 attachments get a Save button; the rest are listed in the table.
- A message over 25 MiB is refused before it is read. Nesting deeper than 16 parts, more than 1,000 parts, more than 2,000 headers, a header over 64 KiB or more than 200 encoded words in one header stops the reading at that point and says so, keeping what was read.
- An HTML body over 1 MiB, with more than 20,000 tags or nested deeper than 200 levels is shown as text, not rendered. A cid image is shown only when its part is a PNG, JPEG, GIF or WebP identified by its first bytes (never SVG), at most 1 MiB, and 5 MiB for all of them.
- Character sets are read with the browser's decoder; the labels us-ascii and iso-8859-1 are read as windows-1252, as browsers do. A plain text body is shown up to 256 KiB. The body is shown as it is encoded: a format=flowed body is not re-flowed.

## Ambiguous cases, and what this does about them

- The label us-ascii and the label iso-8859-1 name windows-1252 in the WHATWG Encoding Standard, so a byte from 0x80 to 0x9F reads as the windows-1252 character a browser would show, where RFC 2045 would call it invalid.
- RFC 2231 says neither leading zeros nor gaps are allowed in a continuation count. A parameter with either is not joined: its pieces are shown raw, so nothing is guessed.
- A message that names the same attachment twice, or an attachment name that cleans to an existing name, gets a number before its extension (report.txt, report (2).txt) so every Save button writes a different file.
- A part with no Content-Type is plain text in US-ASCII (RFC 2045), except inside a multipart/digest, where it is a message (RFC 2046).

## Defined by

- [RFC 5322: Internet Message Format](https://www.rfc-editor.org/rfc/rfc5322)
- [RFC 2045: MIME Part One, Format of Internet Message Bodies](https://www.rfc-editor.org/rfc/rfc2045)
- [RFC 2046: MIME Part Two, Media Types](https://www.rfc-editor.org/rfc/rfc2046)
- [RFC 2047: MIME Part Three, Message Header Extensions for Non-ASCII Text](https://www.rfc-editor.org/rfc/rfc2047)
- [RFC 2049: MIME Part Five, Conformance Criteria and Examples](https://www.rfc-editor.org/rfc/rfc2049)
- [RFC 2231: MIME Parameter Value and Encoded Word Extensions](https://www.rfc-editor.org/rfc/rfc2231)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/eml-viewer eml-viewer
cd eml-viewer
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/eml-viewer
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { analyzeMessage, previewHtml } from '@fodt/eml-viewer';

// A saved message as bytes
const analysis = await analyzeMessage(bytes);
analysis.headers[0]?.value; // the first header, encoded words decoded
analysis.attachments[0]?.name; // the cleaned name
analysis.attachments[0]?.sha256; // SHA-256 of the decoded bytes, as hex

// The HTML body, neutralised, with a browser window (or a jsdom one) passed in
if (analysis.htmlBody !== null) {
  const preview = previewHtml(analysis.htmlBody, window, analysis.cidParts);
  preview.status === 'shown' && preview.html; // markup that loads nothing and navigates nowhere
  preview.blocked; // every remote reference that was removed, as text
}
```

`analyzeMessage(bytes)` returns the summary pairs, the headers (decoded, with the raw text), the MIME tree, the plain text body, the HTML body text, the Content-ID parts a cid address can name, the attachments (cleaned name, raw name, declared type, size, SHA-256, bytes) and the notes. A refusal is an `EmlViewerError` with a fixed sentence that names the part and never holds message text. `previewHtml(html, window, cidParts)` runs the size, tag and depth pre-scan before any DOM call, records every remote reference from an inert parse, rewrites cid images to data addresses, runs the sanitiser with DOMPurify 3.4.16, removes href, target, ping and rel from every anchor and returns the markup with the blocked references and the links as text. The package keeps no state, makes no request and prints nothing, and it never touches a global window or document: the caller passes one in.

## Dependencies

- `dompurify` 3.4.16

## Tests

```sh
npm test
```

Expected values come from the RFC texts: the RFC 2047 section 8 examples (including the two-word subject and the parenthesis table), the RFC 2231 section 3, 4 and 4.1 parameter examples, and the RFC 2049 Appendix A message, each retyped as a JSON string with CRLF escapes and its RFC and section. Node crypto is the second opinion on every SHA-256 and Node Buffer on the Base64 decoder. Boundaries that start the same (BOUNDARY-1 and BOUNDARY-10), attachment names (paths, device names, direction marks, 300 characters, a NUL, repeats), charsets (utf-7, x-unknown, us-ascii, gb18030, euc-kr, iso-8859-2), caps (17 levels, 1,001 parts, 2,001 headers, a 70,000-byte header, 201 encoded words, a 26 MiB input) and a hostile HTML body (every remote reference, entity-form javascript addresses, a cid PNG) are tested, with names such as __proto__ and constructor, refusals that never repeat message text, and every parser on hostile strings at two sizes. Deep HTML is refused by the pre-scan and never given to jsdom.

## Licence

MIT. See [LICENSE](./LICENSE).

# Email Message Viewer & Header Analyzer

Open a saved email to read its headers, delivery hops, MIME parts, attachments and a closed preview of its HTML, with nothing loaded or sent.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Open a saved email (an .eml file) or paste a message or only its headers and read it without sending it anywhere: the delivery hops oldest first with the time between them, the Authentication-Results, DKIM-Signature and ARC headers explained tag by tag, a short list of things worth a look, every header with its RFC 2047 encoded words and RFC 2231 parameters decoded, the MIME structure as a tree, the plain text body, every attachment with its cleaned name, type, size and SHA-256, and the HTML body in a fully closed preview where remote images, styles and links do nothing. Nothing is verified, because that would need DNS, nothing the message names is loaded or opened, and nothing leaves your browser.

## Supported

- A saved message from a file (.eml or any text file of the RFC 5322 form, up to 25 MiB) or pasted text (up to 5 MiB of characters), with CRLF, LF or CR line ends, a leading mbox From line (noted) and a block of headers with no body
- Headers in message order with repeats kept, folded lines unfolded, RFC 2047 encoded words (B and Q, with the language suffix) decoded and adjacent words joined without the white space between them, and the raw text shown beside a decoded value when they differ
- Received lines (RFC 5321 section 4.4) listed oldest first, each with its from, by, via, with, id and for clauses read outside comments, its stated time in UTC and the delay since the line before it in whole seconds, the zone of each date applied; a negative delay is a clock note, not an error
- Dates read as RFC 5322 section 3.3 and 4.3 say, with comments and folding white space, obsolete zones (EST is -0500) and military letters (read as -0000), two-digit years (00 to 49 are 20xx, 50 to 99 are 19xx) and, said when it happens, the month-before-day order that RFC 8601's own examples use
- Authentication-Results (RFC 8601) read result by result with the server, method, result, reason and properties, comments of any depth up to 50 stripped; DKIM-Signature (RFC 6376) read tag by tag with case-sensitive names, a repeated tag voiding the list, x after t, i inside d, From in h and the key lookup name shown as text; ARC headers (RFC 8617) grouped by instance number
- A Worth a look list of observations only: From and Return-Path domains that differ, a Reply-To elsewhere, a missing Message-ID or Date, a repeated header that RFC 5322 allows once, a negative hop delay, a Date more than 24 hours from the oldest hop, From missing from the signed headers
- MIME parts per RFC 2045 to 2049: nested multipart (mixed, alternative, related, digest with its message/rfc822 default), nested message/rfc822, boundaries read as whole lines only, transport padding, a preamble and epilogue, a missing closing boundary tolerated and said, Base64 (lenient), quoted-printable and 7bit, 8bit and binary bodies
- Content-Type and Content-Disposition parameters per RFC 2231: continuations (name*0, name*1), character set and language values (name*=us-ascii'en'...) and the two combined, with a gap, a leading zero or more than 100 sections shown raw
- Character sets read with the browser's decoder (UTF-8, windows-1252, ISO-8859-2, GB18030, EUC-KR and the other WHATWG labels); a set it does not know, such as UTF-7, is shown as escaped bytes with the label named
- Attachments named from filename*, then filename, then name, cleaned of paths, control and direction characters, device names and reserved characters, with repeats numbered, each listed with its SHA-256 and saved only when you press Save, always as application/octet-stream
- The HTML body in a closed frame: every remote reference (images, srcset, poster, background, object data, ping, link and base addresses, style url and import, styles written with escapes, meta refresh, frame content, links inside SVG drawings) is listed as text and removed, a small PNG, JPEG, GIF or WebP part named by a cid address is shown inline, and every link is listed as text and made inert

## Limits

- Everything is read and shown on this device. Nothing is sent, and no remote image, link, font or style sheet in the message is loaded: the page lists what it blocked and shows links as text. Style blocks in an HTML body are dropped; inline styles are kept without their remote addresses.
- Authentication-Results, DKIM-Signature and ARC lines are shown as the servers that wrote them said them. This page does not verify SPF, DKIM, DMARC or ARC, because that needs DNS and fetched keys, so any of these lines can be forged. A line added by your own mail provider's servers is the one worth reading; Received lines below the first server you know were written by the sender and can be invented, and every delay is only the difference between the dates two lines state. No body hash is computed.
- Signed and encrypted content (S/MIME, PGP) is shown as structure only, an Outlook .msg file is not read, and winmail.dat appears as an attachment. The words that say a signing domain and a From domain are aligned are approximate, because no public suffix list is consulted.
- Attachments are never opened or previewed. They are saved only when you press Save, under a cleaned name, and a saved file can still be harmful when you open it. Only the first 200 attachments get a Save button; the rest are listed in the table.
- A message over 25 MiB is refused before it is read. Nesting deeper than 16 parts, more than 1,000 parts, more than 2,000 headers, a header over 64 KiB or more than 200 encoded words in one header stops the reading at that point and says so, keeping what was read. Of the Received lines the oldest 200 are listed; a header lists at most 500 addresses and 100 authentication results; at most 50 Authentication-Results and 50 DKIM-Signature headers are read; a comment nested deeper than 50 levels stops the reading of that header.
- An HTML body over 1 MiB, with more than 20,000 tags or nested deeper than 200 levels is shown as text, not rendered. A cid image is shown only when its part is a PNG, JPEG, GIF or WebP identified by its first bytes (never SVG), at most 1 MiB, and 5 MiB for all of them.
- Character sets are read with the browser's decoder; the labels us-ascii and iso-8859-1 are read as windows-1252, as browsers do. A plain text body is shown up to 256 KiB. The body is shown as it is encoded: a format=flowed body is not re-flowed.

## Ambiguous cases, and what this does about them

- The label us-ascii and the label iso-8859-1 name windows-1252 in the WHATWG Encoding Standard, so a byte from 0x80 to 0x9F reads as the windows-1252 character a browser would show, where RFC 2045 would call it invalid.
- RFC 2231 says neither leading zeros nor gaps are allowed in a continuation count. A parameter with either is not joined: its pieces are shown raw, so nothing is guessed.
- A message that names the same attachment twice, or an attachment name that cleans to an existing name, gets a number before its extension (report.txt, report (2).txt) so every Save button writes a different file.
- A part with no Content-Type is plain text in US-ASCII (RFC 2045), except inside a multipart/digest, where it is a message (RFC 2046).
- A date with the month before the day (Fri, Feb 15 2002 17:19:07 -0800, the form RFC 8601's examples use) is not RFC 5322 order. It is read, and the hop says so. A date with no time zone, a day past the end of its month or an hour of 24 is not read.
- RFC 5322 section 4.3 says the military zone letters and any alphabetic zone it does not define should be read as -0000, so a delay that spans one of them can be out by the hours the sender meant.

## Defined by

- [RFC 5322: Internet Message Format](https://www.rfc-editor.org/rfc/rfc5322)
- [RFC 2045: MIME Part One, Format of Internet Message Bodies](https://www.rfc-editor.org/rfc/rfc2045)
- [RFC 2046: MIME Part Two, Media Types](https://www.rfc-editor.org/rfc/rfc2046)
- [RFC 2047: MIME Part Three, Message Header Extensions for Non-ASCII Text](https://www.rfc-editor.org/rfc/rfc2047)
- [RFC 2049: MIME Part Five, Conformance Criteria and Examples](https://www.rfc-editor.org/rfc/rfc2049)
- [RFC 2231: MIME Parameter Value and Encoded Word Extensions](https://www.rfc-editor.org/rfc/rfc2231)
- [RFC 5321: Simple Mail Transfer Protocol, section 4.4 trace information](https://www.rfc-editor.org/rfc/rfc5321)
- [RFC 8601: Message Header Field for Indicating Message Authentication Status](https://www.rfc-editor.org/rfc/rfc8601)
- [RFC 6376: DomainKeys Identified Mail (DKIM) Signatures](https://www.rfc-editor.org/rfc/rfc6376)
- [RFC 8617: The Authenticated Received Chain (ARC) Protocol](https://www.rfc-editor.org/rfc/rfc8617)

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

// A saved message (or only its headers) as bytes
const analysis = await analyzeMessage(bytes);
analysis.headers[0]?.value; // the first header, encoded words decoded
analysis.hops[0]?.delay; // delivery hops, oldest first, with the delay since the line before, as '6 s'
analysis.authResults[0]?.result; // what an Authentication-Results header said, never checked
analysis.dkim[0]?.signature.issues; // what breaks an RFC 6376 rule
analysis.observations; // things worth a look, never safe or unsafe
analysis.attachments[0]?.name; // the cleaned name
analysis.attachments[0]?.sha256; // SHA-256 of the decoded bytes, as hex

// The HTML body, neutralised, with a browser window (or a jsdom one) passed in
if (analysis.htmlBody !== null) {
  const preview = previewHtml(analysis.htmlBody, window, analysis.cidParts);
  preview.status === 'shown' && preview.html; // markup that loads nothing and navigates nowhere
  preview.blocked; // every remote reference that was removed, as text
}
```

`analyzeMessage(bytes)` returns the summary pairs, the headers (decoded, with the raw text), the delivery hops (oldest first, with the delay between stated dates), the Authentication-Results rows, the DKIM-Signature readings, the ARC sets grouped by instance and the observations, the MIME tree, the plain text body, the HTML body text, the Content-ID parts a cid address can name, the attachments (cleaned name, raw name, declared type, size, SHA-256, bytes) and the notes. A refusal is an `EmlViewerError` with a fixed sentence that names the part and never holds message text. `previewHtml(html, window, cidParts)` runs the size, tag and depth pre-scan before any DOM call, records every remote reference from an inert parse, rewrites cid images to data addresses, runs the sanitiser with DOMPurify 3.4.16, removes href, target, ping and rel from every anchor, removes and lists every image source that is not a data image (an address that is only a fragment would load the page's own address), and returns the markup, written out inside the sanitiser's own inert document and never the caller's, with the blocked references and the links as text. Any base start tag is renamed before a parser sees it, because a page policy that forbids a base address reports the attempt even when the parse is inert; its address is still listed as text. Bytes 0x80 to 0x9F of a windows-1252 text map as the WHATWG table says on every runtime, so the same message reads the same everywhere. The package keeps no state, makes no request and prints nothing, and it never touches a global window or document: the caller passes one in. The header readers are exported on their own: `parseMailDate` and `readMailDate` (RFC 5322 dates, obsolete zones, two-digit years), `parseReceived`, `parseAddressList`, `parseAuthenticationResults`, `parseDkimSignature` and `groupArc`. They read what a header says and never check it: no DNS lookup, no key, no body hash. A comment nested deeper than 50 levels stops the reading of that header with a note.

## Dependencies

- `dompurify` 3.4.16

## Tests

```sh
npm test
```

Expected values come from the RFC texts: the RFC 2047 section 8 examples (including the two-word subject and the parenthesis table), the RFC 2231 section 3, 4 and 4.1 parameter examples, and the RFC 2049 Appendix A message, each retyped as a JSON string with CRLF escapes and its RFC and section. Node crypto is the second opinion on every SHA-256 and Node Buffer on the Base64 decoder. Boundaries that start the same (BOUNDARY-1 and BOUNDARY-10), attachment names (paths, device names, direction marks, 300 characters, a NUL, repeats), charsets (utf-7, x-unknown, us-ascii, gb18030, euc-kr, iso-8859-2), caps (17 levels, 1,001 parts, 2,001 headers, a 70,000-byte header, 201 encoded words, a 26 MiB input) and a hostile HTML body (every remote reference, entity-form javascript addresses, a cid PNG) are tested, with names such as __proto__ and constructor, refusals that never repeat message text, and every parser on hostile strings at two sizes. Deep HTML is refused by the pre-scan and never given to jsdom. A window whose parser records its input proves that no base element reaches a parser, and a window whose parser throws proves that a refusal happens before any DOM call. Never opened and never loaded: no attachment is previewed, no remote address is requested, and every blocked reference and link is checked as text. The header readers are checked against RFC 5322 section 3.3 and 4.3 (dates, obsolete zones, two-digit years) and Appendix A.1.1, A.1.3, A.4, A.5 and A.6.1 to A.6.3, RFC 5321 section 4.4 (trace fields), RFC 8601 Appendix B.1 to B.7 (B.7 is the comment-heavy example), RFC 6376 sections 3.2 and 3.5 with the headers of its Appendix A, and RFC 8617 sections 4.1 and 4.2 with its Appendix B, each retyped with its section. A recorded corpus of 20 messages is compared with the output of Python 3.14.3 email library (default policy), recorded from a scratch virtual environment with its version and time inside the file, and every difference (five, all in the text of address headers) is named with its cause. The edges are tested too: 200 and 201 hops, headers of 65,536 and 65,537 bytes, comments nested 50, 51 and 100,000 deep, names such as __proto__ and constructor, and linear time on hostile header text. Real browsers (Chromium, Firefox, WebKit and a phone-sized Chromium) check that a message is read in a background worker started from a blob address after it reports ready, that Save writes an attachment under its cleaned name with the bytes its digest describes, that a hostile message makes no outside request and no policy violation and a click on its link text leaves the preview at about:srcdoc, that a 26 MiB file is refused before any worker exists, and that pasted headers alone show the hops and the authentication lines.

## Licence

MIT. See [LICENSE](./LICENSE).

# HTML Link Builder (mailto, tel, sms)

Build a link with the rel, target and download attributes you choose, or a correctly encoded mailto, tel or sms link.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Builds one link element and shows its markup first, ready to copy, with a live preview of the same markup after it. It writes an email link (mailto), a phone link (tel) or a text message link (sms) whose address is percent-encoded the way the RFCs describe, so a subject or body with spaces, ampersands, line breaks and non-English letters arrives intact. The bare address is shown beside the markup so it can be used outside HTML. The preview link has no address at all, so nothing in it can be followed.

## Supported

- An email link (mailto) with To, Cc, Bcc, a subject and a body, percent-encoded as RFC 6068 describes: a space as an encoded space, each line break in the body as an encoded carriage return and line feed, every non-ASCII letter as its UTF-8 bytes in percent-encoded form, and a percent sign, ampersand, question mark, quote or backslash in a local part encoded
- A non-ASCII domain in an email address converted to punycode (the form RFC 6068 section 2 recommends for the widest support), with the percent-encoded UTF-8 form of RFC 6068 section 6.3 available to the package as an option
- A line break typed into To, Cc, Bcc or the subject is refused naming the field, so no mail header can be added through the link; only the body may have line breaks (RFC 6068 section 5)
- A phone link (tel) for a global number (RFC 3966 section 5.1.4) or a local number with its phone-context (section 5.1.5), with an extension; visual separators - . ( ) are kept, spaces typed in a number become hyphens with a note, and letters are refused (section 5.1.2)
- A text message link (sms) with one or more recipients and a message body, as RFC 5724 section 2.2 writes it: everything except unreserved characters percent-encoded, and each line break as an encoded line feed
- The link text, which is the address, number or recipient list when you leave it blank, and the bare address shown in its own block for use outside HTML

## Limits

- Everything you type is escaped before it is placed in the markup, so a tag, an event handler or a script address you type stays text; a javascript:, data: or vbscript: address is kept as typed and flagged.
- The preview replaces every address you typed (src, srcset, poster, href, action, formaction, data and cite) with an inert placeholder or removes it, so nothing you typed is loaded; only the markup you copy keeps the real addresses.
- Addresses in a Bcc field are part of the link itself, so they are visible to anyone who reads the page source or the link (RFC 6068 section 7); a link also exposes every address in it to harvesting.
- Each text field is limited to 20,000 characters, an email link to 50 recipients across To, Cc and Bcc and a text message link to 20 recipients, and control characters other than a tab (and line breaks in a body or a recipient list) are refused because HTML cannot carry them.
- A plus sign in a subject or body is written as an encoded plus, so no handler can read it as a space; RFC 6068 section 5 allows this, and it is the one place the encoder is stricter than it has to be.
- RFC 5724 does not say how a line break is written in a text message body; this builder writes an encoded line feed, and mail and message handlers differ in how they read a body, so test the link on the devices you care about.
- Only the header fields Cc, Bcc, Subject and Body are offered for an email link, each at most once, in that order; other header fields, and the isub parameter of a phone number, are not offered.

## Ambiguous cases, and what this does about them

- A line break inside an email body is written as an encoded carriage return and line feed, which RFC 6068 section 5 requires, whichever line break you typed; in a text message body it is an encoded line feed.
- An address outside the HTML Living Standard's expression for a valid email address (4.10.5.1.5), such as a quoted local part, is written as typed and encoded with a warning rather than refused, because that expression is a stated willful violation of the RFC for addresses.
- RFC 3966 asks for the phone-context parameter only on a local number; a global number (one starting with +) works everywhere, so typing a phone context for it is refused rather than written.
- The grammar of RFC 3966 allows the letters A to F in a local number as hexadecimal digits (section 5.1.3); a typed letter more likely stands for a keypad digit, which section 5.1.2 does not support, so every letter is refused.
- In a phone number, a number sign is written as an encoded number sign because a bare one would start the fragment of the address.

## Defined by

- [RFC 6068, The mailto URI Scheme](https://www.rfc-editor.org/rfc/rfc6068)
- [RFC 3966, The tel URI for Telephone Numbers](https://www.rfc-editor.org/rfc/rfc3966)
- [RFC 5724, URI Scheme for Global System for Mobile Communications (GSM) Short Message Service (SMS)](https://www.rfc-editor.org/rfc/rfc5724)
- [RFC 3986, Uniform Resource Identifier (URI): Generic Syntax](https://www.rfc-editor.org/rfc/rfc3986)
- [HTML Living Standard, 4.5.1 The a element](https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-a-element)
- [HTML Living Standard, 4.10.5.1.5 Email state](https://html.spec.whatwg.org/multipage/input.html#email-state-(type=email))

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/link-builder link-builder
cd link-builder
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/link-builder
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { buildLink } from '@fodt/link-builder';

const mail = buildLink({
  kind: 'mailto',
  to: 'infobot@example.com',
  body: 'send current-issue\nsend index',
});
mail?.address;
// mailto:infobot@example.com?body=send%20current-issue%0D%0Asend%20index

buildLink({ kind: 'tel', phone: '7042', phoneContext: 'example.com' })?.address;
// tel:7042;phone-context=example.com
```

`buildLink(spec)` returns `{ tree, html, preview, address, warnings }`, or `null` when every field it reads is blank. `html` is the copyable markup, `preview` is the same tree with the address removed, and `address` is the bare address. A refused value throws `MarkupError` with a `field` (the label the page shows) and a `message`. `buildMailto(parts, { domainEncoding })`, `buildTel(number, { ext, phoneContext })` and `buildSms(recipients, body)` are the encoders behind it, and `percentEncode`, `encodeHeaderValue` and `encodeLocalPart` are the percent-encoders themselves.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every generated snippet is parsed with parse5 and must report zero parse errors. The examples that RFC 6068 sections 6.1 to 6.3, RFC 3966 sections 6 and 8 and RFC 5724 section 2.5 print are checked literally, so the encoding is reproduced byte for byte, and a line break typed into a header field must be refused.

## Licence

MIT. See [LICENSE](./LICENSE).

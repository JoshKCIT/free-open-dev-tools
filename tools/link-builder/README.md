# HTML Link Builder (mailto, tel, sms)

Build a link with the rel, target and download attributes you choose, or a correctly encoded mailto, tel or sms link.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Builds one link element and shows its markup first, ready to copy, with a live preview of the same markup after it. In this edition it builds an email link: the recipients are written in the address part and the body is percent-encoded the way RFC 6068 describes, with each line break written as an encoded carriage return and line feed. The bare address is shown beside the markup so it can be used outside HTML. The preview link has no address at all, so nothing in it can be followed.

## Supported

- An email link (mailto) with one or more recipients and a body, percent-encoded as RFC 6068 section 5 describes: a space is written as an encoded space, each line break in the body as an encoded carriage return and line feed, and every non-ASCII letter as its UTF-8 bytes in percent-encoded form
- The link text, which is the address list when you leave it blank
- The bare address shown in its own block, for use outside HTML

## Limits

- Everything you type is escaped before it is placed in the markup, so a tag, an event handler or a script address you type stays text; a javascript:, data: or vbscript: address is kept as typed and flagged.
- The preview replaces every address you typed (src, srcset, poster, href, action, formaction, data and cite) with an inert placeholder or removes it, so nothing you typed is loaded; only the markup you copy keeps the real addresses.
- Each text field is limited to 20,000 characters, and control characters other than a tab (and line breaks in the body) are refused because HTML cannot carry them.

## Ambiguous cases, and what this does about them

- A line break inside a mailto body is written as an encoded carriage return and line feed, which is what RFC 6068 section 5 requires, whichever line break you typed.

## Defined by

- [RFC 6068, The mailto URI Scheme](https://www.rfc-editor.org/rfc/rfc6068)
- [HTML Living Standard, 4.5.1 The a element](https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-a-element)

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

const link = buildLink({
  kind: 'mailto',
  to: 'infobot@example.com',
  body: 'send current-issue\nsend index',
});
link?.address;
// mailto:infobot@example.com?body=send%20current-issue%0D%0Asend%20index
```

`buildLink(spec)` returns `{ tree, html, preview, address, warnings }`, or `null` when every field it reads is blank. `html` is the copyable markup, `preview` is the same tree with the address removed, and `address` is the bare address. A refused value throws `MarkupError` with a `field` (the label the page shows) and a `message`. `buildMailto` is the encoder behind it.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every generated snippet is parsed with parse5 and must report zero parse errors. The two-line body example of RFC 6068 section 6.1 is checked literally, and the preview link must have no href.

## Licence

MIT. See [LICENSE](./LICENSE).

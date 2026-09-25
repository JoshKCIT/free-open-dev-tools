# Meta Tags & Social Preview

Generate SEO, Open Graph and Twitter Card tags and preview them locally.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Writes SEO, Open Graph and Twitter Card meta tags from typed fields, with every value HTML-escaped, and builds a mock social preview from those same fields. The preview never loads the image URL or fetches anything: it shows the address as plain text inside a sandboxed, sanitised frame.

## Supported

- title, meta name=description, link rel=canonical and meta name=robots, in that order
- Open Graph basic and optional properties (og:title, og:type, og:url, og:image, og:image:alt, og:description, og:site_name, og:locale)
- Twitter Card properties for the summary and summary_large_image layouts (twitter:card, twitter:site, twitter:creator, twitter:title, twitter:description, twitter:image, twitter:image:alt)
- Every attribute value and the title text HTML-escaped, with whitespace runs and line breaks collapsed to one space
- A length warning for a title, description or image description past the limit the X Cards documentation states
- A mock Open Graph and X card preview built only from the typed fields, rendered in a sandboxed frame, with any image URL shown as text and never loaded
- A relative or non-http canonical or image URL, or a Twitter handle not shaped like @name, reported

## Limits

- This tool cannot fetch the page these tags describe, so it cannot confirm the tags match the page's real content, or that a social network's own crawler can reach the page at all -- both need a real request to a server
- The preview is an approximation of the Open Graph and X card layouts, not the networks' own rendering; a network may crop, cache or resize the image differently
- The image is never loaded, so this tool cannot check its real size, aspect ratio or file type
- Search-engine title or description truncation is not simulated: only the documented X Cards length limits are checked, since this tool has no authoritative source for how any particular search engine truncates a snippet

## Ambiguous cases, and what this does about them

- The trailing slash in a generated tag (for example content="The Rock" />) is optional in HTML; it is kept to match the published Open Graph protocol examples exactly
- Whitespace, including line breaks, is collapsed to one space before HTML-escaping, since a meta tag's content attribute cannot itself contain a literal line break

## Defined by

- [Open Graph protocol](https://ogp.me/)
- [X Cards markup reference](https://developer.x.com/en/docs/x-for-websites/cards/overview/markup)
- [HTML Living Standard — the meta element (name=description)](https://html.spec.whatwg.org/multipage/semantics.html#meta-name-metadata)
- [RFC 6596 — The Canonical Link Relation](https://www.rfc-editor.org/rfc/rfc6596)
- [OWASP XSS Filter Evasion Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.html)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/meta-tags meta-tags
cd meta-tags
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/meta-tags
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { buildMetaTags, buildSocialPreview } from '@fodt/meta-tags';

buildMetaTags({ title: 'The Rock' }).html;
// '<title>The Rock</title>\n...<meta property="og:title" content="The Rock" />...'
buildSocialPreview({ title: 'The Rock' }, window).html;
// sanitised preview markup, no src or href attribute anywhere
```

`buildMetaTags(fields)` is pure and never reads a DOM global; it throws `MetaTagsError` only when `twitterCard` is set to something other than 'summary' or 'summary_large_image'. Every other problem (an unparseable URL, a Twitter handle not shaped like @name, a value past a documented length limit) is reported as a warning rather than thrown, since none of them make the generated tags unusable. `buildSocialPreview(fields, win)` builds preview markup from escaped text only, then sanitises it with the copied `sanitiseMarkup('html')` before returning it; it never reads a DOM global of its own, only the `win` argument.

## Dependencies

- `dompurify` 3.4.16

## Tests

```sh
npm test
```

The Open Graph example form is checked against the exact `<meta property="og:title" content="The Rock" />` line from ogp.me's own introduction. X Cards property names and their length limits (title 70, description 200, image:alt 420 characters) come from the X Cards markup reference's own property table, fetched from an archived snapshot since the live page no longer serves the table server-rendered (recorded in the SUMMARY). OWASP XSS Filter Evasion Cheat Sheet payloads are placed in every field in turn and the resulting preview is checked with the copied active-content checker and a scan for any src, href, srcset or poster attribute.

## Licence

MIT. See [LICENSE](./LICENSE).

# Favicon Generator

Produce favicon sizes and an ICO from text, an emoji or an image.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Renders one to three characters, a single emoji or a picked image at every standard favicon size, writes the multi-size ICO container by hand, and gives you the HTML link tags and a web app manifest to go with it. Everything is drawn in your browser; nothing is uploaded.

## Supported

- A 16, 32 and 48 pixel favicon.ico written by this tool, byte for byte, from Microsoft's own ICO layout
- Standalone favicon-16x16.png and favicon-32x32.png files
- A 180 pixel apple-touch-icon.png, always drawn on an opaque background
- 192 and 512 pixel android-chrome PNG icons for a web app manifest
- Text (1 to 3 characters), a single emoji, or a picked PNG, JPEG, GIF, WebP or BMP image as the source
- Square, rounded or circular shapes, a foreground and background colour, and cover or contain fitting for an image source
- The HTML link tags and a site.webmanifest ready to paste in

## Limits

- Text and emoji are drawn with your own system fonts, so they look slightly different on every operating system and browser.
- ICO entries are PNG-compressed: every current browser and Windows since Vista read this, but Windows XP does not.
- No SVG favicon is produced.
- A picked image is limited to 25 MB and 100,000,000 declared pixels.

## Ambiguous cases, and what this does about them

- A family emoji joined by zero-width joiners (for example a family of four) counts as one grapheme under Intl.Segmenter's grapheme granularity, matching how a visitor would count it by eye, even though it is several Unicode code points.
- The Apple touch icon is always drawn on an opaque background even when 'transparent' is checked, since Apple's own guidance says a transparent apple-touch-icon is filled in black by iOS, which is worse than choosing an opaque background here.

## Defined by

- [HTML Standard — The link element (rel=icon, the sizes attribute)](https://html.spec.whatwg.org/multipage/links.html#rel-icon)
- [W3C Web Application Manifest — the icons member](https://www.w3.org/TR/appmanifest/#icons-member)
- [W3C PNG (Third Edition) — Portable Network Graphics Specification](https://www.w3.org/TR/png/)
- [Microsoft — ICO file format (ICONDIR and ICONDIRENTRY)](https://learn.microsoft.com/en-us/previous-versions/ms997538(v=msdn.10))

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/favicon-generator favicon-generator
cd favicon-generator
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/favicon-generator
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { planFavicon, buildIco, FAVICON_SET, linkTags, manifestJson } from '@fodt/favicon-generator';

const plan = planFavicon({ source: 'text', text: 'Ab', shape: 'square', foreground: '#000000', background: '#ffffff', transparent: false, font: 'sans-serif', bold: true, appName: 'My site', fit: 'cover', emoji: '' });
// A worker draws each FAVICON_SET size from the plan and hands the PNG
// bytes back here; buildIco combines the 16/32/48 pixel PNGs into one ICO.
```

This package takes only byte arrays and plain values, and names no browser-only type anywhere, not even in a comment: it is built and tested in plain Node by a release gate that has no such type available. Drawing text, an emoji or an image onto a canvas happens only in the worker and the page's own fallback, both of which this package never imports.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

buildIco's layout is proven against Microsoft's own ICONDIR/ICONDIRENTRY field order, byte for byte, including the 256-pixel zero-means-256 rule; readIcoDirectory round-trips every field. The favicon set, link tags and manifest text are checked against the cited HTML Standard, Apple and W3C sources. Real ICO decoding by four browsers is proven only by the dedicated Playwright spec.

## Licence

MIT. See [LICENSE](./LICENSE).

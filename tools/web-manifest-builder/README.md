# Web App Manifest Builder

Build a web app manifest with its name, icons, colours, display mode and start address, each member checked.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Fill in the members of a web app manifest and get the JSON to save as manifest.webmanifest, a table that shows how a browser reads each member, a finding for every member a browser would ignore with the reason, and the link tag for your page. Each member is checked with the processing steps of the W3C Web Application Manifest specification: addresses are resolved against the manifest address, the start address must share the page's origin, the scope must contain the start address, display, orientation and direction accept only their listed values, colours must be sRGB CSS colours, and icon sizes, types and purposes follow the image resource rules. Addresses are only text: nothing is fetched, so nothing you type leaves your browser.

## Supported

- Every member of the W3C Web Application Manifest Working Draft of 13 August 2026 that can be written as plain text at the root level: name, short_name, id, start_url, scope, display, orientation, dir, lang, theme_color, background_color, icons and shortcuts
- start_url, id, scope, icon addresses and shortcut addresses resolved against a typed manifest address, with the same-origin and within-scope tests of the specification, shown as the URL parser writes them
- Colours written as #rgb, #rgba, #rrggbb, #rrggbbaa, rgb(), rgba(), hsl(), hsla() (comma and space forms, with an optional alpha), the 148 CSS Color 4 named colours and transparent
- Icons with src, sizes (any, or width x height in pixels as the HTML sizes attribute reads them), type (a MIME type) and purpose (any, maskable, monochrome); shortcuts with a name and an address within scope
- lang checked as a structurally valid BCP 47 language tag with Intl.getCanonicalLocales and shown in canonical form
- display_override, offered as an optional member and labelled as an incubating feature outside the W3C specification
- The link tag for the page, with the manifest address written relative to the page when both share an origin

## Limits

- Nothing is fetched: icon, start and shortcut addresses are checked as text only, so a missing or broken icon file is not detected.
- Up to 50 icons and 20 shortcuts; each field up to 2,048 characters.
- display_override is not part of the W3C specification; its token list here is incomplete and browsers may differ.
- Colours written as lab(), oklch(), color() and other newer CSS syntax are kept but not checked.
- description, categories, screenshots and related_applications are not members of the W3C draft and are not offered; the *_localized members and color_scheme_dark of the draft are not offered either.
- The W3C within-scope test is a plain path prefix, so a scope of /app also contains /application.
- Install advice that browsers apply (icon sizes, a name, a display mode, HTTPS) is not in the W3C text; it is shown separately and labelled as advice.
- Language tags the W3C draft hands to ECMAScript are judged by the browser's own Intl.getCanonicalLocales, so a grandfathered tag such as i-enochian, an extended language subtag such as zh-yue-HK or a private-use-only tag such as x-whatever is refused even though RFC 5646 calls it well formed.

## Ambiguous cases, and what this does about them

- Relative addresses resolve against the manifest address, not against the page: a start_url of foo in a manifest at /resources/manifest.webmanifest means /resources/foo.
- When id is not set it is the start address with its fragment removed. The draft's table of examples shows that, although its algorithm text does not remove the fragment of that default.
- The draft compares icon purposes exactly, so MASKABLE is an unknown purpose and an icon whose purpose holds nothing it knows is ignored; Chromium reads purposes without regard to case and keeps such an icon. An icon whose type is not a well formed MIME type is ignored by the draft; Chromium keeps it.
- A size keyword is written width x height in digits with no leading zero; the x may be upper case. any is read in either case, as Chromium does.
- A scope without a trailing slash is a text prefix: a scope of /app contains /app/, /app and /application. End the scope with a slash to mean a folder.

## Defined by

- [Web Application Manifest, W3C Working Draft 13 August 2026](https://www.w3.org/TR/appmanifest/)
- [Image Resource, W3C Working Draft (section 6, processing an image resource from JSON)](https://www.w3.org/TR/image-resource/)
- [CSS Color Module Level 4 (named colors, rgb(), hsl())](https://www.w3.org/TR/css-color-4/)
- [HTML Standard, the sizes attribute of link rel=icon](https://html.spec.whatwg.org/multipage/links.html)
- [BCP 47 / RFC 5646, Tags for Identifying Languages](https://www.rfc-editor.org/rfc/rfc5646)
- [Manifest incubations (display_override, not a W3C specification)](https://wicg.github.io/manifest-incubations/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/web-manifest-builder web-manifest-builder
cd web-manifest-builder
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/web-manifest-builder
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { buildManifest, processManifest } from '@fodt/web-manifest-builder';

const manifest = buildManifest({ name: 'Racer', startUrl: '/app/start.html', icons: [['icon-192.png', '192x192', 'image/png', '']] });
const { processed, findings } = processManifest(manifest, 'https://example.com/app/manifest.webmanifest', 'https://example.com/app/start.html');
processed.startUrl; // 'https://example.com/app/start.html'
processed.scope; // 'https://example.com/app/'
findings.map((finding) => finding.member);
```

`buildManifest(fields)` turns text fields into a manifest object with its members in one fixed order (name, short_name, id, start_url, scope, display, display_override, orientation, dir, lang, theme_color, background_color, icons, shortcuts) and leaves out every empty field. `processManifest(json, manifestUrl, pageUrl)` applies the processing steps of the W3C draft to any parsed JSON object and returns the processed members and a list of findings in member order, each with a severity of ignored, warning or info. `manifestLinkTag(manifestUrl, pageUrl)` writes the link tag. `parseCssColour`, `parseIconSizes` and `parseIconPurpose` are exported for use on their own. Addresses are read with the URL parser and never requested. Nothing is logged, stored or sent, and no finding repeats more than 40 escaped characters of what was typed. Everything is pure and runs in Node or a browser.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Expected values come from the specifications and from a second implementation. The start_url, scope and id steps are the examples of the W3C draft (its table of resulting ids), the icon rules are section 6 of the Image Resource draft and the HTML sizes rules, the colours are the CSS Color 4 named colour table and its syntax, and the language tags are the examples of RFC 5646 Appendix A, each listed by name where the browser's Intl refuses what the RFC accepts. A browser test builds nine manifests on the page, serves each one from a local server and compares the start URL, scope, id, theme and background colours, icon sizes and which icons survive with what Chromium's own processed manifest reports through the DevTools protocol (Chromium 153.0.8010.12, 4 October 2026); Chromium's messages are never copied. A second browser test checks twenty language tags against Intl.getCanonicalLocales in each of four browser projects, and a third proves with a recording server that no icon, start or shortcut address is ever requested.

## Licence

MIT. See [LICENSE](./LICENSE).

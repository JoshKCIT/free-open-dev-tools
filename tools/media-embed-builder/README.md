# HTML Media Embed Builder

Build video, audio and responsive image markup with several sources, caption and subtitle tracks, a poster, controls and lazy loading, previewed without loading anything.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Builds a video element with its caption and subtitle tracks and shows the markup first, ready to copy, with a live preview of the same markup after it. The track lines follow the HTML Living Standard: each has an address, a kind, a language and a label, and the preview shows a player without loading the video or any track. The standard was read on 2026-10-01 (last updated 2026-09-29); a later edition may differ.

## Supported

- A video element with one address and any number of track lines, each written as address | kind | language | label | default
- Track elements written with their attributes in the order kind, src, srclang and label, as the standard's own example writes them
- Markup first and an inert preview of the same element second, with any warning in a note

## Limits

- Everything you type is escaped before it is placed in the markup, so a tag, an event handler or a script address you type stays text; a javascript:, data: or vbscript: address is kept as typed and flagged.
- The preview replaces every address you typed (src, srcset, poster and every track address) with an inert placeholder or removes it, so nothing you typed is loaded; only the markup you copy keeps the real addresses.
- Each text field is limited to 20,000 characters, and control characters other than a tab (and line breaks in a text area) are refused because HTML cannot carry them.
- This first version writes a video with one address and its tracks only; sources, audio, images and the other attributes follow.

## Ambiguous cases, and what this does about them

- The standard's example gives four tracks; this page offers as many lines as you type, and the first two of the example are the ones the first-use example reproduces.

## Defined by

- [HTML Living Standard, 4.8.8 The video element](https://html.spec.whatwg.org/multipage/media.html#the-video-element)
- [HTML Living Standard, 4.8.10 The track element](https://html.spec.whatwg.org/multipage/media.html#the-track-element)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/media-embed-builder media-embed-builder
cd media-embed-builder
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/media-embed-builder
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { buildMedia } from '@fodt/media-embed-builder';

const video = buildMedia({
  kind: 'video',
  src: 'brave.webm',
  tracks: 'brave.en.vtt | subtitles | en | English',
  controls: true,
});
video?.html;
// <video src="brave.webm" controls>
//   <track kind="subtitles" src="brave.en.vtt" srclang="en" label="English">
// </video>
```

`buildMedia(spec)` returns `{ tree, html, preview, warnings }`, or `null` when every field it reads is blank. `html` is the copyable markup and `preview` is the same tree with every address removed and controls always shown. A refused value throws `MarkupError` with a `field` (the label the page shows) and a `message`.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every generated snippet is parsed with parse5 and must report zero parse errors. The track example of WHATWG 4.8.10 is checked literally, and the preview must carry no address the visitor typed.

## Licence

MIT. See [LICENSE](./LICENSE).

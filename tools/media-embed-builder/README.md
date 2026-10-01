# HTML Media Embed Builder

Build video, audio and responsive image markup with several sources, caption and subtitle tracks, a poster, controls and lazy loading, previewed without loading anything.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Builds a video or audio element and shows its markup first, ready to copy, with a live preview of the same markup after it. You give one file or several source lines, any caption, subtitle or other tracks, and the playback attributes, and the page checks them against the HTML Living Standard and refuses what the standard does not allow instead of copying it. The preview shows a player without loading the media, the poster or any track. The standard was read on 2026-10-01 (last updated 2026-09-29); a later edition may differ.

## Supported

- video and audio with either one address or several source lines written as address | type | media, never both, with the sources written before the tracks
- Track lines written as address | kind | language | label | default, with the five kinds of the standard, a well-formed language tag required for subtitles, a label written only when typed, at most one default among subtitles and captions, one among descriptions and one among chapters, and no two tracks of the same kind, language and label
- A poster, width and height on video; audio takes none of these, as the standard lists none for audio
- preload (auto, metadata, none), loading (lazy, eager) and crossorigin (anonymous, use-credentials), each taking only its keywords, and the controls, autoplay, muted, loop and playsinline attributes where the standard defines them
- Optional fallback text for a browser that cannot play media, written after the tracks
- Notes where the choice has a platform limit: autoplay without muted, autoplay with lazy loading, the loading attribute on video and audio, tracks on another site without crossorigin, a video without width and height, and media without controls
- Markup first and an inert preview of the same element second, with controls always shown in the preview so the element is visible

## Limits

- Everything you type is escaped before it is placed in the markup, so a tag, an event handler or a script address you type stays text; a javascript:, data: or vbscript: address is kept as typed and flagged.
- The preview replaces every address you typed (src, srcset, poster and every track address) with an inert placeholder or removes it, so nothing you typed is loaded; only the markup you copy keeps the real addresses.
- Each text field is limited to 20,000 characters, a list to 20 sources or 20 tracks, and control characters other than a tab (and line breaks in a text area) are refused because HTML cannot carry them.
- The preview always shows controls so the element is visible, while the copied markup keeps your choice; an audio element without controls is not displayed by a browser at all, and a note says so.
- Browsers commonly block autoplay unless the media is muted, and lazy loading defers autoplay; the builder keeps what you choose and says so. The loading attribute on video and audio is in the standard, but when this page was built only Chromium-based browsers acted on it.
- Tracks are fetched with the media element's crossorigin setting, so a track on another site needs the crossorigin attribute and CORS headers on the file; a track address with a scheme and no crossorigin setting is flagged.
- The files are never fetched or inspected: codecs are not checked against what a browser plays, a source type is checked only for the type/subtype shape, a media query is not parsed, and a track file is not checked to be WebVTT.
- This page writes the attributes the standard defines for video and audio that it offers; it does not write the other global attributes.

## Ambiguous cases, and what this does about them

- The standard's example gives four tracks; this page offers as many lines as you type, and its first example reproduces the first two of them.
- A track with no kind is in the subtitles state, so it needs a language; a blank kind cell is therefore not written but is treated as subtitles for the language, default and duplicate rules.
- Two languages are taken to be the same when their canonical forms are equal, as the browser's own language tag handling computes them, so en and EN are the same language.
- The standard allows a track label to be absent but not empty; an empty label cell is therefore read as no label.
- The preload attribute's empty value means auto in the standard; this page writes the keyword auto instead of an empty value, and leaves the attribute out when the choice is blank.
- The standard says an audio element without controls is not displayed, so a markup without controls is kept as you chose and flagged, while the preview shows controls.

## Defined by

- [HTML Living Standard, 4.8.2 The source element](https://html.spec.whatwg.org/multipage/embedded-content.html#the-source-element)
- [HTML Living Standard, 4.8.8 The video element](https://html.spec.whatwg.org/multipage/media.html#the-video-element)
- [HTML Living Standard, 4.8.9 The audio element](https://html.spec.whatwg.org/multipage/media.html#the-audio-element)
- [HTML Living Standard, 4.8.10 The track element](https://html.spec.whatwg.org/multipage/media.html#the-track-element)
- [HTML Living Standard, 4.8.11 Media elements](https://html.spec.whatwg.org/multipage/media.html#media-elements)
- [HTML Living Standard, 2.5.4 CORS settings attributes](https://html.spec.whatwg.org/multipage/urls-and-fetching.html#cors-settings-attributes)
- [HTML Living Standard, 2.5.7 Lazy loading attributes](https://html.spec.whatwg.org/multipage/urls-and-fetching.html#lazy-loading-attributes)

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
import { buildMedia, parseTrackLines } from '@fodt/media-embed-builder';

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

const audio = buildMedia({ kind: 'audio', mediaSources: 'song.ogg | audio/ogg\nsong.mp3 | audio/mpeg', controls: true });
audio?.html;
// <audio controls>
//   <source src="song.ogg" type="audio/ogg">
//   <source src="song.mp3" type="audio/mpeg">
// </audio>

parseTrackLines('a.vtt | chapter | en | Chapters');
// throws MarkupError: Tracks: line 1: "chapter" is not a track kind
```

`buildMedia(spec)` returns `{ tree, html, preview, warnings }`, or `null` when every field it reads is blank. `html` is the copyable markup and `preview` is the same tree with every address removed and controls always shown. A refused value throws `MarkupError` with a `field` (the label the page shows) and a `message` that names the rule and its section. `parseSourceLines(text)` and `parseTrackLines(text)` take the typed lines, throw `MarkupError` naming the line, and return the parsed lines. `MEDIA_KINDS` lists the media and `FIELD_LABELS` the field names used in refusals.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every generated snippet is parsed with parse5 and must report zero parse errors. The track example of WHATWG 4.8.10 is checked literally; a video with src must have no source children and without src the sources come before the tracks; audio must refuse a poster and a size; each track rule is tested on its own, including the five kinds, the language for subtitles, one default per kind group and duplicates; preload, loading and crossorigin take only their keywords; and the preview must carry no address the visitor typed and must always show controls.

## Licence

MIT. See [LICENSE](./LICENSE).

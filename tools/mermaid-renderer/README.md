# Mermaid Diagram Renderer

Render a Mermaid diagram description to SVG or PNG with syntax errors shown and nothing fetched.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Draws a Mermaid diagram description with Mermaid 11.17.2 inside a locked frame in this page: a fresh frame for every Run that has no network access, no storage and no way to reach the page except one message, and that is removed when the drawing is done. The description is checked before it is drawn, and the drawn SVG is checked again before it is shown, copied, downloaded or turned into a PNG, so nothing in a diagram can load a font, an icon, an image or a link, and nothing is sent anywhere.

## Supported

- The diagram types Mermaid 11.17.2 draws: flowchart, sequence, class, state, entity relationship, Gantt, pie, user journey, git graph, mind map, timeline, quadrant chart, requirement, C4, Sankey, XY chart, block, packet, Kanban, architecture, radar and treemap
- Five Mermaid themes: default, neutral, dark, forest and base
- The result as an image, as SVG text to copy or download as diagram.svg, and as a PNG at scale 1 to 4 to download as diagram.png
- A title line in the frontmatter, and accTitle and accDescr lines, which become the image's text alternative and are also listed as text on the page
- Syntax errors shown with the parser's own line number, counted in the text as pasted, and what it expected, never the diagram text
- Labels drawn as SVG text, so the same diagram looks the same in every browser and exports as well-formed SVG

## Limits

- Diagrams up to 20,000 characters and 300 lines are accepted, and no single line may be longer than 2,000 characters.
- A large diagram can leave the tab unresponsive for a few seconds while it is drawn; it cannot be stopped part way, because the drawing runs in a frame that holds the page while it works.
- Nothing is fetched: settings directives, click and link lines, image shapes and icons from outside are refused or drawn as text.
- Math in labels is not supported.
- Labels are drawn as SVG text, so HTML formatting inside labels is shown as text.
- Frontmatter may hold one title line and nothing else.
- The SVG is refused above 5 MiB, and a PNG above 16,000,000 pixels or 8,192 pixels on a side.

## Ambiguous cases, and what this does about them

- Mermaid counts the lines of what it parses after it drops the frontmatter, comment lines and blank lines at the start, so it can report a line that is not the line of the pasted text; this page hands it the text with those lines taken out and counts them back, so the line shown is the line of the text as pasted, counted from 1
- Icons written like fa:fa-car or logos:aws are not looked up anywhere: they are drawn as plain text, because no icon pack is loaded
- A diagram that Mermaid draws with settings of its own, such as a %%{init} line, is refused rather than drawn differently from what the page promises

## Defined by

- [Mermaid syntax reference](https://mermaid.js.org/intro/syntax-reference.html)
- [Scalable Vector Graphics (SVG) 2](https://www.w3.org/TR/SVG2/)
- [WAI-ARIA Graphics Module 1.0](https://www.w3.org/TR/graphics-aria-1.0/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/mermaid-renderer mermaid-renderer
cd mermaid-renderer
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/mermaid-renderer
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { prescanDiagram, scrubSvg } from '@fodt/mermaid-renderer';

prescanDiagram('flowchart LR\n  A --> B'); // returns {} and throws a MermaidError for anything refused

// svg is the text Mermaid drew inside a locked frame:
const { svg, title, description } = scrubSvg(svgFromTheFrame);
// scrubSvg throws a MermaidError when the SVG holds a script, an event attribute, an outside link or anything else it does not allow.
```

The folder checks text and output; the page supplies the frame. `prescanDiagram(text)` refuses a diagram over 20,000 characters or 300 lines, a %%{ settings line, frontmatter other than one title line, click and link lines (in the diagram types that have them; a first word such as Click in a mind map is text), an @{ block that names img, and $$ math, each with its line number, and returns the title when there is one. `prepareDiagram(text)` gives the text the engine is sent and the number of lines to add back to a line it reports. `scrubSvg(svg)` is one pass over the SVG text with an allowlist of element names, refuses event attributes, links that do not start with #, addresses in any attribute value, style text that imports or loads anything, characters XML does not allow, a DOCTYPE, an entity declaration, processing instructions, comments and CDATA, and returns the same SVG with the title, description and diagram type it holds. `buildFrameDocument(bundle)` writes the document the page puts in the frame: its policy first, then the Mermaid bundle with every closing script tag escaped, then a boot script that draws each message it is sent. `FRAME_CSP` is that policy and `mermaidConfig(theme)` is the Mermaid configuration (security level strict, labels as SVG text). `parserMessage(line, expecting)` turns a parser error into a line and an expecting clause cut to 160 characters. `svgSize`, `pngSize(svg, scale)` and `withPixelSize(svg, width, height)` plan the PNG. The bundle is the package's own dist/mermaid.min.js, read by the page as a string. The folder reads no file, makes no request and prints nothing.

## Dependencies

- `mermaid` 11.17.2

## Tests

```sh
npm test
```

The pre-scan and the scrub are tested in Node against recorded outputs: test/fixtures/recorded-outputs.ts holds what Mermaid 11.17.2 drew for 22 diagram types with this page's configuration (labels as SVG text, security level strict) in Chromium, in a frame of the size the page uses, and the outputs of four hostile diagrams drawn with the frame's policy removed, which the scrub must refuse. record-outputs.mjs writes the file; test/fixtures/README.md names the versions and the date. Node cannot run Mermaid's own parser for every diagram type, so the grammar is proven in the browser spec, which draws all 22 types in four browsers, runs 19 hostile diagrams against a local recording server that must stay silent, shows the same server does hear a request a plain page makes, checks that a parser line is the line of the pasted text even after blank lines, comments and frontmatter, decodes each PNG again and compares its size with the size the SVG states times the scale, and watches that every Run makes one new frame with only allow-scripts that is removed when the run ends, the visitor leaves or pagehide fires. Parser messages are tested with a marker word that must never reach a message, the address, the title, storage or the console.

## Licence

MIT. See [LICENSE](./LICENSE).

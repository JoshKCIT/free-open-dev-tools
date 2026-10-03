# Test fixtures

`samples.ts` holds one small diagram of each of the 22 types Mermaid 11.17.2 draws (the flowchart and the pie also carry
accTitle and accDescr lines) and 19 hostile diagrams. `{PORT}` in a hostile text stands for the port of a local
recording server; the unit tests only read the text, and the browser spec carries its own copy.

`recorded-outputs.ts` holds what Mermaid drew, so the unit tests can check the scrub in Node without a browser:

- `RECORDED_OUTPUTS`: the SVG of each of the 22 samples, drawn with this folder's own frame document (`src/frame-doc.ts`:
  security level strict, labels as SVG text, theme default), one fresh frame per sample, sized as the page sizes its frame (1024 by 768 pixels, `FRAME_WIDTH_PX` and `FRAME_HEIGHT_PX`, because a Gantt chart takes its width from the document it is drawn in). All 22 are kept (the file is
  about 300 KB).
- `RECORDED_ATTACK_OUTPUTS`: four hostile outputs drawn with the frame's policy removed, which the scrub must refuse: a
  `themeCSS` setting with a `url()`, a `fontFamily` setting with a `url()`, a link element with an outside address, and
  an image element with an outside address. The last one exists only with HTML labels on, which this page never uses, so
  that one frame was given `htmlLabels: true`; with labels as SVG text Mermaid never writes it. The hostile texts name
  `127.0.0.1:9` (the discard port, where nothing listens).

## How the file is made

Run from the repository root, by hand (CI never runs it; it needs Chromium from Playwright):

```
node tools/mermaid-renderer/test/fixtures/record-outputs.mjs
```

The script reads the bundle installed in this folder (`node_modules/mermaid/dist/mermaid.min.js`) and stops if it is not
Mermaid 11.17.2. Last run on 2026-10-03 with Mermaid 11.17.2, Chromium 153.0.8010.12 (Playwright 1.63.0) and Node 22.14.
The fixtures folder is not formatted by Prettier, so nothing needs to be run over the written file.

## Expected values

The recorded outputs are what the engine wrote, used as input to the scrub, never as the expected result of anything the
scrub writes. The scrub's expected results come from the SVG and XML rules (well formed markup, the namespaces SVG
names) and from the constructs the hostile outputs contain.

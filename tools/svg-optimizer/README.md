# SVG Optimizer

Shrink SVGs and strip scripts, event handlers and external references.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Sanitises a pasted SVG first, removing scripts, event handlers, foreignObject content, dangerous URL schemes and references to other addresses, then shrinks the result with a size optimiser. The sanitised markup is shown only in a sandboxed preview frame, never written into this page itself.

## Supported

- SVG 1.1 (Second Edition) shapes, paths, gradients, filters, masks and use references
- Scripts, foreignObject content, event handler attributes and dangerous URL schemes removed before anything else runs
- References to another address (an external image, filter, font or stylesheet) removed; same-document fragment references (#id) and small base64 data images are kept
- Size optimisation with multipass, adjustable numeric precision and a pretty-printed option, run only after sanitising
- A DOCTYPE declaring entities refused outright; a plain DOCTYPE removed with a warning
- Malformed XML refused with a line and column
- A live preview of the sanitised, optimised markup, rendered only inside a sandboxed frame

## Limits

- External images, fonts and stylesheets are always removed, even a legitimate one on another origin: nothing this page renders ever makes a network request
- CSS is checked for dangerous patterns (imports, expressions, binding hooks) but not otherwise validated; a stylesheet with unrelated errors passes through unchanged
- Animation elements are kept only when they carry no script; SMIL event attributes that run script are removed the same as any other event handler
- Comments and processing instructions are not preserved by the optimiser
- This does not restore an SVG that was already broken before sanitising; malformed input is refused, not repaired

## Ambiguous cases, and what this does about them

- A reference such as href that could point at either a local fragment or a same-document element by id is only kept when it starts with '#'; anything else is treated as external and removed

## Defined by

- [SVG 1.1 (Second Edition)](https://www.w3.org/TR/SVG11/)
- [OWASP XSS Filter Evasion Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.html)
- [GitHub Security Advisory GHSA-2p49-hgcm-8545 (SVGO removeScripts plugin)](https://github.com/svg/svgo/security/advisories/GHSA-2p49-hgcm-8545)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/svg-optimizer svg-optimizer
cd svg-optimizer
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/svg-optimizer
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { optimizeSvg } from '@fodt/svg-optimizer';

optimizeSvg('<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>', window, { multipass: true, precision: 3 });
// { output: '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>', originalBytes: 55, optimisedBytes: 51, removed: {...}, warnings: [] }
```

`optimizeSvg(input, win, options)` takes the `window` object it should sanitise with (never reads a DOM global on its own) and returns `{ output, originalBytes, optimisedBytes, removed, warnings }`, or throws `SvgOptimizerError` with `line`/`column` for malformed XML, or a plain message for a refused DOCTYPE or a non-svg root. Options default to `multipass: true`, `precision: 3`, `pretty: false`. `sanitiseMarkup`, `sanitiseToFragment`, `serialiseFragment`, `describeRemoved` and `SanitiserUnavailableError` are exported from the sibling sanitiser module for reuse.

## Dependencies

- `dompurify` 3.4.16
- `svgo` 4.1.0
- `fast-xml-parser` 5.11.1

## Tests

```sh
npm test
```

Every payload extracted from a vendored copy of the OWASP XSS Filter Evasion Cheat Sheet is checked to leave no active content after sanitising, in both the HTML and the SVG profile. The advisory GHSA-2p49-hgcm-8545's own proof-of-concept vectors (a namespaced svg:script element and a case-varied javascript: URL) are checked directly. DOMPurify's own no-window behaviour was measured by test before writing the fail-closed wrapper.

## Licence

MIT. See [LICENSE](./LICENSE).

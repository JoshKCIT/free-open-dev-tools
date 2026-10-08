# Notes for AI coding assistants

These notes are for an AI assistant making changes to this repository. People should start with `README.md` and
`CONTRIBUTING.md`, which say the same things at more length.

## Project

**Free & Open Dev Tools** is a free developer tools website where every tool runs in the visitor's browser and every
tool is a self-contained MIT-licensed folder they can download, test and reuse. It exists so developers can use common
utilities on code, tokens, configs and customer data without sending any of it to a service they cannot inspect.

It is live at https://joshkcit.github.io/free-open-dev-tools/. The catalog, `docs/catalog.json`, lists 224 tools in
fourteen categories, and every one is built, tested and live.

**Core value:** a developer can use any tool without their input leaving the browser, and can take that tool's
complete, tested source for their own project.

## Where things are

- `tools/<id>/`: one self-contained package per tool. `src/index.ts` is pure logic (no DOM, no network),
  `src/meta.json` is its documentation, `test/` holds its tests.
- `apps/web/src/tools/<id>.ts`: the tool's page, a field list and a `run()` that returns output blocks.
- `docs/catalog.json`: every tool, with its category and build tier. A new tool needs an entry here first.
- `scripts/`: the release gates and the generators. `docs/ARCHITECTURE.md` explains how the pieces fit.
- `e2e/`: browser tests, including the privacy harness in `e2e/privacy.spec.ts`.

## Working rules

- Do not edit generated files by hand. A tool's `README.md`, `package.json`, `LICENSE`, `tsconfig.json` and
  `vitest.config.ts` come from its `src/meta.json` through `pnpm sync`; `docs/LEDGER.md`, `docs/THIRD-PARTY.md` and
  `apps/web/src/generated-*.json` are generated too. CI fails when a generated file is out of date.
- `pnpm verify` runs everything CI runs except the browser tests. To run only the browser tests a change reaches:

  ```sh
  node scripts/affected-tools.mjs --base origin/main --run -- --project=chromium
  ```

- Never write the catalog size into a test. Specs read it from `docs/catalog.json` at run time.

## Constraints

- **Privacy**: No tool may perform a network request, write to storage, or put input in the URL. It is the core
  value, and it is enforced by ESLint, a static gate and a browser harness
- **Packaging**: A tool folder may not import from outside itself, nor depend on another tool package. Otherwise it
  cannot be lifted out, which is the second half of the core value
- **Correctness**: A tool's tests may not use another tool site as the oracle. They must be grounded in a
  specification, its published vectors, or a mature independent implementation used as a second opinion
- **Documentation**: Every tool must state its limits, and the limits list may not be empty, enforced by the catalog
  gate
- **Licensing**: MIT for everything original here: code, build scripts, documentation and site copy,
  backed by a root `LICENSE` file; runtime dependencies must be permissively licensed and their notices
  preserved, enforced by the licence gate; weak copyleft (MPL and similar) needs an explicit owner OK
- **Hosting**: GitHub Pages, which cannot set response headers. Each page therefore carries its own content
  security policy in its markup, a meta element written at build time as the first element of the head and
  checked on every build. It forbids the page from requesting anything outside the site (no fetch, XHR, WebSocket,
  beacon, outside images, fonts, media, frames, objects or form posts) and allows scripts only from the site itself
  plus the hash of one inline theme script; a page adds only what its tool declares it needs. A policy in
  markup cannot give framing protection, cannot report violations, cannot apply sandboxing by header and
  cannot stop a visitor following a link or a page navigating away, and some browser features (WebRTC, and
  connection hints such as preconnect, in some browsers) and browser extensions sit outside it. It is a
  second layer behind ESLint, the static gate and the browser harness.
- **Provenance**: Never name another website or product as the inspiration for a tool, in code, documentation,
  commit messages or the site. `pnpm check:provenance` and the local commit hooks enforce this; the hooks are turned
  on with `git config core.hooksPath .githooks`.

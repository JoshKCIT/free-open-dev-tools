# Architecture

## The shape of it

```
tools/<id>/src/index.ts              pure logic, no DOM, no network, its own tests
        |
        |  imported by
        v
apps/web/src/tools/<id>.ts           a field list and a run() returning render instructions
        |
        |  consumed by
        v
apps/web/src/components/ToolRunner   renders the form, runs the tool, renders the output
```

A tool page never contains processing logic, and a tool package never contains interface code. That line is what
makes the packages reusable and the pages uniform.

## Why the logic is a separate package

Three reasons, in order of importance:

1. **It can be taken.** The point of the project is that a developer can lift one folder out and use it. A folder that
   imported a shared runtime, a design system or a React hook could not be lifted.
2. **It can be tested properly.** Pure functions with no DOM run in Node, fast, with no browser and no mocking.
3. **The privacy claim becomes checkable.** A package that cannot touch `fetch` or `document` cannot leak, and a
   script can prove that statically rather than by inspection.

## Why the website builds from source, not from dist

`apps/web/vite.config.ts` aliases every `@fodt/<id>` import straight to `tools/<id>/src/index.ts`. The alternative,
importing each package built output, introduces a class of bug where the deployed site runs a stale copy of logic the
tests have already changed. Building from source removes it entirely.

The standalone `tsc` build of each package still has to work, and `scripts/check-standalone.mjs --full` proves it by
building and testing each folder in a temporary directory outside the workspace. So both properties hold: the site is
never stale, and the folders genuinely compile on their own.

## The declarative tool page

`apps/web/src/lib/tool-ui.ts` defines what a tool page is: a list of `Field` descriptors and a `run(values)` that
returns `OutputBlock` values. `ToolRunner` turns that into a form and a result panel.

This is deliberate. It means:

- Every tool gets the same keyboard behaviour, focus handling, labels, error presentation, copy and download controls,
  reset, and the "Processed locally in your browser" label, without each page reimplementing them.
- Accessibility is fixed in one place. The test asserting that every form control has an accessible name passes for
  all tools because there is one implementation of a form control.
- A new tool is roughly eighty lines of configuration rather than a bespoke component.

Fields can be conditional through `visible(values)`, which is how a tool shows different controls per mode without
needing its own layout code.

### Output blocks

`run()` returns blocks rather than markup: `code`, `text`, `keyvalue`, `table`, `list`, `swatches`, `image`, `files`,
`diff`, `note` and `sandboxed-html`. Tools describe what they produced; the renderer decides how it looks. A tool
cannot inject raw HTML into the page: `sandboxed-html` goes into a fully sandboxed iframe with its own restrictive
content security policy.

## Generated files, and why

Documentation drifts. The defence is to have one source and generate the rest.

| Source of truth                       | What is generated from it                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| `tools/<id>/src/meta.json`            | The folder README, the documentation panels on the tool page, and `package.json`. |
| `docs/catalog.json`                   | The catalog the website renders.                                                  |
| The installed dependency tree         | `docs/THIRD-PARTY.md`.                                                            |
| The test reports produced by a CI run | `docs/RELEASE-MANIFEST.json` and `.md`.                                           |

CI regenerates all of these and fails if the working tree changes afterwards, so a stale generated file cannot be
merged.

## Routing and static hosting

The site is a single-page app, but `scripts/prerender.mjs` writes a real HTML file per route, carrying that route
title and description, as both `<path>.html` and `<path>/index.html`. Static hosts differ on which one they serve for
an extensionless URL, so both exist.

This is not server rendering. The body is still built by the bundle; only the head differs per route. The benefit is
that `/tools/base64` is a genuine 200 with its own metadata rather than a 404 handled by a redirect trick, which
matters for links, bookmarks and search engines.

`404.html` serves the app so a mistyped URL lands on the not-found page, which points at the catalog.

## The privacy harness

`e2e/privacy.spec.ts` is the load-bearing test. For each tool page it:

1. Loads the production build and waits for the network to settle.
2. Starts recording requests, console output and page errors. Everything before this point is page load, which is not
   what the claim is about.
3. Types a unique canary string into every text input, cycling through each radio option so conditionally hidden
   fields are covered too.
4. Waits for auto-run and debouncing to finish.
5. Fails if any request was made, or if the canary appears in the URL, in `localStorage`, `sessionStorage`, IndexedDB,
   a cookie, or the console.
6. Fails if the output panel is missing, so a tool that silently does nothing cannot pass trivially.

## Dependency policy

Runtime dependencies are kept to what genuinely should not be written by hand. The entire shipped dependency set is
React, React DOM, React Router and `@noble/hashes`.

Cryptographic primitives always come from a reviewed library. Everything else, including CRC-32, the IP arithmetic,
the JSON parser and the chmod logic, is implemented here because doing so is straightforward, testable against a
published standard, and avoids a supply chain entry for no real gain.

These were surveyed for the probe.

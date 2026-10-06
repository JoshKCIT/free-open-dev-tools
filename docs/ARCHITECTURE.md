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
`diff`, `note`, `tree`, `countdown` and `sandboxed-html`. Tools describe what they produced; the renderer decides how
it looks. A tool cannot inject raw HTML into the page: `sandboxed-html` goes into a fully sandboxed iframe with its
own restrictive content security policy.

Two of the blocks are for results that are not flat text:

- `tree` draws nested entries as native expandable sections. Labels and details are text only, never read as markup.
  The block caps how many nodes and how many levels it draws and says so when it cuts, while Copy always gives the
  whole tree.
- `countdown` shows the whole seconds left until a device-clock time, with a progress bar that is hidden for visitors
  who ask for less motion. It keeps its own timer, announces nothing, and so never makes the rest of the page render
  again.

### What a page and a result can ask the runner for

Two optional fields keep the runner in charge of time, so no tool page keeps its own timers:

- `runLimit` on the page names the time limit the page's own background helper enforces, taken from that helper's
  exported constant. A run still going after about a second shows a line with the elapsed time and the limit, beside
  a Cancel button where the page allows cancelling, and the previous output is dimmed while it waits.
- `refreshAfterMs` on a result asks the runner to run the tool once more after that many milliseconds, with the
  values then in the form. There is one timer per result: an edit, Reset or leaving the page clears it, and a page
  that wants it again returns the field again. A tab that was hidden runs at once when it becomes visible after the
  due time. This is how the one-time-code page keeps its codes current by itself.

## Generated files, and why

Documentation drifts. The defence is to have one source and generate the rest.

| Source of truth                       | What is generated from it                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| `tools/<id>/src/meta.json`            | The folder README, the documentation panels on the tool page, and `package.json`. |
| `docs/catalog.json`                   | The catalog the website renders.                                                  |
| The installed dependency tree         | `docs/THIRD-PARTY.md`.                                                            |
| The test reports produced by a CI run | `docs/RELEASE-MANIFEST.json` and `.md`.                                           |

CI regenerates the committed ones (the tool READMEs and package files, the catalog, and `docs/THIRD-PARTY.md`) and
fails if the working tree changes afterwards, so a stale generated file cannot be merged. The release manifest is
never committed: CI builds it fresh on every run and publishes it as that run's job summary and workflow artifact.

## Routing and static hosting

The site is a single-page app, but `scripts/prerender.mjs` writes a real HTML file per route, carrying that route
title and description, as both `<path>.html` and `<path>/index.html`. Static hosts differ on which one they serve for
an extensionless URL, so both exist.

This is not server rendering. The body is still built by the bundle; only the head differs per route. The benefit is
that `/tools/base64` is a genuine 200 with its own metadata rather than a 404 handled by a redirect trick, which
matters for links, bookmarks and search engines.

`404.html` serves the app so a mistyped URL lands on the not-found page, which points at the catalog.

Every in-site link loads a fresh document. A browser keeps the policy of the first document it loaded, so client-side
routing would leave every later page under the policy of the first one. `SiteLink` and `SiteNavLink` in
`apps/web/src/components/SiteLink.tsx` wrap the router's links with a full document load, the router still builds the
address so the base path is applied, and a lint rule forbids using the router's own link components anywhere else.

### Content security policy per page

GitHub Pages cannot set response headers, so each page carries its own content security policy in its markup.
`scripts/prerender.mjs` writes it at build time, using `scripts/lib/csp.mjs`, as a meta element that is the first
element of the head, with the charset meta second. Both files of one route (`<path>.html` and `<path>/index.html`)
carry the same policy.

**What it blocks.** The baseline policy lets scripts come only from the site itself plus the hash of the one inline
theme script, which is computed from the final HTML and never written by hand. Styles may come only from the site
itself, and images only from data and blob addresses. Every other kind of outside load (connections, fonts, frames,
media, objects, the web app manifest, form posts, workers and the page base) is set to none. So a page cannot fetch, send a beacon, open a socket or an event
stream, or load anything from another site, whatever its code tries.

**What a page adds.** A tool declares what it needs in `tools/<id>/src/meta.json`, under `needs`, from a closed list of
five terms. A page with no `needs` gets the baseline and nothing else.

| Term             | What it adds to the baseline                                                             |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `workers`        | Background workers built from blob addresses. Never workers from an address of the site. |
| `wasm`           | WebAssembly compilation.                                                                 |
| `eval`           | Run-time code generation, which also lets WebAssembly compile.                           |
| `sandboxed-html` | Inline styles, because the preview frame's own policy asks for them.                     |
| `mermaid-frame`  | The two build-time hashes of the Mermaid frame's inline scripts, and inline styles.      |

Run-time code generation is limited to eight pages, fixed in the gate and in its test: `docker-compose-validator`,
`docker-run-to-compose` (it compiles the Compose schema when its page loads), `github-actions-validator`,
`json-schema-validator`, `k8s-validator`, `openapi-validator`, `sass-less-compiler`, and `font-inspector`, which is
reserved for a later phase. No page gets inline scripts.

**The gate.** `scripts/check-csp.mjs` is the last step of the production build. It finds the built code each tool page
loads, scans it for the code each term allows, and fails the build when a tool's `needs` and its built code disagree
in either direction, when a page's written policy differs from the one its needs produce, or when a page does not open
its head with exactly one policy. The only hand-kept list is `scripts/csp-acks.json`: each entry is a reviewed false
positive with a one-line reason, and an entry that is stale or contradicts the code fails too. A pass prints
`CSP-GATE-OK`. The same script with `--live <address>` repeats the page check against a running site, which is what the
post-deployment job does after every deploy.

**What it cannot do.** A policy in markup is a second layer, not a wall. It gives no framing protection, because that
needs a response header. It cannot report violations to anyone, and it cannot apply sandboxing the way a header can. It
cannot stop a visitor following a link, or a page navigating away. It does not govern WebRTC, or connection hints such
as preconnect, in every browser (both were measured getting past it in some). Browser extensions sit outside it. For
those reasons it sits behind three checks that do the main work: the lint rules that forbid network code, the static
gate in the build, and the browser harness, which fails a tool's privacy test when the page, one of its frames or one
of its workers breaks its own policy.

**If the site moves to a host that sets headers**, see `docs/DEPLOYMENT.md`: a header policy would have to be written
per route, because workers, WebAssembly, code generation and previews differ from page to page.

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
7. Fails if the page, one of its frames or one of its workers breaks the page's own content security policy. The
   violation probe is armed before the page loads, because a request the policy refuses leaves no trace in the
   request list, so the request check alone would stay green on a real leak.

A fixture can carry real files inline, as text or base64, inside its own fixture file (`inlineFiles`, see
`e2e/fixture-inline.ts`), so a tool that needs a binary or a mail message adds one fixture file and edits no shared
spec. The sizes the specs count come from the catalog at run time, never from a number written in a spec.

## Dependency policy

Runtime dependencies are kept to what genuinely should not be written by hand. The entire shipped dependency set is
React, React DOM, React Router and `@noble/hashes`.

Cryptographic primitives always come from a reviewed library. Everything else, including CRC-32, the IP arithmetic,
the JSON parser and the chmod logic, is implemented here because doing so is straightforward, testable against a
published standard, and avoids a supply chain entry for no real gain.

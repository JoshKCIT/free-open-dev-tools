# Free & Open Dev Tools

Free developer tools, published for anyone to use. Explore the source, download individual tools, and make them your own.

Every tool runs in your browser. Your input is processed by JavaScript already loaded in the tab and is never
transmitted, stored or put in the URL. That is not a promise in a footer: it is checked on every commit by a test that
drives each tool in a real browser and fails the build if anything escapes. See [Privacy](#privacy) below.

- **Site:** https://joshkcit.github.io/free-open-dev-tools/
- **Licence:** MIT for all original code. Third-party notices in [`docs/THIRD-PARTY.md`](docs/THIRD-PARTY.md).

## Take a single tool

Each tool lives in its own folder with its own package file, tests, README and licence, and imports nothing from the
rest of this repository. To use one on its own:

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/base64 base64
cd base64
npm install
npm test
```

That gets you a working, tested copy with no reference back here. The same three lines work for any folder under
[`tools/`](tools).

## What is in here

| Path                                     | What it holds                                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [`tools/`](tools)                        | One self-contained package per tool: pure TypeScript logic plus its tests. No DOM, no React, no network. |
| [`apps/web/`](apps/web)                  | The website. A thin layer over the tool packages: form controls in, rendered results out.                |
| [`docs/catalog.json`](docs/catalog.json) | The list of every tool this project intends to have, with each one's category and build tier.            |
| [`e2e/`](e2e)                            | Browser tests, including the privacy harness that checks the central claim.                              |
| [`scripts/`](scripts)                    | The release gates and the generators that keep documentation from drifting.                              |

## How a tool is built

**Logic is separate from interface.** `tools/<id>/src/index.ts` is a plain module that takes values and returns
values. It never touches the DOM and never makes a request, so it can be tested in Node, reused in a CLI, or dropped
into someone else's project.

**Behaviour is specified before it is written.** Each tool names the standard it implements in its
`src/meta.json`, and that file is the single source of truth for the documentation shown on the website _and_ in the
folder's README. They cannot disagree, because the README is generated from it.

**Correctness is tested against standards, not against other tool sites.** Where a specification publishes test
vectors, those vectors are asserted directly: RFC 4648 for Base64, RFC 1321 and FIPS 180-4 for hashes, RFC 4231 for
HMAC, RFC 9562 for UUIDs, RFC 7519 for JWT. Where an independent implementation exists, a differential test compares
against it as a second opinion, never as the primary oracle.

**Ambiguity is written down.** Duplicate JSON keys, timestamp units, cron dialects, `/31` subnets, the difference
between decoding a JWT and verifying one: each is a place where reasonable implementations disagree. Every tool with
such a case states what it does and why, on the page and in the README.

## Running it locally

```sh
pnpm install
pnpm dev            # the site at http://127.0.0.1:5173
pnpm test           # unit tests for every tool package
pnpm verify         # everything CI runs, except the browser tests
pnpm e2e            # browser tests against the production build
```

`pnpm verify` runs the inventory check, regenerates the tool files, typechecks, lints, runs the unit tests, and then
the three release gates:

| Gate               | What it blocks                                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check:catalog`    | A tool on the site with no tests, a folder with no page, empty documentation, or any code path that could transmit input.                           |
| `check:standalone` | A tool folder that could not be lifted out and used on its own. Add `--full` to actually install, build and test each folder outside the workspace. |
| `check:licenses`   | A dependency under a licence that cannot be shipped here, or one whose notice is missing. Regenerates `docs/THIRD-PARTY.md`.                        |

## Privacy

The [privacy page](apps/web/src/pages/Privacy.tsx) is written to be precise rather than reassuring. The short version:

- **Your input never leaves the tab.** No tool performs a network request while processing. There is no backend.
- **Nothing is persisted.** No tool writes your input to storage, a cookie or the URL. The only thing stored in your
  browser is the string `light` or `dark` under `fodt-theme`.
- **The host can still see which page you opened.** The site is served by GitHub Pages, which receives and may log
  your IP address, the time, the path and your user agent, exactly as any web host does. That is GitHub's log, not
  ours, and nothing on this site adds to it. What you typed is not in it.
- **Nothing is loaded from a third party.** No CDN, no web font service, no analytics, no icon host. A third-party
  request would hand that party your IP address and the page you are on, so there are none.

[`e2e/privacy.spec.ts`](e2e/privacy.spec.ts) enforces this. For every tool page it types a unique canary string into
every input, then fails if that string reaches a request, storage, a cookie, the URL or the console, or if any network
request happens at all during processing.

## The catalog

The catalog is **144** tools. **16** of them are built, tested and usable today; the rest are listed so the gap is
visible.

- [`docs/LEDGER.md`](docs/LEDGER.md) — what is built, what is next, and what is outstanding.
- [`docs/RELEASE-MANIFEST.md`](docs/RELEASE-MANIFEST.md) — what shipped, from which commit, and what was verified.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). A new tool needs its logic, its tests, its `meta.json` and a page; everything
else is generated. The rules a tool has to satisfy before it can be merged are enforced by `pnpm verify`, so you can
check your own work before opening a pull request.

Please describe input in bug reports rather than pasting it, especially anything sensitive. The issue link on each
tool page deliberately carries no input.

## Licence

MIT. See [LICENSE](LICENSE).

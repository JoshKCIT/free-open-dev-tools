# Contributing

Thanks for looking. This file describes what a tool has to do before it can be merged, and how to add one.

## Before your first commit

Run this once per clone:

```sh
git config core.hooksPath .githooks
```

This turns on two local hooks that check every commit against a small local gate before it is
written. They read their list from `.provenance-denylist` at the repository root, which is
deliberately git-ignored and not distributed with the repository. A fresh clone without that file
still works: the hooks print a warning and run a reduced check instead of failing. The same gate
also runs in CI on every push and pull request, reading its list from a repository secret
instead — that is the enforcement; the local hooks are a convenience so you find out sooner.

It is a secret rather than a variable for a specific reason: GitHub Actions masks secrets in job
logs and does not mask variables. A variable is echoed verbatim in the `env:` group of every step
that uses it, and this repository's logs are public, so a variable would publish the list on every
run.

A fork's CI has no repository secret of that name, so the gate fails closed there by design. A
fork maintainer who wants CI to pass again must either set their own repository secret or remove
that step from the workflow.

## The short version

```sh
pnpm install
node scripts/new-tool.mjs <tool-id>         # scaffolds the folder
# write src/index.ts, src/meta.json and test/
pnpm sync                                   # generates package.json, README, licence, configs
pnpm verify                                 # runs everything CI runs, except browser tests
```

Then add `apps/web/src/tools/<id>.ts` to give it a page, and run `pnpm e2e`.

## Rules a tool must satisfy

These are not style preferences. Each one is enforced by a script, and a pull request that breaks one fails CI.

### 1. It must not be able to transmit anything

A tool package may not call `fetch`, construct an `XMLHttpRequest`, open a `WebSocket` or `EventSource`, call
`navigator.sendBeacon`, or dynamically import a remote URL. `scripts/check-catalog.mjs` strips comments and string
literals, then scans for these, so mentioning them in documentation is fine and calling them is not.

ESLint additionally forbids `localStorage`, `sessionStorage`, `indexedDB` and `document` inside `tools/*/src`. Tool
logic has no business touching the DOM: keeping it out is what makes the logic testable in Node and reusable anywhere.

### 2. It must not persist or expose input

The page layer must not write input to storage, to a cookie, or to the URL. `e2e/privacy.spec.ts` types a canary
string into every input on every tool page and fails if it turns up anywhere it should not, or if any network request
happens while the tool is running.

If your tool genuinely needs to save something between visits, it has to be explicit, local, clearable, and opted into
by the user. Raise it in an issue first.

### 3. It must stand alone

`tools/<id>` may not import from `../../`, from another tool, or from anything under `@fodt/`. Its dependencies must
be real published packages, never `workspace:`, `link:` or `file:` ranges. Someone must be able to copy the folder
out, run `npm install && npm test`, and have it work.

`node scripts/check-standalone.mjs --full` proves this by actually doing it in a temporary directory outside the
workspace.

### 4. It must document its limits

`src/meta.json` requires `about`, `supports` and `limits`, and `limits` may not be empty. Every tool has limits. A
tool that claims none is a tool that has not been thought about, and the gate rejects it.

If your tool has a case where reasonable implementations disagree, add an `ambiguities` array saying what you chose
and why. Examples already in the tree: duplicate JSON keys, JWT timestamps in milliseconds, `/31` subnets,
Base64 without padding.

### 5. Its correctness must be grounded in something

Do not test a tool by comparing it against another tool site. In order of preference:

1. **Published test vectors.** If the standard has them, assert them directly and cite the section.
2. **The standard's rules.** Write a test per rule, including the ones about what must be rejected.
3. **A mature independent implementation**, as a differential test. Node's own `crypto`, `Buffer`, `URLSearchParams`
   and `Intl` are all useful here. Treat this as a second opinion, never as the definition.
4. **Property and round-trip tests**, where they say something. A round trip proves the pair is consistent, not that
   either half is right, so it never stands alone.

Cover, where they apply: typical input, empty input, malformed input, Unicode and astral-plane characters, escaping,
multiline data, boundary values, numeric precision, large input, locale and time zone differences, adversarial input,
and cases where conversion loses information.

## Adding a tool, step by step

### 1. Pick an id from the catalog

Every tool must already exist in `docs/catalog.json`.

### 2. Scaffold

```sh
node scripts/new-tool.mjs json-diff
```

This writes `tools/json-diff/` with a starter `src/index.ts`, `src/meta.json` and `test/index.test.ts`.

### 3. Write the logic

`src/index.ts` exports plain functions and `meta`. Keep it pure. Errors should be typed and carry enough detail to
show a useful message: a position, a line and column, or a path.

### 4. Write `src/meta.json`

This one file drives the tool page, the folder README and the release gates. Fields:

| Field                            | Required | What it is                                                          |
| -------------------------------- | -------- | ------------------------------------------------------------------- |
| `id`, `name`, `summary`          | yes      | Must match `docs/catalog.json` exactly.                             |
| `about`                          | yes      | Two or three sentences: what it does and when to reach for it.      |
| `supports`                       | yes      | What is accepted, specifically. Name versions and dialects.         |
| `limits`                         | yes      | What it will not do and where it loses information. Never empty.    |
| `ambiguities`                    | no       | Where implementations disagree, and what this one chose.            |
| `standards`                      | no       | The specifications it implements, with URLs.                        |
| `dependencies`                   | no       | Runtime dependencies. These flow into the generated `package.json`. |
| `usage`, `apiNotes`, `testNotes` | no       | Shown in the generated README.                                      |

### 5. Write the tests

Put them in `test/`. Name the specification section in the describe block where a vector comes from one.

### 6. Generate the rest

```sh
pnpm sync
```

This writes `package.json`, `tsconfig.json`, `vitest.config.ts`, `LICENSE` and `README.md`. Do not edit those by
hand: they are regenerated, and CI fails if they are out of date.

### 7. Add the page

`apps/web/src/tools/<id>.ts` exports a `defineTool({ ... })` describing the fields and what to render. Import the
documentation from the package's `meta` so there is one source of truth:

```ts
import { meta, doTheThing } from '@fodt/json-diff';
import { defineTool, str, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'json-diff',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [{ name: 'input', label: 'JSON', type: 'textarea', rows: 12 }],
  examples: [{ label: 'Sample', values: { input: '{"a":1}' } }],
  run(values): ToolResult {
    return { outputs: [{ kind: 'code', value: doTheThing(str(values, 'input')) }] };
  },
});
```

Give it at least one example. The browser test clicks the first example button and fails the build if it produces
nothing, which is what stops an unfinished page shipping.

### 8. Verify

```sh
pnpm verify
pnpm e2e
```

## Dependencies

Prefer no runtime dependency. Where one is needed, especially for cryptography, use a well-reviewed library rather
than writing your own: `@noble/hashes` is already here and is the right default for digests and HMAC.

A new runtime dependency must be permissively licensed. `pnpm check:licenses` has the allow list, blocks copyleft
licences that would impose their terms on the whole site, and regenerates `docs/THIRD-PARTY.md`.

## Reporting a bug

Describe the input rather than pasting it. If the bug only reproduces with a specific value, replace the sensitive
parts with placeholders of the same shape and length. The issue link on each tool page carries the tool name and
nothing else, deliberately.

## Security

See [SECURITY.md](SECURITY.md).

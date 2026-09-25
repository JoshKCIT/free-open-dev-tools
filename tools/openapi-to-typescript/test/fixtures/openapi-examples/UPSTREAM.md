# Upstream source

- Repository: `https://github.com/OAI/learn.openapis.org`
- Commit: `bbb743ed3b7c5ed76b6e6ba9b302af38f3956c44` (resolved via
  `https://api.github.com/repos/OAI/learn.openapis.org/commits/main`, fetched 2026-09-25)
- Licence: CC BY 4.0 (`LICENSE` in this folder, from the same repository and commit)
- Fetch date: 2026-09-25

## Files (51, plus this folder's own `LICENSE` and `UPSTREAM.md`)

Every file under `examples/v2.0/json/`, `examples/v2.0/yaml/`, `examples/v3.0/` and `examples/v3.1/` at
the commit above, fetched byte for byte via
`https://raw.githubusercontent.com/OAI/learn.openapis.org/bbb743ed3b7c5ed76b6e6ba9b302af38f3956c44/<path>`
and stored here with the leading `examples/` segment dropped (so `examples/v2.0/json/petstore.json`
became `v2.0/json/petstore.json`).

- `v2.0/json/`: `api-with-examples.json`, `petstore-expanded.json`, `petstore-minimal.json`,
  `petstore-separate/common/Error.json`, `petstore-separate/spec/{NewPet,Pet,parameters,swagger}.json`,
  `petstore-simple.json`, `petstore-with-external-docs.json`, `petstore.json`, `uber.json` (12 files)
- `v2.0/yaml/`: the same 12 documents as YAML, plus the same `petstore-separate/` split
- `v3.0/`: `api-with-examples`, `callback-example`, `link-example`, `petstore-expanded`, `petstore`,
  `uspto`, each as `.json`, `.yaml` and a `.md` walkthrough (18 files)
- `v3.1/`: `non-oauth-scopes`, `tictactoe`, `webhook-example`, each as `.json`, `.yaml` and `.md` (9 files)

**Deviation from the plan's own text (Rule 1 — the plan's own instruction did not match what the
repository actually contains):** the plan's action text says to fetch "`examples/v3.0/` ... (including
the `petstore-separate` folder)". At the pinned commit, `learn.openapis.org` has NO `petstore-separate`
folder under `examples/v3.0/` — that split-file layout exists only under `examples/v2.0/`. Confirmed by
listing the full commit tree (`git/trees/<sha>?recursive=1`) and searching for `petstore-separate`: all
ten matches are under `v2.0/`. All of `examples/v3.0/` (18 files, matching the directory as it actually
exists) was vendored; there is no missing `petstore-separate` split to add for 3.0.

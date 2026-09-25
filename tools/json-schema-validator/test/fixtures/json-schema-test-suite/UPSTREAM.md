# Upstream: JSON-Schema-Test-Suite

- **Repository:** https://github.com/json-schema-org/JSON-Schema-Test-Suite
- **Commit:** `5b0ee1613e45fcc2bddac00e07c19cd49b00d8a8` (resolved from the repository's `main` branch)
- **Commit date:** 2026-09-21T18:57:04Z
- **Fetch date:** 2026-09-25
- **License:** `LICENSE` in this folder (vendored unmodified from the upstream repository root)

## Files vendored

Every top-level `.json` file under the upstream `tests/draft7/` and `tests/draft2020-12/`
directories, except `refRemote.json` in each (it requires the suite's own remote HTTP server;
this tool never fetches a remote `$ref`, so those cases cannot be exercised here).

- `draft7/`: 36 files (37 top-level files in the upstream folder, minus `refRemote.json`)
- `draft2020-12/`: 45 files (46 top-level files in the upstream folder, minus `refRemote.json`)

No file listed above was edited after fetching. Fetched with:

```
curl -fsSL https://raw.githubusercontent.com/json-schema-org/JSON-Schema-Test-Suite/5b0ee1613e45fcc2bddac00e07c19cd49b00d8a8/tests/<draft>/<file>.json
```

## Note for the release plan (04-09)

`draft2020-12/content.json` contains several JWT-shaped base64 strings (e.g.
`eyJmb28iOiAiYmFyIn0K`) used as `contentEncoding`/`contentMediaType` test vectors. These are
published test fixtures from the upstream suite, not real credentials, but plan 04-09 should
review them against the secret scanner (gitleaks) before pushing, per this phase's `<decisions>`
carried-forward rule that secret-scanner false positives on published vectors go into
`.gitleaksignore` by exact fingerprint.

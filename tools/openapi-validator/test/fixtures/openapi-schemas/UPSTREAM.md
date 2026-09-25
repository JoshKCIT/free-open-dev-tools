# Upstream sources

Every file in this folder is vendored byte for byte from the sources below, fetched live at plan
execution time (2026-09-25) rather than transcribed from memory or an older cached copy, per D-83.

## Swagger 2.0

- Repository: `https://github.com/OAI/OpenAPI-Specification`
- Commit: `447c479c9c7136918e80a57a258fd6c84f369c7c` (resolved via
  `https://api.github.com/repos/OAI/OpenAPI-Specification/commits/main`, fetched 2026-09-25)
- File: `https://raw.githubusercontent.com/OAI/OpenAPI-Specification/447c479c9c7136918e80a57a258fd6c84f369c7c/_archive_/schemas/v2.0/schema.json`
  → `swagger-2.0.schema.json`
- Licence: Apache-2.0 (`LICENSE` in this folder, from the same repository and commit)
- JSON Schema draft: draft-04 (`"$schema": "http://json-schema.org/draft-04/schema#"`)

## OpenAPI 3.0

- Source: `https://spec.openapis.org/oas/3.0/schema/2024-10-18` (the newest dated release listed at
  `https://spec.openapis.org/oas/` when this plan executed) → `openapi-3.0.schema.json`
- Licence: Apache-2.0 (OpenAPI-Specification repository licence; spec.openapis.org publishes the OAI's
  own dated schema releases)
- JSON Schema draft: draft-04 (`"$schema": "http://json-schema.org/draft-04/schema#"`)

## OpenAPI 3.1

- Source: `https://spec.openapis.org/oas/3.1/schema-base/2026-08-03` → `openapi-3.1.schema-base.json`
- Source: `https://spec.openapis.org/oas/3.1/schema/2026-08-03` → `openapi-3.1.schema.json`
  (the document `schema-base` itself `$ref`s)
- Source: `https://spec.openapis.org/oas/3.1/dialect/2024-11-10` → `openapi-3.1.dialect.json` (the newest
  dated dialect release listed at `https://spec.openapis.org/oas/` when this plan executed)
- Source: `https://spec.openapis.org/oas/3.1/meta/2024-11-10` → `openapi-3.1.meta.json`
- Licence: Apache-2.0
- JSON Schema draft: 2020-12 (`"$schema": "https://json-schema.org/draft/2020-12/schema"`), using
  `$dynamicRef`/`$dynamicAnchor` for its own OpenAPI Schema Object dialect

## OpenAPI 3.2

- Source: `https://spec.openapis.org/oas/3.2/schema-base/2026-08-30` → `openapi-3.2.schema-base.json`
- Source: `https://spec.openapis.org/oas/3.2/schema/2026-08-30` → `openapi-3.2.schema.json`
- Source: `https://spec.openapis.org/oas/3.2/dialect/2026-02-26` → `openapi-3.2.dialect.json` (the newest
  dated dialect release listed at `https://spec.openapis.org/oas/` when this plan executed)
- Source: `https://spec.openapis.org/oas/3.2/meta/2026-02-26` → `openapi-3.2.meta.json`
- Licence: Apache-2.0
- JSON Schema draft: 2020-12, same dialect mechanism as 3.1

## Notes

- The `spec.openapis.org` URLs above are already dated (immutable) releases, not `latest`, so no
  separate commit pin is needed for them (D-83, RESEARCH.md Pattern 6 Open Question 3): re-fetching the
  same URL always returns the same bytes.
- Field ordering and formatting are exactly as served; `src/schema-*.json` holds a prettier-formatted
  copy of each, proven deep-equal to these vendored originals by a required test.

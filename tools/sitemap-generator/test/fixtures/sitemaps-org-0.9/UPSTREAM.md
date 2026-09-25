# Upstream source

- `sitemap.xsd`: https://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd
- `siteindex.xsd`: https://www.sitemaps.org/schemas/sitemap/0.9/siteindex.xsd
- Fetched: 2026-09-25

Licence, quoted verbatim from `https://www.sitemaps.org/terms.html`: "The Sponsors' copyrights in the
sitemaps protocol specification, as published on the Website (the "Specification"), are licensed to you
under the Creative Commons Attribution-ShareAlike License (version 2.5)."

Both files are the sitemaps.org protocol 0.9's own XML Schema Definitions, vendored byte for byte so
`xmllint-wasm` (devDependency-only, Node-test-only) can validate this package's generated output against
the real schema rather than a transcription. Never edited.

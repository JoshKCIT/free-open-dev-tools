Source: https://github.com/schemaorg/schemaorg, `data/releases/30.1/schemaorg-current-https.jsonld`

Resolved commit (tag `v30.1`): `5f2d8cdec99b7329459ef6584e94b6a840f88471`

Version: 30.1, released 2026-09-16 (per https://schema.org/docs/releases.html:
"Version 30.1 - Add vocabulary to support discovery of EU Digital Product
Passports, Add vocabulary to express common eCommerce product data, Misc.
schema, doc, and infra updates. Cleanup release notes.")

Fetched: 2026-09-25

Licence: CC BY-SA 3.0. Quoted verbatim from https://schema.org/docs/terms.html
(fetched 2026-09-25):

> The Sponsors' copyrights in the schema are licensed to website publishers
> and other third parties under the Creative Commons Attribution-ShareAlike
> License (version 3.0). To view a copy of this license, please visit
> http://creativecommons.org/licenses/by-sa/3.0/.

Vendored here byte for byte as `schemaorg-current-https.jsonld`. The file's
`@graph` array has 3,256 nodes (types, properties and enumeration members)
across schema.org's core vocabulary plus every pending/extension vocabulary
schema.org also publishes in this one release file (health-lifesci, bib,
auto, meta, pending -- each node from those carries its own `schema:isPartOf`
field naming which one).

Used by `tools/schema-markup/src/schema-org-subset.ts` (the bundled subset
this project ships, core vocabulary only) and by
`tools/schema-markup/test/subset.test.ts`, which re-derives the bundled
tables from this file at test time and asserts deep equality, so the bundle
can never silently drift from this source.

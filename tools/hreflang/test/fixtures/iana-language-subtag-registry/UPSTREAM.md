Source: https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry

Fetched: 2026-09-25

File-Date (the registry's own self-reported date, first line of the file): 2026-09-17

731,819 bytes, 49,316 lines. 9,296 records total (each record delimited by a
`%%` line): 8,276 `Type: language`, 258 `Type: extlang`, 225 `Type: script`,
305 `Type: region`, 139 `Type: variant`, 26 `Type: grandfathered`, 67
`Type: redundant`.

Licence: both IANA and IETF dedicate the Protocol Registries to the public
domain under CC0 1.0. Quoted verbatim from
https://www.iana.org/help/licensing-terms (fetched 2026-09-25):

> IANA and IETF intend that the Protocol Registries may be freely used by
> any party for any purpose. Both IANA and IETF believe that the Protocol
> Registries consist primarily of factual information that is unlikely to be
> protectable as a matter of copyright law. However, for additional clarity,
> and to avoid any potential confusion about applicable rights, both IANA
> and IETF desire to (a) dedicate any applicable copyright rights that they
> may own in the Protocol Registries to the public domain, and (b) license
> any copyright or related rights for which they are a licensee (with a
> right to sublicense) to the broadest extent that they are permitted to do
> so. Accordingly, both IANA and IETF affirm that any applicable rights that
> they may have in the Protocol Registries are subject to the Creative
> Commons CC0 1.0 dedication found at
> https://creativecommons.org/publicdomain/zero/1.0/legalcode.

Vendored here byte for byte as `language-subtag-registry`. Used by
`tools/hreflang/src/iana-language-subtag-registry.ts` (the bundled, dated
snapshot this project ships) and by `tools/hreflang/test/registry.test.ts`,
which re-derives the bundled tables from this file at test time and asserts
deep equality, so the bundle can never silently drift from this source.

# Upstream source: HTML Living Standard, SVG tag-name adjustment table

- **URL:** https://html.spec.whatwg.org/multipage/parsing.html
- **Section:** "The 'in foreign content' insertion mode", the table used by the step "If the adjusted
  current node is an element in the SVG namespace, and the token's tag name is one of the ones in the
  first column of the following table, change the tag name to the name given in the corresponding cell
  in the second column. (This fixes the case of SVG elements that are not all lowercase.)"
- **Fetched:** 2026-09-25 (page `Last-Modified: Fri, 25 Sep 2026 09:21:51 GMT`, per the response headers
  at fetch time)
- **Licence:** the HTML Living Standard is published under the Creative Commons Attribution 4.0
  International License (CC BY 4.0), per the standard's own "Copyright" section
  (https://html.spec.whatwg.org/multipage/introduction.html#copyright).
- **Files in this folder:**
  - `svg-tag-names-table.html` — the exact `<table>...</table>` markup for this one table, cut from the
    fetched page, byte for byte
- **Extracted entry count:** 37 lowercase-tag-name to camelCase-element-name pairs (`test/index.test.ts`
  re-reads this file by line pattern and asserts this count and every pair equal `src/svg-tag-names.ts`).

This file is never imported or executed. It is read as plain text by a line-pattern parser (matching
`<td> <code>name</code>` pairs) so the equality test does not depend on parsing full HTML.

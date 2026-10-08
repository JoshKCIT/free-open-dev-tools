# The recorded second opinion: the specification's reference parser

`reference.json` holds what `@conventional-commits/parser` answers for 1,043 commit messages. The tests read this file and
never load the parser. It is a second opinion, not the specification: where this page and the parser differ, the page follows
the numbered rules of Conventional Commits 1.0.0 as worded, and every such place is listed below by name.

| What          | Value                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| Parser        | `@conventional-commits/parser` 0.4.1 (ISC), "reference implementation of conventionalcommits.org spec"      |
| Recorded      | 2026-10-08T07:48:45Z (UTC), Node v22.14.0. The first recording (2026-10-08T03:57:12Z) held the first 1,033 rows; they are byte for byte the same in this one |
| Recorded by   | `record-reference.cjs`, run by hand from a scratch folder that already held the package (nothing installed here) |
| Command       | `node record-reference.cjs <folder holding node_modules/@conventional-commits/parser> reference.json`        |
| Messages      | `make-corpus.mjs`: the 33 research probes, then 1,000 generated messages (mulberry32, seed 20261008), then the 10 probes added in code review (`REVIEW_PROBES`) |
| Result        | 1,043 messages, 969 accepted and 74 rejected by the parser                                                    |
| Held in file  | per message: `accepted`, and when accepted its parts: type, scope, `bang`, description, body, footers (token, separator, value) and `breaking` |

The generated messages are of three kinds: well-formed ones (60 %: a clean header, plain paragraphs, footers after one blank
line), structural ones (25 %: footer-shaped lines inside the body, one or two blank lines, footers glued to the body, values
that run over blank or unindented lines) and header mutations (15 %: no space after the colon, a tab or a no-break space, an
empty description, an empty or nested scope, doubled or misplaced marks, a leading space, look-alike characters).

The review probes are BREAKING CHANGE lines that come close to a breaking footer and are not one (glued to body text, a colon
that ends the line, the same line with one space after the colon, no space after the colon, a plural, lower case inside the
footer block, a colon that ends the line inside the footer block) and a BREAKING CHANGE or BREAKING-CHANGE footer written
with a space and a number sign. The parser and this page read all ten differently.

## What the test checks

For every recorded message the page's parser is run. The two agree when both say valid or both say not valid and, for a valid
message, the type, scope, `!` mark, description, body, footers (token, separator and value, white space collapsed) and
breaking flag are equal. 768 messages agree. For the other 275 the test requires at least one of the named families below to
apply to the message, and requires every family to explain at least one recorded difference, so a name can never go stale.

## The families where this page follows the wording of the specification

1. **No space after the colon** (rule 1: "REQUIRED terminal colon and space"). The parser accepts `feat:x`; this page says not valid.
2. **An empty description** (rule 5: "A description MUST immediately follow the colon and space"). The parser accepts `feat:` and `feat: `.
3. **A tab or a no-break space in place of the space after the colon** (rule 1). The parser counts a tab, a no-break space and a
   zero width no-break space as white space.
4. **White space before the type** (rule 1: commits "MUST be prefixed with a type"). The parser trims the message first.
5. **A space and a number sign in place of the colon of the header** (rule 1). The parser reads `fix #12: text` as a header with
   the footer separator ` #`; the specification gives that separator to footers only (rule 8).
6. **A second line that is not blank** (rules 6 and 8: the body, and the footers, begin one blank line after what comes before).
   The parser accepts `feat: x` followed directly by body text or a footer.
7. **A footer glued to body text** (rule 8: footers "one blank line after the body"). The parser reads `Signed-off-by: A` straight
   after a body line as a footer, and a `BREAKING CHANGE:` line straight after body text as a breaking change. This page keeps
   such a line in the body and says so in a note.
8. **A footer value that runs over a blank or unindented line** (rule 10: a value "MAY contain spaces and newlines, and parsing
   MUST terminate when the next valid footer token/separator pair is observed"). The parser only continues a value with an
   indented line and otherwise reads the whole tail as body. With one space after its colon, `BREAKING CHANGE: ` followed by a
   line of text is a breaking footer here whose description is that line; the parser keeps both lines in the body.
9. **A footer separator that is not a colon and a space or a space and a number sign** (rule 8). The parser accepts `Refs:#5`,
   `Refs:` at the end of a line and `http://example.invalid/a` as footers. It also counts `BREAKING CHANGE:` with the colon at
   the end of the line, and `BREAKING CHANGE:text` with no space, as a breaking change; this page reads both as text and names
   them in a note.
10. **A footer token that holds a scope or a `!` mark** (rules 8 and 9: "a word token"). The parser accepts `Closes(api): #5`
    and `Break!: now` as footers.
11. **A BREAKING CHANGE footer written with a space and a number sign** (rule 12: "the uppercase text BREAKING CHANGE, followed
    by a colon, space, and description"). The parser counts `BREAKING CHANGE #12` and `BREAKING-CHANGE #12` as breaking
    changes; this page says the message is not valid by rule 12.
12. **A line that starts with BREAKING CHANGES** (rule 12: the token is BREAKING CHANGE; rule 7: a body is free-form text). The
    parser takes the words BREAKING CHANGE off the line and keeps only `S: plural` as body text; this page keeps the whole line
    as body text and says in a note that the token has no S. Neither counts it as a breaking change.

Not generated, and so not recorded: a carriage return that is not followed by a line feed (the parser reads it as a line end,
this page keeps it in the line and shows it as an escape).

# A second opinion on glob matching

A recorded comparison of this package's glob matcher with the `editorconfig` library for JavaScript (npm package
`editorconfig`, version 3.0.2, MIT licence). Unit tests never run that library: they read this recording.

| | |
| --- | --- |
| Library | editorconfig 3.0.2 (npm, MIT) |
| Recorded | 2026-10-08T04:52:30.301Z (UTC) with Node 22.14.0 |
| Seed | 99, 6000 draws |
| Pairs | 5900 (glob, path) pairs the library accepted |
| Disagreements | 34, all in three named families |

## How it was recorded

`make-pairs.mjs` draws the pairs: a seeded generator (seed 99) joins one to four tokens into a glob (stars, double
stars, question marks, classes, braces, a number range, an escaped star, slashes) and one to five tokens into a path, drops a
path that is empty or holds a . or .. part, and `record-editorconfig.cjs` hands each pair to the library as the file
"root = true", an empty line, "[glob]", "k = v" and asks for the properties of the path. The pair is recorded as matched when
the library answers k = v. A pair the library refuses is dropped, which leaves 5900 of 6000 draws.

The library was installed once, with scripts turned off, in a scratch folder outside this repository; the recorder only reads
it from the folder named on its command line. Nothing in this folder installs a package. With a third argument (an ES module
that exports matches(glob, path), this package bundled with a bundler) the recorder also lists the pairs where the two
disagree and the family each belongs to:

    node record-editorconfig.cjs <folder with node_modules/editorconfig> differential.json ours.mjs

The test in test/core.test.ts runs this package over all 5900 recorded pairs and requires that the pairs where it
disagrees are exactly the 34 listed below, each in the family it names.

## The disagreements, by family

All three families are degenerate globs that the specification does not define, so neither answer is wrong. Each pair is
listed below with both answers.

| Family | Pairs |
| --- | --- |
| runs of slashes and stars | 26 |
| escaped star followed by a star | 1 |
| empty brace alternative before a slash | 7 |

- runs of slashes and stars: two slashes in a row or three or more stars in a row (`//**`, `**//`, `***/`, `/****//`).
  The library matches the path and this package does not: it reads two slashes as two slashes, which no path holds, and a run
  of three stars as a double star and a star.
- empty brace alternative before a slash: `{b,c,}/**`. The library matches the path and this package does not: it
  reads the glob as written, so with the empty alternative the glob starts with a slash that no path holds.
- escaped star followed by a star: `ab*\***`. The library does not match and this package does: an escaped star is
  the character * and the stars after it are stars.

## Every disagreement

| Glob | Path | Library says | This package says | Family |
| --- | --- | --- | --- | --- |
| `//**` | `.js1abc1` | true | false | runs of slashes and stars |
| `//**` | `aba/.tsab` | true | false | runs of slashes and stars |
| `ab*\***` | `ab*2` | false | true | escaped star followed by a star |
| `{b,c,}/***` | `babb.js2` | true | false | runs of slashes and stars |
| `{b,c,}/**{b,c,}` | `2` | true | false | empty brace alternative before a slash |
| `/**{b,c,}/**` | `2.ts1.ts.ts` | true | false | empty brace alternative before a slash |
| `***/**?` | `.ts` | true | false | runs of slashes and stars |
| `***//**` | `.js` | true | false | runs of slashes and stars |
| `{b,c,}/**b` | `2b` | true | false | empty brace alternative before a slash |
| `**//**` | `x` | true | false | runs of slashes and stars |
| `{b,c,}/**/**.js` | `.ts.ts.tsab.js` | true | false | empty brace alternative before a slash |
| `//**` | `*2.ts2` | true | false | runs of slashes and stars |
| `***/*` | `a.tsxxab` | true | false | runs of slashes and stars |
| `**/**//**` | `.js` | true | false | runs of slashes and stars |
| `/****/**` | `ab` | true | false | runs of slashes and stars |
| `//**/**{b,c,}` | `c.js` | true | false | runs of slashes and stars |
| `//**` | `cabx1*` | true | false | runs of slashes and stars |
| `**//****` | `1/2c` | true | false | runs of slashes and stars |
| `/**//**` | `.js/aabab` | true | false | runs of slashes and stars |
| `//***` | `cc*c` | true | false | runs of slashes and stars |
| `**//**` | `1.js1b*` | true | false | runs of slashes and stars |
| `**//**` | `2b` | true | false | runs of slashes and stars |
| `**/**{b,c,}/**` | `*` | true | false | empty brace alternative before a slash |
| `**//**` | `.ts` | true | false | runs of slashes and stars |
| `**///*` | `cab.ts.ts` | true | false | runs of slashes and stars |
| `***/a` | `a` | true | false | runs of slashes and stars |
| `***/*` | `1ab` | true | false | runs of slashes and stars |
| `/**//**[ab]` | `11*a` | true | false | runs of slashes and stars |
| `**//**?` | `c*1.js.js` | true | false | runs of slashes and stars |
| `**//*?` | `2c` | true | false | runs of slashes and stars |
| `****/a**` | `ab.js` | true | false | runs of slashes and stars |
| `{b,c,}/**` | `1xab` | true | false | empty brace alternative before a slash |
| `{b,c,}/**/**` | `b1c` | true | false | empty brace alternative before a slash |
| `/****//[ab]` | `*c/a` | true | false | runs of slashes and stars |

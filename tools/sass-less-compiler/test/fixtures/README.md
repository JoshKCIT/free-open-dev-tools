# Test fixtures

`published-cases.ts` holds input and output pairs taken from the two compilers' own published test suites. It is
committed as text, so the unit tests never need either repository, a network connection or any other tool.

## Where the cases come from

| Compiler | Repository | Licence | Commit | Downloaded |
|---|---|---|---|---|
| Sass | https://github.com/sass/sass-spec | MIT | `49bf57edf18c4938599b3afd53dd826ee2f4e0e6` | 2026-10-03 |
| Less | https://github.com/less/less.js | Apache-2.0 | `713331655e437401dfea6cd233893a69762734e1` | 2026-10-03 |

- Sass: eight cases from `spec/directives/for/for.hrx`, `spec/variables/semi_global.hrx`,
  `spec/directives/extend/pseudo.hrx`, `spec/non_conformant/scss/while_directive.hrx`, `spec/directives/if/sass.hrx`
  and `spec/directives/each.hrx`. Three of them are in the indented syntax. Each case's input and its published
  `output.css` are copied unchanged; the output loses only its final newline.
- Less: six cases from `packages/test-data/tests-unit/`: `operations`, `scope`, `strings`, `css-guards`, `merge` and
  `lazy-eval`, each as the `.less` input and the `.css` output beside it. Both are compared with line ends normalised
  and both ends trimmed, as the Less project's own runner does.

Every case is import free. Both projects' suites hold many more pairs; the executor ran the larger corpora once from a
scratch script (not committed, not run in CI) and recorded the counts and every pair that did not reproduce, with the
reason, in the plan's summary.

## How the file is made

`node make-published-cases.mjs` (Node 22, needs a network connection) downloads the files at the two pinned commits and
writes `published-cases.ts` next to it. It is run by hand; CI never runs it.

## Expected values

The expected value of every published case is the project's own published output, never this package's output. The
refusal tests, the position tests and the limit tests use literals written from the compilers' language references
and from the text of each source.

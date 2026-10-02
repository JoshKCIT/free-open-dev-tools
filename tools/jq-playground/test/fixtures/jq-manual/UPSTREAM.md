# The jq 1.8 manual's examples

- **Source:** the manual source of jq 1.8.2, tag `jq-1.8.2`,
  <https://raw.githubusercontent.com/jqlang/jq/jq-1.8.2/docs/content/manual/v1.8/manual.yml>, rendered at
  <https://jqlang.org/manual/v1.8/>.
- **Fetched:** 2026-10-02 with `curl -fsSL`.
- **Taken:** every `examples` entry of the manual (250 of them: `program`, `input` and the documented `output` lines),
  written to `golden.ts` by a scratch script with `JSON.stringify`. Nothing was edited, added or dropped.
- **Licence:** the jq manual is licensed under the Creative Commons CC BY 3.0 licence
  (<https://creativecommons.org/licenses/by/3.0/>), as the `COPYING` file of jq 1.8.2 states ("the jq documentation ... is
  licensed under the Creative Commons CC BY 3.0 licence"). Attribution: the examples are the work of the jq authors
  (Stephen Dolan and the jq contributors) and are quoted here unchanged as test data.
- **Left out of the comparison, by name:** the two examples that read the `PAGER` environment variable, `$ENV.PAGER` and
  `env.PAGER`. The manual documents them for a machine where `PAGER=less`; the engine runs with its own empty environment
  (and the page says so), so they cannot reproduce. They are listed in `EXPECTED_EXCEPTIONS` in `test/index.test.ts`.
- **Compared as JSON values:** each output line is parsed with `JSON.parse` on both sides, so object key order, which
  JSON equality ignores, is not compared.

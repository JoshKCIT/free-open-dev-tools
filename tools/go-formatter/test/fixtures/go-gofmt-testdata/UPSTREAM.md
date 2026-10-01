# Upstream: golang/go cmd/gofmt test data

- **Repository:** https://github.com/golang/go
- **Tag:** go1.25.5
- **Fetch date:** 2026-10-01
- **Licence:** BSD-3-Clause (repository `LICENSE` at the same tag, vendored alongside as `LICENSE`, unmodified)
- **Directory:** https://github.com/golang/go/tree/go1.25.5/src/cmd/gofmt/testdata

The gofmt command's own test data: each `<name>.input` is the text fed to gofmt and each `<name>.golden` is
what gofmt must print. The package under test runs the same Go formatter (go/format) compiled to WebAssembly, so
a golden file is the expected output with no help from this project.

Each file was fetched with `curl -fsSL` from `https://raw.githubusercontent.com/golang/go/go1.25.5/src/cmd/gofmt/testdata/<name>.<input|golden>`
and written into `golden.ts` by a throwaway script using `JSON.stringify`, so tabs, carriage returns and trailing
spaces are exactly as published. The constants are named `<NAME>_INPUT` and `<NAME>_GOLDEN`.

## Files quoted: every fixture that needs no gofmt flag (16, each pair formats byte for byte)

- `comments`: comment placement and alignment.
- `crlf`: input with CRLF line endings; the golden has LF only (Go issue 3961). The input constant keeps its `\r`.
- `go2numbers`: integer and floating-point literal forms, including digit separators.
- `import`: import blocks sorted, de-duplicated and re-grouped, with comments attached to imports (the first block
  sorts `"fmt" "math" "log" "errors" "io"` into `errors fmt io log math`).
- `issue28082`: function declarations with a long run of blanks between the parentheses (Go issue 28082).
- `stdin1` to `stdin7`: statement and declaration fragments, some indented with tabs, some without a package clause
  or a trailing newline, that gofmt's own test feeds on standard input; their goldens are the same flag-free output.
- `tabs`: a composite literal whose fields are padded into aligned columns.
- `typealias`: type alias declarations, alone and in groups.
- `typeparams`: generic type and function declarations with type parameter lists.
- `typeswitch`: type switch statements and their comments.

## File quoted for a different purpose

- `slices1`: its first line is `//gofmt -s`. gofmt with `-s` rewrites `a[2:len(a)]` to `a[2:]`. The engine here has no
  `-s`, so the test checks that the input is formatted WITHOUT that rewrite (the redundant form survives) and that the
  golden is not reproduced. This documents the limit stated in `meta.json`.

## Fixtures left out, and why

- `composites`, `emptydecl`, `ranges`: their first line is `//gofmt -s` (simplify); the engine has no `-s`.
- `rewrite1` to `rewrite10`: their first line is `//gofmt -r=...` (rewrite rule); the engine has no `-r`.

`src/go/printer/testdata` is not used: its goldens pad with tabs that go/format replaces with spaces.

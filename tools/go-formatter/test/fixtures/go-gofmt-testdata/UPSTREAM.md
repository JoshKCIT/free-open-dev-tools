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
spaces are exactly as published.

## Files quoted

- `import.input` and `import.golden`: import blocks that must be sorted, de-duplicated and re-grouped, with comments
  attached to imports (the first block sorts `"fmt" "math" "log" "errors" "io"` into `errors fmt io log math`).

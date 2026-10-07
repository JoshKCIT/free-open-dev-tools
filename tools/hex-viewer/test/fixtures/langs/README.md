# Second opinions for the Python, JavaScript and Go arrays

Only the C form has a program whose output it follows (`xxd -i`, see `../xxd`). The other forms are conventional ones, so
each is checked by an engine that reads it:

- **Python.** `python.json` records one run of Python 3.14.3 over ten arrays (0, 1, 2, 11, 12, 13, 24, 25, 1,000 and 4,096
  seeded bytes). For each it holds the SHA-256 of the text, the length Python found and the SHA-256 of the bytes Python
  built. The unit test never runs Python: it regenerates each text, requires its SHA-256 to equal the recorded one (so the
  recording is of exactly that text) and requires the byte SHA-256 to equal that of its own bytes.
  - `make-texts.mjs <folder>` writes the ten texts from the package's own `exportCodeArray` (it compiles `src/export.ts` in
    memory with the folder's TypeScript).
  - `record.py <folder>` (standard library only) runs each text in a fresh namespace and writes `python.json`. It was run
    with the Python 3.14.3 of a scratch virtual environment on 2026-10-07; `recordedAt` and `python` are inside the JSON.
- **JavaScript.** The test evaluates each text with `node:vm` and compares the bytes it makes. Nothing is recorded.
- **Go.** The test hands each text, after a `package main` line, to the gofmt engine (`@wasm-fmt/gofmt` 0.7.3, the Go
  standard library's `go/format` compiled to WebAssembly) and requires the formatted result to equal the input. A syntax
  error would throw, so passing means the text parses and is already in gofmt style.
- **Rust.** No Rust compiler was available, so the form follows the grammar of The Rust Reference (a `const` item holding
  an array expression of hexadecimal integer literals, which infer to `u8`) and is not executed. The page's limits say so.

The bytes are seeded (mulberry32, seed 1900 plus the size). The seeds and the generator are the same in
`make-texts.mjs` and in `../../export.test.ts`.

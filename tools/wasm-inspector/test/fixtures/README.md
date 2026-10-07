# Fixtures of the WebAssembly Module Inspector

Nothing here is run by the package. The tests read these bytes with the package's reader and, where noted, compare the
answer with V8 (Node 22), which may compile in a test; the package source never does.

## The 329 byte fixture module

- `fixture.wat` is the text of the module: an imported function `env.log` and global `env.limit`, a memory exported as
  `memory`, a table of two functions, a mutable global exported as `counter`, the data segment `hello fixture` at address
  16, an element segment, the exported functions `add` and `twice`, a start function and a name section.
- `make-fixture.mjs` assembles it with wabt 1.0.39 (a development dependency of this folder, authoring time only) and
  writes `fixture.ts`: the Base64 text, the length (329 bytes) and the SHA-256
  (`20d21fba08e6e32764d47bfd8c70419836e932c013b52ed514232794046d95a2`). The tests recompute the length and the hash from
  the Base64, so the file cannot drift from the recording.
- Run `node test/fixtures/make-fixture.mjs` from this tool's folder to write `fixture.ts` again; the bytes do not change.

Recorded on 2026-10-07 with wabt 1.0.39 on Node 22.14.0.

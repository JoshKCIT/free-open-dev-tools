# Where the WebAssembly testsuite files come from

- Repository: https://github.com/WebAssembly/testsuite (licence Apache-2.0, the full text is in `LICENSE`)
- Commit: `b464a4cd100d98175ae6e3890db89a2e6c8302f7`, committed 2026-09-15T22:06:25Z
- Fetched: 2026-10-07 with `curl` from raw.githubusercontent.com at that commit, and the blob sizes and shas below checked
  against `gh api repos/WebAssembly/testsuite/git/trees/<commit>`

Every file is kept byte for byte. The test recomputes each git blob sha (the SHA-1 of `blob`, a space, the length, a null
byte and the bytes) and fails if one differs.

| Upstream file | Git blob sha | Bytes |
| ------------- | ------------ | ----- |
| `binary.wast` | `e328be360345522d394a7366298cebec656ad81f` | 42,602 |
| `binary0.wast` | `88270ac9e804f5911c33e8a3612a0d84ef35a6f2` | 2,638 |
| `binary-leb128.wast` | `787ba9eb59ea4a2b5d37f98740ccca4bafeed6d3` | 43,517 |
| `binary_leb128_64.wast` | `21a07ecb84681549f1210ed7390931f319de370c` | 1,335 |
| `binary-gc.wast` | `589573f2cc7182f4e5676549565bb7dd3366a843` | 432 |
| `custom.wast` | `12b0476503e77f3d9ba7b3bf779eed0160fac2bd` | 3,696 |
| `LICENSE` | `8f71f43fee3f78649d238238cbde51e6d7055c82` | 11,358 |

The six `.wast` files are the binary format cases of the suite: `(module binary ...)` forms that must read, and
`assert_malformed` forms whose binary must be refused with a stated message. The tests read only those two forms; the
other forms of these files (`assert_invalid`, `assert_return` and the rest) need validation or running and are not used.

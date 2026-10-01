# Upstream: clang-format documentation and unit tests

- **Repository:** https://github.com/llvm/llvm-project
- **Tag:** llvmorg-23.1.1
- **Fetch date:** 2026-10-01
- **Licence:** Apache-2.0 WITH LLVM-exception (`clang/LICENSE.TXT` at the same tag, vendored alongside as `LICENSE`, unmodified)

The package under test runs the clang-format library of this release compiled to WebAssembly, so a block printed in the
project's own documentation or asserted by its own unit tests is the expected output with no help from this project.

The files were fetched with `curl -fsSL` from `https://raw.githubusercontent.com/llvm/llvm-project/llvmorg-23.1.1/...`
and each constant was written into `golden.ts` by a throwaway script using `JSON.stringify`, so every space survives.

## Cases quoted

- `clang/docs/ClangFormatStyleOptions.rst`, section `IndentWidth` (the example that starts `IndentWidth: 3`):
  `INDENT_WIDTH_DOC_OUTPUT` is the printed block verbatim (the documentation's own five-space code-block margin removed,
  and the final line break the formatter ends with added). The documentation shows only the formatted result, so
  `INDENT_WIDTH_DOC_INPUT` is the same code on one line.

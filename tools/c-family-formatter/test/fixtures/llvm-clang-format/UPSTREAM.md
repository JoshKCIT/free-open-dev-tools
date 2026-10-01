# Upstream: clang-format documentation and unit tests

- **Repository:** https://github.com/llvm/llvm-project
- **Tag:** llvmorg-23.1.1
- **Fetch date:** 2026-10-01
- **Licence:** Apache-2.0 WITH LLVM-exception (`clang/LICENSE.TXT` at the same tag, vendored alongside as `LICENSE`, unmodified)

The package under test runs the clang-format library of this release compiled to WebAssembly, so a block printed in the
project's own documentation or asserted by its own unit tests is the expected output with no help from this project.

The files were fetched with `curl -fsSL` from `https://raw.githubusercontent.com/llvm/llvm-project/llvmorg-23.1.1/...`
and each constant was written into `golden.ts` by a throwaway script using `JSON.stringify`, so every space survives.
The script read each unit test call by joining the C++ string literal pieces of its two arguments and resolving the
escapes; it failed if a call was not found at the line recorded here.

## Cases quoted

- `clang/docs/ClangFormatStyleOptions.rst`, section `IndentWidth` (the example that starts `IndentWidth: 3`):
  `INDENT_WIDTH_DOC_OUTPUT` is the printed block verbatim (the documentation's own five-space code-block margin removed,
  and the final line break the formatter ends with added). The documentation shows only the formatted result, so
  `INDENT_WIDTH_DOC_INPUT` is the same code on one line.
- One two-argument `verifyFormat` case (expected output, then input) of each unit test file, each under the style the
  test file sets up with no option changed. `PUBLISHED_CASES` in `golden.ts` records file, line, test name and style:

  | Language | File and line | Test | Style the test uses |
  | --- | --- | --- | --- |
  | C++ | `clang/unittests/Format/FormatTest.cpp` line 3745 | `FormatTest.SeparatesLogicalBlocks` | LLVM, the default of the fixture |
  | C | `clang/unittests/Format/FormatTest.cpp` line 12267 | `FormatTest.UnderstandsNewAndDelete` | LLVM with the language set to C |
  | C# | `clang/unittests/Format/FormatTestCSharp.cpp` line 1706 | `FormatTestCSharp.GotoCaseLabel` | Microsoft for C#, the default of the fixture |
  | Java | `clang/unittests/Format/FormatTestJava.cpp` line 851 | `FormatTestJava.TextBlock` | Google for Java, the default of the fixture |
  | Objective-C | `clang/unittests/Format/FormatTestObjC.cpp` line 571 | `FormatTestObjC.FormatObjCMethodDeclarations` | LLVM with the language set to Objective-C; the style is unchanged at that point of the test |
  | Protocol Buffers | `clang/unittests/Format/FormatTestProto.cpp` line 197 | `FormatTestProto.DoesntWrapFileOptions` | Google for Protocol Buffers with the fixture's column limit of 60 |

  The Protocol Buffers case is an `EXPECT_EQ(expected, format(input))` call, not a `verifyFormat` call (that file's
  `verifyFormat` takes one argument). The page offers the preset only, whose column limit is 80, and the case is about a
  file option that is never wrapped however long it is, which holds at both limits; the package reproduces it.
  Each expected text is also checked to be stable (formatting it again gives it back), as the unit tests' own helper does.
- `clang/lib/Format/Format.cpp`: the `IndentWidth` and `ColumnLimit` each preset gives, quoted in a comment above
  `PRESET_WIDTHS` with line numbers: LLVM 2 and 80, Google 2 and 80 (100 for Java, Objective-C and C#), Chromium 2 and 80
  (Java 4), Mozilla 2 and 80, WebKit 4 and no limit (0), Microsoft 4 and 120, GNU 2 and 79.

## Cases left out, and why

- The `IndentWrappedFunctionNames` example of the style documentation: the page does not offer that option.
- Unit test cases whose style changes an option (a column limit, a brace style, a pointer alignment): the page offers a
  named preset and an indent width only.

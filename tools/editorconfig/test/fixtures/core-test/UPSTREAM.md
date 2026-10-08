# Where the vendored core tests come from

These files are the conformance tests of the EditorConfig project, copied without any change.

| | |
| --- | --- |
| Repository | https://github.com/editorconfig/editorconfig-core-test |
| Commit | 895b3a65d0d823dbd0acf2bc402376381995d1b1 ("spelling: https (#61)"), committed 2025-04-21T07:21:22Z |
| Licence | BSD-2-Clause, Copyright (c) 2011-2018 EditorConfig Team (the text is in LICENSE.txt, which travels with the files) |
| Checked | 2026-10-07: the blob sha of every file below equals the sha the GitHub API reports for this commit |

## What is copied and what is not

Copied: LICENSE.txt, README.md and the four folders glob, parser, properties and filetree with their CMakeLists.txt files
(one test case per call) and their .in files (the EditorConfig files the cases read). Not copied: the top level
CMakeLists.txt and the cmake folder (they define how the command line is called), the cli folder (three cases for the command
line options) and the meta folder (a self test of the CMake harness), and the project's own .editorconfig and .gitignore.

The files are kept byte for byte, including the carriage returns of parser/crlf.in and the byte order mark of
parser/bom.in. The repository root marks every file as text with converted line ends, so the nested .gitattributes in this
folder switches that off for the vendored files. A test compares the git blob sha of every file with the table below.

## The cases

extract-cases.mjs reads the four CMakeLists.txt files and writes cases.json: 198 cases (glob 130, parser 34, properties
10, filetree 24), of which 196 are run and 2 are excluded by name:

- indent_size_default_pre_0_9_0 passes a compatibility version flag (-b 0.8.0) to the command line, which this page has no
  equivalent of.
- path_separator_backslash_in_cmd_line gives the command line a Windows absolute path with backslashes, and its expected
  answer depends on the operating system.

`node extract-cases.mjs` rebuilds cases.json from the vendored files; a test runs the same code and compares the result with
the file.

## Git blob sha of every vendored file

| Path | Git blob sha | Bytes |
| --- | --- | --- |
| LICENSE.txt | e01e979101e683ce4664d8a92a7cc04be5281a4c | 1309 |
| README.md | 0be04e73de512cec81907591ae86fea856d2b329 | 1241 |
| filetree/CMakeLists.txt | e2d1c8a94bab3ae57b0ecba4cde73f50e5d6584a | 5312 |
| filetree/parent_directory.in | 911b059b63d71180ae64b17475d38dfe7dc37e31 | 119 |
| filetree/parent_directory/parent_directory.in | cffb0749921170e31f31eef4f65ac1c5bb374279 | 127 |
| filetree/path_separator.in | aa752bea8b66f3e47c2ad27dc0a8fad532b3588b | 163 |
| filetree/path_with_special_[chars/path_with_special_chars.in | e3b8bc3e5c955e0fd870b2f0766dc6283c0afd1e | 32 |
| filetree/root_file.in | 94677e7d7cd982108c5c149f33ba24a4607b3391 | 50 |
| filetree/root_file/root_file.in | 78b36ca0838fc0e4747c102a9b16154d7d481c2b | 12 |
| filetree/root_mixed/root_file.in | ccb54076dddb786ed27e3afeeee4fedc4ce271d3 | 45 |
| filetree/unset.in | 54633f5fb76acd8fe1b5c2487b3071cff72cb316 | 292 |
| filetree/unset/unset.in | 35714f2a6419bc37f6ef5b6c2c33b65b19311eb0 | 293 |
| glob/CMakeLists.txt | 520aec41fe6590f068cc762e047d207541ea990c | 12956 |
| glob/braces.in | 0400aeb73d07c121d1479775134575c2a39d146a | 884 |
| glob/brackets.in | f44def283b4e38ba6bcb5cfc64a9af691176ecc2 | 674 |
| glob/question.in | e2af52adcb99f0e35022b13c6b19b76621745de3 | 41 |
| glob/star.in | c7d874f85f617848fa3fda25da0d063c61ea75f6 | 77 |
| glob/star_star.in | c8f2c997f04651ad755366e5ad8947816b45fe64 | 113 |
| glob/utf8char.in | 6fe89b0cff7aed26311c5597ba4c9319d40930d2 | 103 |
| parser/CMakeLists.txt | c0166b7692e93d5386c4e6f5ddd7e7e7823db3d5 | 11278 |
| parser/basic.in | 3033b9acb99845862f6bdd9a0181b88461c1ce25 | 129 |
| parser/bom.in | 8bde2011dd7dd8899eddf7a18171aa8ef6a48fde | 68 |
| parser/comments.in | c49fba86a0ef6fc08837097a3658355001476985 | 799 |
| parser/comments_and_newlines.in | 35fc0239af1c2da5dad488654c81e5f934587780 | 37 |
| parser/comments_only.in | 9592ed21877a402b5ffc9b17e7100018576b6813 | 30 |
| parser/crlf.in | ec582d2c06098deeb9dfd83457be14dd20a8cc60 | 88 |
| parser/empty.in | e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 | 0 |
| parser/empty_values.in | d3c198eb0c396532c3d10b7e5a3e89b26c22d29d | 152 |
| parser/leading_slash.in | 5c3a3a464075ccf694c22caac5df51fb34315be9 | 260 |
| parser/limits.in | d768a8cccdf792f30fab00583f9003703026881b | 6389 |
| parser/newlines_only.in | 139597f9cb07c5d48bed18984ec4747f4b4f3438 | 2 |
| parser/whitespace.in | 6dd0d3030b0b1383e660a060cf3504b7eb71588a | 756 |
| properties/CMakeLists.txt | cbfb86f8684f3fe522e52a763069168ec4b7f64c | 3517 |
| properties/indent_size_default.in | 809fc3f70252ee1f8313614b096681cba8637415 | 117 |
| properties/lowercase_names.in | 253ea8bddb5007fe458a36fffa7b62e0a4c29ae3 | 90 |
| properties/lowercase_values.in | 1730bb24fa750d3e4791b057ee00040b96eb7df8 | 222 |
| properties/tab_width_default.in | 3084607b7f8e5170fe2a22c3b543ae3fc3006af6 | 107 |

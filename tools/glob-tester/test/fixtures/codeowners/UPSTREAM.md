# Upstream material for the CODEOWNERS mode

What the CODEOWNERS tests are grounded on, where it comes from, and under which licence. Nothing here is fetched while the
tests run.

## GitHub: About code owners

| What             | Value                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Repository       | `github/docs`                                                                                                          |
| Path             | `content/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners.md` |
| Git blob         | `a0ff66d59c8819c28c87e94c61195e175afd8ec2`                                                                             |
| Commit read      | `0b183d589a7f22b5ed23a4b4b7f40eb4cc0dbe0a` (last change to the file, 2026-08-14)                                       |
| Read on          | 2026-10-06                                                                                                             |
| Licence          | CC BY 4.0 (the documentation content of `github/docs`; its `LICENSE` blob is `9238c8f9388066fe7cb3b308de35104bb3c9596b`) |
| Published at     | https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners |

**Attribution (CC BY 4.0):** the example CODEOWNERS file and the sentences quoted in the tests and in this tool's limits
text are from "About code owners" by GitHub, Inc., licensed under CC BY 4.0
(https://creativecommons.org/licenses/by/4.0/). The example was re-typed into `docs-example.json` as two files, a list of
14 paths and 28 answers; the answers follow the comments in the documentation, and the deciding line is counted over
every pasted line, comment lines included. No change was made to the meaning of any quoted sentence. Changes: the example
is shortened to the lines the tests use, and the comment lines between rules are left out except the first.

The page states these rules, each of which a test cites by its sentence:

- "CODEOWNERS files must be under 3 MB in size." and a larger file "will not be loaded".
- "Order is important; the last matching pattern takes the most precedence."
- "CODEOWNERS paths are case sensitive."
- Using `!` to negate a pattern, escaping a leading `#` with a backslash, and using `[ ]` ranges "doesn't work".
- "If any line in your CODEOWNERS file contains invalid syntax, that line will be skipped."
- The example file's own comments for `docs/*`, `apps/`, `/docs/`, `**/logs`, `/apps/github` and the inline comment line.

# Upstream: shfmt flags test data

- **Repository:** https://github.com/mvdan/sh
- **Tag:** v3.13.1
- **Fetch date:** 2026-10-01
- **Licence:** BSD-3-Clause (repository `LICENSE` at the same tag, vendored alongside as `LICENSE`, unmodified)
- **File:** https://github.com/mvdan/sh/blob/v3.13.1/cmd/shfmt/testdata/script/flags.txtar

The shfmt command's own test script for its flags. A txtar file holds a script of commands and, below it, named
sections (`-- name --`) that the script feeds to the command or compares its output with. The package under test runs
the same parser and printer (mvdan.cc/sh/v3) compiled to WebAssembly, so a golden section is the expected output with
no help from this project.

The file was fetched with `curl -fsSL` from
`https://raw.githubusercontent.com/mvdan/sh/v3.13.1/cmd/shfmt/testdata/script/flags.txtar` and each section written
into `golden.ts` by a throwaway script using `JSON.stringify`, so tabs and trailing spaces are exactly as published. A
section is the text between its marker line and the next marker, final line break included. The constants are named
after the sections.

## Sections quoted

- `flags-input`: a function with a binary-operator continuation, a case statement, a redirect and a run of padding
  spaces. It is the input every golden below is produced from.
- `flags-output.indent-golden`: produced with `shfmt -i 2`. The page's indent 2 reproduces it byte for byte.
- `flags-output.keep-padding-golden`: produced with `shfmt -kp` (keep padding), which the page does not offer. Apart from
  its one padding line (`keep  padding`, which the default collapses to `keep padding` in every other golden of the
  file) it is exactly the default output: tabs, `&&` at the end of the line, case branches level with `case`, and no
  space after `>`. The test applies that one published substitution and compares the rest byte for byte. The file
  holds no golden for the default alone.
- `input-mksh`: `coprocess |&`, valid only in mksh. Upstream: `shfmt -ln=mksh` prints it; the default refuses it.
- `input-mksh-shebang`: the same line after a `#!/bin/mksh` first line.
- `input-bash-arrays` and `input-bash-extglobs`: scripts with a `#!/bin/sh` first line that use an array and an extended
  glob. Upstream refuses them in POSIX mode (`parsed as posix via -ln=auto`). The engine build the page runs cannot
  parse in POSIX mode (its wrapper skips that dialect), so these are used to document the limit: they are formatted,
  not refused.

## Sections left out, and why

- `flags-output.binary-next-line-golden`, `case-indent-golden`, `space-redirects-golden`, `func-next-line-golden`:
  they need switches (`-bn`, `-ci`, `-sr`, `-fn`) the page does not offer.
- `input-posix`, `input-bash`, `input-tiny`, `input-zsh`: they only exercise dialect selection by flag, which the
  engine build handles by file name instead.

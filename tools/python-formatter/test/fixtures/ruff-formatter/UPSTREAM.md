# Upstream: Ruff formatter test fixtures

- **Repository:** https://github.com/astral-sh/ruff
- **Tag:** 0.15.20
- **Fetch date:** 2026-10-01
- **Licence:** MIT (repository `LICENSE` at the same tag, vendored alongside as `LICENSE`, unmodified)
- **Directory:** https://github.com/astral-sh/ruff/tree/0.15.20/crates/ruff_python_formatter

The Ruff formatter's own test data: each fixture is a Python file under `resources/test/fixtures/ruff/`, an optional
`<name>.options.json` lists the option sets it is formatted with, and each snapshot under `tests/snapshots/` holds the
input and one `### Output N` section per option set, each headed by the settings it was produced with. The package under
test runs the same formatter compiled to WebAssembly, so a snapshot output is the expected text with no help from this
project.

Each file was fetched with `curl -fsSL` from
`https://raw.githubusercontent.com/astral-sh/ruff/0.15.20/crates/ruff_python_formatter/...` and written into
`golden.ts` by a throwaway script using `JSON.stringify`, so tabs, carriage returns and trailing spaces are exactly as
published. A snapshot output is the text between the fence lines of its `python` block, final line break included.

## Files quoted

- `quote_style.py` with `quote_style.options.json` (three option sets: `single`, `double`, `preserve`) and
  `format@quote_style.py.snap`. Every string prefix and every quote kind, plain and triple quoted, adjacent string
  concatenation and docstrings. All three outputs are quoted.
- `tab_width.py` with `tab_width.options.json` (indent_width 2, 4 and 8) and `format@tab_width.py.snap`. All three
  outputs are quoted (indent-style = space).
- `docstring_tab_indentation.py` with its options file (indent_style tab, indent_width 4 and 8) and
  `format@docstring_tab_indentation.py.snap`. Both outputs are quoted: tab indentation.
- `fmt_on_off/indent.py` with its options file (spaces at width 4, spaces at width 1, tabs) and
  `format@fmt_on_off__indent.py.snap`. All three outputs are quoted.
- `fluent.py` with `fluent.options.json` (line_width 8) and `format@fluent.py.snap`. Its one output is quoted: a line
  width other than 88.
- `skip_magic_trailing_comma.py` with its options file (respect, ignore) and `format@skip_magic_trailing_comma.py.snap`.
  Both outputs are quoted; only the first (respect, the default) is reproduced by the package, because the page offers
  no magic trailing comma option.

The generating script checked that the `## Input` block of every snapshot is byte for byte the fixture file, and that
every output header carries the settings named above.

## Fixtures left out, and why

- `docstring_code_examples*.py`, `preview.py`, the `expression/*` target-version fixtures and the `stub_files`
  fixtures: they need options (docstring code, preview style, target version, source type) the page does not offer.
- Output 2 of `format@skip_magic_trailing_comma.py.snap` (magic trailing comma ignored): same reason; it is vendored
  for the record and named in the test file's `NOT_REPRODUCED` list.

## Settings every quoted output was produced with, unless named otherwise

`indent-style = space`, `line-width = 88`, `indent-width = 4`, `quote-style = Double`, `magic-trailing-comma = Respect`,
line ending LF, docstring code formatting disabled, preview disabled. These are the page's defaults, so a fixture
formatted with only the named setting changed needs no other option.

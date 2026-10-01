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

## Settings every quoted output was produced with

`indent-style = space`, `line-width = 88`, `indent-width = 4`, `magic-trailing-comma = Respect`, line ending LF,
docstring code formatting disabled, preview disabled. These are the page's defaults, so a fixture formatted with
only its `quote-style` changed needs no other option.

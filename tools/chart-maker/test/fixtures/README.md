# Test fixtures

One file holds the rows the reading tests use.

## csv-cases.ts

Seventeen pieces of pasted text that are easy to read wrongly (a comma, a doubled quote or a line break inside quotes,
an empty value at the end of a row or of the whole text, carriage returns, tabs, a quote in the middle of a value, a
space before a quote, accented and astral characters), each with the rows Python's csv module read from it. The file is
committed as text, so the unit tests never run Python (CI has other versions of it).

- Written by `make-fixtures.py` on 2026-10-04.
- Version: Python 3.14.3 (its standard library `csv` module, default dialect, the text opened with `newline=""`).
- Run it from a scratch virtual environment (never the machine's own Python): `python make-fixtures.py` writes
  `csv-cases.ts` next to the script; the repository's formatter is then run over the file.
- A blank line is dropped from the module's output, because the package drops it too (the module returns an empty row
  for it). No case holds an unterminated quote: the module reads the rest of the text into one value and the package
  refuses it with a message, on purpose.
- Second opinion only: the package's own tests state the other expected values (numbers, limits, geometry) from the
  rules in the standards the package names.

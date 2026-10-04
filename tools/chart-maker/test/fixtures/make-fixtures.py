"""Writes csv-cases.ts: tricky pasted rows and how Python's csv module reads them.

Run it from a scratch virtual environment (never the machine's own Python):

    python make-fixtures.py

The csv module (standard library, Python 3.14.3 on 2026-10-04) is the independent second opinion for the reader of this
package: it is mature, and its default dialect follows RFC 4180 closely. A blank line is dropped here, as the package
drops it (the module returns an empty row for it). The cases hold no unterminated quote, because the module and the
package refuse that differently on purpose (the package refuses it with a message).
"""

import csv
import io
import json
import pathlib
import sys

NL = "\n"
CASES = [
    ("simple rows", "a,b,c\n1,2,3\n", ","),
    ("a comma inside quotes", 'x,"a, b",3\n', ","),
    ("a doubled quote inside quotes", 'x,"say ""hi""",3\n', ","),
    ("a line break inside quotes", 'x,"line1\nline2",3\ny,z,4\n', ","),
    ("a trailing empty value on every row", "a,b,\nc,d,\n", ","),
    ("a leading empty value", ",b\n,d\n", ","),
    ("carriage return and line feed", "a,b\r\nc,d\r\n", ","),
    ("no final line break", "a,b\nc,d", ","),
    ("an empty value in quotes", 'a,"",c\n', ","),
    ("tabs with a trailing empty value", "a\tb\tc\n1\t2\t\n", "\t"),
    ("a quote in the middle of a value", 'a,b"c,d\n', ","),
    ("a space before a quote", 'a, "b"\n', ","),
    ("accented and astral characters", "é,\U0001F600\n", ","),
    ("one column", "a\nb\n", ","),
    ("a trailing empty value at the end of the text", "a,b,", ","),
    ("a lone carriage return between rows", "a,b\rc,d\r", ","),
    ("a comma inside quotes in a tab file", 'a\t"b,c"\td\n', "\t"),
]


def read(text, delimiter):
    rows = list(csv.reader(io.StringIO(text, newline=""), delimiter=delimiter))
    return [row for row in rows if row]


def main():
    here = pathlib.Path(__file__).resolve().parent
    out = here / "csv-cases.ts"
    lines = [
        "// Written by make-fixtures.py with Python " + sys.version.split()[0] + " (csv module) on 2026-10-04.",
        "// Each case is the pasted text and the rows Python's csv module read from it (blank lines dropped).",
        "export interface CsvCase {",
        "  name: string;",
        "  text: string;",
        "  delimiter: string;",
        "  rows: string[][];",
        "}",
        "",
        "export const CSV_CASES: CsvCase[] = [",
    ]
    for name, text, delimiter in CASES:
        rows = read(text, delimiter)
        lines.append("  {")
        lines.append("    name: " + json.dumps(name) + ",")
        lines.append("    text: " + json.dumps(text) + ",")
        lines.append("    delimiter: " + json.dumps(delimiter) + ",")
        lines.append("    rows: " + json.dumps(rows, ensure_ascii=True) + ",")
        lines.append("  },")
    lines.append("];")
    out.write_text(NL.join(lines) + NL, encoding="utf-8", newline="\n")
    print("wrote", out)


if __name__ == "__main__":
    main()

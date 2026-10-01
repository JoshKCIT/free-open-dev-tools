"""Writes sample.sqlite, the small database the SQLite viewer's tests open.

Run from any directory:

    python make-fixture.py            writes sample.sqlite next to this script
    python make-fixture.py --print    also prints, as JSON, what Python's own sqlite3 module reads back from it

Only the Python standard library is used (sqlite3), so no virtual environment or install is needed. The library that
reads the file here is Python's own SQLite, an independent build from the one compiled into the viewer's engine; the
test compares what the viewer reads with what this script printed (the second opinion named in meta.json).

The file holds a table with a 64-bit integer, a NULL, a 40 byte BLOB and non-ASCII text, a view and an index.
"""

import json
import pathlib
import sqlite3
import sys

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "sample.sqlite"

ROWS = [
    (1, "Ada", 9007199254740993, None, "é€漢"),
    (2, "Alan", -42, bytes(range(40)), None),
    (3, "Grace", None, bytes([0xDE, 0xAD, 0xBE, 0xEF]), "plain text"),
    (4, "Linus", 9223372036854775807, None, ""),
]


def build() -> None:
    if OUT.exists():
        OUT.unlink()
    con = sqlite3.connect(OUT)
    # The page size has to be set before the first table exists. 1024 is not SQLite's default (4096), so the
    # viewer is shown to read a file whose pages are not the usual size.
    con.execute("PRAGMA page_size=1024")
    con.execute("CREATE TABLE people(id INTEGER PRIMARY KEY, name TEXT NOT NULL, big INTEGER, photo BLOB, note TEXT)")
    con.execute("CREATE VIEW named_people AS SELECT id, name FROM people WHERE name <> ''")
    con.execute("CREATE INDEX people_name ON people(name)")
    con.executemany("INSERT INTO people VALUES (?, ?, ?, ?, ?)", ROWS)
    con.commit()
    con.close()


def show(value):
    """The text the viewer is documented to show for one value."""
    if value is None:
        return "NULL"
    if isinstance(value, bytes):
        head = value[:32].hex().upper()
        return "X'" + head + ("…" if len(value) > 32 else "") + "'" + " (" + str(len(value)) + " bytes)"
    return str(value)


def read_back() -> dict:
    con = sqlite3.connect("file:" + OUT.as_posix() + "?mode=ro", uri=True)
    master = [list(r) for r in con.execute("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY rowid")]
    info = [list(r) for r in con.execute("PRAGMA table_info(people)")]
    rows = [[show(v) for v in r] for r in con.execute("SELECT * FROM people ORDER BY id")]
    page_size = con.execute("PRAGMA page_size").fetchone()[0]
    con.close()
    return {
        "python": sys.version.split()[0],
        "sqlite": sqlite3.sqlite_version,
        "page_size": page_size,
        "master": master,
        "table_info_people": info,
        "rows_people": rows,
    }


if __name__ == "__main__":
    build()
    if "--print" in sys.argv:
        sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps(read_back(), ensure_ascii=False, indent=1))

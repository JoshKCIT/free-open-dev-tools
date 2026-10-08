"""Records the official Unicode name of every character listed in src/offenders.ts, from Python's unicodedata.

The code points are read from the rows of OFFENDERS in the TypeScript source (each row starts with a code point written
0x... in square brackets). For each one the script records unicodedata.name(). A control character such as tab has no
name of its own in Python; its formal name alias (CHARACTER TABULATION) is recorded instead, after checking with
unicodedata.lookup() that the alias is that very character, and the code point is listed in "aliasOnly".

Run by hand with any Python 3 (standard library only; nothing is installed):

    python record-names.py ../../../src/offenders.ts unicode-names.json

Unit tests only read the JSON; they never run Python. A test compares every OFFENDERS entry's unicodeName with the name
recorded here, so a name typed wrongly in the source is caught.
"""
import datetime
import json
import re
import sys
import unicodedata

sys.dont_write_bytecode = True

# Formal name aliases for the control characters in the list (Python's name() has no name for them).
ALIASES = {9: "CHARACTER TABULATION"}


def label(cp):
    return "U+" + format(cp, "04X")


def main(source_path, out_path):
    text = open(source_path, encoding="utf-8").read()
    code_points = [int(h, 16) for h in re.findall(r"\[\s*0x([0-9a-fA-F]+)\s*,", text)]
    if len(code_points) != len(set(code_points)):
        raise SystemExit("a code point is listed twice")
    names, alias_only = {}, []
    for cp in code_points:
        ch = chr(cp)
        try:
            names[label(cp)] = unicodedata.name(ch)
        except ValueError:
            alias = ALIASES.get(cp)
            if alias is None or unicodedata.lookup(alias) != ch:
                raise SystemExit(label(cp) + " has no Unicode name here and no checked alias")
            names[label(cp)] = alias
            alias_only.append(label(cp))
    recorded = {
        "recordedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "python": sys.version.split()[0],
        "unicodeVersion": unicodedata.unidata_version,
        "aliasOnly": alias_only,
        "names": names,
    }
    with open(out_path, "w", encoding="utf-8", newline="\n") as out:
        json.dump(recorded, out, ensure_ascii=True, indent=1)
        out.write("\n")
    print(len(names), "names recorded with Python", recorded["python"], "(Unicode", recorded["unicodeVersion"] + ")")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: python record-names.py <offenders.ts> <output file>")
    main(sys.argv[1], sys.argv[2])

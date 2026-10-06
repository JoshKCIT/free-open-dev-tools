"""List the cases of the OpenSPF rfc7208 test suite whose checked domain holds exactly one SPF record.

Run from a scratch virtual environment (never the machine's Python packages):

    python -m venv <scratch>/venv-18
    <scratch>/venv-18/bin/python -m pip install PyYAML==6.0.3
    <scratch>/venv-18/bin/python extract.py rfc7208-tests.yml > candidates.json

The output is only a worklist. syntax-cases.json is curated from it by hand: this script judges nothing. The suite is used
for syntax only, never to evaluate a record.

A case is listed when the domain of its mailfrom (or its helo, when mailfrom is empty) holds exactly one distinct record
text that starts with v=spf1, counting both SPF and TXT entries (the suite drivers copy each SPF entry to TXT).
"""

import json
import re
import sys

import yaml

VERSION = re.compile(r"(?i)v=spf1( |$)")


def records_of(entries):
    found = set()
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        for kind in ("SPF", "TXT"):
            if kind not in entry:
                continue
            value = entry[kind]
            if isinstance(value, list):
                value = "".join(value)
            if isinstance(value, str) and VERSION.match(value):
                found.add(value)
    return found


def main(path):
    with open(path, encoding="utf-8") as handle:
        documents = list(yaml.safe_load_all(handle))
    rows = []
    for document in documents:
        zone = document.get("zonedata") or {}
        for name, test in document["tests"].items():
            mailfrom = test.get("mailfrom") or ""
            domain = mailfrom.split("@")[-1] if mailfrom else test.get("helo")
            entries = zone.get(domain)
            if not isinstance(entries, list):
                continue
            found = records_of(entries)
            if len(found) != 1:
                continue
            rows.append(
                {
                    "section": document["description"],
                    "name": name,
                    "spec": test.get("spec"),
                    "domain": domain,
                    "record": next(iter(found)),
                    "result": test.get("result"),
                }
            )
    json.dump(rows, sys.stdout, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main(sys.argv[1])

"""Records what a second CODEOWNERS matcher answers for the pairs of generate-pairs.py.

The second matcher is the Python package `codeowners` 0.9.0 (MIT). For each pair, a one-line CODEOWNERS file holding the
pattern and an owner is built and the package is asked who owns the path: an owner means the pattern matched.

Run by hand from a scratch environment that already has the package (nothing is installed by this script):

    python record-second-matcher.py second-matcher.json

The output keeps `differences` as an empty list. The unit test fills it in when it is run once with RECORD_DIFFERENCES=1
(see README.md): it lists every pair where this tool's matcher and the package disagree, by name, with a reason. Unit tests
only read the file; they never run Python.
"""
import datetime
import importlib.util
import json
import os
import sys
from importlib import metadata

sys.dont_write_bytecode = True

from codeowners import CodeOwners

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("generate_pairs", os.path.join(HERE, "generate-pairs.py"))
generate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generate)


def main(out_path):
    pairs = []
    for pattern, path in generate.make_pairs():
        owners = CodeOwners(pattern + " @o\n")
        pairs.append([pattern, path, bool(owners.of(path))])
    recorded = {
        "recordedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "package": "codeowners",
        "version": metadata.version("codeowners"),
        "python": sys.version.split()[0],
        "seed": generate.SEED,
        "tries": generate.TRIES,
        "pairs": pairs,
        "differences": [],
    }
    with open(out_path, "w", encoding="utf-8", newline="\n") as out:
        json.dump(recorded, out, separators=(",", ":"))
        out.write("\n")
    print(len(pairs), "pairs recorded with codeowners", recorded["version"])


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python record-second-matcher.py <output file>")
    main(sys.argv[1])

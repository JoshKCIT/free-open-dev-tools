"""Makes the (pattern, path) pairs the second matcher is asked about.

Seeded (31), so the same pairs come out every time. Patterns are one to four tokens joined from GLOB_TOKENS, paths one to
five tokens joined from PATH_TOKENS; a pattern with three or more stars in a row is dropped (the CODEOWNERS mode lists
those lines as unsupported and matches nothing), and so is a path that is empty after repeated slashes are removed or
that holds a dot-dot segment. 4,000 tries give 3,498 pairs.

Standard library only. Used by record-second-matcher.py; run on its own it prints how many pairs there are.
"""
import json
import random
import sys

SEED = 31
TRIES = 4000
GLOB_TOKENS = ["*", "**", "/", "a", "b", ".js", "?", "docs", "x", "*.js", "a*", "/**", "**/"]
PATH_TOKENS = ["a", "b", "docs", "x", ".js", "/", "a.js", "ab"]


def make_pairs():
    random.seed(SEED)
    pairs = []
    for _ in range(TRIES):
        pattern = "".join(random.choice(GLOB_TOKENS) for _ in range(random.randint(1, 4)))
        if "***" in pattern or pattern == "":
            continue
        path = "".join(random.choice(PATH_TOKENS) for _ in range(random.randint(1, 5)))
        path = path.replace("//", "/").strip("/")
        if not path or ".." in path.split("/"):
            continue
        pairs.append([pattern, path])
    return pairs


if __name__ == "__main__":
    pairs = make_pairs()
    if len(sys.argv) > 1:
        with open(sys.argv[1], "w", encoding="utf-8") as out:
            json.dump(pairs, out)
    print(len(pairs), "pairs")

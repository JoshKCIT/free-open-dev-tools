# Upstream of golden.ts

`golden.ts` holds every case of the published MessagePack test suite.

- **Repository:** https://github.com/kawanet/msgpack-test-suite (Yusuke Kawasaki).
- **File:** `dist/msgpack-test-suite.json`, the suite's own JSON build of its YAML files.
- **Commit:** e04f6edeaae589c768d6b70fcce80aa786b7800e, dated 2018-10-18 (the repository has no releases or tags; this was
  its latest commit when fetched).
- **Fetched:** 2026-10-02, from
  https://raw.githubusercontent.com/kawanet/msgpack-test-suite/e04f6edeaae589c768d6b70fcce80aa786b7800e/dist/msgpack-test-suite.json
- **Licence:** MIT, Copyright (c) 2017-2018 Yusuke Kawasaki. The licence text is the `LICENSE` file in this folder, copied
  byte for byte from the same commit.
- **Contents:** 15 groups, 85 cases, 233 encodings: nil, booleans, binaries, positive and negative numbers (each in every
  integer and float width that holds it), big numbers, ASCII, UTF-8 and emoji strings, arrays, maps, nested values,
  timestamps (4, 8 and 12 byte layouts, with seconds and nanoseconds) and extensions of every size.
- **How it was made:** a script (kept in the session scratch directory, not in this repository) reads the JSON and writes
  one line per case with `JSON.stringify`, adding only the `kind` of each value (the key the suite itself names it under).
  Every value stays in the suite's notation. Nothing was typed by hand and nothing was produced by this package.

# Recorded `xxd -i` output

`cases.json` holds what the program `xxd -i` printed, kept as facts so the unit tests can compare the hex viewer's C
array export with it without ever running `xxd` themselves.

- **Program and versions.** Git for Windows `xxd 2025-11-26` (run in Git Bash) and Ubuntu 24.04.2 LTS `xxd 2023-10-25`
  (run under WSL 2). The two outputs are identical, byte for byte, and `identical: true` is written only when they are.
- **When.** `recordedAt` inside the JSON (2026-10-07).
- **Cases.** 121 = 11 inputs by 11 option sets. The inputs are seeded bytes (mulberry32, seed 19) of 0, 1, 2, 11, 12, 13,
  23, 24, 25, 1,000 and 4,096 bytes, stored as base64. The option sets are none, `-u`, `-C`, `-c 8`, `-c 16`, `-c 1`,
  `-n my_var`, `-s 3`, `-l 7`, `-s 3 -l 7` and `-u -C -c 5`. For a case without `-n` the variable name comes from the file
  name, `rand-<size>.bin`.
- **Names.** `names` lists the variable name `xxd -i` derived from a file name or an `-n` argument, written as the exact
  text typed, for example `9lives-file.v2.bin`, an accented name and a CJK name.
- **How.** `bash record.sh <empty work folder> <cases.json>` from Git Bash with `wsl` on the path. It makes the inputs,
  runs the script itself once in each environment, compares the two outputs, and writes the JSON only if they agree.
  Nothing from the Vim source tree or its licence is copied: the output is facts. The source rules the tests cite are in
  `src/xxd/xxd.c` of the Vim repository (blob `9b1ca6ea5555df413546e48126d75ab91e1c8393`, lines 971 and 1079 to 1135).

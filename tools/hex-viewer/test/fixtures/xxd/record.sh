#!/usr/bin/env bash
# Records the output of `xxd -i` as facts for the hex viewer export tests (19-01 S8).
#
#   bash record.sh <empty work folder> <cases.json to write>
#
# It makes 11 seeded input files (mulberry32, seed 19; sizes 0, 1, 2, 11, 12, 13, 23, 24, 25, 1000 and 4096 bytes), runs
# `xxd -i` over each with 11 option sets, once in Git Bash (the Windows xxd) and once in Ubuntu under WSL, and keeps the
# output only when the two environments print exactly the same text. It also records the variable name xxd derives from
# a set of file names and -n arguments (the names are written with printf escapes so the script holds no loose bytes).
# Then it writes cases.json: both version strings, `identical`, the date, the 121 cases and the name table.
# Run it under Git Bash with wsl on the path. Needs node (for the seeded bytes and the JSON). xxd's own licence is not
# copied: its output is facts.
#
# The same file is also run inside each environment with the single argument `run`, which prints the cases and names.

set -eu

SIZES="0 1 2 11 12 13 23 24 25 1000 4096"
OPTS=("" "-u" "-C" "-c 8" "-c 16" "-c 1" "-n my_var" "-s 3" "-l 7" "-s 3 -l 7" "-u -C -c 5")

# Names are printed as hex of their bytes, so the table survives any console encoding.
hexof() { printf '%s' "$1" | xxd -p | tr -d '\n'; }

run_all() {
  for n in $SIZES; do
    f="rand-$n.bin"
    for o in "${OPTS[@]}"; do
      printf '=== %s | %s\n' "$f" "$o"
      # shellcheck disable=SC2086
      xxd -i $o "$f"
    done
  done
  printf '#NAMES\n'
  rm -rf nm && mkdir nm
  # File names: the bytes of the name written with printf escapes (e acute is c3 a9; the two CJK characters are 3 bytes each).
  for name in "$(printf 'caf\xc3\xa9.bin')" 'a b-c.d.bin' '_leading.bin' '9lives.bin' '9lives-file.v2.bin' \
    "$(printf '\xe6\x97\xa5\xe6\x9c\xac.bin')" 'x.TAR.GZ' '.hidden' 'a--b' 'class.bin'; do
    printf 'ab' >"nm/$name"
    first=$(cd nm && xxd -i "$name" | head -n 1)
    printf 'NAME|file|%s|%s\n' "$(hexof "$name")" "$first"
  done
  # -n arguments.
  for name in 'my var' "$(printf '\xc3\xa9')" 'a.b' '1' 'ok_name' 'UPPER' '9lives-file.v2.bin'; do
    first=$(xxd -i -n "$name" rand-2.bin | head -n 1)
    printf 'NAME|-n|%s|%s\n' "$(hexof "$name")" "$first"
  done
}

if [ "${1:-}" = "run" ]; then
  run_all
  exit 0
fi

work="${1:?usage: bash record.sh <empty work folder> <cases.json to write>}"
out="${2:?usage: bash record.sh <empty work folder> <cases.json to write>}"
self="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
out="$(cd "$(dirname "$out")" && pwd)/$(basename "$out")"
mkdir -p "$work"
cd "$work"

node -e '
const fs = require("fs");
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(19);
for (const n of [0, 1, 2, 11, 12, 13, 23, 24, 25, 1000, 4096]) {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) b[i] = Math.floor(rnd() * 256);
  fs.writeFileSync("rand-" + n + ".bin", b);
}
'

# Git Bash, then Ubuntu under WSL (same folder, same script).
bash "$self" run >msys.out
vmsys=$(xxd -v 2>&1 | head -n 1)
here_win=$(pwd -W)
self_win=$(cygpath -m "$self")
wsl_here=$(MSYS_NO_PATHCONV=1 wsl wslpath -a "$here_win" | tr -d '\r')
wsl_self=$(MSYS_NO_PATHCONV=1 wsl wslpath -a "$self_win" | tr -d '\r')
MSYS_NO_PATHCONV=1 wsl bash -c "cd '$wsl_here' && bash '$wsl_self' run" >wsl.out
vwsl=$(MSYS_NO_PATHCONV=1 wsl bash -c "xxd -v 2>&1 | head -n 1" | tr -d '\r')
oswsl=$(MSYS_NO_PATHCONV=1 wsl bash -c "grep ^PRETTY_NAME= /etc/os-release" | tr -d '[:cntrl:]"' | sed "s/^PRETTY_NAME=//")
gitv=$(git --version)

OUT_FILE="$out" VMSYS="$vmsys" VWSL="$vwsl" OSWSL="$oswsl" GITV="$gitv" node -e '
const fs = require("fs");
const read = (f) => fs.readFileSync(f, "utf8");
const [msysCases, msysNames] = read("msys.out").split("#NAMES\n");
const [wslCases, wslNames] = read("wsl.out").split("#NAMES\n");
if (msysCases !== wslCases) { console.error("the two xxd versions print different output; nothing written"); process.exit(1); }
const table = (text) => text.split("\n").filter((l) => l.startsWith("NAME|")).map((l) => {
  const [, via, hex, first] = l.split("|");
  const m = /^unsigned char (.*)\[\] = \{$/.exec(first);
  return { via, arg: Buffer.from(hex, "hex").toString("utf8"), identifier: m ? m[1] : null };
});
const names = table(msysNames);
if (JSON.stringify(names) !== JSON.stringify(table(wslNames))) { console.error("the two xxd versions derive different names; nothing written"); process.exit(1); }
if (names.some((n) => n.identifier === null)) { console.error("a name was not read from the first line"); process.exit(1); }
const cases = msysCases.split("=== ").slice(1).map((block) => {
  const nl = block.indexOf("\n");
  const [file, args] = block.slice(0, nl).split(" | ");
  return { file, bytesBase64: fs.readFileSync(file).toString("base64"), args, output: block.slice(nl + 1) };
});
const doc = {
  recordedAt: new Date().toISOString().slice(0, 10),
  xxd: [process.env.VMSYS, process.env.VWSL],
  environments: [process.env.GITV + ", Git Bash", process.env.OSWSL + ", WSL 2"],
  identical: true,
  note: "Inputs are seeded bytes (mulberry32, seed 19). args is what followed xxd -i. A file name is the argument as typed.",
  cases,
  names,
};
fs.writeFileSync(process.env.OUT_FILE, JSON.stringify(doc, null, 2) + "\n");
console.log("wrote " + cases.length + " cases and " + names.length + " names to " + process.env.OUT_FILE);
'

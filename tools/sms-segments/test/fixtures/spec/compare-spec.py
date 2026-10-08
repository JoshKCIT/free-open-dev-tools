"""Records how the text of 3GPP TS 23.038 compares with the recorded Android table and with the Unicode mapping file.

The specification's tables are 3GPP copyright and are NOT copied into this repository. This script reads a text
extraction of them that was made once in a scratch folder (a JSON file of two objects, "default" and "extension", each
mapping a septet code to the text of its cell in clause 6.2.1 and clause 6.2.1.1 of TS 23.038 V20.0.0, read from
23038-k00.docx of the 3GPP archive) and writes only the RESULT of the comparison: how many cells are equal, which cells the
Word file draws as symbols (so the extraction holds no text for them), the one cell where the Unicode file differs, and the
SHA-256 of the Android default table that was compared. The unit tests tie that Android table to this tool's table cell by
cell and recompute the hash, so a later edit of either table is caught.

Run by hand from a scratch folder (nothing is installed):

    python compare-spec.py ts23038-tables.json ../android/android-alphabet.json ../unicode/GSM0338.TXT spec-comparison.json

Unit tests only read the JSON; they never run Python.
"""
import datetime
import hashlib
import json
import sys

sys.dont_write_bytecode = True

SOURCE = (
    "3GPP TS 23.038 V20.0.0 (2026-06), clause 6.2.1 (default alphabet) and 6.2.1.1 (extension table), read as text from "
    "23038-k00.docx in 23038-k00.zip of the 3GPP archive (https://www.3gpp.org/ftp/Specs/archive/23_series/23.038/)"
)
# The cells of the specification's table that hold a word, not a character.
NAMES = {"SP": " ", "LF": chr(10), "CR": chr(13)}
ESCAPE_CODE = 27


def label(ch):
    return "U+" + format(ord(ch), "04X")


def unicode_file(path):
    default, extension = {}, {}
    for line in open(path, encoding="utf-8").read().splitlines():
        if not line or line.startswith("#"):
            continue
        parts = line.split(chr(9))
        code = int(parts[0], 16)
        ch = chr(int(parts[1], 16))
        if code > 0xFF:
            extension[code & 0xFF] = ch
        else:
            default[code] = ch
    return default, extension


def main(spec_path, android_path, unicode_path, out_path):
    spec = json.load(open(spec_path, encoding="utf-8"))
    android = json.load(open(android_path, encoding="utf-8"))
    uni_default, uni_extension = unicode_file(unicode_path)
    table = android["defaultTable"]

    symbol_cells, equal, android_differences, unicode_differences = [], 0, [], []
    for code in range(128):
        text = spec["default"][str(code)]
        if text == "" or code == ESCAPE_CODE:
            symbol_cells.append(code)
            continue
        ch = NAMES.get(text, text)
        if table[code] == ch:
            equal += 1
        else:
            android_differences.append(code)
        if uni_default.get(code) != ch:
            unicode_differences.append(
                {
                    "code": code,
                    "specification": label(ch),
                    "unicodeFile": label(uni_default[code]),
                }
            )

    # The extension table: the cells that hold one character. Form feed is drawn as a note marker in the Word file.
    extension_equal, extension_cells = 0, 0
    for code, text in spec["extension"].items():
        if len(text) == 1:
            extension_cells += 1
            if android["extension"].get(code) == text and uni_extension.get(int(code)) == text:
                extension_equal += 1

    recorded = {
        "recordedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": SOURCE,
        "compared": "the 128 cells of the default alphabet against the recorded Android table",
        "equal": equal,
        "symbolCells": symbol_cells,
        "symbolCellsNote": "Ten Greek capitals (codes 16 and 18 to 26) and the escape (code 27) are drawn as symbols in the Word file, so the extraction holds no text for them; they are checked against the Unicode file and the Android table only.",
        "androidDifferences": android_differences,
        "unicodeFileDifferences": unicode_differences,
        "unicodeFileDifferencesNote": "Code 9: the specification draws capital C cedilla; the Unicode file maps it to lower case c cedilla and says why in its own header.",
        "extensionCells": extension_cells,
        "extensionEqual": extension_equal,
        "extensionNote": "Form feed (code 10) is drawn as a note marker in the Word file and is not counted.",
        "androidBlob": android["blob"],
        "tableSha256": hashlib.sha256("".join(table).encode("utf-8")).hexdigest(),
        "tableHashOf": "the UTF-8 bytes of the 128 cells of the Android default table, joined with nothing between them (code 27 is U+FFFF there)",
    }
    with open(out_path, "w", encoding="utf-8", newline="\n") as out:
        json.dump(recorded, out, ensure_ascii=True, indent=1)
        out.write("\n")
    print(
        equal,
        "equal text cells;",
        len(symbol_cells),
        "symbol cells;",
        len(unicode_differences),
        "difference with the Unicode file;",
        extension_equal,
        "of",
        extension_cells,
        "extension cells equal",
    )


if __name__ == "__main__":
    if len(sys.argv) != 5:
        sys.exit("usage: python compare-spec.py <spec tables json> <android json> <GSM0338.TXT> <output file>")
    main(*sys.argv[1:])

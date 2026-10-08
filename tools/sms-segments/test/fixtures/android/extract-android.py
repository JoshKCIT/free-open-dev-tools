"""Records the two GSM 7-bit tables as Android lists them, as data.

The source is the Android Open Source Project file GsmAlphabet.java (Apache License 2.0), at git blob
5c53f7e5a4d0403d510b8ed5a148558175f212b2 of the aosp-mirror/platform_frameworks_base mirror, path
telephony/common/com/android/internal/telephony/GsmAlphabet.java (last changed 2020-03-12). Its own comment names
"3GPP TS 23.038 V9.1.1 section 6.2.1" for the default table and "6.2.1.1" for the extension table.

Run by hand with a copy of the file; nothing is downloaded and nothing is installed:

    python extract-android.py GsmAlphabet.java android-alphabet.json

The script refuses a file whose git blob checksum is not the one above. It reads the first string of the language
tables (the default alphabet, 128 cells, with code 0x1B written as the placeholder U+FFFF) and the first string of the
shift tables (the extension table, where a space means "no character"), and writes them as JSON. Unit tests only read
the JSON; they never run Python.
"""
import datetime
import hashlib
import json
import sys

sys.dont_write_bytecode = True

BS = chr(92)
EXPECTED_BLOB = "5c53f7e5a4d0403d510b8ed5a148558175f212b2"
SOURCE = "aosp-mirror/platform_frameworks_base telephony/common/com/android/internal/telephony/GsmAlphabet.java"
LICENCE = (
    "Copyright (C) 2006 The Android Open Source Project. Licensed under the Apache License, Version 2.0 "
    "(http://www.apache.org/licenses/LICENSE-2.0); the full text is in LICENSE-APACHE-2.0.txt."
)


def git_blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + bytes([0]) + data).hexdigest()


def decode(raw):
    """Decodes the escapes of a Java string literal: backslash n, r, u plus four hex digits, and quoted characters."""
    out = []
    i = 0
    while i < len(raw):
        c = raw[i]
        if c != BS:
            out.append(c)
            i += 1
            continue
        n = raw[i + 1]
        if n == "u":
            out.append(chr(int(raw[i + 2 : i + 6], 16)))
            i += 6
        elif n == "n":
            out.append(chr(10))
            i += 2
        elif n == "r":
            out.append(chr(13))
            i += 2
        elif n in (BS, '"', "'"):
            out.append(n)
            i += 2
        else:
            raise SystemExit("unexpected escape in the Java source")
    return "".join(out)


def literals(text):
    """Every string literal in text, decoded, in order."""
    found = []
    i = 0
    while i < len(text):
        if text[i] == '"':
            j = i + 1
            while text[j] != '"':
                j += 2 if text[j] == BS else 1
            found.append(decode(text[i + 1 : j]))
            i = j + 1
        else:
            i += 1
    return found


def code_lines(lines):
    """The lines without comment-only lines and without block comments."""
    kept = []
    in_block = False
    for line in lines:
        s = line.strip()
        if in_block:
            if "*/" in s:
                in_block = False
            continue
        if s.startswith("/*"):
            if "*/" not in s:
                in_block = True
            continue
        if s.startswith("//"):
            continue
        kept.append(line)
    return kept


def region(lines, start_marker, end_marker):
    start = next(i for i, line in enumerate(lines) if start_marker in line)
    end = next(i for i, line in enumerate(lines) if i > start and end_marker in line)
    return code_lines(lines[start:end])


def main(java_path, out_path):
    data = open(java_path, "rb").read()
    blob = git_blob(data)
    if blob != EXPECTED_BLOB:
        raise SystemExit("git blob " + blob + " is not " + EXPECTED_BLOB)
    lines = data.decode("utf-8").splitlines()

    default_text = "".join(
        literals("\n".join(region(lines, "GSM 7 bit Default Alphabet", "A.3.1 Turkish National Language Locking Shift Table")))
    )
    extension_text = "".join(
        literals(
            "\n".join(
                region(lines, "6.2.1.1 GSM 7 bit Default Alphabet Extension Table", "A.2.1 Turkish National Language Single Shift Table")
            )
        )
    )
    if len(default_text) != 128:
        raise SystemExit("the default table has " + str(len(default_text)) + " cells, not 128")
    extension = {str(code): ch for code, ch in enumerate(extension_text) if ch != " "}
    if len(extension) != 10:
        raise SystemExit("the extension table has " + str(len(extension)) + " entries, not 10")

    recorded = {
        "recordedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": SOURCE,
        "blob": blob,
        "licence": LICENCE,
        "reference": "3GPP TS 23.038 V9.1.1 section 6.2.1 (default) and 6.2.1.1 (extension), as the file's own comments say",
        "note": "Code 27 (0x1B, the escape) is the placeholder U+FFFF in the source and is not a character.",
        "defaultTable": list(default_text),
        "extension": extension,
    }
    with open(out_path, "w", encoding="utf-8", newline="\n") as out:
        json.dump(recorded, out, ensure_ascii=True, indent=1)
        out.write("\n")
    print("recorded", len(default_text), "default cells and", len(extension), "extension entries from blob", blob)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: python extract-android.py <GsmAlphabet.java> <output file>")
    main(sys.argv[1], sys.argv[2])

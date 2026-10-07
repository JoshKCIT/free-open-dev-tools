"""Runs the ten Python arrays that make-texts.mjs wrote and records what Python made of each, so the unit test can compare.

Standard library only. Run it with a Python 3 that is not the machine's own, for example the scratch folder's:

    node tools/hex-viewer/test/fixtures/langs/make-texts.mjs <scratch>/texts
    <scratch>/venv/Scripts/python.exe tools/hex-viewer/test/fixtures/langs/record.py <scratch>/texts

(on Windows; bin/python on other systems). For each python-<size>.py in the folder it reads the text as UTF-8, runs it in
a fresh namespace, and reads back the variable my_data_bin. It records the size, the SHA-256 of the text's UTF-8 bytes,
the length Python found, and the SHA-256 of the bytes Python built. It writes python.json beside this script, with the
Python version and the date inside it. The unit test never runs Python: it regenerates each text, checks the text's
SHA-256 against this recording (so the recording is of that very text) and checks the byte SHA-256 against its own bytes.
"""
import datetime
import hashlib
import json
import pathlib
import platform
import sys

HERE = pathlib.Path(__file__).resolve().parent
SIZES = [0, 1, 2, 11, 12, 13, 24, 25, 1000, 4096]


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit('usage: record.py <folder holding python-<size>.py>')
    folder = pathlib.Path(sys.argv[1])
    cases = []
    for size in SIZES:
        raw = (folder / f'python-{size}.py').read_bytes()
        text = raw.decode('utf-8')
        namespace: dict = {}
        exec(compile(text, f'python-{size}.py', 'exec'), namespace)
        built = namespace['my_data_bin']
        if not isinstance(built, bytes):
            sys.exit(f'python-{size}.py did not make a bytes value')
        cases.append(
            {
                'size': size,
                'textSha256': hashlib.sha256(raw).hexdigest(),
                'length': len(built),
                'bytesSha256': hashlib.sha256(built).hexdigest(),
            }
        )
    document = {
        'recordedAt': datetime.date.today().isoformat(),
        'python': platform.python_version(),
        'cases': cases,
    }
    (HERE / 'python.json').write_text(json.dumps(document, indent=2) + '\n', encoding='utf-8')
    print(f'wrote {len(cases)} cases with Python {platform.python_version()}')


main()

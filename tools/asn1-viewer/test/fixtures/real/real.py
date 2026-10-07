"""Records what pyasn1 does with REAL values, for real.test.ts-style checks in values.test.ts.

Run with a Python that has pyasn1 installed (nothing is installed by this script):

    python real.py

It writes recorded.json next to this file. Two kinds of entries:

* encoded: a float, the bytes pyasn1's DER encoder writes for it (decimal NR3 form, or the special-value octet), and what
  pyasn1's decoder reads back from those bytes.
* decoded: hand-made REAL encodings (binary base 2, 8 and 16, a binary scaling factor, longer exponent forms, the
  special values, and the decimal forms NR1, NR2 and NR3). `derived` is the value ITU-T X.690 (02/2021) clause 8.5 gives
  for the bytes, worked out by hand and written beside the bytes below; `pyasn1` is what pyasn1's decoder reads. They
  agree except where listed in `pyasn1Differs`.
"""

import json
import os
import platform
from datetime import datetime, timezone

import pyasn1
from pyasn1.codec.ber import decoder as ber_decoder
from pyasn1.codec.der import encoder as der_encoder
from pyasn1.type import univ


def number(value):
    """A JSON-safe form of a float: finite numbers stay numbers, the others become words."""
    value = float(value)
    if value != value:
        return "nan"
    if value in (float("inf"), float("-inf")):
        return "inf" if value > 0 else "-inf"
    return value


def read(hex_text):
    data = bytes.fromhex(hex_text)
    try:
        return number(ber_decoder.decode(data)[0]), None
    except Exception as err:  # the recording keeps the error class, never the message
        return None, type(err).__name__


ENCODE = [0.0, 1.0, -1.0, 0.5, 0.15625, 3.14159, 100.0, 1e10, -2.5e-7, float("inf"), float("-inf")]

# (label, clause, hex, derived value, derivation)
DECODE = [
    ("plus zero", "8.5.2", "0900", 0.0, "no contents octets"),
    ("binary base 2: 5 x 2^-5", "8.5.7", "090380fb05", 0.15625, "80 = binary, +, base 2, F 0, one exponent octet; exponent fb = -5; N = 5"),
    ("binary base 2: 1", "8.5.7", "0903800001", 1.0, "exponent 0, N = 1"),
    ("binary base 2, negative: -3 x 2^-1", "8.5.7.1", "0903c0ff03", -1.5, "c0 = binary, S = -1; exponent ff = -1; N = 3"),
    ("binary base 8: 3 x 8^1", "8.5.7.2", "0903900103", 24.0, "90 = binary, +, base 8; exponent 1; N = 3"),
    ("binary base 16: 1 x 16^2", "8.5.7.2", "0903a00201", 256.0, "a0 = binary, +, base 16; exponent 2; N = 1"),
    ("binary scaling factor F 2: 3 x 2^2", "8.5.7.3", "0903880003", 12.0, "88 = binary, +, base 2, F 2; exponent 0; N = 3"),
    ("two exponent octets: 2^256", "8.5.7.4", "090481010001", 2.0**256, "81 = two exponent octets 0100 = 256; N = 1"),
    ("exponent length octet: 2^256", "8.5.7.4", "09058302010001", 2.0**256, "83: next octet 02 = number of exponent octets; 0100 = 256; N = 1"),
    ("PLUS-INFINITY", "8.5.9", "090140", "inf", "40"),
    ("MINUS-INFINITY", "8.5.9", "090141", "-inf", "41"),
    ("NOT-A-NUMBER", "8.5.9", "090142", "nan", "42"),
    ("minus zero", "8.5.9", "090143", -0.0, "43"),
    ("decimal NR1", "8.5.8", "090401313530", 150.0, "01 = NR1; the characters 150"),
    ("decimal NR2", "8.5.8", "090402312e35", 1.5, "02 = NR2; the characters 1.5"),
    ("decimal NR3", "8.5.8", "090603312e354532", 150.0, "03 = NR3; the characters 1.5E2"),
    ("decimal NR3 with a comma", "8.5.8", "090603312c354532", 150.0, "ISO 6093 allows a comma as the decimal mark: 1,5E2"),
]

# Where pyasn1 0.6.4 does not give the value the standard gives (found by this recording).
PYASN1_DIFFERS = ["NOT-A-NUMBER", "minus zero", "decimal NR3 with a comma"]


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    encoded = []
    for value in ENCODE:
        data = der_encoder.encode(univ.Real(value))
        decoded, error = read(data.hex())
        encoded.append({"value": number(value), "hex": data.hex(), "pyasn1": decoded})
    decoded_entries = []
    for label, clause, hex_text, derived, derivation in DECODE:
        value, error = read(hex_text)
        entry = {
            "label": label,
            "clause": "X.690 " + clause,
            "hex": hex_text,
            "derived": number(derived),
            "derivation": derivation,
            "pyasn1": value,
        }
        if error is not None:
            entry["pyasn1Error"] = error
        if label in PYASN1_DIFFERS:
            entry["pyasn1Differs"] = True
        decoded_entries.append(entry)
    out = {
        "recordedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "python": platform.python_version(),
        "pyasn1": pyasn1.__version__,
        "encoded": encoded,
        "decoded": decoded_entries,
    }
    with open(os.path.join(here, "recorded.json"), "w", encoding="utf-8", newline="\n") as handle:
        handle.write("{\n")
        for key in ("recordedAt", "python", "pyasn1"):
            handle.write("  " + json.dumps(key) + ": " + json.dumps(out[key]) + ",\n")
        for key in ("encoded", "decoded"):
            handle.write("  " + json.dumps(key) + ": [\n")
            rows = out[key]
            for i, row in enumerate(rows):
                handle.write("    " + json.dumps(row) + ("," if i < len(rows) - 1 else "") + "\n")
            handle.write("  ]" + ("," if key == "encoded" else "") + "\n")
        handle.write("}\n")
    print("recorded", len(encoded), "encoded and", len(decoded_entries), "decoded with pyasn1", pyasn1.__version__)


main()

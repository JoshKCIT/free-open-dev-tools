# REAL values recorded with pyasn1

`recorded.json` holds what pyasn1 0.6.4 (BSD-2-Clause, Python 3.14.3) did with REAL values, made by `real.py` on
2026-10-07. Nothing in the tests runs Python or pyasn1.

- `encoded`: 11 numbers, the bytes pyasn1's DER encoder writes for each (decimal NR3 form, or the special-value octet) and the
  number its decoder reads back.
- `decoded`: 17 hand-made encodings (binary base 2, 8 and 16, a binary scaling factor, two longer exponent forms, the special
  values, plus zero, and the decimal forms NR1, NR2 and NR3). `derived` is the value ITU-T X.690 (02/2021) clause 8.5 gives for
  the bytes, with the working beside it; `pyasn1` is what pyasn1 reads.

pyasn1 0.6.4 differs from the standard on three of the 17, and `values.test.ts` follows the standard and lists them by
name: NOT-A-NUMBER (`09 01 42`, pyasn1 reads infinity), minus zero (`09 01 43`, pyasn1 reads minus infinity) and a decimal
form with a comma as the decimal mark (`1,5E2`, which ISO 6093 allows and pyasn1 refuses).

## Recording again

```
python real.py
```

Needs a Python with pyasn1 installed. The research environment used a virtual environment in a scratch folder; nothing is
installed for the repository, and pyasn1 is not a dependency of anything here.

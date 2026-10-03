# Fixtures for the TOTP & HOTP code generator

`pyotp-cases.ts` holds values recorded from **pyotp 2.10.0**, an independent, widely used implementation of HOTP, TOTP and the
otpauth link. Unit tests never run Python (CI has other versions): the printed values are committed as literals, and
`make-fixtures.py` is the recipe that made them.

| What | Detail |
| ---- | ------ |
| Recorded on | 2026-10-03 |
| Python | 3.14.3, in a scratch virtual environment that holds only pyotp (nothing is installed into the machine's Python) |
| pyotp | 2.10.0 (`importlib.metadata.version("pyotp")` prints it into the first line of `pyotp-cases.ts`) |
| Random generator | `random.seed(14050)`, so the recipe prints the same file every time |
| Command | `python -m venv <scratch>/venv-14`, then `<scratch>/venv-14/Scripts/python -m pip install pyotp==2.10.0`, then `<scratch>/venv-14/Scripts/python tools/totp-generator/test/fixtures/make-fixtures.py > tools/totp-generator/test/fixtures/pyotp-cases.ts` |

What it records:

- **60 TOTP cases**: SHA-1, SHA-256 and SHA-512; 6, 7 and 8 digits; periods 15, 30 and 60; seeds of 10 to 49 bytes; times from 0
  to 4,000,000,000. Each case has the seed as hexadecimal and as the Base32 text Python writes, and pyotp's code. The time
  is passed to pyotp as a time zone aware UTC time, which takes its exact path (a time without a zone goes through the
  machine's local zone and can be an hour out on a daylight saving change).
- **20 HOTP cases**: counters 0, 1, 2^31 - 1, 2^32 - 1, 2^32, 2^53 - 1, 2^53, 2^63, 2^64 - 1 and eleven random ones up to
  2^48, so the 8 byte counter is tested well past 32 and 53 bits.
- **4 otpauth links** made by `provisioning_uri`: plain; an issuer with a space, a colon and reserved characters
  (`ACME Co: R&D (EU) !*'`) with a name holding an apostrophe and a plus sign; HOTP with a counter; and non-ASCII names with
  SHA-512, 8 digits and a period of 60. The Base32 text of each seed is replaced by a `{SEED}` marker, so no file holds a
  Base32 secret next to the word secret scanners look for; the test puts the text back.

One difference from pyotp is known and chosen: pyotp leaves a `/` in the label as it is (`urllib.parse.quote` keeps it by
default) and this package writes `%2F`, which keeps the label one path segment. No recorded case holds a `/`.

The RFC values (RFC 4226 Appendix D, RFC 6238 Appendix B with the seeds of Appendix A, RFC 4648 section 10) are written in
the test files themselves, next to the lines they come from.

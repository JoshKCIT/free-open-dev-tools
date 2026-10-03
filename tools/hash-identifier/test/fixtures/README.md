# Hash identifier fixtures

`corpus.ts` holds 91 real hash strings, each with the generator that made it and the id of the rule its documented format
maps to, plus 6 strings made by Django itself. The strings are recorded output of independent programs, not output of this
package, and the rule ids are the formats those programs document.

## How they were made

`make-fixtures.py` runs the generators and prints the entries (`--ts` prints the text of `corpus.ts`). It was run on
2026-10-03 from a scratch virtual environment, never the machine's own Python:

```
python -m venv venv-14
venv-14/Scripts/python -m pip install passlib==1.7.4 bcrypt==4.0.1 argon2-cffi Werkzeug Django
venv-14/Scripts/python tools/hash-identifier/test/fixtures/make-fixtures.py --ts > tools/hash-identifier/test/fixtures/corpus.ts
```

| Generator | Version |
| --------- | ------- |
| Python | 3.14.3 (hashlib and zlib are part of it) |
| OpenSSL command line (`passwd -1 -5 -6 -apr1`, `dgst -ripemd160`) | OpenSSL 3.5.5 27 Jan 2026 |
| passlib | 1.7.4, with the pyca bcrypt 4.0.1 backend for bcrypt |
| argon2-cffi | 25.1.0 (argon2-cffi-bindings 26.1.0) |
| Werkzeug | 3.1.9 |
| Django | 6.1.1 (six hashers, listed apart as `DJANGO_CORPUS`) |

The text that was hashed is one fixed short sample inside the script and is not written anywhere in the output. Salts are
random, so another run gives other strings; the committed file is one recorded run.

## What the corpus does and does not cover

84 of the 91 recorded strings, and all 6 from Django, map to a rule of the table. Seven passlib or Cisco formats are recorded
with `rule: null` because the table does not cover them: Cisco type 7, Cisco PIX and Cisco ASA, FSHP, GRUB PBKDF2 (the
research left these out on purpose) and the two Microsoft cached-credential hashes, which are bare 32-character hexadecimal
strings with no marker. `test/corpus.test.ts` lists them by generator and checks that none of them is listed by a marker rule.

Four of the 91 hexadecimal strings are the same text under two generator names (passlib's hex digests and Python's hashlib),
and passlib's Cisco PIX and ASA outputs are one string; each is kept under both names so the generator list is complete.

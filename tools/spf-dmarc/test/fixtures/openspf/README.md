# The OpenSPF syntax cases

`rfc7208-tests.yml`, `rfc7208-tests.LICENSE` and `rfc7208-tests.CHANGES` are the vendored suite (see `UPSTREAM.md`).
`syntax-cases.json` is the hand-curated list the unit tests read. This folder holds no other data.

## How the worklist was made

`extract.py` ran with Python 3.14.3 and PyYAML 6.0.3 from a scratch virtual environment (never the machine's own Python
packages) on 2026-10-06:

```
python -m venv <scratch>/venv-18
<scratch>/venv-18/bin/python -m pip install PyYAML==6.0.3
<scratch>/venv-18/bin/python extract.py rfc7208-tests.yml > candidates.json
```

It lists every case whose checked domain (the mailfrom domain, or the helo when mailfrom is empty) holds exactly one
distinct record text that starts with `v=spf1`, counting SPF and TXT entries together because the suite drivers copy each SPF
entry to TXT. That is 189 cases. The script judges nothing.

## How the cases were curated

Each of the 189 was read by hand. The suite's `result` is only a hint to the cause:

- `pass`, `fail`, `softfail` and `neutral` mean the record parsed, so the case becomes `valid`;
- `permerror` becomes `syntax-error` only when the cause is grammar (a bad term, a bad address, a bad prefix length, a
  bad domain-spec, a bad macro, a repeated `exp` or `redirect`); a `permerror` that comes from a missing DNS name, a loop,
  a lookup limit or void lookups is dropped, because the record on its own is fine and this page makes no lookup;
- `temperror` is dropped (a DNS failure says nothing about grammar);
- a result list such as `fail` or `permerror` is dropped when the cause is a DNS name rule the grammar does not state;
- a record text already curated from an earlier case is dropped as a repeat.

Every kept row has `reviewed: true` and a one-line `why`. Every dropped row is listed under `dropped` with its suite result
and the reason, so nothing leaves the list unrecorded. The test `spf-openspf.test.ts` judges every kept case with the
parser and checks that the vendored files still hash to the blob SHAs in `UPSTREAM.md`.

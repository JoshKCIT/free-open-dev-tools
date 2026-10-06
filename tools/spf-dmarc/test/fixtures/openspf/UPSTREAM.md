# Upstream: the OpenSPF rfc7208 test suite

- **Repository:** https://github.com/sdgathman/pyspf
- **Commit:** 4bf96ea63af4999663809bae9b5530bce25e6f16 (2019-08-31)
- **Path:** `test/`
- **Fetch date:** 2026-10-06
- **Licence:** a three-clause BSD-style grant, `rfc7208-tests.LICENSE`, vendored unedited beside the data.

The three files below are byte for byte as the repository holds them at that commit (they are LF already, and each
git blob SHA equals the one the GitHub API reports for the path). The suite's own header says "release 2014.04, based on
RFC 7208"; `rfc7208-tests.CHANGES` lists the 2019.08 addition of "multiple tests for creative syntax errors".

The suite is used only for syntax: `extract.py` lists the cases whose checked domain holds exactly one SPF record, and
`syntax-cases.json` is curated from that list by hand (see `README.md`). The suite is never used to evaluate a record,
because the page makes no DNS query.

## Files

- rfc7208-tests.yml: 386dcd4883567f99d807835e75983ffd96518944
- rfc7208-tests.LICENSE: 589f9ecf0e8360dd2215551466fa5adab499bb0c
- rfc7208-tests.CHANGES: 1b869142433abb1032eba797867bb1922d2bff7d

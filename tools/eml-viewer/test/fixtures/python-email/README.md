# Recorded second opinion: Python's email library

This folder holds what Python's standard `email` library makes of 20 messages, so the tool's reading of headers, mailboxes,
parts, file names, sizes, digests and the first text body can be compared with an independent implementation.

- **Tool and version:** Python 3.14.3 (`email` package, policy `email.policy.default`), standard library only. The version is
  written inside `expected.json` (`python`).
- **Recorded:** 2026-10-07 (the exact time is `recordedAt` inside `expected.json`).
- **How it was recorded:** from a scratch virtual environment, never the machine's own Python:

  ```
  python -m venv <scratch>/venv-18
  cd tools/eml-viewer/test/fixtures/python-email
  <scratch>/venv-18/Scripts/python.exe record.py
  ```

  (`bin/python` instead of `Scripts/python.exe` outside Windows.) `record.py` reads `messages.json`, parses each message
  with `email.message_from_bytes(..., policy=email.policy.default)` and writes `expected.json`.

## Files

- `messages.json`: the corpus. Each message is a JSON string with `\r\n` escapes (never an `.eml` file, because the
  repository normalises line endings), with the RFC or the reason it is there. It holds the RFC 5322 Appendix A examples
  (A.1.1, A.1.2, A.1.3, A.2, A.3, A.4, A.5, A.6.1 and A.6.2), the RFC 2047 section 8 header examples, the RFC 2049
  Appendix A message, the welcome message of the live page test, a forwarded message, an RFC 2231 attachment name (the
  section 4.1 example used as a file name, and a UTF-8 extended name), the character sets iso-8859-2, gb18030, euc-kr
  and windows-1252, a quoted-printable body with soft line breaks, and a Base64 body with line noise. Every message is
  pure ASCII; the bodies in other character sets are in Base64 or quoted-printable.
- `record.py`: the recorder.
- `expected.json`: the recording. Per message: the decoded `From`, `To` and `Subject`, the mailboxes of `From` and `To`,
  every part (path, content type, file name, character set, decoded size and SHA-256 of the decoded bytes) and the text of
  the first plain text body.

## How the test uses it

`test/python-email.test.ts` never runs Python. It reads `expected.json` and compares it with what `analyzeMessage` and the
header readers make of the same bytes. A difference is allowed only when it is listed in `KNOWN_DIFFERENCES` in that test,
with what each side gave and why; a difference that is not listed fails the test, and so does a listed difference that no
longer happens.

# Test fixtures for the PDF text and metadata folder

`pdfs.ts` holds small PDF files as base64 text. They were written by programs other than the code under test, so the
tests never use this folder's own output as the thing they expect.

| Writer | Version | Used for |
| --- | --- | --- |
| reportlab | 5.0.1 | the pages (text in Helvetica and Times-Roman), the first document information dictionary |
| pikepdf | 10.16.0 | the XMP streams, `PieceInfo`, `LastModified`, the form XObject, object streams, encryption |
| pypdf | 6.19.0 | the incremental update (a new Info dictionary and a new XMP stream), and the reader that checks every value |
| Python | 3.14.3 | runs the script |

Made on 2026-10-03 with:

```
python tools/pdf-text-metadata/test/fixtures/make-fixtures.py
```

from a Python environment that has those three packages (here a scratch virtual environment, never the machine's own
Python). The script reads each file back with pypdf and stops if a value is not the one that was given. Encrypted files
get new random salts on every run, so running the script again changes `F3_OWNER_ENCRYPTED` and `F4_USER_ENCRYPTED`; the
tests do not depend on their bytes.

## The files

| Constant | What it holds |
| --- | --- |
| `F1_PLAIN` | three pages, reportlab's document information only |
| `F1_FULL` | `F1_PLAIN` plus every kind of metadata: all nine standard Info keys and a custom key, a catalog XMP stream, a page XMP stream, a page `PieceInfo` and `LastModified`; objects in object streams |
| `F1_FULL_NO_OBJSTM` | the same with plain objects and uncompressed streams |
| `F2_INCREMENTAL` | `F1_FULL_NO_OBJSTM` plus an incremental update (ISO 32000-1 section 7.5.6) pointing the trailer at a new Info dictionary and the catalog at a new XMP stream; the first revision's objects stay in the file |
| `F3_OWNER_ENCRYPTED` | `F1_FULL` with an owner password only (opens without a password) |
| `F4_USER_ENCRYPTED` | `F1_FULL` with the user password `user-pw` |
| `F5_CLEAN_NO_INFO` | two pages, no document information and no XMP |
| `F6_UNICODE` | one page; Title and Author with umlauts, a tick mark and Japanese, written as UTF-16 |
| `F7_BIDI` | a title that starts with the right-to-left override character U+202E |
| `F8_NESTED` | `Metadata`, `PieceInfo` and `LastModified` in a form XObject, in font dictionaries and in an inline dictionary |

Every marker string starts `SENTINEL-` so a scan of a copy's bytes can look for it. The strings given to the writers are
listed at the top of `pdfs.ts`.

## Large inputs

The 501 page and 3,000 page files and the 2,000,000 character case are built inside the tests (`minimal-pdf.ts`, a PDF
writer written from ISO 32000-1 sections 7.3 to 7.5, and a fake document), so no large file is committed.

## Offline second readers

The copies this folder writes were also read by pypdf (`metadata`, `xmp_metadata`), pikepdf (`docinfo`,
`open_metadata()`) and Poppler's `pdftotext` outside the tests; those commands and their output are in the plan summary.
They are not run in CI.

# Fixtures of the checksum, MD4, NTLM and SHAKE tests

Unit tests never run OpenSSL, Python or a download. Every literal here was recorded once, on 2026-10-03, by the commands
below, and is read from a committed file. The scripts are kept so the values can be made again.

| File | Made by | Second opinion and version |
| ---- | ------- | -------------------------- |
| `md4-openssl.ts` | `MSYS2_ARG_CONV_EXCL="*" node tools/hash-text/test/fixtures/make-fixtures.mjs > tools/hash-text/test/fixtures/md4-openssl.ts` | `openssl dgst -md4 -provider legacy -provider default` once per input, OpenSSL 3.5.5 27 Jan 2026, Node 22.14.0 to run the script. 200 inputs from the seed in the file. Node's own `crypto` offers no MD4 under OpenSSL 3 (checked on Node 22.14.0 and 22.23.3: `error:0308010C:digital envelope routines::unsupported`), so it cannot be used. |
| `nist-shake.ts` | `python make-nist-shake.py <folder> > nist-shake.ts` | The NIST example files `SHAKE128_Msg0.pdf` and `SHAKE256_Msg0.pdf` from <https://csrc.nist.gov/CSRC/media/Projects/Cryptographic-Standards-and-Guidelines/documents/examples/>, text extracted with pypdf 6.19.0 on Python 3.14.3. |
| Adler-32 and NTLM literals in the tests | `python make-zlib-passlib.py` (output is printed, the values are written into the tests) | `zlib.adler32` of Python 3.14.3 (zlib-ng 1.3.1 as its zlib) and passlib 1.7.4 `nthash.hash`. |

The values the tests quote from standards are copied from the published text: the CRC check values and aliases from
<https://reveng.sourceforge.io/crc-catalogue/16.htm> and <https://reveng.sourceforge.io/crc-catalogue/17plus.htm>, the
five CRC-32C examples from RFC 3720 appendix B.4, the seven MD4 values from RFC 1320 appendix A.5, the NTLM value of
`Password` from MS-NLMP section 4.2.2.1.2, and the SHAKE values of the empty message from the NIST files above.

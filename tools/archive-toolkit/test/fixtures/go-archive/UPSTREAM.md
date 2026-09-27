# Upstream: golang/go archive/zip and archive/tar test data

- **Repository:** https://github.com/golang/go
- **Tag:** go1.23.0
- **Fetch date:** 2026-09-27
- **Licence:** BSD-3-Clause (repository `LICENSE`, vendored alongside these files, unmodified)

The smallest set of `src/archive/zip/testdata/` and `src/archive/tar/testdata/` files this
package's own Go-oracle test needs, covering ZIP64, a symbolic link, a ZIP data descriptor, a
UTF-8 name, a ZIP CRC error, a Windows-written ZIP, USTAR, POSIX pax records (long path, long
link name, mtime) and GNU long name/long link name headers (via consecutive `L`/`K` headers,
where the last of each kind before the real header wins). The expected names, sizes, modes
and PAX records for each file are transcribed from the fetched `archive/zip/reader_test.go`
and `archive/tar/reader_test.go` (at the same tag) into `../../test/index.test.ts`, with the
relevant table rows quoted in a comment above each assertion.

- `zip64.zip`: a single ZIP64-format entry, `README`, `"This small file is in ZIP64 format.\n"`.
- `symlink.zip`: a single symbolic-link entry, `symlink` -> `../target`.
- `go-with-datadesc-sig.zip`: two entries (`foo.txt`, `bar.txt`) written with the optional data
  descriptor signature Go's own writer adds for macOS compatibility.
- `crc32-not-streamed.zip`: two entries (`foo.txt`, `bar.txt`) whose CRC-32 lives in the local
  file header, not a data descriptor.
- `utf8-osx.zip`: a single entry named "世界" whose raw name bytes are already valid UTF-8 even
  though the UTF-8 general-purpose flag bit is not set (a macOS zip tool's own behaviour).
- `winxp.zip`: created in the Windows XP file manager -- `hello`, `dir/bar`, `dir/empty/`
  (a directory entry) and `readonly`.
- `ustar-file-devs.tar`: a single USTAR-format regular file entry, `file`, with non-zero
  device major/minor numbers.
- `pax.tar`: two entries using POSIX pax extended header records -- a 200-character name via
  the `path` record, and a symbolic link whose 200-character target arrives via the `linkpath`
  record, both with `mtime`/`atime`/`ctime` pax records.
- `gnu-multi-hdrs.tar`: four consecutive GNU long-name/long-link (`L`/`K` typeflag) headers
  before one real entry (`bar` -> `foo`, typeflag `2`, a symlink): two `L` headers naming
  `GNU1/GNU1/long-path-name` then `GNU2/GNU2/long-path-name`, and two `K` headers naming
  `GNU3/GNU3/long-linkpath-name` then `GNU4/GNU4/long-linkpath-name`. Both GNU and BSD tar
  apply only the *last* header of each kind, so the real entry's own name and link name are
  `GNU2/GNU2/long-path-name` and `GNU4/GNU4/long-linkpath-name` -- the header block's own
  `name`/`linkname` fields (`bar`/`foo`) are never used once a long-name override is pending.

## Files

- zip64.zip: a2ee1fa33dca48e1ec8dfc7507640bfa09bddeb6
- symlink.zip: af846938cde293ccc3dfb310fdfbda641382dd3f
- go-with-datadesc-sig.zip: bcfe121bb63c79be6849ca64589feea612015512
- crc32-not-streamed.zip: f268d88732f837723525285c0922231d9c3fcb46
- utf8-osx.zip: 9b0c058b5b5744d389e73e8afd9f6963426aaebf
- winxp.zip: 3919322f0c5f8be8f1a214af712b6e86b4d04aef
- ustar-file-devs.tar: 146e25b79d8980a5eb0d370d0d9a0b7534c05135
- pax.tar: 9bc24b6587d726c7fca4e533d9c61a3801a34688
- gnu-multi-hdrs.tar: 8bcad55d06e8f9fde3641d2a8df370503a582ce6
- LICENSE: 6a66aea5eafe0ca6a688840c47219556c552488e

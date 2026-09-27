# Upstream: golang/go archive/zip test data

- **Repository:** https://github.com/golang/go
- **Tag:** go1.23.0
- **Fetch date:** 2026-09-27
- **Licence:** BSD-3-Clause (repository `LICENSE`, vendored alongside these files, unmodified)

The smallest set of `src/archive/zip/testdata/` files this package's own Go-oracle test needs,
covering ZIP64, a symbolic link, a ZIP data descriptor, a UTF-8 name, a ZIP CRC error and a
Windows-written ZIP. The expected names, sizes and modes for each file are transcribed from the
fetched `archive/zip/reader_test.go` (at the same tag) into `../../test/index.test.ts`.

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

## Files

- zip64.zip: a2ee1fa33dca48e1ec8dfc7507640bfa09bddeb6
- symlink.zip: af846938cde293ccc3dfb310fdfbda641382dd3f
- go-with-datadesc-sig.zip: bcfe121bb63c79be6849ca64589feea612015512
- crc32-not-streamed.zip: f268d88732f837723525285c0922231d9c3fcb46
- utf8-osx.zip: 9b0c058b5b5744d389e73e8afd9f6963426aaebf
- winxp.zip: 3919322f0c5f8be8f1a214af712b6e86b4d04aef
- LICENSE: 6a66aea5eafe0ca6a688840c47219556c552488e

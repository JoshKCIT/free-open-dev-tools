# Upstream: MikeKovarik/exifr

- Repository: https://github.com/MikeKovarik/exifr
- Commit: 6cbf6e921688faf7723e1f2e0b9e672d1f0aa21c (tag v7.1.3)
- Fetch date: 2026-09-27
- Licence: MIT

Three small real camera/software test files from exifr's own `test/fixtures/` directory, chosen so that
together they carry EXIF, GPS, XMP, IPTC and ICC colour-profile data (`iptc-agency-photographer-example.jpg`
alone carries all five; the other two add a second and third independent camera/software origin for the real
JPEG segment layouts this package's own tests read and strip):

- `iptc-agency-photographer-example.jpg`: EXIF, GPS, XMP (photoshop, xap, crs, plus and more namespaces), IPTC
  and an ICC colour profile.
- `Bush-dog.jpg`: EXIF, XMP (photoshop, dc, xmpMM), IPTC and an ICC colour profile.
- `empty-imagedesc-in-ifd0.jpg`: EXIF and GPS, from a different camera/software origin (Microsoft Photo).

## Files

- iptc-agency-photographer-example.jpg: c965f6b24558a8ed366c597687cbcfab6c70a00f
- Bush-dog.jpg: f52a754e261386b121781da161d9a3f15d00939f
- empty-imagedesc-in-ifd0.jpg: cbc95948cb75e12be56ffd06118dddf9b55967e2
- LICENSE: bbb9a269b8ee43c14cadc046e27bb09da00477f7

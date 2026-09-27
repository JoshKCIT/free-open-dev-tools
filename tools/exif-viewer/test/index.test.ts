import { it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readMetadata, stripMetadata, readWebpChunks, type MetadataBlock } from '../src/index';
import { readUpstreamShas, gitBlobShaOfFile } from './upstream';
import {
  minimalExifTiff,
  writeJpeg,
  jpegJfifSegment,
  jpegExifSegment,
  jpegXmpSegment,
  jpegIptcSegment,
  jpegIccSegment,
  jpegAdobeSegment,
  jpegCommentSegment,
  jpegOtherAppSegment,
  writeMalformedJpegTruncatedSegment,
  writePng,
  pngTextChunk,
  pngZtxtChunk,
  pngItxtXmpChunk,
  pngExifChunk,
  pngTimeChunk,
  pngIccpChunk,
  pngGamaChunk,
  pngChrmChunk,
  pngSrgbChunk,
  pngPhysChunk,
  pngTrnsChunk,
  writeMalformedPngBadCrc,
  writeVp8xWebp,
  minimalIccProfile,
  SCAN_DATA_WITH_STUFFING,
} from './build-images';

const XMP_XML = (value: string) =>
  `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:description>${value}</dc:description></rdf:Description></rdf:RDF></x:xmpmeta>`;

function findBlock(blocks: MetadataBlock[], name: string): MetadataBlock | undefined {
  return blocks.find((b) => b.name === name);
}

const FIXTURES_DIR = join(__dirname, 'fixtures', 'exifr');

/**
 * Corrupts the first occurrence of the given JPEG marker's own length field
 * to declare far more data than the file actually has, keeping every byte
 * before it untouched (including the SOI header and SOF0, so the header
 * check still recognises the file as a JPEG) -- used to prove the strip
 * walker's own mid-file truncation refusal, independent of the earlier
 * header check.
 */
function corruptSegmentLength(jpeg: Uint8Array, marker: number): Uint8Array {
  const out = Uint8Array.from(jpeg);
  for (let i = 2; i + 3 < out.length; i++) {
    if (out[i] === 0xff && out[i + 1] === marker) {
      out[i + 2] = 0xff;
      out[i + 3] = 0xff;
      return out;
    }
  }
  throw new Error(`marker 0x${marker.toString(16)} not found in fixture`);
}

it('EXIF, GPS, XMP, IPTC and ICC blocks in a JPEG are read with exifr and match the values written into the fixture', async () => {
  const tiff = minimalExifTiff({
    description: 'a test photo',
    exifColorSpace: 1,
    gps: {
      latitudeDeg: 40,
      latitudeMin: 26,
      latitudeSec: 46,
      longitudeDeg: -79,
      longitudeMin: 58,
      longitudeSec: 56,
    },
  });
  const jpeg = writeJpeg(16, 8, [
    jpegJfifSegment(),
    jpegExifSegment(tiff),
    jpegXmpSegment(XMP_XML('a test xmp description')),
    jpegIptcSegment('a test caption'),
    jpegIccSegment(minimalIccProfile()),
  ]);

  const result = await readMetadata(jpeg);
  expect(result.kind).toBe('jpeg');

  const ifd0 = findBlock(result.blocks, 'Image (IFD0)');
  expect(ifd0?.rows).toContainEqual(['ImageDescription', 'a test photo']);

  const exif = findBlock(result.blocks, 'EXIF');
  expect(exif?.rows.some(([tag, value]) => tag === 'ColorSpace' && value.includes('1'))).toBe(true);

  const xmp = findBlock(result.blocks, 'XMP');
  expect(xmp?.rows).toContainEqual(['dc:description', 'a test xmp description']);

  const iptc = findBlock(result.blocks, 'IPTC');
  expect(iptc?.rows.some(([tag, value]) => tag === 'Caption' && value === 'a test caption')).toBe(true);

  expect(findBlock(result.blocks, 'ICC Profile')).toBeTruthy();

  expect(result.gps).toBeDefined();
  expect(result.gps!.latitude).toBeCloseTo(40.446, 2);
  expect(result.gps!.longitude).toBeCloseTo(-79.982, 2);
});

it('metadata in PNG eXIf, tEXt, iTXt and zTXt chunks and WebP EXIF and XMP chunks is read', async () => {
  const pngTiff = minimalExifTiff({ description: 'a png photo' });
  const png = writePng(4, 4, [
    pngTextChunk('Comment', 'a plain text comment'),
    pngZtxtChunk('Author', 'a compressed text comment'),
    pngItxtXmpChunk(XMP_XML('a png xmp description')),
    pngExifChunk(pngTiff),
  ]);
  const pngResult = await readMetadata(png);
  expect(pngResult.kind).toBe('png');
  const header = findBlock(pngResult.blocks, 'PNG Header');
  expect(header?.rows).toContainEqual(['Comment', 'a plain text comment']);
  expect(header?.rows).toContainEqual(['Author', 'a compressed text comment']);
  expect(findBlock(pngResult.blocks, 'Image (IFD0)')?.rows).toContainEqual(['ImageDescription', 'a png photo']);
  expect(findBlock(pngResult.blocks, 'XMP')?.rows).toContainEqual(['dc:description', 'a png xmp description']);

  const webpTiff = minimalExifTiff({ description: 'a webp photo' });
  const webp = writeVp8xWebp(16, 8, {
    exif: webpTiff,
    xmp: new TextEncoder().encode('<dc:description>a webp xmp description</dc:description>'),
  });
  const webpResult = await readMetadata(webp);
  expect(webpResult.kind).toBe('webp');
  expect(findBlock(webpResult.blocks, 'Image (IFD0)')?.rows).toContainEqual(['ImageDescription', 'a webp photo']);
  expect(findBlock(webpResult.blocks, 'XMP')?.rows).toContainEqual(['dc:description', 'a webp xmp description']);
});

it('removing metadata from a JPEG drops APP1, APP13, COM and other application segments and keeps every other byte in order', async () => {
  const tiff = minimalExifTiff({ description: 'drop me' });
  const jpeg = writeJpeg(16, 8, [
    jpegJfifSegment(),
    jpegExifSegment(tiff),
    jpegXmpSegment(XMP_XML('drop me too')),
    jpegIccSegment(minimalIccProfile()),
    jpegIptcSegment('drop this caption'),
    jpegAdobeSegment(),
    jpegCommentSegment('drop this comment'),
    jpegOtherAppSegment(3, 'an unrecognised app3 segment'),
  ]);

  const result = await stripMetadata(jpeg, { keepColourProfile: false, keepOrientation: false });

  // APP0 (JFIF) and APP14 (Adobe) are the only two segments kept from the
  // custom list above; every structural segment after them (DQT, SOF0, DHT,
  // SOS, scan data, EOI) is unaffected -- this is exactly what writeJpeg
  // itself produces when only those two segments are given, so a direct
  // byte-for-byte comparison proves nothing was reordered or altered.
  const expected = writeJpeg(16, 8, [jpegJfifSegment(), jpegAdobeSegment()]);
  expect(result.bytes).toEqual(expected);

  const whats = result.removed.map((r) => r.what);
  expect(whats.some((w) => w.includes('camera and location metadata'))).toBe(true);
  expect(whats.some((w) => w.includes('XMP'))).toBe(true);
  expect(whats.some((w) => w.includes('colour profile'))).toBe(true);
  expect(whats.some((w) => w.includes('Photoshop/IPTC'))).toBe(true);
  expect(whats.some((w) => w.includes('text comment'))).toBe(true);
  expect(whats.some((w) => w.includes('unrecognised metadata segment'))).toBe(true);
});

it('a stuffed byte and a restart marker inside JPEG scan data are copied through exactly once, never duplicated or dropped', async () => {
  // Regression test: an earlier version of this scan-data walker pushed a
  // stuffed byte or restart marker into the output both individually (as it
  // was found) and again as part of the trailing bulk copy, silently
  // duplicating bytes inside the scan and producing a corrupt copy no
  // decoder could read correctly -- caught by a real four-browser pixel
  // comparison (09-04's own SUMMARY), not by any Node-only test until this
  // one was added.
  const jpeg = writeJpeg(
    16,
    8,
    [jpegExifSegment(minimalExifTiff({ description: 'x' }))],
    undefined,
    SCAN_DATA_WITH_STUFFING,
  );
  const result = await stripMetadata(jpeg, { keepColourProfile: false, keepOrientation: false });

  const sosIndex = result.bytes.findIndex((b, i) => b === 0xff && result.bytes[i + 1] === 0xda);
  expect(sosIndex).toBeGreaterThan(-1);
  const sosLength = (result.bytes[sosIndex + 2]! << 8) | result.bytes[sosIndex + 3]!;
  const scanStart = sosIndex + 2 + sosLength;
  const scanEnd = scanStart + SCAN_DATA_WITH_STUFFING.length;
  expect(Array.from(result.bytes.subarray(scanStart, scanEnd))).toEqual(Array.from(SCAN_DATA_WITH_STUFFING));
  expect(result.bytes[scanEnd]).toBe(0xff);
  expect(result.bytes[scanEnd + 1]).toBe(0xd9); // EOI immediately follows, not a duplicated byte
});

it('removing metadata from a PNG drops eXIf, text and time chunks and keeps every other chunk byte for byte', async () => {
  const tiff = minimalExifTiff({ description: 'drop me' });
  const keptChunks = [
    pngGamaChunk(),
    pngChrmChunk(),
    pngSrgbChunk(),
    pngIccpChunk('sRGB-ish', minimalIccProfile()),
    pngPhysChunk(),
    pngTrnsChunk(),
  ];
  const droppedOnly = [
    pngExifChunk(tiff),
    pngTextChunk('Comment', 'drop this comment'),
    pngZtxtChunk('Author', 'drop this compressed comment'),
    pngItxtXmpChunk(XMP_XML('drop this xmp value')),
    pngTimeChunk(),
  ];
  const png = writePng(4, 4, [...keptChunks, ...droppedOnly]);

  const result = await stripMetadata(png, { keepColourProfile: true, keepOrientation: false });

  const expected = writePng(4, 4, keptChunks);
  expect(result.bytes).toEqual(expected);

  const whats = result.removed.map((r) => r.what);
  expect(whats.some((w) => w.includes('camera and location metadata'))).toBe(true);
  expect(whats.filter((w) => w.includes('text comment')).length).toBeGreaterThanOrEqual(2);
  expect(whats.some((w) => w.includes('last-modified date'))).toBe(true);
  expect(whats.some((w) => w.includes('XMP'))).toBe(false); // the XMP block here is a text-comment removal, not a dedicated XMP reason
});

it('removing metadata from a WebP drops the EXIF and XMP chunks, clears their VP8X flags and fixes the RIFF size as RFC 9649 defines', async () => {
  const tiff = minimalExifTiff({ description: 'drop me' });
  const webp = writeVp8xWebp(16, 8, {
    iccp: minimalIccProfile(),
    exif: tiff,
    xmp: new TextEncoder().encode('drop this xmp packet'),
  });

  const result = await stripMetadata(webp, { keepColourProfile: true, keepOrientation: false });

  // RIFF size field (bytes 4-7, little-endian) must equal the file length minus 8.
  const view = new DataView(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength);
  expect(view.getUint32(4, true)).toBe(result.bytes.length - 8);

  const chunks = readWebpChunks(result.bytes);
  expect(chunks.map((c) => c.fourCc)).toEqual(['VP8X', 'ICCP', 'VP8L']);

  const flags = chunks[0]!.data[0]!;
  expect((flags & 0x20) !== 0).toBe(true); // ICC kept
  expect((flags & 0x08) !== 0).toBe(false); // Exif flag cleared
  expect((flags & 0x04) !== 0).toBe(false); // XMP flag cleared

  const whats = result.removed.map((r) => r.what);
  expect(whats.some((w) => w.includes('camera and location metadata'))).toBe(true);
  expect(whats.some((w) => w.includes('XMP'))).toBe(true);
});

it('the stripped file re-reads with exifr and finds no EXIF, XMP, IPTC or GPS block', async () => {
  const tiff = minimalExifTiff({
    description: 'everything goes',
    gps: { latitudeDeg: 1, latitudeMin: 2, latitudeSec: 3, longitudeDeg: 4, longitudeMin: 5, longitudeSec: 6 },
  });
  const jpeg = writeJpeg(16, 8, [
    jpegExifSegment(tiff),
    jpegXmpSegment(XMP_XML('gone')),
    jpegIptcSegment('gone too'),
    jpegIccSegment(minimalIccProfile()),
  ]);

  const stripped = await stripMetadata(jpeg, { keepColourProfile: false, keepOrientation: false });
  const reread = await readMetadata(stripped.bytes);

  expect(findBlock(reread.blocks, 'EXIF')).toBeUndefined();
  expect(findBlock(reread.blocks, 'Image (IFD0)')).toBeUndefined();
  expect(findBlock(reread.blocks, 'XMP')).toBeUndefined();
  expect(findBlock(reread.blocks, 'IPTC')).toBeUndefined();
  expect(findBlock(reread.blocks, 'GPS')).toBeUndefined();
  expect(reread.gps).toBeUndefined();
  expect(stripped.kept).toEqual([]);
});

it('the colour profile is kept unless the visitor asks to remove it', async () => {
  const tiff = minimalExifTiff({ description: 'x' });
  const jpeg = writeJpeg(16, 8, [jpegExifSegment(tiff), jpegIccSegment(minimalIccProfile())]);

  const kept = await stripMetadata(jpeg, { keepColourProfile: true, keepOrientation: false });
  expect(kept.removed.some((r) => r.what.includes('colour profile'))).toBe(false);
  expect(kept.kept).toContain('the colour profile');
  expect(findBlock((await readMetadata(kept.bytes)).blocks, 'ICC Profile')).toBeTruthy();

  const removed = await stripMetadata(jpeg, { keepColourProfile: false, keepOrientation: false });
  expect(removed.removed.some((r) => r.what.includes('colour profile'))).toBe(true);
  expect(removed.kept).not.toContain('the colour profile');
  expect(findBlock((await readMetadata(removed.bytes)).blocks, 'ICC Profile')).toBeUndefined();

  const webp = writeVp8xWebp(16, 8, { iccp: minimalIccProfile() });
  const webpKept = await stripMetadata(webp, { keepColourProfile: true, keepOrientation: false });
  expect(readWebpChunks(webpKept.bytes).some((c) => c.fourCc === 'ICCP')).toBe(true);
  const webpRemoved = await stripMetadata(webp, { keepColourProfile: false, keepOrientation: false });
  expect(readWebpChunks(webpRemoved.bytes).some((c) => c.fourCc === 'ICCP')).toBe(false);
});

it('an orientation other than 1 is kept as a one-tag EXIF block so the picture is not shown rotated, unless the visitor asks to remove it', async () => {
  const tiff = minimalExifTiff({ description: 'rotated', orientation: 6 });

  const jpeg = writeJpeg(16, 8, [jpegExifSegment(tiff), jpegXmpSegment(XMP_XML('gone'))]);
  const jpegKept = await stripMetadata(jpeg, { keepColourProfile: false, keepOrientation: true });
  const jpegKeptRead = await readMetadata(jpegKept.bytes);
  expect(jpegKeptRead.orientation).toBe(6);
  expect(findBlock(jpegKeptRead.blocks, 'Image (IFD0)')?.rows).toEqual([['Orientation', expect.any(String)]]);
  expect(jpegKept.kept).toContain('the orientation tag');

  const jpegRemoved = await stripMetadata(jpeg, { keepColourProfile: false, keepOrientation: false });
  expect((await readMetadata(jpegRemoved.bytes)).orientation).toBeUndefined();
  expect(jpegRemoved.kept).toEqual([]);

  const png = writePng(4, 4, [pngExifChunk(tiff)]);
  const pngKept = await stripMetadata(png, { keepColourProfile: false, keepOrientation: true });
  expect((await readMetadata(pngKept.bytes)).orientation).toBe(6);
  const pngRemoved = await stripMetadata(png, { keepColourProfile: false, keepOrientation: false });
  expect((await readMetadata(pngRemoved.bytes)).orientation).toBeUndefined();

  const webp = writeVp8xWebp(16, 8, { exif: tiff });
  const webpKept = await stripMetadata(webp, { keepColourProfile: false, keepOrientation: true });
  expect((await readMetadata(webpKept.bytes)).orientation).toBe(6);
  const webpRemoved = await stripMetadata(webp, { keepColourProfile: false, keepOrientation: false });
  expect((await readMetadata(webpRemoved.bytes)).orientation).toBeUndefined();
});

it('data after the JPEG end-of-image marker is removed and reported', async () => {
  const trailing = new Uint8Array(24).fill(0x99);
  const jpeg = writeJpeg(16, 8, [jpegJfifSegment()], trailing);

  const result = await stripMetadata(jpeg, {});

  expect(result.bytes.length).toBe(jpeg.length - trailing.length);
  const trailingRemoval = result.removed.find((r) => r.what.includes('appended after the end'));
  expect(trailingRemoval).toBeDefined();
  expect(trailingRemoval!.bytes).toBe(trailing.length);
});

it('a truncated or malformed segment or chunk is refused rather than written out', async () => {
  await expect(stripMetadata(writeMalformedJpegTruncatedSegment(), {})).rejects.toThrow();
  await expect(stripMetadata(writeMalformedPngBadCrc(), {})).rejects.toThrow();

  // A JPEG that passes the header check (a real SOF0 is found early) but
  // whose own DHT segment, later in the file, declares far more data than
  // the file actually has -- proves strip-jpeg.ts's own mid-file refusal
  // directly, not merely the earlier header gate.
  const wellFormed = writeJpeg(16, 8, [jpegJfifSegment()]);
  const corrupted = corruptSegmentLength(wellFormed, 0xc4); // DHT
  await expect(stripMetadata(corrupted, {})).rejects.toThrow();
});

it('real camera files from the exifr repository are read and stripped with the same guarantees', async () => {
  const files = ['iptc-agency-photographer-example.jpg', 'Bush-dog.jpg', 'empty-imagedesc-in-ifd0.jpg'];
  for (const file of files) {
    const bytes = readFileSync(join(FIXTURES_DIR, file));
    const read = await readMetadata(new Uint8Array(bytes));
    expect(read.kind).toBe('jpeg');
    expect(read.blocks.length).toBeGreaterThan(0);

    const stripped = await stripMetadata(new Uint8Array(bytes), { keepColourProfile: false, keepOrientation: false });
    expect(stripped.removed.length).toBeGreaterThan(0);
    expect(stripped.bytes.length).toBeLessThan(bytes.length);

    const reread = await readMetadata(stripped.bytes);
    expect(findBlock(reread.blocks, 'EXIF')).toBeUndefined();
    expect(findBlock(reread.blocks, 'XMP')).toBeUndefined();
    expect(findBlock(reread.blocks, 'IPTC')).toBeUndefined();
    expect(reread.gps).toBeUndefined();
  }
});

it('every vendored upstream file matches the git blob SHA recorded in UPSTREAM.md', () => {
  const upstreamText = readFileSync(join(FIXTURES_DIR, 'UPSTREAM.md'), 'utf8');
  const entries = readUpstreamShas(upstreamText);
  expect(entries.length).toBeGreaterThan(0);
  for (const entry of entries) {
    const actualSha = gitBlobShaOfFile(join(FIXTURES_DIR, entry.path));
    expect(actualSha, entry.path).toBe(entry.sha);
  }
});

it('nothing is written to the console while reading or removing', async () => {
  const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    const tiff = minimalExifTiff({ description: 'x', orientation: 6 });
    const jpeg = writeJpeg(16, 8, [
      jpegExifSegment(tiff),
      jpegXmpSegment(XMP_XML('x')),
      jpegIccSegment(minimalIccProfile()),
    ]);
    await readMetadata(jpeg);
    await stripMetadata(jpeg, {});

    const bytes = readFileSync(join(FIXTURES_DIR, 'iptc-agency-photographer-example.jpg'));
    await readMetadata(new Uint8Array(bytes));
    await stripMetadata(new Uint8Array(bytes), {});

    for (const badBytes of [writeMalformedJpegTruncatedSegment(), writeMalformedPngBadCrc()]) {
      try {
        await stripMetadata(badBytes, {});
      } catch {
        // Refusal is expected here; only console silence is checked.
      }
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

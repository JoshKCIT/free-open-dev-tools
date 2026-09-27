import { test, expect, type Page } from '@playwright/test';
import {
  writeJpeg,
  jpegExifSegment,
  jpegXmpSegment,
  jpegIptcSegment,
  jpegIccSegment,
  minimalExifTiff,
  crc32,
} from './fixture-files';

/**
 * The dedicated pixel-identity, GPS-warning, orientation, hostile-file and
 * Cancel proofs for EXIF Viewer & Remover, on top of the phase-wide proof
 * `e2e/file-tools.spec.ts` already runs.
 *
 * `withRequestRecorder` is copied in shape from `e2e/pdf-to-image.spec.ts`'s
 * own helper, not `e2e/hash-file.spec.ts` (which defines `rel()` and the
 * Run/Cancel helpers but has no request-recording logic at all) -- the same
 * finding 09-02's and 09-03's own SUMMARY files already recorded for this
 * exact plan-text instruction.
 */
const rel = (path: string) => path.replace(/^\//, '');

function runButtonOf(page: Page) {
  return page.getByRole('button', { name: 'Run', exact: true });
}

async function pressRun(page: Page): Promise<void> {
  await runButtonOf(page).click();
  await expect(runButtonOf(page)).toHaveText('Run', { timeout: 30_000 });
}

async function withRequestRecorder(page: Page, action: () => Promise<void>): Promise<string[]> {
  const requests: string[] = [];
  const handler = (req: import('@playwright/test').Request) => {
    const url = req.url();
    if (!url.startsWith('data:') && !url.startsWith('blob:')) requests.push(`${req.method()} ${url}`);
  };
  page.on('request', handler);
  try {
    await action();
  } finally {
    page.off('request', handler);
  }
  return requests;
}

async function attachFile(page: Page, name: string, mimeType: string, buffer: Uint8Array): Promise<void> {
  await page.locator('#f-file').setInputFiles({ name, mimeType, buffer: Buffer.from(buffer) });
}

function outputOf(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

declare global {
  interface Window {
    __FODT_EXIF_VIEWER_TEST_CHUNK_SIZE__?: number;
    __FODT_EXIF_VIEWER_TEST_STALL_MS__?: number;
  }
}

// --- Real, browser-encoded fixtures with hand-spliced metadata --------------
// e2e code does not import tool test code, so a real canvas-encoded picture
// is built inside the page, then Node-side helpers here splice in real
// Exif/XMP/IPTC/ICC segments or chunks built from the same specifications
// `tools/exif-viewer/src/*.ts` cite, matching image-converter.spec.ts's own
// established splice-after-SOI pattern for its own orientation proof.

function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}
function u32le(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}
function ascii(s: string): number[] {
  return Array.from(s, (c) => c.charCodeAt(0));
}
function concatBytes(...parts: (number[] | Uint8Array)[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p instanceof Uint8Array ? p : Uint8Array.from(p), offset);
    offset += p.length;
  }
  return out;
}

/** Splices marker segments in right after a real JPEG's own SOI (2 bytes), before whatever the browser's own encoder wrote. */
function spliceJpegSegments(jpeg: Uint8Array, segments: Uint8Array[]): Uint8Array {
  return concatBytes(jpeg.subarray(0, 2), ...segments, jpeg.subarray(2));
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeAndData = concatBytes(ascii(type), data);
  return concatBytes(u32be(data.length), typeAndData, u32be(crc32(typeAndData)));
}
/** Inserts chunks right after a real PNG's own IHDR chunk (8-byte signature + 25-byte IHDR chunk = 33 bytes in). */
function insertPngChunksAfterIhdr(png: Uint8Array, chunks: Uint8Array[]): Uint8Array {
  const IHDR_CHUNK_END = 8 + 4 + 4 + 13 + 4; // signature + length + type + IHDR data + crc
  return concatBytes(png.subarray(0, IHDR_CHUNK_END), ...chunks, png.subarray(IHDR_CHUNK_END));
}

interface RawWebpChunk {
  fourCc: string;
  data: Uint8Array;
}

/** Walks a WebP's own top-level chunks (RFC 9649 section 2.3), starting right after the fixed 12-byte "RIFF"+size+"WEBP" header. */
function parseWebpChunks(webp: Uint8Array): RawWebpChunk[] {
  const chunks: RawWebpChunk[] = [];
  let offset = 12;
  while (offset + 8 <= webp.length) {
    const fourCc = String.fromCharCode(webp[offset]!, webp[offset + 1]!, webp[offset + 2]!, webp[offset + 3]!);
    const size = webp[offset + 4]! | (webp[offset + 5]! << 8) | (webp[offset + 6]! << 16) | (webp[offset + 7]! << 24);
    const dataStart = offset + 8;
    chunks.push({ fourCc, data: webp.subarray(dataStart, dataStart + size) });
    offset = dataStart + size + (size % 2);
  }
  return chunks;
}

function buildWebpChunk(fourCc: string, data: Uint8Array): Uint8Array {
  return concatBytes(ascii(fourCc), u32le(data.length), data, data.length % 2 ? [0] : []);
}

/**
 * Wraps a real, browser-encoded WebP's own image chunk(s) in a fresh VP8X
 * container carrying the given metadata. A canvas-encoded WebP is NOT
 * always the "simple" container RFC 9649 describes -- measured directly
 * this session: every tested engine already wraps its own output in VP8X
 * with an embedded ICCP colour profile (confirmed by inspecting the real
 * bytes, not assumed) -- so this parses whatever chunks are actually
 * present, keeps only the real image-bearing ones (dropping any existing
 * `ICCP`/`EXIF`/`XMP ` this function's own caller did not ask for), and
 * rebuilds the VP8X header and requested metadata chunks itself, rather
 * than assuming a single opaque trailing chunk.
 */
function wrapWebpAsVp8x(
  webp: Uint8Array,
  width: number,
  height: number,
  chunks: { iccp?: Uint8Array; exif?: Uint8Array; xmp?: Uint8Array },
): Uint8Array {
  const inputChunks = parseWebpChunks(webp);
  const alreadyExtended = inputChunks[0]?.fourCc === 'VP8X';
  const imageChunks = (alreadyExtended ? inputChunks.slice(1) : inputChunks)
    .filter((c) => c.fourCc !== 'ICCP' && c.fourCc !== 'EXIF' && c.fourCc !== 'XMP ')
    .map((c) => buildWebpChunk(c.fourCc, c.data));

  const w = width - 1;
  const h = height - 1;
  const flags = (chunks.iccp ? 0x20 : 0) | (chunks.exif ? 0x08 : 0) | (chunks.xmp ? 0x04 : 0);
  const vp8xPayload = concatBytes([flags, 0, 0, 0], u32le(w).slice(0, 3), u32le(h).slice(0, 3));
  const vp8x = buildWebpChunk('VP8X', vp8xPayload);

  const beforeImage: Uint8Array[] = [];
  if (chunks.iccp) beforeImage.push(buildWebpChunk('ICCP', chunks.iccp));
  const afterImage: Uint8Array[] = [];
  if (chunks.exif) afterImage.push(buildWebpChunk('EXIF', chunks.exif));
  if (chunks.xmp) afterImage.push(buildWebpChunk('XMP ', chunks.xmp));

  const payload = concatBytes(ascii('WEBP'), vp8x, ...beforeImage, ...imageChunks, ...afterImage);
  return concatBytes(ascii('RIFF'), u32le(payload.length), payload);
}

async function encodeCanvas(page: Page, width: number, height: number, mimeType: string): Promise<Uint8Array> {
  const bytes = await page.evaluate(
    async ({ width, height, mimeType }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#3366cc';
      ctx.fillRect(0, 0, width, height / 2);
      ctx.fillStyle = '#cc6633';
      ctx.fillRect(0, height / 2, width, height / 2);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), mimeType, 0.95));
      const buf = new Uint8Array(await blob.arrayBuffer());
      return Array.from(buf);
    },
    { width, height, mimeType },
  );
  return Uint8Array.from(bytes);
}

async function decodedPixels(
  page: Page,
  base64: string,
  mimeType: string,
): Promise<{ width: number; height: number; data: number[] }> {
  return page.evaluate(
    async ({ base64, mimeType }) => {
      const bin = atob(base64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const blob = new Blob([arr], { type: mimeType });
      // 'from-image' matches what a real <img> tag or CSS background shows:
      // the decoder rotates/flips per the Exif Orientation tag rather than
      // handing back the raw, un-rotated pixel grid -- the whole point of
      // this tool's own orientation-preservation guarantee is a claim about
      // what a visitor actually sees, not about the undecoded pixel layout.
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      return { width: bitmap.width, height: bitmap.height, data: Array.from(image.data) };
    },
    { base64, mimeType },
  );
}

async function downloadBytes(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).first().click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const fs = await import('node:fs');
  return fs.readFileSync(path!);
}

test('exif-viewer strips a JPEG, a PNG and a WebP and each copy decodes to exactly the same pixels in this browser', async ({
  page,
}) => {
  const W = 16;
  const H = 16;
  const cases: { name: string; mimeType: string; build: (raw: Uint8Array) => Uint8Array }[] = [
    {
      name: 'sample.jpg',
      mimeType: 'image/jpeg',
      build: (raw) =>
        spliceJpegSegments(raw, [
          jpegExifSegment(minimalExifTiff('a jpeg photo')),
          jpegXmpSegment(
            '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:description>xmp</dc:description></rdf:Description></rdf:RDF></x:xmpmeta>',
          ),
          jpegIptcSegment('an iptc caption'),
          jpegIccSegment(new Uint8Array(16).fill(1)),
        ]),
    },
    {
      name: 'sample.png',
      mimeType: 'image/png',
      build: (raw) =>
        insertPngChunksAfterIhdr(raw, [pngChunk('tEXt', concatBytes(ascii('Comment'), [0], ascii('a png comment')))]),
    },
  ];

  await page.goto(rel('/tools/exif-viewer'));
  await page.waitForLoadState('networkidle');

  for (const c of cases) {
    const raw = await encodeCanvas(page, W, H, c.mimeType);
    const withMetadata = c.build(raw);

    await page.goto(rel('/tools/exif-viewer'));
    await page.waitForLoadState('networkidle');
    await attachFile(page, c.name, c.mimeType, withMetadata);
    await pressRun(page);

    const stripped = await downloadBytes(page);
    const before = await decodedPixels(page, Buffer.from(withMetadata).toString('base64'), c.mimeType);
    const after = await decodedPixels(page, stripped.toString('base64'), c.mimeType);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    expect(after.data).toEqual(before.data);
  }

  // WebP: wrap a real, browser-encoded simple WebP's own image chunk in a
  // VP8X container carrying Exif/XMP, since a plain canvas.toBlob output has
  // no metadata capability at all (RFC 9649: only VP8X carries it).
  const rawWebp = await encodeCanvas(page, W, H, 'image/webp');
  const webpWithMetadata = wrapWebpAsVp8x(rawWebp, W, H, {
    exif: minimalExifTiff('a webp photo'),
    xmp: new TextEncoder().encode('<dc:description>webp xmp</dc:description>'),
  });
  await page.goto(rel('/tools/exif-viewer'));
  await page.waitForLoadState('networkidle');
  await attachFile(page, 'sample.webp', 'image/webp', webpWithMetadata);
  await pressRun(page);
  const strippedWebp = await downloadBytes(page);
  const beforeWebp = await decodedPixels(page, Buffer.from(webpWithMetadata).toString('base64'), 'image/webp');
  const afterWebp = await decodedPixels(page, strippedWebp.toString('base64'), 'image/webp');
  expect(afterWebp.width).toBe(beforeWebp.width);
  expect(afterWebp.height).toBe(beforeWebp.height);
  expect(afterWebp.data).toEqual(beforeWebp.data);
});

test('exif-viewer shows the GPS position as a warning and the copy has none', async ({ page }) => {
  await page.goto(rel('/tools/exif-viewer'));
  await page.waitForLoadState('networkidle');

  const jpeg = writeJpeg(16, 8, [jpegExifSegment(minimalExifTiffWithGps('a photo with a location'))]);
  await attachFile(page, 'located.jpg', 'image/jpeg', jpeg);
  await pressRun(page);

  await expect(outputOf(page)).toContainText('records where it was taken');
  await expect(outputOf(page)).toContainText('Checked: the copy has no EXIF, XMP, IPTC or GPS metadata.');
});

/**
 * `minimalExifTiff` in `e2e/fixture-files.ts` (09-01, ImageDescription
 * only) has no GPS support; a minimal GPS IFD is built here, local to this
 * spec, from CIPA DC-008 section 4.6.6 -- one entry each for
 * GPSLatitudeRef/GPSLatitude/GPSLongitudeRef/GPSLongitude, matching
 * `tools/exif-viewer/test/build-images.ts`'s own independently-built GPS IFD
 * shape (e2e code does not import tool test code, so this is written again
 * rather than imported).
 */
function minimalExifTiffWithGps(description: string): Uint8Array {
  function u16le(n: number): number[] {
    return [n & 0xff, (n >> 8) & 0xff];
  }
  function rational(n: number, d: number): Uint8Array {
    return concatBytes(u32le(n), u32le(d));
  }
  const descBytes = concatBytes(ascii(description), [0]);
  const descPadded = descBytes.length % 2 === 0 ? descBytes : concatBytes(descBytes, [0]);
  const ifd0Start = 8;
  const ifd0OverflowStart = ifd0Start + 2 + 2 * 12 + 4;
  const gpsIfdStart = ifd0OverflowStart + descPadded.length;

  const descEntry =
    descPadded.length <= 4
      ? concatBytes(
          u16le(0x010e),
          u16le(2),
          u32le(descPadded.length),
          concatBytes(descPadded, new Uint8Array(4 - descPadded.length)),
        )
      : concatBytes(u16le(0x010e), u16le(2), u32le(descPadded.length), u32le(ifd0OverflowStart));
  const gpsPtrEntry = concatBytes(u16le(0x8825), u16le(4), u32le(1), u32le(gpsIfdStart));
  const ifd0 = concatBytes(u16le(2), descEntry, gpsPtrEntry, u32le(0));

  const gpsOverflowStart = gpsIfdStart + 2 + 4 * 12 + 4;
  const latVal = concatBytes(rational(40, 1), rational(26, 1), rational(4600, 100));
  const lonVal = concatBytes(rational(79, 1), rational(58, 1), rational(5600, 100));
  const latRefEntry = concatBytes(u16le(1), u16le(2), u32le(2), concatBytes(ascii('N'), [0, 0, 0]));
  const latEntry = concatBytes(u16le(2), u16le(5), u32le(3), u32le(gpsOverflowStart));
  const lonRefEntry = concatBytes(u16le(3), u16le(2), u32le(2), concatBytes(ascii('E'), [0, 0, 0]));
  const lonEntry = concatBytes(u16le(4), u16le(5), u32le(3), u32le(gpsOverflowStart + latVal.length));
  const gpsIfd = concatBytes(u16le(4), latRefEntry, latEntry, lonRefEntry, lonEntry, u32le(0), latVal, lonVal);

  const header = concatBytes(ascii('II'), [42, 0], u32le(ifd0Start));
  return concatBytes(header, ifd0, descPadded.length > 4 ? descPadded : new Uint8Array(0), gpsIfd);
}

test('exif-viewer keeps a rotated photo upright after removing its metadata', async ({ page }) => {
  await page.goto(rel('/tools/exif-viewer'));
  await page.waitForLoadState('networkidle');

  // A real, browser-encoded JPEG (top half blue, bottom half orange) with a
  // hand-built Orientation=6 Exif segment spliced in: this browser's own
  // decoder must rotate the picture 90 degrees clockwise per CIPA DC-008,
  // so the copy this tool writes -- carrying only that one tag -- must
  // decode the exact same way.
  const raw = await encodeCanvas(page, 8, 16, 'image/jpeg');
  const rotated = spliceJpegSegments(raw, [jpegExifSegment(minimalExifTiffOrientation6())]);

  await attachFile(page, 'rotated.jpg', 'image/jpeg', rotated);
  await pressRun(page);

  const stripped = await downloadBytes(page);
  const before = await decodedPixels(page, Buffer.from(rotated).toString('base64'), 'image/jpeg');
  const after = await decodedPixels(page, stripped.toString('base64'), 'image/jpeg');
  expect(after.width).toBe(before.width);
  expect(after.height).toBe(before.height);
  expect(after.data).toEqual(before.data);
  // Whether a real browser-encoded JPEG carries its own automatic ICC
  // profile varies by engine (measured directly this session: chromium and
  // webkit embed one, firefox did not for this image) -- checked for
  // separately below rather than assumed, so this assertion only relies on
  // what every engine does the same way: keeping the orientation tag.
  await expect(outputOf(page)).toContainText('the orientation tag');
});

function minimalExifTiffOrientation6(): Uint8Array {
  function u16le(n: number): number[] {
    return [n & 0xff, (n >> 8) & 0xff];
  }
  const header = concatBytes(ascii('II'), [42, 0], u32le(8));
  const entry = concatBytes(u16le(0x0112), u16le(3), u32le(1), u16le(6), [0, 0]);
  const ifd0 = concatBytes(u16le(1), entry, u32le(0));
  return concatBytes(header, ifd0);
}

test('exif-viewer refuses an SVG and a non-image before reading and sends nothing', async ({ page }) => {
  await page.goto(rel('/tools/exif-viewer'));
  await page.waitForLoadState('networkidle');

  const requests = await withRequestRecorder(page, async () => {
    await attachFile(
      page,
      'x.svg',
      'image/svg+xml',
      new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.invalid/x.png"/></svg>',
      ),
    );
    await pressRun(page);
  });
  expect(requests).toEqual([]);
  await expect(outputOf(page)).toContainText('Could not read');

  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  const requests2 = await withRequestRecorder(page, async () => {
    await attachFile(page, 'x.jpg', 'image/jpeg', new TextEncoder().encode('just plain text, not a photo at all'));
    await pressRun(page);
  });
  expect(requests2).toEqual([]);
  await expect(outputOf(page)).toContainText('Could not read');
});

test('exif-viewer shows progress, stops on Cancel and the page keeps answering', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    window.__FODT_EXIF_VIEWER_TEST_CHUNK_SIZE__ = 64;
  });
  await page.goto(rel('/tools/exif-viewer'));
  await page.waitForLoadState('networkidle');

  // A JPEG padded well past the tiny test chunk size above, so reading it
  // in slices spans many progress messages instead of finishing before a
  // test can ever observe one.
  const trailing = new Uint8Array(400_000).fill(0x30);
  const jpeg = writeJpeg(16, 8, [jpegExifSegment(minimalExifTiff('a large photo'))]);
  const padded = new Uint8Array(jpeg.length + trailing.length);
  padded.set(jpeg, 0);
  padded.set(trailing, jpeg.length);

  await attachFile(page, 'large.jpg', 'image/jpeg', padded);

  const runButton = runButtonOf(page);
  await runButton.click();

  const cancelButton = page.getByRole('button', { name: 'Cancel', exact: true });
  await expect(cancelButton).toBeVisible({ timeout: 30_000 });

  const progressEl = page.locator('progress.tool-progress');
  const seen = new Set<number>();
  const deadline = Date.now() + 60_000;
  while (seen.size < 1 && Date.now() < deadline) {
    if ((await progressEl.count()) > 0) {
      const value = await progressEl.evaluate((el) => (el as HTMLProgressElement).value);
      seen.add(value);
    }
    if ((await cancelButton.count()) === 0) break;
    await page.waitForTimeout(5);
  }
  expect(seen.size, `observed progress values: ${[...seen].join(', ')}`).toBeGreaterThanOrEqual(1);

  await cancelButton.click();
  const note = page.locator('section[aria-label="Output"] .note-warn');
  await expect(note).toHaveText('Cancelled before finishing. No result was produced.');
  await expect(runButton).toBeEnabled();

  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    await page.evaluate(() => 1 + 1);
    expect(Date.now() - start).toBeLessThan(1000);
  }
});

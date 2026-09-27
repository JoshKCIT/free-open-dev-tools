import { test, expect, type Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';

/**
 * The dedicated four-browser proof for the phase's only file-reading page
 * and the "without my images leaving my browser" half of the goal
 * (success criterion 5, D-115): a generated image gives its colours with
 * no request other than data or blob, a hostile file is refused or
 * reported without a request, a crash or a frozen tab, and nothing about
 * the file's own bytes ever reaches the URL, storage or the console.
 *
 * `rel()` copied from `e2e/hash-file.spec.ts` / `e2e/svg-optimizer.spec.ts`.
 */
const rel = (path: string) => path.replace(/^\//, '');

// --- A small, hand-written PNG writer -------------------------------------
// Every image this file attaches is built here, byte by byte, rather than
// loaded from a fixture asset, so this spec has no binary test fixtures and
// every scenario's exact bytes are visible in this file.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/**
 * Builds a real, valid, decodable PNG: a 64 by 64 image split into four
 * solid quadrants (top-left red, top-right lime, bottom-left blue,
 * bottom-right white -- CSS Color Module Level 4's own named colours),
 * matching `tools/image-color-extractor/src/quantize.ts`'s own
 * `SAMPLE_PATTERN` layout so this file's own expected hex values agree
 * with that package's unit tests. `markerText`, if given, is embedded in a
 * `tEXt` chunk -- used only by the "never leaves the browser" test below to
 * prove a marker string inside the file's own bytes never reaches the URL,
 * storage or the console. `corruptIdat` breaks the zlib stream's own first
 * byte after a valid CRC is computed over that broken data, producing a
 * PNG with a wholly valid header (openable up to IHDR) but undecodable
 * image data -- the "corrupt image" scenario.
 */
function buildFourQuadrantPng(options: { markerText?: string; corruptIdat?: boolean } = {}): Buffer {
  const size = 64;
  const half = size / 2;
  const raw = Buffer.alloc(size * (1 + size * 4)); // one filter byte (0) + RGBA per row
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0; // filter type: None
    for (let x = 0; x < size; x++) {
      const left = x < half;
      const top = y < half;
      const [r, g, b] =
        top && left ? [255, 0, 0] : top && !left ? [0, 255, 0] : !top && left ? [0, 0, 255] : [255, 255, 255];
      const offset = rowStart + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = 255;
    }
  }

  let compressed = deflateSync(raw);
  if (options.corruptIdat) {
    compressed = Buffer.from(compressed);
    compressed[0] = 0x00; // breaks the zlib header (a valid header starts 0x78 ...)
  }

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // colour type: truecolour with alpha
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const chunks = [
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdrData),
    ...(options.markerText ? [pngChunk('tEXt', Buffer.from(`Comment\u0000${options.markerText}`, 'latin1'))] : []),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ];
  return Buffer.concat(chunks);
}

/** A PNG with a well-formed IHDR claiming far more pixels than this tool will ever decode, and no image data at all -- the header alone is enough to be refused. */
function buildHugePngHeaderOnly(): Buffer {
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(100_000, 0);
  ihdrData.writeUInt32BE(100_000, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdrData),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function attachFile(page: Page, name: string, mimeType: string, buffer: Buffer): Promise<void> {
  await page.locator('#f-image').setInputFiles({ name, mimeType, buffer });
}

function runButtonOf(page: Page) {
  return page.getByRole('button', { name: 'Run', exact: true });
}

async function pressRunAndWait(page: Page, timeout = 30_000): Promise<void> {
  await runButtonOf(page).click();
  await expect(runButtonOf(page)).toHaveText('Run', { timeout });
}

function issueListOf(page: Page) {
  return page.locator('section[aria-label="Output"] .issue-list');
}

function colourTableOf(page: Page) {
  return page.locator('section[aria-label="Output"] table');
}

test('image-color-extractor finds the four colours of a generated image and makes no request', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));

  await page.goto(rel('/tools/image-color-extractor'));
  await page.waitForLoadState('networkidle');
  requests.length = 0; // only requests made while processing the file count

  await attachFile(page, 'quadrants.png', 'image/png', buildFourQuadrantPng());
  await pressRunAndWait(page);

  const table = colourTableOf(page);
  await expect(table).toBeVisible();
  const tableText = await table.innerText();
  for (const hex of ['#0000ff', '#00ff00', '#ff0000', '#ffffff']) {
    expect(tableText.toLowerCase()).toContain(hex);
  }

  const offending = requests.filter((u) => !u.startsWith('data:') && !u.startsWith('blob:'));
  expect(offending, `no request may be made while extracting colours: ${offending.join(', ')}`).toEqual([]);
});

test('image-color-extractor refuses an SVG, a non-image and an image whose header claims too many pixels before decoding', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));

  await page.goto(rel('/tools/image-color-extractor'));
  await page.waitForLoadState('networkidle');

  const svg = Buffer.from(
    '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.invalid/x.png"/></svg>',
    'utf8',
  );
  const text = Buffer.from('this is a plain text file pretending to be a PNG by its own extension', 'utf8');
  const hugeHeader = buildHugePngHeaderOnly();

  for (const [name, mimeType, buffer] of [
    ['hostile.svg', 'image/svg+xml', svg],
    ['not-really-a-png.png', 'image/png', text],
    ['too-many-pixels.png', 'image/png', hugeHeader],
  ] as const) {
    requests.length = 0;
    await attachFile(page, name, mimeType, buffer);
    await pressRunAndWait(page);
    await expect(issueListOf(page)).toBeVisible();
    const message = await issueListOf(page).innerText();
    expect(message.length, `${name} should show a refusal message`).toBeGreaterThan(0);
    expect(message).not.toContain('example.invalid');
    const offending = requests.filter((u) => !u.startsWith('data:') && !u.startsWith('blob:'));
    expect(offending, `${name} must make no request: ${offending.join(', ')}`).toEqual([]);
  }
});

test('image-color-extractor reports a corrupt image without crashing', async ({ page }) => {
  await page.goto(rel('/tools/image-color-extractor'));
  await page.waitForLoadState('networkidle');

  await attachFile(page, 'corrupt.png', 'image/png', buildFourQuadrantPng({ corruptIdat: true }));
  await pressRunAndWait(page);

  // Engines genuinely differ here (measured this session, not assumed):
  // Chromium and WebKit's own image decoders reject a PNG whose zlib
  // stream is broken, which this tool reports as an input problem;
  // Firefox's decoder is more lenient and returns some image (here, one
  // with nothing sampled) rather than throwing. Either outcome is
  // acceptable -- the one thing this test exists to rule out is the
  // runner's own generic crash note (`run()` itself throwing), which would
  // mean this tool, not just the browser's decoder, mishandled the file.
  await expect(page.locator('section[aria-label="Output"] .note-error')).toHaveCount(0);
  await expect(runButtonOf(page)).toBeEnabled();
});

test('image-color-extractor stops a run at the time limit and the page stays responsive', async ({ page }) => {
  await page.addInitScript(() => {
    (
      window as unknown as { __FODT_IMAGE_COLOR_EXTRACTOR_TEST_TIME_LIMIT_MS__?: number }
    ).__FODT_IMAGE_COLOR_EXTRACTOR_TEST_TIME_LIMIT_MS__ = 1;
  });
  await page.goto(rel('/tools/image-color-extractor'));
  await page.waitForLoadState('networkidle');

  await attachFile(page, 'quadrants.png', 'image/png', buildFourQuadrantPng());
  await runButtonOf(page).click();

  await expect(issueListOf(page)).toContainText('Stopped after', { timeout: 5_000 });
  await expect(runButtonOf(page)).toBeEnabled();

  // Reset, from the visitor's own point of view: the app's own "chosen
  // file" summary line for the Image field disappears within a second. (A
  // pre-existing, shared ToolRunner.tsx limitation -- confirmed to affect
  // the live hash-file page too -- means the native <input type="file">
  // element itself is not reset by React; recorded rather than fixed, see
  // this plan's own SUMMARY and .planning/WINDOWS.md.)
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.locator('p.field-help', { hasText: 'quadrants.png' })).toHaveCount(0, { timeout: 1_000 });
});

test('image-color-extractor never puts the file contents in the URL, storage or console', async ({ page }) => {
  const marker = 'FODT-IMAGE-MARKER-3f9a7c2e';
  const consoleText: string[] = [];
  page.on('console', (msg) => consoleText.push(msg.text()));

  await page.goto(rel('/tools/image-color-extractor'));
  await page.waitForLoadState('networkidle');

  await attachFile(page, 'marked.png', 'image/png', buildFourQuadrantPng({ markerText: marker }));
  await pressRunAndWait(page);

  expect(page.url()).not.toContain(marker);
  const storageDump = await page.evaluate(() => ({
    local: Object.entries(localStorage).map(([k, v]) => `${k}=${v}`),
    session: Object.entries(sessionStorage).map(([k, v]) => `${k}=${v}`),
  }));
  expect(storageDump.local.join('\n')).not.toContain(marker);
  expect(storageDump.session.join('\n')).not.toContain(marker);
  expect(consoleText.join('\n')).not.toContain(marker);
});

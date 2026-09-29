import { test, expect, type Page } from '@playwright/test';
import { deflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { buildFixtureFiles, buildFixtureFile } from './fixture-files';

/**
 * The dedicated four-browser proof for `archive-toolkit`: ordinary ZIP and
 * tar.gz extraction, the D-135 safety policy (path traversal refused,
 * absolute paths and drive letters made relative, links listed and never
 * followed, overlapping entries refused, a decompression bomb stopped with
 * the page still answering), ZIP creation round-tripping through this
 * reader, and progress/Cancel (BQ). `rel()`, the request recorder and the
 * Run/Cancel helpers are copied in shape from `e2e/hash-file.spec.ts`, the
 * same shape `e2e/pdf-pages.spec.ts` already copied for this phase.
 *
 * Every hostile ZIP fixture below is a hand-rolled builder, independent of
 * both `tools/archive-toolkit/test/build-archives.ts` (e2e code never
 * imports tool test code) and `e2e/fixture-files.ts`'s own simpler
 * `writeZip` (which has no way to set a Unix mode, a custom general
 * purpose flag, or a duplicated local header offset).
 */
const rel = (path: string) => path.replace(/^\//, '');

function u16(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}
function u32(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
}
function concatBytes(...parts: (number[] | Uint8Array)[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface HostileEntry {
  name: string;
  content: Uint8Array;
  method?: 0 | 8;
  generalPurposeFlag?: number;
  unixMode?: number;
}

/** A minimal ZIP writer with full control over each entry's own header fields, for the hostile fixtures this spec builds. */
function writeHostileZip(entries: HostileEntry[], duplicateLocalHeaderFor?: number[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const localOffsets: number[] = [];
  const central: { crc: number; compressedSize: number; uncompressedSize: number; nameBytes: Uint8Array }[] = [];
  let offset = 0;

  for (const entry of entries) {
    const method = entry.method ?? (entry.content.length > 0 ? 8 : 0);
    const compressed = method === 8 ? deflateRawSync(Buffer.from(entry.content)) : Buffer.from(entry.content);
    const crc = crc32(entry.content);
    const nameBytes = new TextEncoder().encode(entry.name);
    const flag = entry.generalPurposeFlag ?? 0;
    const local = concatBytes(
      u32(0x04034b50),
      u16(20),
      u16(flag),
      u16(method),
      u16(0),
      u16(0x21),
      u32(crc),
      u32(compressed.length),
      u32(entry.content.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
    );
    localOffsets.push(offset);
    localParts.push(local, compressed);
    offset += local.length + compressed.length;
    central.push({ crc, compressedSize: compressed.length, uncompressedSize: entry.content.length, nameBytes });
  }

  const centralParts: Uint8Array[] = [];
  const centralStart = offset;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const c = central[i]!;
    const method = entry.method ?? (entry.content.length > 0 ? 8 : 0);
    const flag = entry.generalPurposeFlag ?? 0;
    const versionMadeByHost = entry.unixMode !== undefined ? 3 : 0;
    const externalAttrs = entry.unixMode !== undefined ? (entry.unixMode << 16) >>> 0 : 0;
    const localOffsetForThis =
      duplicateLocalHeaderFor?.[i] !== undefined ? localOffsets[duplicateLocalHeaderFor[i]!]! : localOffsets[i]!;
    centralParts.push(
      concatBytes(
        u32(0x02014b50),
        u16((versionMadeByHost << 8) | 20),
        u16(20),
        u16(flag),
        u16(method),
        u16(0),
        u16(0x21),
        u32(c.crc),
        u32(c.compressedSize),
        u32(c.uncompressedSize),
        u16(c.nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(externalAttrs),
        u32(localOffsetForThis),
        c.nameBytes,
      ),
    );
  }
  const centralDir = concatBytes(...centralParts);
  const eocd = concatBytes(
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDir.length),
    u32(centralStart),
    u16(0),
  );
  return concatBytes(...localParts, centralDir, eocd);
}

function runButtonOf(page: Page) {
  return page.getByRole('button', { name: 'Run', exact: true });
}

async function pressRun(page: Page): Promise<void> {
  await runButtonOf(page).click();
  await expect(runButtonOf(page)).toHaveText('Run', { timeout: 60_000 });
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

function outputOf(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

async function attachFiles(
  page: Page,
  field: string,
  files: { name: string; mimeType: string; buffer: Uint8Array }[],
): Promise<void> {
  await page
    .locator(`#f-${field}`)
    .setInputFiles(files.map((f) => ({ name: f.name, mimeType: f.mimeType, buffer: Buffer.from(f.buffer) })));
}

async function setRadio(page: Page, name: string, value: string): Promise<void> {
  await page.locator(`input[type="radio"][name="${name}"][value="${value}"]`).check();
}

async function downloadAllBytes(page: Page, count: number): Promise<{ name: string; bytes: Buffer }[]> {
  const buttons = page.locator('section[aria-label="Output"] button', { hasText: 'Download' });
  const out: { name: string; bytes: Buffer }[] = [];
  for (let i = 0; i < count; i++) {
    const downloadPromise = page.waitForEvent('download');
    await buttons.nth(i).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).not.toBeNull();
    out.push({ name: download.suggestedFilename(), bytes: readFileSync(path!) });
  }
  return out;
}

declare global {
  interface Window {
    __FODT_ARCHIVE_TOOLKIT_TEST_LIMITS__?: {
      maxInputBytes: number;
      maxTotalOutputBytes: number;
      maxEntries: number;
      maxRatio: number;
      feedChunkBytes: number;
    };
    __FODT_ARCHIVE_TOOLKIT_TEST_CHUNK_SIZE__?: number;
    __FODT_ARCHIVE_TOOLKIT_TEST_STALL_MS__?: number;
    __FODT_ARCHIVE_TOOLKIT_TEST_STEP_DELAY_MS__?: number;
  }
}

test('archive-toolkit extracts a ZIP and a tar.gz picked from disk and every entry downloads with its content', async ({
  page,
}) => {
  const zipFile = buildFixtureFile('zip', 'FODT-ARCHIVE-ZIP');
  await page.goto(rel('/tools/archive-toolkit'));
  await page.waitForLoadState('networkidle');

  const requests = await withRequestRecorder(page, async () => {
    await setRadio(page, 'mode', 'extract');
    await attachFiles(page, 'archive', [zipFile]);
    await pressRun(page);
  });
  expect(requests).toEqual([]);
  await expect(outputOf(page)).toContainText('readme.txt');
  await expect(outputOf(page)).toContainText('folder/data.txt');

  const downloaded = await downloadAllBytes(page, 2);
  const readme = downloaded.find((d) => d.name.includes('readme'));
  expect(readme).toBeTruthy();
  expect(readme!.bytes.toString('utf8')).toBe('FODT-ARCHIVE-ZIP');

  // A fresh run with a tar.gz.
  const [tarGz] = buildFixtureFiles('tar.gz', 'FODT-ARCHIVE-TARGZ');
  const requests2 = await withRequestRecorder(page, async () => {
    await attachFiles(page, 'archive', [tarGz!]);
    await pressRun(page);
  });
  expect(requests2).toEqual([]);
  await expect(outputOf(page)).toContainText('notes.txt');
  const downloaded2 = await downloadAllBytes(page, 1);
  expect(downloaded2[0]!.bytes.toString('utf8')).toBe('FODT-ARCHIVE-TARGZ');
});

test('archive-toolkit refuses path traversal entries, makes absolute paths relative and lists links without following them', async ({
  page,
}) => {
  const bytes = writeHostileZip([
    { name: '../evil.txt', content: new TextEncoder().encode('x') },
    { name: '/etc/x.txt', content: new TextEncoder().encode('x') },
    { name: 'a-symlink', content: new TextEncoder().encode('/etc/passwd'), unixMode: 0o120777 },
  ]);
  await page.goto(rel('/tools/archive-toolkit'));
  await page.waitForLoadState('networkidle');
  await setRadio(page, 'mode', 'extract');
  await attachFiles(page, 'archive', [{ name: 'hostile.zip', mimeType: 'application/zip', buffer: bytes }]);
  await pressRun(page);

  await expect(outputOf(page)).toContainText('refused');
  await expect(outputOf(page)).toContainText('etc/x.txt');
  await expect(outputOf(page)).toContainText('a-symlink');
  await expect(outputOf(page)).toContainText('symlink');
  // The relativised etc/x.txt is a real extracted file (one download); the
  // refused ../evil.txt and the listed-only symlink are never offered.
  const downloaded = await downloadAllBytes(page, 1);
  expect(downloaded[0]!.name).toContain('x.txt');
});

test('archive-toolkit refuses overlapping entries', async ({ page }) => {
  const bytes = writeHostileZip(
    [
      { name: 'a.txt', content: new TextEncoder().encode('aaaa') },
      { name: 'b.txt', content: new TextEncoder().encode('bbbb') },
    ],
    [0, 0],
  );
  await page.goto(rel('/tools/archive-toolkit'));
  await page.waitForLoadState('networkidle');
  await setRadio(page, 'mode', 'extract');
  await attachFiles(page, 'archive', [{ name: 'overlap.zip', mimeType: 'application/zip', buffer: bytes }]);
  await pressRun(page);
  await expect(outputOf(page)).toContainText('overlap');
});

test('archive-toolkit stops a decompression bomb at the limit and the page keeps answering', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    window.__FODT_ARCHIVE_TOOLKIT_TEST_LIMITS__ = {
      maxInputBytes: 2 * 1024 * 1024 * 1024,
      maxTotalOutputBytes: 8 * 1024 * 1024,
      maxEntries: 10_000,
      maxRatio: 250,
      feedChunkBytes: 16 * 1024,
    };
  });
  await page.goto(rel('/tools/archive-toolkit'));
  await page.waitForLoadState('networkidle');
  await setRadio(page, 'mode', 'extract');

  const zeros = new Uint8Array(64 * 1024 * 1024);
  const bombBytes = writeHostileZip([{ name: 'bomb.bin', content: zeros, method: 8 }]);
  await attachFiles(page, 'archive', [{ name: 'bomb.zip', mimeType: 'application/zip', buffer: bombBytes }]);
  await pressRun(page);

  await expect(outputOf(page)).toContainText(/Stopped: this archive would expand to more than/, { timeout: 10_000 });

  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    await page.evaluate(() => 1 + 1);
    expect(Date.now() - start).toBeLessThan(1000);
  }
});

test('archive-toolkit creates a ZIP from picked files that this reader extracts unchanged', async ({ page }) => {
  const files = buildFixtureFiles('png,jpeg', 'FODT-ARCHIVE-CREATE');
  await page.goto(rel('/tools/archive-toolkit'));
  await page.waitForLoadState('networkidle');
  await setRadio(page, 'mode', 'create');
  await attachFiles(page, 'files', files);
  await pressRun(page);

  await expect(outputOf(page)).toContainText('archive.zip');
  const [created] = await downloadAllBytes(page, 1);
  expect(created!.bytes.subarray(0, 4).toString('hex')).toBe('504b0304');

  // Extract the created ZIP back on the same page and see both files listed.
  await setRadio(page, 'mode', 'extract');
  await attachFiles(page, 'archive', [{ name: created!.name, mimeType: 'application/zip', buffer: created!.bytes }]);
  await pressRun(page);
  const entriesTable = outputOf(page);
  await expect(entriesTable).toContainText('.png');
  await expect(entriesTable).toContainText('.jpg');
});

test('archive-toolkit shows progress, stops on Cancel and the page keeps answering', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    window.__FODT_ARCHIVE_TOOLKIT_TEST_CHUNK_SIZE__ = 4096;
    // A real run over a few megabytes finishes in well under a second even
    // at a small chunk size: too fast for a real click to ever land while
    // Cancel is still showing. The same established test-only per-chunk
    // delay pattern `pdf-split.worker.ts`'s own `testStepDelayMs` uses.
    window.__FODT_ARCHIVE_TOOLKIT_TEST_STEP_DELAY_MS__ = 20;
  });
  await page.goto(rel('/tools/archive-toolkit'));
  await page.waitForLoadState('networkidle');
  await setRadio(page, 'mode', 'extract');

  // Stored (not deflated), so its own compressed size equals its real size
  // regardless of content -- the small test chunk size then forces enough
  // real feed iterations for a Playwright poll to land mid-run.
  // 1 MiB: 256 chunks at 20 ms each is about 5 s of work. 256 KiB (about
  // 1.3 s) was too short on GitHub's WebKit runner: the run finished while
  // the Cancel click was landing (CI run 36488561740).
  const bigContent = new Uint8Array(1024 * 1024);
  for (let i = 0; i < bigContent.length; i++) bigContent[i] = (i * 31 + 7) & 0xff;
  const bigZip = writeHostileZip([{ name: 'big.bin', content: bigContent, method: 0 }]);
  await attachFiles(page, 'archive', [{ name: 'big.zip', mimeType: 'application/zip', buffer: bigZip }]);

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

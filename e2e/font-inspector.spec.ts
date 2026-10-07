import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { armCspProbe, describeFinding, type CspFinding, type CspProbe } from './csp-probe';

/**
 * The dedicated four-browser proof for the Font Inspector & Web Font Converter's conversion half (19-06, INSP-05, D-232,
 * D-233, D-235): each conversion of the 1,672 byte Det Sans font is saved under the expected name with the expected container
 * signature; each saved file is loaded by the browser's own font loader (a blank page, `new FontFace`) and a copy with one
 * flipped header byte is refused; a long conversion shows the working cue and Cancel stops it with nothing offered; a font
 * that would expand more than 100 times is refused with no download; the served policy holds the three grants the engine
 * needs; and neither inspecting nor converting sends a request.
 *
 * The long and the patterned fonts are built here from the fixture font by adding one table to it (crypto-random bytes for
 * the long conversion, so they cannot be packed; zeros for the ratio refusal, so they pack to almost nothing), then the
 * checksums and the head adjustment are set again. The same spec runs against a deployed site when E2E_BASE_URL is set (plan
 * 19-08). It edits no shared file and never sets bypassCSP.
 */
const here = dirname(fileURLToPath(import.meta.url));
const rel = (path: string) => path.replace(/^\//, '');

/** The padding of the long conversion: 4 MiB of random bytes packs at about a second per MiB on every engine measured. */
const LONG_PADDING_BYTES = 4 * 1024 * 1024;
/** The padding of the 60 second probe: 12 MiB of random bytes, which keeps the worker busy for far longer than the probe waits. */
const HUGE_PADDING_BYTES = 12 * 1024 * 1024;
/** The patterned table of the ratio refusal: 3 MiB of zeros packs to about a kilobyte, far past 100 times. */
const PATTERN_BYTES = 3 * 1024 * 1024;

interface LiveFixture {
  steps: { action: string; files?: { name: string; mimeType: string; base64: string }[] }[];
}

/** The Det Sans font's bytes, read from the live fixture file so the two cannot disagree. */
function fixtureFont(): Buffer {
  const live = JSON.parse(readFileSync(join(here, 'live-fixtures', 'font-inspector.json'), 'utf8')) as LiveFixture;
  const attach = live.steps.find((step) => step.action === 'attach');
  const base64 = attach?.files?.[0]?.base64;
  if (base64 === undefined) throw new Error('the live fixture has no font to attach');
  return Buffer.from(base64, 'base64');
}

/** The sum of a buffer read as big-endian 32-bit words, padded with zeros, modulo 2 to the 32. */
function sum32(buffer: Buffer): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 4) {
    const word =
      (buffer[i]! * 2 ** 24 + (buffer[i + 1] ?? 0) * 2 ** 16 + (buffer[i + 2] ?? 0) * 2 ** 8 + (buffer[i + 3] ?? 0)) >>>
      0;
    sum = (sum + word) % 2 ** 32;
  }
  return sum;
}

/** The font with one more table: the directory is rebuilt in tag order, every checksum is worked out and the head adjustment is set. */
function withTable(font: Buffer, tag: string, data: Buffer): Buffer {
  const count = font.readUInt16BE(4);
  const tables: { tag: string; data: Buffer }[] = [];
  for (let i = 0; i < count; i++) {
    const e = 12 + 16 * i;
    const offset = font.readUInt32BE(e + 8);
    const length = font.readUInt32BE(e + 12);
    tables.push({ tag: font.toString('latin1', e, e + 4), data: Buffer.from(font.subarray(offset, offset + length)) });
  }
  tables.push({ tag, data });
  tables.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  let at = 12 + 16 * tables.length;
  const placed = tables.map((t) => {
    const start = at;
    at += (t.data.length + 3) & ~3;
    return { ...t, start };
  });
  const out = Buffer.alloc(at);
  out.writeUInt32BE(font.readUInt32BE(0), 0);
  out.writeUInt16BE(tables.length, 4);
  let log = 0;
  while (2 ** (log + 1) <= tables.length) log++;
  out.writeUInt16BE(2 ** log * 16, 6);
  out.writeUInt16BE(log, 8);
  out.writeUInt16BE(tables.length * 16 - 2 ** log * 16, 10);
  let headAt = -1;
  placed.forEach((t, i) => {
    const e = 12 + 16 * i;
    out.write(t.tag, e, 'latin1');
    t.data.copy(out, t.start);
    if (t.tag === 'head') {
      headAt = t.start;
      out.fill(0, t.start + 8, t.start + 12);
    }
    out.writeUInt32BE(sum32(out.subarray(t.start, t.start + t.data.length)), e + 4);
    out.writeUInt32BE(t.start, e + 8);
    out.writeUInt32BE(t.data.length, e + 12);
  });
  if (headAt >= 0) out.writeUInt32BE((0xb1b0afba - sum32(out) + 2 ** 32) % 2 ** 32, headAt + 8);
  return out;
}

function outputArea(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

/** The row of the offered file whose name is exactly this (not a name that merely contains it, nor an earlier result's row). */
function fileRow(page: Page, name: string) {
  return outputArea(page)
    .locator('li')
    .filter({ has: page.getByText(name, { exact: true }) });
}

function runButton(page: Page) {
  return page.getByRole('button', { name: 'Run', exact: true });
}

const lines = (findings: CspFinding[]): string => findings.map(describeFinding).join(' | ') || 'none';

/** Opens the inspector with the probe armed first, so a violation raised while the page loads is counted. */
async function openInspector(page: Page): Promise<CspProbe> {
  const probe = await armCspProbe(page);
  await page.goto(rel('/tools/font-inspector'));
  await page.waitForLoadState('networkidle');
  await page.locator('#f-file').waitFor({ state: 'attached' });
  return probe;
}

async function attachFont(page: Page, name: string, mimeType: string, buffer: Buffer): Promise<void> {
  await page.locator('#f-file').setInputFiles({ name, mimeType, buffer });
}

async function chooseTarget(page: Page, target: 'none' | 'sfnt' | 'woff' | 'woff2'): Promise<void> {
  await page.locator('#f-convertTo').selectOption(target);
}

/** Converts and saves: the file's name and bytes as the browser downloaded them. */
async function convertAndSave(page: Page, expectedName: string): Promise<{ name: string; bytes: Buffer }> {
  await runButton(page).click();
  const row = fileRow(page, expectedName);
  await expect(row).toBeVisible({ timeout: 90_000 });
  const pending = page.waitForEvent('download');
  await row.getByRole('button', { name: /Download/ }).click();
  const download = await pending;
  const path = await download.path();
  expect(path).not.toBeNull();
  return { name: download.suggestedFilename(), bytes: readFileSync(path!) };
}

const hex = (bytes: Buffer, count: number): string => bytes.subarray(0, count).toString('hex');

test('font-inspector: each conversion saves the expected name and container signature', async ({ page }) => {
  test.setTimeout(240_000);
  const probe = await openInspector(page);
  await attachFont(page, 'det-sans.ttf', 'font/ttf', fixtureFont());

  // The check is on screen beside the file: read back, tables identical, glyphs compared, what differs by design.
  await chooseTarget(page, 'woff2');
  const woff2 = await convertAndSave(page, 'DetSans-Regular.woff2');
  expect(woff2.name).toBe('DetSans-Regular.woff2');
  expect(hex(woff2.bytes, 4)).toBe('774f4632');
  const output = outputArea(page);
  await expect(output).toContainText('Conversion check');
  await expect(output).toContainText('Read back and checked');
  await expect(output).toContainText('Tables byte for byte identical');
  await expect(output).toContainText('Glyphs compared');
  await expect(output).toContainText('Differs by design');
  await expect(output).toContainText('Only the container and its compression changed');

  await chooseTarget(page, 'woff');
  const woff = await convertAndSave(page, 'DetSans-Regular.woff');
  expect(woff.name).toBe('DetSans-Regular.woff');
  expect(hex(woff.bytes, 4)).toBe('774f4646');

  // And back: the saved WOFF2 file is opened and turned into a plain TrueType file.
  await attachFont(page, 'DetSans-Regular.woff2', 'font/woff2', woff2.bytes);
  await chooseTarget(page, 'sfnt');
  const ttf = await convertAndSave(page, 'DetSans-Regular.ttf');
  expect(ttf.name).toBe('DetSans-Regular.ttf');
  expect(hex(ttf.bytes, 4)).toBe('00010000');
  // The same container is refused in plain words, with nothing offered.
  await chooseTarget(page, 'woff2');
  await runButton(page).click();
  await expect(output).toContainText('already a WOFF2 file', { timeout: 60_000 });
  await expect(output.locator('li', { hasText: '.woff2' })).toHaveCount(0);
  expect(probe.findings(), `a violation was recorded while converting: ${lines(probe.findings())}`).toEqual([]);
});

/** What the browser's own font loader says about the bytes, in a blank page. */
async function loadWithFontFace(context: BrowserContext, bytes: Buffer): Promise<string> {
  const blank = await context.newPage();
  try {
    await blank.goto('about:blank');
    return await blank.evaluate(async (base64: string) => {
      const raw = atob(base64);
      const buffer = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) buffer[i] = raw.charCodeAt(i);
      try {
        const face = new FontFace('FodtProbe', buffer.buffer);
        await face.load();
        return face.status;
      } catch (err) {
        return `error:${err instanceof Error ? err.name : 'unknown'}`;
      }
    }, bytes.toString('base64'));
  } finally {
    await blank.close();
  }
}

test('font-inspector: each converted font loads with FontFace and a copy with a flipped header byte is refused', async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  await openInspector(page);
  await attachFont(page, 'det-sans.ttf', 'font/ttf', fixtureFont());
  const saved: { name: string; bytes: Buffer }[] = [];
  await chooseTarget(page, 'woff2');
  saved.push(await convertAndSave(page, 'DetSans-Regular.woff2'));
  await chooseTarget(page, 'woff');
  saved.push(await convertAndSave(page, 'DetSans-Regular.woff'));
  await attachFont(page, saved[0]!.name, 'font/woff2', saved[0]!.bytes);
  await chooseTarget(page, 'sfnt');
  saved.push(await convertAndSave(page, 'DetSans-Regular.ttf'));
  expect(saved.map((file) => file.name)).toEqual([
    'DetSans-Regular.woff2',
    'DetSans-Regular.woff',
    'DetSans-Regular.ttf',
  ]);

  for (const file of saved) {
    // The browser's loader accepts the file as it was saved ...
    expect(await loadWithFontFace(context, file.bytes), `${file.name} as saved`).toBe('loaded');
    // ... and refuses the same file with its first byte changed.
    const flipped = Buffer.from(file.bytes);
    flipped[0] = flipped[0]! ^ 0xff;
    const refused = await loadWithFontFace(context, flipped);
    expect(refused, `${file.name} with a flipped header byte`).toMatch(/^error:/);
  }
});

test('font-inspector: a long conversion shows the working cue and Cancel stops it with nothing offered', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const long = withTable(fixtureFont(), 'PADD', randomBytes(LONG_PADDING_BYTES));
  await page.clock.install();
  await openInspector(page);
  await attachFont(page, 'long.ttf', 'font/ttf', long);
  await chooseTarget(page, 'woff2');

  const output = outputArea(page);
  const cue = output.locator(':scope > .working-cue');
  const started = Date.now();
  await runButton(page).click();
  // The cue shows after about a second and says the run stops by itself at 60 seconds; Cancel is offered.
  await expect(cue).toBeVisible({ timeout: 30_000 });
  const cueAfter = Date.now() - started;
  await expect(cue).toContainText(/Working… \d+ s/);
  await expect(cue).toContainText('60 s');
  await expect(cue).toContainText('Press Cancel to stop it.');
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
  await expect(cancel).toHaveCount(1);
  const cancelAt = Date.now();
  await cancel.click();
  const cancelledAfter = Date.now() - cancelAt;

  // It stopped: no cue, the cancelled note, focus back on Run, and nothing to save.
  await expect(cue).toHaveCount(0);
  await expect(output.locator('.note-warn')).toContainText('Cancelled before finishing. No result was produced.');
  await expect(output).toHaveAttribute('aria-busy', 'false');
  await expect(runButton(page)).toBeFocused();
  await expect(output.getByRole('button', { name: /Download/ })).toHaveCount(0);
  await expect(output).not.toContainText('Converted font');
  // Give the worker time to have finished if it had not really been stopped, and judge again.
  await page.waitForTimeout(2500);
  await expect(output.getByRole('button', { name: /Download/ })).toHaveCount(0);
  await expect(output).not.toContainText('Converted font');
  testInfo.annotations.push({
    type: 'timing',
    description: `padding ${LONG_PADDING_BYTES} bytes; the cue showed ${cueAfter} ms after Run; Cancel took effect in ${cancelledAfter} ms`,
  });
  console.log(
    `font-inspector long conversion: padding ${LONG_PADDING_BYTES} bytes, cue after ${cueAfter} ms, Cancel took ${cancelledAfter} ms`,
  );

  // A run that outlasts 60 seconds is stopped by the page itself and nothing is offered. A fake clock that otherwise flows
  // as usual is jumped forward over the limit while the worker is still packing a much larger font; the worker is
  // terminated, so the packing never finishes.
  const huge = withTable(fixtureFont(), 'PADD', randomBytes(HUGE_PADDING_BYTES));
  await attachFont(page, 'huge.ttf', 'font/ttf', huge);
  await runButton(page).click();
  await expect(cue).toBeVisible({ timeout: 30_000 });
  // The worker has started and the job is posted by now; the limit counts from the job.
  await page.waitForTimeout(1500);
  await page.clock.fastForward(61_000);
  await expect(output).toContainText('Stopped after 60 seconds', { timeout: 30_000 });
  await expect(output).toHaveAttribute('aria-busy', 'false');
  await expect(output.getByRole('button', { name: /Download/ })).toHaveCount(0);
  await expect(output).not.toContainText('Converted font');
  await page.waitForTimeout(2500);
  await expect(output.getByRole('button', { name: /Download/ })).toHaveCount(0);
});

test('font-inspector: a font that would expand more than 100 times is refused with no download', async ({ page }) => {
  test.setTimeout(240_000);
  const patterned = withTable(fixtureFont(), 'PADD', Buffer.alloc(PATTERN_BYTES));
  await openInspector(page);
  await attachFont(page, 'patterned.ttf', 'font/ttf', patterned);
  const output = outputArea(page);

  await chooseTarget(page, 'woff2');
  await runButton(page).click();
  await expect(output).toContainText('more than 100 times', { timeout: 90_000 });
  await expect(output).toContainText('Not offered');
  await expect(output).toContainText('Try WOFF instead');
  await expect(output.getByRole('button', { name: /Download/ })).toHaveCount(0);
  await expect(output.locator('li', { hasText: '.woff2' })).toHaveCount(0);

  // WOFF has no such rule: the same font is offered as a WOFF file, and the reader's check passes.
  await chooseTarget(page, 'woff');
  const woff = await convertAndSave(page, 'DetSans-Regular.woff');
  expect(hex(woff.bytes, 4)).toBe('774f4646');
  await expect(output).toContainText('Read back and checked');
});

test('font-inspector: the served policy allows code generation, WebAssembly and blob workers', async ({ page }) => {
  test.setTimeout(120_000);
  await openInspector(page);
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(policy, 'the page serves a policy in a meta element').not.toBeNull();
  const directive = (name: string): string =>
    (policy ?? '')
      .split(';')
      .find((part) => part.trim().startsWith(`${name} `))
      ?.trim() ?? '';
  const script = directive('script-src');
  expect(script, 'script-src is present').toContain("'self'");
  expect(script).toContain("'unsafe-eval'");
  expect(script).toContain("'wasm-unsafe-eval'");
  expect(directive('worker-src')).toContain('blob:');
  // Nothing wider than the engine needs: no inline script, no remote source.
  expect(script).not.toContain("'unsafe-inline'");
  expect(script).not.toMatch(/https?:/);
  expect(directive('connect-src')).toContain("'none'");
});

test('font-inspector: inspecting and converting send no request', async ({ page }) => {
  test.setTimeout(240_000);
  const probe = await openInspector(page);
  // Everything after the page has loaded: the page, its scripts and its styles are already here.
  const requests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith('data:') && !url.startsWith('blob:')) requests.push(`${request.method()} ${url}`);
  });
  await attachFont(page, 'det-sans.ttf', 'font/ttf', fixtureFont());
  // Inspecting alone, then converting to each target.
  await runButton(page).click();
  await expect(outputArea(page)).toContainText('Det Sans', { timeout: 60_000 });
  for (const [target, name] of [
    ['woff2', 'DetSans-Regular.woff2'],
    ['woff', 'DetSans-Regular.woff'],
  ] as const) {
    await chooseTarget(page, target);
    await runButton(page).click();
    await expect(fileRow(page, name)).toBeVisible({ timeout: 90_000 });
  }
  // Give a stray request time to land before judging.
  await page.waitForTimeout(1500);
  expect(requests, 'a request was made while a font was read and converted').toEqual([]);
  expect(probe.findings(), `a request was refused by the policy: ${lines(probe.findings())}`).toEqual([]);
});

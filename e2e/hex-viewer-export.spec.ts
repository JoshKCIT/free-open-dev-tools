import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * The dedicated four-browser proof for the hex viewer's code array export (19-01, INSP-06, D-231, D-233): the file a
 * visitor saves has the name and the bytes the page promises, the page with Export left at No export shows nothing of the
 * export, and an export over 4 MiB is refused beside the rows without removing them.
 *
 * The expected text is what `xxd -i greeting.bin` printed for the five bytes of Hello on this machine on 2026-10-07, both
 * with Git for Windows xxd 2025-11-26 and with Ubuntu 24.04 xxd 2023-10-25 (the two outputs have the same MD5,
 * 500d6bb51addd70157dcf5e9d9a3c68b); it is also one of the recorded cases kept in
 * tools/hex-viewer/test/fixtures/xxd/cases.json. The page is driven only through its labelled controls.
 */
const rel = (path: string) => path.replace(/^\//, '');

const XXD_GREETING = [
  'unsigned char greeting_bin[] = {',
  '  0x48, 0x65, 0x6c, 0x6c, 0x6f',
  '};',
  'unsigned int greeting_bin_len = 5;',
  '',
].join('\n');

function outputArea(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

async function openHexViewer(page: Page): Promise<void> {
  await page.goto(rel('/tools/hex-viewer'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
}

/** Fills a text field and checks the value stayed; a prerendered page can clear a field filled just after load. */
async function fillAndHold(page: Page, name: string, value: string): Promise<void> {
  const field = page.locator(`#f-${name}`);
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

test('hex-viewer: export saves greeting_bin.h holding the xxd -i form of the five bytes', async ({ page }) => {
  test.setTimeout(120_000);
  await openHexViewer(page);

  await page.locator('input[type="radio"][name="source"][value="hex"]').check();
  await fillAndHold(page, 'pasted', '48656c6c6f');
  await page.locator('#f-exportAs').selectOption('c');
  await fillAndHold(page, 'exportName', 'greeting.bin');

  // The note says what was written and that nothing was uploaded; the preview holds the array.
  const output = outputArea(page);
  await expect(output).toContainText('Exported 5 bytes from byte 0 as C or C++ (xxd -i form).', { timeout: 20_000 });
  await expect(output).toContainText('Nothing is uploaded.');
  await expect(output.locator('pre.output', { hasText: 'unsigned char greeting_bin[] = {' })).toBeVisible();

  // The saved file: the cleaned name with the fixed extension, the bytes xxd -i wrote, length line included.
  const saved = page.waitForEvent('download');
  await output.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await saved;
  expect(download.suggestedFilename()).toBe('greeting_bin.h');
  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = readFileSync(path!);
  expect(bytes.toString('utf8')).toBe(XXD_GREETING);
  expect(bytes.length).toBe(Buffer.byteLength(XXD_GREETING));
  expect(bytes.toString('utf8').split('\n')[0]).toBe('unsigned char greeting_bin[] = {');
  expect(bytes.toString('utf8')).toContain('unsigned int greeting_bin_len = 5;');
});

test('hex-viewer: with export off the page shows no export note, code block or save button', async ({ page }) => {
  test.setTimeout(120_000);
  await openHexViewer(page);

  await page.locator('input[type="radio"][name="source"][value="hex"]').check();
  await fillAndHold(page, 'pasted', '48656c6c6f');

  const output = outputArea(page);
  // The rows are there, as before this upgrade.
  await expect(output.locator('pre.output')).toContainText('00000000  48 65 6c 6c 6f', { timeout: 20_000 });
  await expect(output).toContainText('Showing bytes');

  // Export is left at its default, and nothing of it is shown or offered.
  await expect(page.locator('#f-exportAs')).toHaveValue('none');
  await expect(page.locator('#f-exportName')).toHaveCount(0);
  await expect(output).not.toContainText('Exported');
  await expect(output).not.toContainText('Nothing is uploaded.');
  await expect(output.locator('pre.output')).toHaveCount(1);
  await expect(output.getByText('C or C++ array')).toHaveCount(0);
  await expect(output.getByRole('button', { name: 'Download' })).toHaveCount(0);
});

test('hex-viewer: an export over 4 MiB is refused beside the rows and the rows stay', async ({ page }) => {
  test.setTimeout(180_000);
  await openHexViewer(page);

  // 5 MiB of zero bytes: the rows come first, as for any file.
  const size = 5 * 1024 * 1024;
  await page
    .locator('#f-file')
    .setInputFiles({ name: 'five.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(size) });
  const output = outputArea(page);
  await expect(output.locator('pre.output')).toContainText('00000000  00 00 00', { timeout: 30_000 });

  // With Export on and no Length the selection is the whole file, which is over the limit: the refusal names it.
  await page.locator('#f-exportAs').selectOption('c');
  await expect(output.locator('.issue-list')).toContainText('4 MiB', { timeout: 30_000 });
  await expect(output.locator('.issue-list')).toContainText('Export');
  await expect(output.locator('pre.output')).toContainText('00000000  00 00 00');
  await expect(output.getByRole('button', { name: 'Download' })).toHaveCount(0);

  // A Length inside the limit is accepted, so the refusal was about the size and nothing else.
  await fillAndHold(page, 'exportLength', '16');
  await expect(output).toContainText('Exported 16 bytes from byte 0 as C or C++ (xxd -i form).', { timeout: 30_000 });
  await expect(output.locator('.issue-list')).toHaveCount(0);
  await expect(output.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
});

test('hex-viewer: a picked file that is gone from disk gives the fixed sentence, never the browser error text', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await openHexViewer(page);

  // A real file on disk, picked by its path, so the page holds a reference to the file and not a copy of its bytes.
  const path = testInfo.outputPath('vanishing.bin');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from('Hello, this file will vanish'));
  await page.locator('#f-file').setInputFiles(path);
  const output = outputArea(page);
  await expect(output.locator('pre.output')).toContainText('00000000  48 65 6c 6c 6f', { timeout: 30_000 });

  // The file is deleted, then Export makes the page read it again: the read fails inside the browser.
  rmSync(path);
  await page.locator('#f-exportAs').selectOption('c');
  await expect(output.locator('.issue-list')).toContainText(
    'Could not read that file. If it changed or moved after you picked it, pick it again.',
    { timeout: 30_000 },
  );
  const shown = await output.innerText();
  for (const raw of [
    'DOMException',
    'NotFoundError',
    'NotReadableError',
    'could not be found',
    'can not be found',
    'was aborted',
  ]) {
    expect(shown, `the page must not show the browser text ${raw}`).not.toContain(raw);
  }
});

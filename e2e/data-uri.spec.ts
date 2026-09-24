import { test, expect } from '@playwright/test';

/**
 * Behavioural proof for the page's file-input half of the design contract
 * (02-UI-SPEC.md Section 1), per this plan's `<action>` instructions.
 *
 * This is the first page on the site with a file picker, so plan 02-02
 * (which built the shared selected-file summary line and the runner's
 * progress/cancel machinery) explicitly delegated its behavioural proof to
 * this plan. It cannot live in `tools/data-uri/test/` (the standalone gate
 * copies only the tool folder, which has no browser) nor in the root
 * Vitest config (which only globs `tools/*\/test/**`), so it lives here as
 * its own spec file -- `e2e/site.spec.ts` belongs to plan 02-02 and three
 * other tier-two plans in this phase each need their own page-level browser
 * checks, so one file per page keeps every plan's write set disjoint.
 */
const rel = (path: string) => path.replace(/^\//, '');

test('a selected file shows its name and size before Run, then encodes to a data URI with the expected media type', async ({
  page,
}) => {
  await page.goto(rel('/tools/data-uri'));

  // Direction defaults to Encode, so the file field is already visible.
  const fileInput = page.locator('#f-file');
  await fileInput.setInputFiles({
    name: 'note.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello from the data uri e2e spec', 'utf8'),
  });

  // The summary line appears BEFORE Run is pressed -- this is the actual
  // claim under test, not just that the file input accepts a file.
  const summary = page.locator('#f-file + p.field-help');
  await expect(summary).toContainText('note.txt');
  await expect(summary).toContainText('B'); // formatBytes renders a byte-size unit

  const runButton = page.getByRole('button', { name: 'Run', exact: true });
  await runButton.click();
  await expect(runButton).toHaveText('Run', { timeout: 30_000 });

  const output = page.locator('section[aria-label="Output"] pre.output').first();
  await expect(output).not.toHaveText('');
  const dataUri = (await output.textContent())!.trim();
  expect(dataUri.startsWith('data:')).toBe(true);
  // A plain-text file with no byte-pattern signature falls back to the
  // browser-reported type, which the synthetic upload above declared as
  // text/plain.
  expect(dataUri).toContain('data:text/plain');
});

test('a decoded data URI is offered back as a downloadable file carrying exactly the expected bytes', async ({
  page,
}) => {
  await page.goto(rel('/tools/data-uri'));

  await page.locator('input[name="direction"][value="decode"]').check();

  // A short, well-formed data URI with known bytes: "data:," followed by a
  // percent-encoded ASCII string decodes to exactly that string's bytes.
  const expectedText = 'byte-exact round trip';
  const encoded = encodeURIComponent(expectedText);
  await page.locator('#f-input').fill(`data:text/plain,${encoded}`);

  const runButton = page.getByRole('button', { name: 'Run', exact: true });
  await runButton.click();
  await expect(runButton).toHaveText('Run', { timeout: 30_000 });

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).first().click();
  const download = await downloadPromise;

  const path = await download.path();
  expect(path).not.toBeNull();
  const fs = await import('node:fs');
  const bytes = fs.readFileSync(path!);
  expect(bytes.toString('utf8')).toBe(expectedText);
});

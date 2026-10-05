import { test, expect, type Page } from '@playwright/test';

/**
 * HARD-07 (D-219): a key saved from the key converter page is offered under the name ssh expects, with no `.txt` added.
 *
 * Chromium and Windows WebKit add `.txt` to the saved name of a file with no extension when its Blob has a text type;
 * Firefox and Linux WebKit never do. So the suggested name is asserted on every project, and the Blob type is asserted
 * on every project too, with an init script that records the `type` of each Blob handed to `URL.createObjectURL`: that is
 * the check that can still fail on CI's Linux WebKit, where the name never changes.
 *
 * The real saved name on a desktop browser is not visible here (Playwright sees the suggested name, not the file the
 * operating system writes), so that stays an owner hands-on check.
 *
 * Runs on all four projects (chromium, firefox, webkit, mobile-chrome) against the production build.
 */

declare global {
  interface Window {
    __fodtBlobTypes?: string[];
  }
}

const rel = (path: string) => path.replace(/^\//, '');

function outputArea(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

/** The output block whose label contains `label`. */
function blockOf(page: Page, label: string) {
  return outputArea(page)
    .locator('.output-block')
    .filter({ has: page.locator('.output-label', { hasText: label }) });
}

/** Records the type of every Blob that is given to `URL.createObjectURL`, in order, on `window.__fodtBlobTypes`. */
async function recordBlobTypes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__fodtBlobTypes = [];
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (object: Blob | MediaSource): string => {
      if (object instanceof Blob) window.__fodtBlobTypes?.push(object.type);
      return original(object);
    };
  });
}

/** Opens the key converter, picks a key type, runs it and waits for the OpenSSH private key block. */
async function generate(page: Page, keyType: string): Promise<void> {
  await page.goto(rel('/tools/key-converter'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
  await page.locator('#f-keyType').selectOption(keyType);
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(blockOf(page, 'OpenSSH private key')).toBeVisible({ timeout: 60_000 });
}

test('key-download: an Ed25519 private key is offered as id_ed25519 with a binary Blob type', async ({ page }) => {
  await recordBlobTypes(page);
  await generate(page, 'ed25519');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    blockOf(page, 'OpenSSH private key').getByRole('button', { name: 'Download' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('id_ed25519');
  expect(await page.evaluate(() => window.__fodtBlobTypes)).toEqual(['application/octet-stream']);
});

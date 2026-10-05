import { test, expect, type Download, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * HARD-07 (D-219): a key saved from the key converter page is offered under the name ssh expects, with no `.txt` added,
 * and its file ends the way ssh expects.
 *
 * Chromium and Windows WebKit add `.txt` to the saved name of a file with no extension when its Blob has a text type;
 * Firefox and Linux WebKit never do. So the suggested name is asserted on every project, and the Blob type is asserted
 * on every project too, with an init script that records the `type` of each Blob handed to `URL.createObjectURL`: that is
 * the check that can still fail on CI's Linux WebKit, where the name never changes.
 *
 * The saved bytes are read from the downloaded file: a private key ends with its END line and one line feed, a public key
 * with one line feed, and neither holds a carriage return.
 *
 * The real saved name on a desktop browser is not visible here (Playwright sees the suggested name, not the file the
 * operating system writes), so that stays an owner hands-on check.
 *
 * Runs on all four projects (chromium, firefox, webkit, mobile-chrome) against the production build. The RSA key is made
 * by the page itself, so no private key is written in this file.
 */

declare global {
  interface Window {
    __fodtBlobTypes?: string[];
    __fodtBlobUrls?: string[];
    __fodtRevoked?: string[];
  }
}

const rel = (path: string) => path.replace(/^\//, '');

const BINARY = 'application/octet-stream';
const TEXT = 'text/plain;charset=utf-8';

function outputArea(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

/** The output block whose label contains `label`. */
function blockOf(page: Page, label: string) {
  return outputArea(page)
    .locator('.output-block')
    .filter({ has: page.locator('.output-label', { hasText: label }) });
}

const PRIVATE_LABEL = 'OpenSSH private key';
const PUBLIC_LABEL = 'OpenSSH public key';

/**
 * Records, on the window, the type of every Blob given to `URL.createObjectURL` (in order), the address it returned, and
 * every address later given to `URL.revokeObjectURL`.
 */
async function recordBlobs(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__fodtBlobTypes = [];
    window.__fodtBlobUrls = [];
    window.__fodtRevoked = [];
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object: Blob | MediaSource): string => {
      const url = create(object);
      if (object instanceof Blob) {
        window.__fodtBlobTypes?.push(object.type);
        window.__fodtBlobUrls?.push(url);
      }
      return url;
    };
    URL.revokeObjectURL = (url: string): void => {
      window.__fodtRevoked?.push(url);
      revoke(url);
    };
  });
}

async function openConverter(page: Page): Promise<void> {
  await page.goto(rel('/tools/key-converter'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
}

/** Opens the key converter, picks a key type, runs it and waits for the OpenSSH private key block. */
async function generate(page: Page, keyType: string): Promise<void> {
  await openConverter(page);
  await page.locator('#f-keyType').selectOption(keyType);
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(blockOf(page, PRIVATE_LABEL)).toBeVisible({ timeout: 60_000 });
  // Making an RSA key starts a background worker from a Blob of its own; only the Blobs of the downloads are of interest.
  await page.evaluate(() => {
    window.__fodtBlobTypes = [];
    window.__fodtBlobUrls = [];
  });
}

/** Clicks the Download button of a block and returns what the browser was asked to save. */
async function downloadFrom(page: Page, label: string): Promise<Download> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    blockOf(page, label).getByRole('button', { name: 'Download' }).click(),
  ]);
  return download;
}

/** The bytes the browser saved, as a Latin-1 string (every byte kept, none dropped or re-coded). */
async function savedText(download: Download): Promise<string> {
  const path = await download.path();
  return readFileSync(path).toString('latin1');
}

/** One key kind under test. */
interface KeyCase {
  name: string;
  keyType: string;
  privateName: string;
  publicName: string;
  publicPrefix: string;
}

const KEY_CASES: KeyCase[] = [
  {
    name: 'Ed25519',
    keyType: 'ed25519',
    privateName: 'id_ed25519',
    publicName: 'id_ed25519.pub',
    publicPrefix: 'ssh-ed25519 ',
  },
  {
    name: 'ECDSA P-256',
    keyType: 'ecdsa-p256',
    privateName: 'id_ecdsa',
    publicName: 'id_ecdsa.pub',
    publicPrefix: 'ecdsa-sha2-nistp256 ',
  },
  {
    name: 'RSA 2048',
    keyType: 'rsa-2048',
    privateName: 'id_rsa',
    publicName: 'id_rsa.pub',
    publicPrefix: 'ssh-rsa ',
  },
];

for (const c of KEY_CASES) {
  test(`key-download: a generated ${c.name} key is offered as ${c.privateName} and ${c.publicName} with the right types and bytes`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await recordBlobs(page);
    await generate(page, c.keyType);

    // The private file: no extension, so a binary Blob type and exactly the fixed name.
    const privateFile = await downloadFrom(page, PRIVATE_LABEL);
    expect(privateFile.suggestedFilename()).toBe(c.privateName);
    const privateBytes = await savedText(privateFile);
    expect(privateBytes.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----\n')).toBe(true);
    expect(privateBytes.endsWith('-----END OPENSSH PRIVATE KEY-----\n')).toBe(true);
    expect(privateBytes.endsWith('\n\n'), 'a second line feed ends the private file').toBe(false);
    expect(privateBytes.includes('\r'), 'a carriage return is in the private file').toBe(false);

    // The public file: the same name with .pub, and one line feed after the single line.
    const publicFile = await downloadFrom(page, PUBLIC_LABEL);
    expect(publicFile.suggestedFilename()).toBe(c.publicName);
    const publicBytes = await savedText(publicFile);
    expect(publicBytes.startsWith(c.publicPrefix)).toBe(true);
    expect(publicBytes.endsWith('\n'), 'the public file has no final line feed').toBe(true);
    expect(publicBytes.endsWith('\n\n'), 'a second line feed ends the public file').toBe(false);
    expect(publicBytes.slice(0, -1).includes('\n'), 'the public file holds more than one line').toBe(false);
    expect(publicBytes.includes('\r'), 'a carriage return is in the public file').toBe(false);

    // Two downloads make two separate Blobs with their own types, each address revoked after its click.
    const seen = await page.evaluate(() => ({
      types: window.__fodtBlobTypes,
      urls: window.__fodtBlobUrls,
    }));
    expect(seen.types).toEqual([BINARY, TEXT]);
    expect(new Set(seen.urls).size, 'the two downloads shared one object address').toBe(2);
    await expect
      .poll(async () => page.evaluate(() => window.__fodtRevoked))
      .toEqual(expect.arrayContaining(seen.urls ?? []));
  });
}

test('key-download: the chmod note directly follows the private key block and names its file', async ({ page }) => {
  await generate(page, 'ecdsa-p256');
  const next = blockOf(page, PRIVATE_LABEL).locator('xpath=following-sibling::*[1]');
  await expect(next.locator('.note.note-info')).toHaveText(
    'On macOS and Linux, run chmod 600 id_ecdsa before ssh will use this private key.',
  );
  await expect(outputArea(page).locator('.note', { hasText: 'chmod' })).toHaveCount(1);
});

test('key-download: a pasted private key gets the same note, name and ending, a pasted public key gets neither', async ({
  page,
}) => {
  // The keys are made by the page, copied from its own output and pasted back, so no key is written in this file.
  await generate(page, 'ed25519');
  const privateText = await blockOf(page, PRIVATE_LABEL).locator('pre.output').first().innerText();
  const publicText = await blockOf(page, PUBLIC_LABEL).locator('pre.output').first().innerText();
  expect(privateText).toContain('END OPENSSH PRIVATE KEY');

  await page.locator('input[name="mode"][value="convert"]').click();
  const input = page.locator('#f-input');
  await expect(async () => {
    await input.fill(privateText);
    await expect(input).toHaveValue(privateText, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(outputArea(page)).toContainText('Read as');
  const note = blockOf(page, PRIVATE_LABEL).locator('xpath=following-sibling::*[1]').locator('.note.note-info');
  await expect(note).toHaveText('On macOS and Linux, run chmod 600 id_ed25519 before ssh will use this private key.');

  // The converted private file is saved as id_ed25519 with exactly one final line feed, the way a generated one is.
  const converted = await downloadFrom(page, PRIVATE_LABEL);
  expect(converted.suggestedFilename()).toBe('id_ed25519');
  const convertedBytes = await savedText(converted);
  expect(convertedBytes.endsWith('-----END OPENSSH PRIVATE KEY-----\n')).toBe(true);
  expect(convertedBytes.endsWith('\n\n')).toBe(false);
  expect(convertedBytes.includes('\r')).toBe(false);

  // A public key line alone shows no private block and so no note.
  await expect(async () => {
    await input.fill(publicText.trim());
    await expect(input).toHaveValue(publicText.trim(), { timeout: 500 });
  }).toPass({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(outputArea(page)).toContainText('This is a public key; there is no private key to show.');
  await expect(blockOf(page, PRIVATE_LABEL)).toHaveCount(0);
  await expect(outputArea(page).locator('.note', { hasText: 'chmod' })).toHaveCount(0);
});

test('key-download: a name that already has an extension keeps the text type', async ({ page }) => {
  await recordBlobs(page);
  await generate(page, 'ed25519');
  const download = await downloadFrom(page, 'Private key, PKCS#8');
  expect(download.suggestedFilename()).toBe('private-key.pem');
  expect(await page.evaluate(() => window.__fodtBlobTypes)).toEqual([TEXT]);
});

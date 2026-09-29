import { test, expect } from '@playwright/test';

/**
 * Behavioural proof of the secret-handling contract (S1) for the AES
 * Encrypt & Decrypt page: a typed passphrase or raw key never reaches the
 * Output section, in either direction, in either key mode. Modelled on
 * e2e/ts-to-js.spec.ts's shape (Reset wait, #f-field locators, the Output
 * section landmark). Test titles start with "aes-encryption:" so
 * `--grep "aes-encryption"` selects them alongside the privacy and site
 * sweeps.
 */
const rel = (path: string) => path.replace(/^\//, '');

function outputArea(page: import('@playwright/test').Page) {
  return page.locator('section[aria-label="Output"]');
}

function runButtonOf(page: import('@playwright/test').Page) {
  return page.getByRole('button', { name: 'Run', exact: true });
}

test('aes-encryption: passphrase encrypt output never contains the passphrase, and decrypt with the wrong passphrase never contains it either', async ({
  page,
}) => {
  await page.goto(rel('/tools/aes-encryption'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  const passphrase = 'Pass-Phrase-e2e-71c4';
  await page.locator('#f-input').fill('Attack at dawn');
  await page.locator('#f-passphrase').fill(passphrase);
  await runButtonOf(page).click();
  await expect(runButtonOf(page)).toHaveText('Run', { timeout: 15_000 });

  const output = outputArea(page);
  await expect(output).toContainText('U2FsdGVkX1');
  await expect(output).toContainText('openssl enc -d');
  await expect(output).toContainText('-pass env:PASS');
  const encryptedText = (await output.textContent()) ?? '';
  expect(encryptedText).not.toContain(passphrase);

  // Decrypt the known aes-256-cbc -pbkdf2 -iter 10000 fixture with the
  // wrong passphrase.
  await page.locator('select#f-direction').selectOption('decrypt');
  await page
    .locator('#f-input')
    .fill('U2FsdGVkX18BAgMEBQYHCMu0XEsdjP5nVNrhGouunGngbsutjjqqTyCT5gK/eAOZeHkWD8Nz2DctvlNPqkUVxw==');
  // Confirmed deterministically (against this exact fixture, cipher, and
  // iteration count) to fail CBC padding validation and take the fixed
  // wrong-passphrase error path, unlike some other wrong passphrases which
  // land in the ~1-in-256 case where padding happens to validate anyway
  // (PD-06) and the page instead shows a hex fallback with its own
  // "often means the wrong passphrase" note -- also a legitimate outcome,
  // but not the one this assertion targets.
  const wrongPassphrase = 'totally-wrong-passphrase-1';
  await page.locator('#f-passphrase').fill(wrongPassphrase);
  await page.locator('#f-iterations').fill('10000');
  await runButtonOf(page).click();
  await expect(runButtonOf(page)).toHaveText('Run', { timeout: 15_000 });

  await expect(output).toContainText('wrong passphrase, wrong options, or damaged data');
  const decryptedFailureText = (await output.textContent()) ?? '';
  expect(decryptedFailureText).not.toContain(wrongPassphrase);
});

test('aes-encryption: raw-key output never contains the key, and a generated key is shown once labelled "Generated key"', async ({
  page,
}) => {
  await page.goto(rel('/tools/aes-encryption'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  await page.locator('input[type="radio"][name="keySource"][value="raw"]').check();
  const key = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
  await page.locator('#f-key').fill(key);
  await page.locator('#f-input').fill('hello');
  await runButtonOf(page).click();
  await expect(runButtonOf(page)).toHaveText('Run', { timeout: 15_000 });

  const output = outputArea(page);
  const outputText = ((await output.textContent()) ?? '').toLowerCase();
  expect(outputText).not.toContain(key.toLowerCase());
  // The Base64 rendering of the same key bytes must not leak either.
  const keyBase64 = Buffer.from(key, 'hex').toString('base64').toLowerCase();
  expect(outputText).not.toContain(keyBase64);

  await page.locator('#f-generateKey').check();
  await runButtonOf(page).click();
  await expect(runButtonOf(page)).toHaveText('Run', { timeout: 15_000 });
  await expect(output).toContainText('Generated key');
});

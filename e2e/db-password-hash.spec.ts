import { test, expect } from '@playwright/test';

/**
 * Behavioural proof of the secret-handling contract (S1) for the Database
 * Password Hash page: a typed password never reaches the Output section,
 * in either mode. Modelled on e2e/ts-to-js.spec.ts's shape. Test titles
 * start with "db-password-hash:" so `--grep "db-password-hash"` selects
 * them alongside the privacy and site sweeps.
 */
const rel = (path: string) => path.replace(/^\//, '');

function outputArea(page: import('@playwright/test').Page) {
  return page.locator('section[aria-label="Output"]');
}

function runButtonOf(page: import('@playwright/test').Page) {
  return page.getByRole('button', { name: 'Run', exact: true });
}

test('db-password-hash: generate produces a SCRAM stored hash and an ALTER ROLE statement, then a MySQL native hash, neither containing the password', async ({
  page,
}) => {
  await page.goto(rel('/tools/db-password-hash'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  const password = 'Pw-e2e-5d8b-unique';
  await page.locator('#f-password').fill(password);
  await page.locator('#f-role').fill('app_user');
  await runButtonOf(page).click();
  await expect(runButtonOf(page)).toHaveText('Run', { timeout: 15_000 });

  const output = outputArea(page);
  await expect(output).toContainText('SCRAM-SHA-256$4096:');
  await expect(output).toContainText('ALTER ROLE "app_user" PASSWORD');
  let text = (await output.textContent()) ?? '';
  expect(text).not.toContain(password);

  await page.locator('select#f-format').selectOption('mysql-native');
  await runButtonOf(page).click();
  await expect(runButtonOf(page)).toHaveText('Run', { timeout: 15_000 });

  await expect(output).toContainText("IDENTIFIED WITH mysql_native_password AS '*");
  await expect(output).toContainText("IDENTIFIED BY PASSWORD '*");
  text = (await output.textContent()) ?? '';
  expect(text).not.toContain(password);
});

test('db-password-hash: verify shows match for the correct password and no-match for a different one', async ({
  page,
}) => {
  await page.goto(rel('/tools/db-password-hash'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  await page.locator('input[type="radio"][name="mode"][value="verify"]').check();
  await page.locator('#f-password').fill('mypass');
  await page.locator('#f-stored').fill('*6C8989366EAF75BB670AD8EA7A7FC1176A95CEF4');
  await runButtonOf(page).click();
  await expect(runButtonOf(page)).toHaveText('Run', { timeout: 15_000 });

  const output = outputArea(page);
  await expect(output).toContainText('Match: this password produces the stored hash.');

  await page.locator('#f-password').fill('mypass2');
  await runButtonOf(page).click();
  await expect(runButtonOf(page)).toHaveText('Run', { timeout: 15_000 });
  await expect(output).toContainText('No match: this password does not produce the stored hash.');
});

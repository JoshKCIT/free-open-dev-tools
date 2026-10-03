import { test, expect, type Page } from '@playwright/test';

/**
 * Browser proof of the new modes the three upgraded tools gained in phase 14 (D-180): hash-text, luhn and
 * security-headers. Each upgraded tool keeps its live fixture and its existing tests, which prove
 * the old default still works; what a tool can newly do is proven here instead, one block of top-level tests per tool,
 * every title starting with `<id>: `. The live fixtures of these tools stay as they are.
 *
 * Every expected text is written by hand from the specification or the published value the page states, never copied from
 * a run of the tool. The helpers are this file's own: a shared test helper would make every spec that imports it run whole
 * for every tool (phase 13 research, Pitfall 5); their shape is copied from e2e/data-upgrades.spec.ts.
 */
const rel = (path: string) => path.replace(/^\//, '');

function outputArea(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

async function openTool(page: Page, id: string): Promise<void> {
  await page.goto(rel(`/tools/${id}`));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
}

/**
 * Sets the radio and select controls of a case before any text is filled, because choosing a mode can show or hide the
 * fields that follow. A radio is clicked by its field name and value; a select is chosen by its id.
 */
async function setControls(
  page: Page,
  controls: { radios?: Record<string, string>; selects?: Record<string, string> },
): Promise<void> {
  for (const [field, value] of Object.entries(controls.radios ?? {})) {
    await page.locator(`input[name="${field}"][value="${value}"]`).click();
  }
  for (const [field, value] of Object.entries(controls.selects ?? {})) {
    await page.locator(`#f-${field}`).selectOption(value);
  }
}

/**
 * Fills one text field and checks the value stayed. The pages are prerendered, so a field filled in the first moments after
 * load can be cleared again when the page finishes starting; the fill is repeated until it holds.
 */
async function fillAndHold(page: Page, name: string, value: string): Promise<void> {
  const field = page.locator(`#f-${name}`);
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

/** The table row of the output whose first cell is exactly this text. */
function rowNamed(page: Page, name: string) {
  return outputArea(page)
    .locator('table.output-table tbody tr')
    .filter({ has: page.getByRole('cell', { name, exact: true }) });
}

test('hash-text: the default family still shows the SHA-256 of abc', async ({ page }) => {
  await openTool(page, 'hash-text');
  await expect(page.locator('#f-family')).toHaveValue('digests');
  await fillAndHold(page, 'input', 'abc');
  // The SHA-256 of abc is the first sample of FIPS 180-4 (SHA-256 example, one block message).
  await expect(outputArea(page).locator('table.output-table')).toContainText(
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  await expect(outputArea(page).locator('table.output-table th').first()).toHaveText('Algorithm');
});

test('hash-text: Checksums show the catalogue check values CRC-32C e3069283 and CRC-16 ARC bb3d for 123456789', async ({
  page,
}) => {
  await openTool(page, 'hash-text');
  await setControls(page, { selects: { family: 'checksums' } });
  await fillAndHold(page, 'input', '123456789');
  // The CRC catalogue's check value is the CRC of the nine ASCII bytes 123456789.
  const castagnoli = rowNamed(page, 'CRC-32/ISCSI');
  await expect(castagnoli).toHaveCount(1);
  await expect(castagnoli).toContainText('e3069283');
  await expect(castagnoli).toContainText('CRC-32C');
  const arc = rowNamed(page, 'CRC-16/ARC');
  await expect(arc).toHaveCount(1);
  await expect(arc).toContainText('bb3d');
  // The catalogue's current name and the older name people search for are on the same row.
  await expect(rowNamed(page, 'CRC-16/IBM-3740')).toContainText('CRC-16/CCITT-FALSE');
  await expect(outputArea(page)).toContainText('Checksums detect accidental changes. They are not hashes');
  await expect(outputArea(page).locator('table.output-table tbody tr')).toHaveCount(44);
});

test('hash-text: Checksums also show Adler-32 after the catalogue rows', async ({ page }) => {
  await openTool(page, 'hash-text');
  await setControls(page, { selects: { family: 'checksums' } });
  await fillAndHold(page, 'input', 'Wikipedia');
  // RFC 1950 section 8.2 defines the value; zlib.adler32 of Wikipedia is 11e60398 (Python 3.14.3).
  const adler = rowNamed(page, 'Adler-32');
  await expect(adler).toHaveCount(1);
  await expect(adler).toContainText('11e60398');
  await expect(outputArea(page).locator('table.output-table tbody tr')).toHaveCount(44);
});

test('hash-text: SHAKE128 of abc at 32 bytes shows the FIPS 202 value', async ({ page }) => {
  await openTool(page, 'hash-text');
  await setControls(page, { selects: { family: 'shake' } });
  await expect(page.locator('#f-shakeBytes')).toHaveValue('32');
  await fillAndHold(page, 'input', 'abc');
  // createHash('shake128', { outputLength: 32 }).update('abc').digest('hex') on Node 22.14.0 (OpenSSL), recorded 2026-10-03.
  await expect(outputArea(page)).toContainText('SHAKE128 (32 bytes)');
  await expect(outputArea(page)).toContainText('5881092dd818bf5cf8a3ddb793fbcba74097d5c526a6d35f97b83351940f2cc8');
  await expect(outputArea(page)).toContainText('SHAKE256 (32 bytes)');
  // The FIPS 202 example for the empty message at 32 bytes (NIST SHAKE128_Msg0): 7F 9C 2B A4 ... EF 26.
  await fillAndHold(page, 'input', '');
  await expect(outputArea(page)).toContainText('7f9c2ba4e88f827d616045507605853ed73b8093f6efbc88eb1a6eacfa66ef26');
  // A longer output starts with the shorter one.
  await fillAndHold(page, 'shakeBytes', '64');
  await expect(outputArea(page)).toContainText('SHAKE128 (64 bytes)');
  await expect(outputArea(page)).toContainText(
    '7f9c2ba4e88f827d616045507605853ed73b8093f6efbc88eb1a6eacfa66ef263cb1eea988004b93103cfb0aeefd2a686e01fa4a58e8a3639ca8a1e3f9ae57e2',
  );
});

test('hash-text: a SHAKE length outside 1 to 4096 is refused and the two ends are accepted', async ({ page }) => {
  await openTool(page, 'hash-text');
  await setControls(page, { selects: { family: 'shake' } });
  await fillAndHold(page, 'input', 'abc');
  const sentence = 'SHAKE output length must be a whole number from 1 to 4096.';
  for (const wrong of ['0', '4097', '-9999999999']) {
    await fillAndHold(page, 'shakeBytes', wrong);
    await expect(outputArea(page)).toContainText(sentence);
  }
  await fillAndHold(page, 'shakeBytes', '4096');
  await expect(outputArea(page)).toContainText('SHAKE128 (4096 bytes)');
  await expect(outputArea(page)).not.toContainText(sentence);
  await fillAndHold(page, 'shakeBytes', '1');
  await expect(outputArea(page)).toContainText('SHAKE128 (1 byte)');
});

test('hash-text: MD4 and NTLM of password show the RFC 1320 and MS-NLMP values and hex input replaces NTLM with a note', async ({
  page,
}) => {
  await openTool(page, 'hash-text');
  await setControls(page, { selects: { family: 'legacy' } });
  // RFC 1320 appendix A.5: MD4 of abc.
  await fillAndHold(page, 'input', 'abc');
  await expect(rowNamed(page, 'MD4')).toContainText('a448017aaf21d8525fc10ae87aa6729d');
  // MS-NLMP section 4.2.2.1.2: the NT hash of Password, and passlib 1.7.4 nthash for password.
  await fillAndHold(page, 'input', 'Password');
  await expect(rowNamed(page, 'NTLM')).toContainText('a4f49c406510bdcab6824ee7c30fd852');
  await fillAndHold(page, 'input', 'password');
  await expect(rowNamed(page, 'NTLM')).toContainText('8846f7eaee8fb117ad06bdd830b7586c');
  await expect(outputArea(page)).toContainText('MD4 and NTLM are broken');
  // Read as hex, the bytes of abc have an MD4 but no NTLM, and a note says why.
  await setControls(page, { radios: { encoding: 'hex' } });
  await fillAndHold(page, 'input', '61 62 63');
  await expect(rowNamed(page, 'MD4')).toContainText('a448017aaf21d8525fc10ae87aa6729d');
  await expect(rowNamed(page, 'NTLM')).toHaveCount(0);
  await expect(outputArea(page)).toContainText(
    'NTLM applies to text, so it is not shown when the input is read as hex or Base64.',
  );
});

test('luhn: the default scheme still says Passes the Luhn check for 79927398713', async ({ page }) => {
  await openTool(page, 'luhn');
  await expect(page.locator('#f-scheme')).toHaveValue('luhn');
  await expect(page.locator('#f-input')).toHaveValue('79927398713');
  // The worked example of the Luhn algorithm: the doubled digits and the others add to 70, a multiple of ten.
  await expect(outputArea(page)).toContainText('Passes the Luhn check.');
  await expect(outputArea(page)).toContainText('Digit count');
});

test('luhn: ISBN-13 978-0-11-000222-4 is valid and its check digit computes to 4', async ({ page }) => {
  await openTool(page, 'luhn');
  await setControls(page, { selects: { scheme: 'isbn13' } });
  await fillAndHold(page, 'input', '978-0-11-000222-4');
  // The ISBN Users Manual (2012) Appendix 1 worked example: the weighted sum is 56, so the check digit is 4.
  await expect(outputArea(page)).toContainText('Valid ISBN-13.');
  await fillAndHold(page, 'input', '978-0-11-000222-5');
  await expect(outputArea(page)).toContainText('Not valid: the check digit should be 4, not 5.');
  await setControls(page, { radios: { mode: 'checkDigit' } });
  await fillAndHold(page, 'input', '978011000222');
  await expect(outputArea(page)).toContainText('9780110002224');
  await expect(outputArea(page)).not.toContainText('Not valid');
});

test('luhn: IBAN GB82 WEST 1234 5698 7654 32 is valid and GB with WEST12345698765432 computes check digits 82', async ({
  page,
}) => {
  await openTool(page, 'luhn');
  await setControls(page, { selects: { scheme: 'iban' } });
  await fillAndHold(page, 'input', 'GB82 WEST 1234 5698 7654 32');
  // The widely published UK example of ISO 13616; python-stdnum 2.2 reads it too. 22 characters is the registry length for GB.
  await expect(outputArea(page)).toContainText('Valid IBAN.');
  await expect(outputArea(page)).toContainText('GB82 WEST 1234 5698 7654 32');
  await expect(outputArea(page)).toContainText('it does not show that the account exists');
  // One character short is refused by length before the check digits are read, and the sentence names the registry length.
  await fillAndHold(page, 'input', 'GB82 WEST 1234 5698 7654 3');
  await expect(outputArea(page)).toContainText('An IBAN from this country has 22 characters. This has 21.');
  await setControls(page, { radios: { mode: 'checkDigit' } });
  await fillAndHold(page, 'input', 'GB WEST12345698765432');
  await expect(outputArea(page)).toContainText('GB82WEST12345698765432');
  await expect(outputArea(page).locator('pre, code').first()).toContainText('82');
});

test('luhn: VIN 1M8GDM9AXKP042788 is valid with check character X and the letter O is refused at its position', async ({
  page,
}) => {
  await openTool(page, 'luhn');
  await setControls(page, { selects: { scheme: 'vin' } });
  await fillAndHold(page, 'input', '1M8GDM9AXKP042788');
  // 49 CFR 565.15: the products add to 351, which leaves 10 modulo 11, written X.
  await expect(outputArea(page)).toContainText('Valid VIN.');
  await expect(outputArea(page)).toContainText('Check character (position 9)');
  await expect(outputArea(page)).toContainText('Position 9 is a check digit only for vehicles made for North America');
  await fillAndHold(page, 'input', '1M8GDM9AXKP04278O');
  // A VIN never uses I, O or Q: the 17th character is refused by its place, and the sentence does not repeat it.
  await expect(outputArea(page)).toContainText('Line 1, column 17');
  await expect(outputArea(page)).toContainText('Character 17 is one of the letters I, O and Q');
  await fillAndHold(page, 'input', '1M8GDM9A1KP042788');
  await expect(outputArea(page)).toContainText('Not valid: the check character should be X, not 1.');
});

test('luhn: ISIN US0378331005, EAN-8 73513537 and UPC-A 036000291452 are valid', async ({ page }) => {
  await openTool(page, 'luhn');
  await setControls(page, { selects: { scheme: 'isin' } });
  await fillAndHold(page, 'input', 'US0378331005');
  await expect(outputArea(page)).toContainText('Valid ISIN.');
  await setControls(page, { selects: { scheme: 'ean8' } });
  await fillAndHold(page, 'input', '73513537');
  await expect(outputArea(page)).toContainText('Valid EAN-8.');
  await setControls(page, { selects: { scheme: 'upca' } });
  await fillAndHold(page, 'input', '036000291452');
  await expect(outputArea(page)).toContainText('Valid UPC-A.');
  // A UPC-A is an EAN-13 with a leading zero.
  await expect(outputArea(page)).toContainText('0036000291452');
  await setControls(page, { selects: { scheme: 'isbn10' } });
  await fillAndHold(page, 'input', '0-306-40615-2');
  await expect(outputArea(page)).toContainText('Valid ISBN-10.');
  await expect(outputArea(page)).toContainText('9780306406157');
});

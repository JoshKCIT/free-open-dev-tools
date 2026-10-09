import { test, expect, type Page } from '@playwright/test';

/**
 * The IDN & Punycode Converter shows U+2800 BRAILLE PATTERN BLANK, a character that draws as an empty cell, as an escape
 * (plan 21-03). A visitor pastes a name made of `a`, the Braille blank and `b` before `.com`; the table must show the
 * escape in the "Name as pasted" and "Unicode form" columns and the real converted name, `xn--ab-10y.com`, in the "ASCII
 * form" column. The expected strings come from tools/idn-converter/test/braille-blank.test.ts, where the ASCII form is
 * checked against tr46. The name is built from code points at run time, so no invisible character sits in this file.
 *
 * A spec of its own so the earlier converter specs stay byte for byte as they were. Read in four browser projects:
 * chromium, firefox, webkit and mobile-chrome.
 */
const rel = (path: string) => path.replace(/^\//, '');

function outputArea(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

async function fillAndHold(page: Page, name: string, value: string): Promise<void> {
  const field = page.locator(`#f-${name}`);
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

test('idn-converter: a domain name holding the Braille blank shows it as an escape', async ({ page }) => {
  test.setTimeout(90_000);
  const blank = String.fromCodePoint(0x2800);
  const name = 'a' + blank + 'b.com';
  const shownName = 'a' + String.fromCharCode(92) + 'u{2800}b.com';

  await page.goto(rel('/tools/idn-converter'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
  await fillAndHold(page, 'names', name);

  // The page answers a moment after the last change, so the row is read again until it is the expected one.
  await expect(async () => {
    const rows = await outputArea(page)
      .locator('table tbody tr')
      .evaluateAll((trs) => trs.map((tr) => Array.from(tr.children).map((cell) => cell.textContent ?? '')));
    expect(rows).toHaveLength(1);
    const cells = rows[0] ?? [];
    expect(cells[0]).toBe('1');
    expect(cells[1]).toBe(shownName);
    expect(cells[2]).toBe('xn--ab-10y.com');
    expect(cells[3]).toBe(shownName);
    expect(cells[4]).toBe('valid');
  }).toPass({ timeout: 15_000 });

  // The list of converted names is for copying and holds the real converted name.
  const list = outputArea(page).locator('.output-block', {
    has: page.locator('.output-label', { hasText: 'Converted names, one per line' }),
  });
  await expect(list.locator('pre')).toHaveText('xn--ab-10y.com');
});

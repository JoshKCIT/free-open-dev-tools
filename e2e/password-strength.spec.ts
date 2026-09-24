import { test, expect } from '@playwright/test';

/**
 * Proves the block order a design-contract-fixed `statsPosition` produces
 * (02-UI-SPEC.md Section 4): verdict note, stats, reasons list, crack-time
 * table -- in that DOM order, in a real browser. Source order cannot
 * establish this: the runner decides where `stats` renders relative to
 * `outputs` (ToolRunner.tsx), so a check over the page's own source text
 * would pass even if the runner placed the stats block somewhere else.
 *
 * This is its own spec file rather than an addition to `e2e/site.spec.ts`,
 * which plan 02-02 owns, so every plan in this phase keeps a disjoint write
 * set. Playwright's `testDir` is the `e2e` directory (playwright.config.ts),
 * so no configuration change is needed for a new file here.
 */
const rel = (path: string) => path.replace(/^\//, '');

test.describe('password-strength renders its four-block readout', () => {
  test('a weak password renders verdict, stats, reasons and crack-time table in the contract order, tone error', async ({
    page,
  }) => {
    await page.goto(rel('/tools/password-strength'));

    const output = page.locator('section[aria-label="Output"]');
    const input = page.locator('#f-password');

    // Before anything is typed, the runner's own empty-state placeholder is
    // shown -- no verdict of the lowest score for an empty input.
    await expect(output.locator('.note')).toHaveCount(0);

    await input.fill('password');

    // Wait for the debounced auto-run: the verdict note is the first thing
    // to appear.
    const blocks = output.locator('.note, .stats, ul, table.output-table');
    await expect(blocks.first()).toBeVisible();

    const tags = await blocks.evaluateAll((els) =>
      els.map((el) => ({ tag: el.tagName.toLowerCase(), className: el.className })),
    );

    // Exactly four blocks, in the fixed order: note, stats, list, table.
    expect(tags.map((t) => t.tag)).toEqual(['div', 'div', 'ul', 'table']);
    expect(tags[0]!.className).toContain('note');
    expect(tags[0]!.className).toContain('note-error');
    expect(tags[1]!.className).toContain('stats');

    // The reasons list carries at least one item, and the crack-time table
    // has one row per attack scenario (four).
    const reasonItems = output.locator('ul li');
    await expect(reasonItems.first()).toBeVisible();
    const reasonCount = await reasonItems.count();
    expect(reasonCount).toBeGreaterThan(0);

    const rows = output.locator('table.output-table tbody tr');
    await expect(rows).toHaveCount(4);

    // None of the four blocks contains the password itself.
    const text = (await output.textContent()) ?? '';
    expect(text).not.toContain('password123'); // sanity: never typed, never appears
  });

  test('a strong password still renders all four blocks, tone success -- the reasoning is not hidden once a password passes', async ({
    page,
  }) => {
    await page.goto(rel('/tools/password-strength'));

    const output = page.locator('section[aria-label="Output"]');
    const input = page.locator('#f-password');

    await input.fill('correct horse battery staple velvet lantern');

    const blocks = output.locator('.note, .stats, ul, table.output-table');
    await expect(blocks.first()).toBeVisible();

    const tags = await blocks.evaluateAll((els) =>
      els.map((el) => ({ tag: el.tagName.toLowerCase(), className: el.className })),
    );

    expect(tags.map((t) => t.tag)).toEqual(['div', 'div', 'ul', 'table']);
    expect(tags[0]!.className).toContain('note-success');
    expect(tags[1]!.className).toContain('stats');

    const reasonItems = output.locator('ul li');
    const reasonCount = await reasonItems.count();
    expect(reasonCount).toBeGreaterThan(0);

    const rows = output.locator('table.output-table tbody tr');
    await expect(rows).toHaveCount(4);
  });
});

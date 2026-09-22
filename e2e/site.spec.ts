import { test, expect } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Paths below are written with a leading slash because it reads better.
 *
 * A leading slash resolves against the origin, which is wrong when the site
 * is served from a subdirectory, as it is on GitHub Pages. Stripping it makes
 * the path resolve against baseURL instead, so the same suite works against a
 * local preview at the root and against a deployment under a prefix.
 */
const rel = (path: string) => path.replace(/^\//, '');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const toolIds = readdirSync(join(root, 'apps', 'web', 'src', 'tools'))
  .filter((f) => f.endsWith('.ts'))
  .map((f) => f.replace(/\.ts$/, ''))
  .sort();

test.describe('routes', () => {
  for (const path of ['/', '/tools', '/catalog', '/privacy', '/about']) {
    test(`${path} loads as its own document with its own title`, async ({ page }) => {
      const response = await page.goto(rel(path));
      expect(response?.status(), `${path} should be served directly, not via a redirect or a 404 fallback`).toBe(200);
      await expect(page.locator('h1')).toBeVisible();
      expect(await page.title()).toMatch(/Free & Open Dev Tools/);
    });
  }

  test('a direct hit on a deep tool URL works without a redirect', async ({ page }) => {
    const response = await page.goto(rel('/tools/json-formatter'));
    expect(response?.status()).toBe(200);
    expect(await page.title()).toContain('JSON Formatter');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('JSON Formatter');
  });

  test('an unknown path shows the not-found page rather than a blank screen', async ({ page }) => {
    await page.goto(rel('/tools/this-does-not-exist'));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/not found|Page not found/i);
  });

  test('every tool page has a unique meta description', async ({ page }) => {
    const seen = new Set<string>();
    for (const id of toolIds) {
      await page.goto(rel(`/tools/${id}`));
      const description = await page.locator('meta[name="description"]').getAttribute('content');
      expect(description, `${id} has no meta description`).toBeTruthy();
      expect(seen.has(description!), `${id} reuses another page's description`).toBe(false);
      seen.add(description!);
    }
  });
});

test.describe('tool pages', () => {
  for (const id of toolIds) {
    test(`${id} renders a working tool, not a placeholder`, async ({ page }) => {
      await page.goto(rel(`/tools/${id}`));

      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByText('Processed locally in your browser').first()).toBeVisible();

      // Every tool links to its own folder and to the issue tracker.
      const source = page.getByRole('link', { name: /source and tests/i });
      await expect(source).toHaveAttribute('href', new RegExp(`/tools/${id}$`));

      // The documentation panels are required and must not be empty.
      await expect(page.getByRole('heading', { name: 'What this does' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Supported' })).toBeVisible();
      const limits = page.getByRole('heading', { name: 'Limits' });
      await expect(limits).toBeVisible();
      const limitItems = page.locator('.docs-card', { has: limits }).locator('li');
      expect(await limitItems.count(), `${id} must document at least one limit`).toBeGreaterThan(0);

      // An example button should produce real output.
      const example = page.locator('.panel-head .button').first();
      if (await example.isVisible()) {
        await example.click();
        await page.waitForTimeout(800);
        const output = page.locator('section[aria-label="Output"]');
        const text = await output.innerText();
        expect(text.length, `${id} produced no output from its own example`).toBeGreaterThan(40);
        expect(text, `${id} shows a placeholder instead of a result`).not.toMatch(
          /not implemented|TODO|coming soon|lorem ipsum placeholder/i,
        );
      }
    });
  }
});

test.describe('representative workflows', () => {
  test('Base64: encode, then decode back', async ({ page }) => {
    await page.goto(rel('/tools/base64'));
    await page.locator('#f-input').fill('foobar');
    await expect(page.locator('pre.output').first()).toContainText('Zm9vYmFy');

    await page.getByRole('radio', { name: 'Decode' }).check();
    await page.locator('#f-input').fill('Zm9vYmFy');
    await expect(page.locator('pre.output').first()).toContainText('foobar');
  });

  test('JSON formatter: reports a duplicate key', async ({ page }) => {
    await page.goto(rel('/tools/json-formatter'));
    await page.locator('#f-input').fill('{"a": 1, "b": 2, "a": 3}');
    await expect(page.getByText(/duplicate key/i).first()).toBeVisible();
  });

  test('JSON formatter: shows the line and column of a syntax error', async ({ page }) => {
    await page.goto(rel('/tools/json-formatter'));
    await page.locator('#f-input').fill('{\n  "a": 1,\n  "b": oops\n}');
    await expect(page.locator('.issue').first()).toContainText('Line 3');
  });

  test('JWT decoder: warns loudly about an unsigned token', async ({ page }) => {
    await page.goto(rel('/tools/jwt-decoder'));
    await page.getByRole('button', { name: 'Unsigned token' }).click();
    await expect(page.getByText(/anyone can forge/i)).toBeVisible();
    await expect(page.getByText(/not verification/i).first()).toBeVisible();
  });

  test('Subnet calculator: computes a /26', async ({ page }) => {
    await page.goto(rel('/tools/ip-subnet'));
    await page.locator('#f-cidr').fill('192.168.1.130/26');
    await expect(page.locator('dl.kv').first()).toContainText('192.168.1.191');
  });

  test('Hash generator: matches the published SHA-256 vector', async ({ page }) => {
    await page.goto(rel('/tools/hash-text'));
    await page.locator('#f-input').fill('abc');
    await expect(page.locator('table.output-table')).toContainText(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  test('Reset returns the page to its starting state', async ({ page }) => {
    await page.goto(rel('/tools/base64'));
    await page.locator('#f-input').fill('something');
    await expect(page.locator('pre.output').first()).toBeVisible();
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(page.locator('#f-input')).toHaveValue('');
  });
});

test.describe('search and navigation', () => {
  test('search finds a tool by purpose, not just by name', async ({ page }) => {
    await page.goto(rel('/tools'));
    await page.locator('#tool-search').fill('cidr');
    await expect(page.locator('.tool-card').first()).toContainText(/Subnet/i);
  });

  test('search that matches nothing explains where to look next', async ({ page }) => {
    await page.goto(rel('/tools'));
    await page.locator('#tool-search').fill('zzzzzznotarealthing');
    await expect(page.locator('.empty-state')).toContainText(/catalog/i);
  });

  test('category filter narrows the list', async ({ page }) => {
    await page.goto(rel('/tools'));
    const all = await page.locator('.tool-card').count();
    expect(all).toBeGreaterThan(1);

    const chip = page.getByRole('button', { name: /^Hashing/ });
    await chip.click();
    // The chip records the selection, and the list re-renders after it.
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.locator('.tool-card').count()).toBeLessThan(all);
    expect(await page.locator('.tool-card').count()).toBeGreaterThan(0);

    // Clearing it brings everything back.
    await page.getByRole('button', { name: /^All / }).click();
    await expect.poll(() => page.locator('.tool-card').count()).toBe(all);
  });

  test('the catalog marks unbuilt tools as planned rather than linking to nothing', async ({ page }) => {
    await page.goto(rel('/catalog'));
    await expect(page.getByText('Planned', { exact: true }).first()).toBeVisible();
    const plannedCard = page.locator('.tool-card', { hasText: 'Planned' }).first();
    expect(await plannedCard.evaluate((el) => el.tagName.toLowerCase())).not.toBe('a');
  });
});

test.describe('clipboard and downloads', () => {
  test('copy puts the output on the clipboard', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'Clipboard permissions are only grantable in Chromium');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(rel('/tools/base64'));
    await page.locator('#f-input').fill('foobar');
    await page.getByRole('button', { name: 'Copy', exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Copied' }).first()).toBeVisible();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe('Zm9vYmFy');
  });

  test('download produces a file built in the browser', async ({ page }) => {
    await page.goto(rel('/tools/base64'));
    await page.locator('#f-input').fill('foobar');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).first().click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('encoded.txt');
    // A blob URL proves the file was assembled locally rather than fetched.
    expect(download.url().startsWith('blob:')).toBe(true);
  });
});

test.describe('accessibility', () => {
  test('the skip link is present, first in the document, and moves focus to the content', async ({ page }) => {
    await page.goto(rel('/'));
    const skip = page.getByRole('link', { name: 'Skip to content' });

    // It must be the first focusable thing in the document order, which is what
    // makes it useful whatever the browser's tab settings are.
    const isFirst = await page.evaluate(() => {
      const focusable = document.querySelectorAll(
        'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      return focusable[0]?.textContent?.trim() === 'Skip to content';
    });
    expect(isFirst).toBe(true);

    // Focusing it must reveal it: it is positioned off screen until then.
    await skip.focus();
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();

    await skip.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });

  test('a single Tab press reaches the skip link', async ({ page, browserName }) => {
    // Safari excludes links from the tab sequence unless the user turns on Full
    // Keyboard Access, so this is a platform setting rather than a site defect.
    test.skip(browserName === 'webkit', 'WebKit omits links from tab order by default');
    await page.goto(rel('/'));
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  });

  test('a tool page is operable by keyboard alone', async ({ page }) => {
    await page.goto(rel('/tools/base64'));
    await page.locator('#f-input').focus();
    await page.keyboard.type('foobar');
    await expect(page.locator('pre.output').first()).toContainText('Zm9vYmFy');
  });

  test('every form control has an accessible name', async ({ page }) => {
    for (const id of toolIds) {
      await page.goto(rel(`/tools/${id}`));
      const unnamed = await page.evaluate(() => {
        const problems: string[] = [];
        const controls = document.querySelectorAll('main input, main select, main textarea');
        for (const el of Array.from(controls)) {
          const control = el as HTMLElement;
          const id = control.getAttribute('id');
          const hasLabel = id ? !!document.querySelector(`label[for="${CSS.escape(id)}"]`) : false;
          const hasAria = control.hasAttribute('aria-label') || control.hasAttribute('aria-labelledby');
          const wrapped = !!control.closest('label');
          if (!hasLabel && !hasAria && !wrapped) problems.push(control.outerHTML.slice(0, 120));
        }
        return problems;
      });
      expect(unnamed, `Unlabelled control on /tools/${id}`).toEqual([]);
    }
  });

  test('every page has exactly one level one heading', async ({ page }) => {
    for (const path of ['/', '/tools', '/catalog', '/privacy', '/about', '/tools/base64']) {
      await page.goto(rel(path));
      expect(await page.locator('h1').count(), `${path} should have exactly one h1`).toBe(1);
    }
  });

  test('images and icons that convey nothing are hidden from assistive technology', async ({ page }) => {
    await page.goto(rel('/'));
    const decorative = await page.locator('svg:not([aria-hidden="true"]):not([role="img"])').count();
    expect(decorative).toBe(0);
  });

  test('the theme toggle works and is announced', async ({ page }) => {
    await page.goto(rel('/'));
    const toggle = page.getByRole('button', { name: /switch to .* theme/i });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', /light|dark/);
  });

  test('the page is readable at a narrow viewport without horizontal scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    for (const path of ['/', '/tools', '/tools/ip-subnet']) {
      await page.goto(rel(path));
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(overflow, `${path} scrolls horizontally at 360px wide`).toBe(false);
    }
  });
});

test.describe('public copy carries no derivation story', () => {
  test('the catalog page has no outcomes table and exactly one outbound link', async ({ page }) => {
    await page.goto(rel('/catalog'));
    expect(await page.locator('main table').count()).toBe(0);
    expect(await page.locator('main a[href^="http"]').count()).toBe(1);
  });

  test('the catalog page renders all 144 catalog entries', async ({ page }) => {
    await page.goto(rel('/catalog'));
    expect(await page.locator('.tool-card').count()).toBe(144);
  });

  test('every unbuilt card reads just "Planned", with no build-tier number', async ({ page }) => {
    await page.goto(rel('/catalog'));
    const pills = page.locator('.tool-card .pill-neutral');
    const count = await pills.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(pills.nth(i)).toHaveText('Planned');
    }
  });

  test('the home page statistics row holds exactly three items', async ({ page }) => {
    await page.goto(rel('/'));
    expect(await page.locator('.stat-row > div').count()).toBe(3);
  });

  test('the privacy page has no link into the catalog', async ({ page }) => {
    await page.goto(rel('/privacy'));
    expect(await page.locator('main a[href*="/catalog"]').count()).toBe(0);
  });

  /**
   * The phrase list comes from the same out-of-band denylist the release gate
   * (scripts/check-provenance.mjs) reads, split the same way it splits it. This
   * file must never carry a phrase literal of its own — that would make it the
   * one file naming the thing the gate exists to keep out.
   */
  const rawDenylist = process.env.PROVENANCE_DENYLIST ?? '';
  const denylistTerms = rawDenylist
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !t.startsWith('#'))
    .map((t) => t.toLowerCase());

  for (const path of ['/', '/catalog', '/about', '/privacy']) {
    test(`${path} carries none of the denylisted terms in its visible text`, async ({ page }) => {
      test.skip(denylistTerms.length === 0, 'PROVENANCE_DENYLIST is not set, skipping phrase assertions');
      await page.goto(rel(path));
      const bodyText = (await page.locator('body').innerText()).toLowerCase();
      for (const term of denylistTerms) {
        expect(bodyText.includes(term), `${path} contains a denylisted term`).toBe(false);
      }
    });
  }
});

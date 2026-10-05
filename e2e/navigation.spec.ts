import { test, expect, type Page } from '@playwright/test';

/**
 * HARD-04 (D-216): every link inside the site loads the next page as a fresh
 * document, so the content security policy written in the page the visitor is
 * on is the one in force. A policy in markup belongs to one document;
 * client-side routing would carry the first page's policy to every page after
 * it.
 *
 * The proof is a marker set on the window before each click. A client-side
 * navigation keeps the window and so keeps the marker; a new document does not.
 * After each click the marker must be gone and the address must be the target.
 *
 * Runs on all four projects (chromium, firefox, webkit, mobile-chrome) against
 * the production build. Set E2E_BASE_URL to run the same file against a build
 * served under another base path or against the deployed site.
 */

declare global {
  interface Window {
    __fodtDocMarker?: number;
  }
}

/** A path relative to the base URL, so the same address works at `/` and at `/free-open-dev-tools/`. */
const rel = (path: string) => path.replace(/^\//, '');

/** The address a path has on the site under test, as a full URL string. */
function addressOf(path: string, baseURL: string | undefined): string {
  return new URL(rel(path), baseURL).toString();
}

async function setMarker(page: Page) {
  await page.evaluate(() => {
    window.__fodtDocMarker = 1;
  });
}

async function markerOf(page: Page) {
  return page.evaluate(() => window.__fodtDocMarker);
}

/** Click a link and wait for the address, with the marker proving a new document. */
async function followAndExpectFreshDocument(
  page: Page,
  baseURL: string | undefined,
  link: ReturnType<Page['locator']>,
  target: string,
) {
  await setMarker(page);
  expect(await markerOf(page)).toBe(1);
  const want = addressOf(target, baseURL);
  await Promise.all([page.waitForURL(want), link.click()]);
  await page.waitForLoadState('load');
  expect(await markerOf(page)).toBeUndefined();
  expect(page.url()).toBe(want);
}

test.describe('every in-site link loads a fresh document', () => {
  test('the brand link from a tool page loads the home page as a new document', async ({ page, baseURL }) => {
    await page.goto(rel('/tools/base64'));
    await followAndExpectFreshDocument(page, baseURL, page.locator('a.brand'), '/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  for (const [name, path] of [
    ['Tools', '/tools'],
    ['Catalog', '/catalog'],
    ['Privacy', '/privacy'],
    ['About', '/about'],
  ] as const) {
    test(`the main navigation link ${name} loads ${path} as a new document`, async ({ page, baseURL }) => {
      await page.goto(rel('/tools/base64'));
      const link = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true });
      await followAndExpectFreshDocument(page, baseURL, link, path);
    });
  }

  test('after scrolling down and following a footer link the new page is at the top with focus at the body', async ({
    page,
    baseURL,
  }) => {
    // The catalog is the longest page, so there is always something to scroll past.
    await page.goto(rel('/catalog'));
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);

    const link = page.getByRole('navigation', { name: 'Footer' }).getByRole('link', { name: 'Privacy', exact: true });
    await followAndExpectFreshDocument(page, baseURL, link, '/privacy');

    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    // Focus starts at the body, so the first Tab press reaches the skip link.
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  });
});

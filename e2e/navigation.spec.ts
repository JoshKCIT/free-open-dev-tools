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

/**
 * Two addresses that differ only by a trailing slash are the same place: a host may answer a page address with a
 * redirect to its slash form. The home link is held to its exact address in its own test.
 */
const sameAddress = (a: string, b: string) => a.replace(/\/$/, '') === b.replace(/\/$/, '');

/** The path a link points to, below the base path (so it can be passed back to `addressOf`). */
async function pathBelowBase(link: ReturnType<Page['locator']>, page: Page, baseURL: string | undefined) {
  const href = new URL((await link.getAttribute('href')) ?? '', page.url());
  const base = new URL(baseURL ?? '').pathname;
  expect(href.pathname.startsWith(base), `${href.pathname} starts with ${base}`).toBe(true);
  return `/${href.pathname.slice(base.length)}${href.search}`;
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
  await Promise.all([page.waitForURL((url) => sameAddress(url.toString(), want)), link.click()]);
  await page.waitForLoadState('load');
  expect(await markerOf(page)).toBeUndefined();
  expect(sameAddress(page.url(), want), `${page.url()} is ${want}`).toBe(true);
}

test.describe('every in-site link loads a fresh document', () => {
  test('the brand link from a tool page loads the home page as a new document', async ({ page, baseURL }) => {
    await page.goto(rel('/tools/base64'));
    // The link is the base path with its closing slash, so the home page loads with no redirect, on the host and on a
    // static server that has none.
    const brand = page.locator('a.brand');
    const home = addressOf('/', baseURL);
    expect(new URL((await brand.getAttribute('href')) ?? '', page.url()).toString()).toBe(home);
    await followAndExpectFreshDocument(page, baseURL, brand, '/');
    expect(page.url()).toBe(home);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Free developer tools/);
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
    // Wait for the page to be drawn, or the scroll below lands on a short page and goes nowhere.
    await expect(page.locator('a.tool-card').first()).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);

    const link = page.getByRole('navigation', { name: 'Footer' }).getByRole('link', { name: 'Privacy', exact: true });
    await followAndExpectFreshDocument(page, baseURL, link, '/privacy');

    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    // Focus starts at the body, so the first Tab press reaches the skip link.
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  });
});

test.describe('every other kind of in-site link loads a fresh document too', () => {
  test('both footer links load a new document', async ({ page, baseURL }) => {
    for (const [name, path] of [
      ['Privacy', '/privacy'],
      ['About', '/about'],
    ] as const) {
      await page.goto(rel('/tools/base64'));
      const link = page.getByRole('navigation', { name: 'Footer' }).getByRole('link', { name, exact: true });
      await followAndExpectFreshDocument(page, baseURL, link, path);
    }
  });

  test('a card on the catalog page loads its tool page as a new document', async ({ page, baseURL }) => {
    await page.goto(rel('/catalog'));
    const card = page.locator('a.tool-card').first();
    const target = await pathBelowBase(card, page, baseURL);
    expect(target).toMatch(/^\/tools\/[a-z0-9-]+$/);
    await followAndExpectFreshDocument(page, baseURL, card, target);
  });

  test('a card on the tools index loads its tool page as a new document', async ({ page, baseURL }) => {
    await page.goto(rel('/tools'));
    const card = page.locator('a.tool-card').first();
    const target = await pathBelowBase(card, page, baseURL);
    expect(target).toMatch(/^\/tools\/[a-z0-9-]+$/);
    await followAndExpectFreshDocument(page, baseURL, card, target);
  });

  test('a category card on the home page keeps its query and loads a new document', async ({ page, baseURL }) => {
    await page.goto(rel('/'));
    const card = page.locator('a.tool-card[href*="/tools?category="]').first();
    const target = await pathBelowBase(card, page, baseURL);
    const category = new URL(target, 'http://site.invalid').searchParams.get('category');
    expect(category).toBeTruthy();
    await followAndExpectFreshDocument(page, baseURL, card, `/tools?category=${category}`);
    expect(new URL(page.url()).searchParams.get('category')).toBe(category);
    // The chip for that category is the pressed one on the new document.
    await expect(page.getByRole('group', { name: 'Filter by category' }).locator('[aria-pressed="true"]')).toHaveCount(
      1,
    );
  });

  test('the breadcrumb links on a tool page load new documents and the category one keeps its query', async ({
    page,
    baseURL,
  }) => {
    await page.goto(rel('/tools/base64'));
    const crumbs = page.locator('.breadcrumbs');
    await followAndExpectFreshDocument(
      page,
      baseURL,
      crumbs.getByRole('link', { name: 'Tools', exact: true }),
      '/tools',
    );

    await page.goto(rel('/tools/base64'));
    const category = crumbs.locator('a').nth(1);
    const target = await pathBelowBase(category, page, baseURL);
    const id = new URL(target, 'http://site.invalid').searchParams.get('category');
    expect(id).toBeTruthy();
    await followAndExpectFreshDocument(page, baseURL, category, `/tools?category=${id}`);
    expect(new URL(page.url()).searchParams.get('category')).toBe(id);
  });

  test('both links on the not-found page load new documents', async ({ page, baseURL }) => {
    await page.goto(rel('/404.html'));
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await followAndExpectFreshDocument(page, baseURL, page.getByRole('link', { name: 'Browse all tools' }), '/tools');

    await page.goto(rel('/404.html'));
    await followAndExpectFreshDocument(
      page,
      baseURL,
      page.getByRole('link', { name: 'see the full catalog' }),
      '/catalog',
    );
  });

  test('a link to the page already shown still loads a fresh document', async ({ page }) => {
    await page.goto(rel('/privacy'));
    await setMarker(page);
    const link = page.getByRole('navigation', { name: 'Footer' }).getByRole('link', { name: 'Privacy', exact: true });
    // The address does not change, so the load event is what shows a new document.
    await Promise.all([page.waitForEvent('load'), link.click()]);
    expect(await markerOf(page)).toBeUndefined();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('the tools index category chips change the query inside one document and are not links', async ({ page }) => {
    await page.goto(rel('/tools'));
    const chips = page.getByRole('group', { name: 'Filter by category' });
    expect(await chips.locator('a').count()).toBe(0);
    await setMarker(page);
    await chips.getByRole('button').nth(1).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('category')).toBeTruthy();
    expect(await markerOf(page)).toBe(1);

    await chips.getByRole('button').first().click();
    await expect.poll(() => new URL(page.url()).searchParams.get('category')).toBeNull();
    expect(await markerOf(page)).toBe(1);
  });
});

test.describe('in-site addresses keep the base path', () => {
  const SITE_PAGES = ['/', '/tools', '/catalog', '/privacy', '/about', '/404.html'];
  const TOOL_PAGES = [
    '/tools/base64',
    '/tools/regex-tester',
    '/tools/mermaid-renderer',
    '/tools/totp-generator',
    '/tools/key-converter',
  ];

  test('every in-site link on the site pages, the 404 shell and five tool pages starts with the base path and answers 200', async ({
    page,
    request,
    baseURL,
  }) => {
    const base = new URL(baseURL ?? '');
    const seen = new Set<string>();
    for (const path of [...SITE_PAGES, ...TOOL_PAGES]) {
      await page.goto(rel(path));
      await expect(page.locator('main')).toBeVisible();
      const hrefs = await page
        .locator('a[href]')
        .evaluateAll((anchors) => anchors.map((a) => (a as HTMLAnchorElement).href));
      expect(hrefs.length, `${path} has links`).toBeGreaterThan(0);
      for (const href of hrefs) {
        const url = new URL(href);
        // Links that leave the site are not in scope.
        if (url.origin !== base.origin) continue;
        expect(url.pathname.startsWith(base.pathname), `${href} on ${path} starts with ${base.pathname}`).toBe(true);
        url.hash = '';
        url.search = '';
        seen.add(url.toString());
      }
    }
    // Enough distinct addresses that the check cannot pass by finding nothing.
    expect(seen.size).toBeGreaterThan(15);
    // A pool of 8 workers takes the addresses from one list, so at most 8 requests are in flight at once. One after
    // another, the same fetches ran past the 45 second limit on a phone-sized browser against the live site.
    const addresses = [...seen];
    let next = 0;
    const worker = async () => {
      while (next < addresses.length) {
        const address = addresses[next++];
        const response = await request.get(address);
        expect(response.status(), address).toBe(200);
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, addresses.length) }, worker));
  });
});

test.describe('an address in the wrong letter case', () => {
  // The host is case-sensitive: each of these answers 404 with the 404 shell, which carries the baseline policy.
  const VARIANTS = [
    { path: '/TOOLS/regex-tester', page: /Regex Tester/ },
    { path: '/Tools/docker-run-to-compose', page: /docker run/i },
    { path: '/PRIVACY', page: /^Privacy/ },
  ];

  test('shows the not-found page from the 404 shell and never draws the page under the shell policy', async ({
    page,
    request,
    baseURL,
  }) => {
    const base = new URL(baseURL ?? '');
    const local = ['127.0.0.1', 'localhost'].includes(base.hostname);
    if (local) {
      // A static preview server answers an unknown address with the home page and may match a file name in any case on
      // Windows, so the host's answer is served here: the built 404 shell with status 404.
      const shell = await (await request.get(rel('/404.html'))).text();
      expect(shell).toContain('Content-Security-Policy');
      const variants = new Set(VARIANTS.map(({ path }) => base.pathname.replace(/\/$/, '') + path));
      await page.route(
        (url) => variants.has(url.pathname),
        (route) => route.fulfill({ status: 404, contentType: 'text/html', body: shell }),
      );
    }
    for (const variant of VARIANTS) {
      const response = await page.goto(rel(variant.path));
      expect(response?.status(), variant.path).toBe(404);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
      await expect(page.getByRole('heading', { name: variant.page })).toHaveCount(0);
    }
  });
});

declare global {
  interface Window {
    __fodtThemeValues?: string[];
    __fodtPaintTheme?: string | null;
    __fodtPaintSeen?: boolean;
  }
}

test.describe('the light theme on a full page load', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('fodt-theme', 'light');
      } catch {
        /* the test then fails on its own assertions */
      }
      window.__fodtThemeValues = [];
      window.__fodtPaintTheme = null;
      window.__fodtPaintSeen = false;
      // The document may have no root element yet when this runs, so watch the whole document.
      new MutationObserver((records) => {
        for (const r of records) {
          if (r.attributeName === 'data-theme') {
            window.__fodtThemeValues?.push((r.target as HTMLElement).getAttribute('data-theme') ?? 'none');
          }
        }
      }).observe(document, { attributes: true, attributeFilter: ['data-theme'], subtree: true });
      try {
        new PerformanceObserver((list) => {
          if (list.getEntries().length > 0 && !window.__fodtPaintSeen) {
            window.__fodtPaintSeen = true;
            window.__fodtPaintTheme = document.documentElement.getAttribute('data-theme');
          }
        }).observe({ type: 'paint', buffered: true });
      } catch {
        /* this engine exposes no paint timing; the test says so by name */
      }
    });
  });

  const readTheme = (page: Page) =>
    page.evaluate(() => ({
      values: window.__fodtThemeValues ?? [],
      current: document.documentElement.getAttribute('data-theme'),
    }));

  test('a visitor who chose light is never shown dark on load, on a first load and on one reached by a link', async ({
    page,
  }) => {
    await page.goto(rel('/'));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    let seen = await readTheme(page);
    expect(seen.current).toBe('light');
    expect(seen.values.length).toBeGreaterThan(0);
    expect(seen.values.every((v) => v === 'light')).toBe(true);

    const link = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'About', exact: true });
    await Promise.all([page.waitForURL(/\/about$/), link.click()]);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    seen = await readTheme(page);
    expect(seen.current).toBe('light');
    expect(seen.values.length).toBeGreaterThan(0);
    expect(seen.values.every((v) => v === 'light')).toBe(true);
  });

  test('the value at the first paint is light, on a first load and on one reached by a link', async ({ page }) => {
    await page.goto(rel('/'));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const hasPaint = await page.evaluate(() => performance.getEntriesByType('paint').length > 0);
    test.skip(!hasPaint, 'this engine exposes no paint timing entry, so the first-paint half cannot run here');
    await expect.poll(() => page.evaluate(() => window.__fodtPaintSeen)).toBe(true);
    expect(await page.evaluate(() => window.__fodtPaintTheme)).toBe('light');

    const link = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Catalog', exact: true });
    await Promise.all([page.waitForURL(/\/catalog$/), link.click()]);
    await expect.poll(() => page.evaluate(() => window.__fodtPaintSeen)).toBe(true);
    expect(await page.evaluate(() => window.__fodtPaintTheme)).toBe('light');
  });
});

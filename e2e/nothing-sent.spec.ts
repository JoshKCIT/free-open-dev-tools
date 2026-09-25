import { test, expect, type Page } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Phase 6's own behavioural proof for the roadmap's success criterion 2
 * (D-90): a visitor typing a real, absolute URL into every field of a phase
 * 6 page causes no network request and no call to a network-capable
 * platform API, on all four browser projects. This file is owned by this
 * plan alone (06-01); later plans in this phase never edit it -- they only
 * run it with `-g <their-id>` once their own page exists, which happens
 * automatically the moment `apps/web/src/tools/<id>.ts` is created, since
 * the per-id tests below are generated from the filesystem, not a literal
 * list.
 */

const rel = (path: string) => path.replace(/^\//, '');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

declare global {
  interface Window {
    /** Every network-capable API call recorded once `__fodtNetArmed` is true. */
    __fodtNetCalls?: { type: string; target: string }[];
    __fodtNetArmed?: boolean;
  }
}

/** The 13 tool ids this phase adds (NET-01..13), the catalog's own network category minus ip-subnet. */
const PHASE_6_TOOL_IDS = [
  'ip-ptr',
  'user-agent',
  'curl-converter',
  'security-headers',
  'url-parser',
  'utm-builder',
  'meta-tags',
  'robots-txt',
  'sitemap-generator',
  'schema-markup',
  'hreflang',
  'htaccess-generator',
  'nginx-config',
];

/**
 * An absolute, real-shaped URL a visitor might genuinely paste. The
 * `.invalid` top-level domain is reserved by RFC 6761 section 6.4 and never
 * resolves, so a real network attempt would still be visible as an attempted
 * request without actually reaching anything.
 */
const VISITOR_URL = 'https://example.invalid/nothing-sent?q=1#f';

/**
 * Wraps every network-capable platform API so a call made after arming is
 * recorded on `window.__fodtNetCalls`, then passes through to the real
 * implementation. Composition (delegation to a captured original), not a
 * class with a private field: a private class field needs a downlevel
 * helper that does not exist once this function's source is serialised into
 * the page by `page.addInitScript` (the 02-10 lesson in STATE.md). The two
 * built-in constructors below use `extends` with an ordinary public
 * constructor instead, which needs no such helper.
 */
async function installNetworkTrap(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__fodtNetCalls = [];
    window.__fodtNetArmed = false;

    const originalFetch = window.fetch.bind(window);
    window.fetch = ((...args: Parameters<typeof window.fetch>) => {
      if (window.__fodtNetArmed) window.__fodtNetCalls!.push({ type: 'fetch', target: String(args[0]) });
      return originalFetch(...args);
    }) as typeof window.fetch;

    type OpenFn = (
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ) => void;
    const originalOpen = XMLHttpRequest.prototype.open as OpenFn;
    XMLHttpRequest.prototype.open = function (
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ): void {
      if (window.__fodtNetArmed) window.__fodtNetCalls!.push({ type: 'XMLHttpRequest', target: String(url) });
      originalOpen.call(this, method, url, async, username, password);
    } as typeof XMLHttpRequest.prototype.open;

    if (navigator.sendBeacon) {
      const originalSendBeacon = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = ((...args: Parameters<typeof navigator.sendBeacon>) => {
        if (window.__fodtNetArmed) window.__fodtNetCalls!.push({ type: 'sendBeacon', target: String(args[0]) });
        return originalSendBeacon(...args);
      }) as typeof navigator.sendBeacon;
    }

    const OriginalWebSocket = window.WebSocket;
    class WrappedWebSocket extends OriginalWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        if (window.__fodtNetArmed) window.__fodtNetCalls!.push({ type: 'WebSocket', target: String(url) });
        super(url, protocols);
      }
    }
    window.WebSocket = WrappedWebSocket;

    const OriginalEventSource = window.EventSource;
    if (OriginalEventSource) {
      class WrappedEventSource extends OriginalEventSource {
        constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
          if (window.__fodtNetArmed) window.__fodtNetCalls!.push({ type: 'EventSource', target: String(url) });
          super(url, eventSourceInitDict);
        }
      }
      window.EventSource = WrappedEventSource;
    }
  });
}

/**
 * Clears the auto-run debounce, then waits for the Output section's own busy
 * signal to clear -- the same two-stage wait `e2e/svg-optimizer.spec.ts` and
 * `e2e/live-catalog.spec.ts` use.
 */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(200);
  try {
    await expect(page.locator('section[aria-label="Output"]')).toHaveAttribute('aria-busy', 'false', {
      timeout: 15_000,
    });
  } catch {
    // A page that never clears aria-busy is a real finding; the assertions
    // below catch it structurally (a network call or leaked attribute).
  }
}

test('the nothing-sent list matches the network category of the catalog', () => {
  const catalog = JSON.parse(readFileSync(join(root, 'docs', 'catalog.json'), 'utf8')) as {
    id: string;
    category: string;
  }[];
  // ip-subnet is a phase 2 tool already live in the network category; every
  // other network-category id belongs to this phase.
  const networkIds = catalog.filter((c) => c.category === 'network' && c.id !== 'ip-subnet').map((c) => c.id);
  expect(networkIds.slice().sort()).toEqual(PHASE_6_TOOL_IDS.slice().sort());
});

const pagesDir = join(root, 'apps', 'web', 'src', 'tools');
const builtIds = existsSync(pagesDir)
  ? new Set(
      readdirSync(pagesDir)
        .filter((f) => f.endsWith('.ts'))
        .map((f) => f.replace(/\.ts$/, '')),
    )
  : new Set<string>();

for (const id of PHASE_6_TOOL_IDS) {
  if (!builtIds.has(id)) continue;

  test(`${id}: a visitor URL typed into every field causes no request and no network call`, async ({ page }) => {
    await installNetworkTrap(page);

    const requestsAfterArm: string[] = [];
    let armed = false;
    page.on('request', (request) => {
      if (armed) requestsAfterArm.push(request.url());
    });

    await page.goto(rel(`/tools/${id}`));
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

    armed = true;
    await page.evaluate(() => {
      window.__fodtNetArmed = true;
    });

    const fields = page.locator('main input[type="text"][id^="f-"], main textarea[id^="f-"]');
    const fieldCount = await fields.count();
    let filled = 0;
    for (let i = 0; i < fieldCount; i++) {
      const field = fields.nth(i);
      if (await field.isVisible()) {
        await field.fill(VISITOR_URL);
        filled++;
      }
    }
    expect(
      filled,
      `no visible text field or textarea was found on /tools/${id} to fill with a visitor URL`,
    ).toBeGreaterThan(0);

    const runButton = page.getByRole('button', { name: 'Run', exact: true });
    if ((await runButton.count()) > 0 && (await runButton.first().isVisible())) {
      await runButton.first().click();
    }

    await settle(page);
    await page.waitForTimeout(1200);
    await page.waitForLoadState('networkidle');

    const nonDataRequests = requestsAfterArm.filter((url) => !url.startsWith('data:') && !url.startsWith('blob:'));
    expect(
      nonDataRequests,
      `a request was made while /tools/${id} processed a visitor URL: ${nonDataRequests.join(', ')}`,
    ).toEqual([]);

    const netCalls = await page.evaluate(() => window.__fodtNetCalls ?? []);
    expect(
      netCalls,
      `a network-capable API was called while /tools/${id} processed a visitor URL: ${JSON.stringify(netCalls)}`,
    ).toEqual([]);

    const mainLeaks = await page.evaluate((needle) => {
      const attrs = ['src', 'href', 'srcset', 'poster'];
      const main = document.querySelector('main');
      const found: string[] = [];
      if (!main) return found;
      for (const el of main.querySelectorAll('*')) {
        for (const attr of attrs) {
          const value = el.getAttribute(attr);
          if (value && value.includes(needle)) found.push(`${el.tagName.toLowerCase()}[${attr}]`);
        }
      }
      return found;
    }, 'example.invalid');
    expect(mainLeaks, `the visitor URL reached a loading attribute on /tools/${id}: ${mainLeaks.join(', ')}`).toEqual(
      [],
    );

    const frameLeaks = await page.evaluate((needle) => {
      const attrs = ['src', 'href', 'srcset', 'poster'];
      const found: string[] = [];
      for (const frame of document.querySelectorAll('iframe.preview-frame')) {
        const srcdoc = frame.getAttribute('srcdoc') ?? '';
        const doc = new DOMParser().parseFromString(srcdoc, 'text/html');
        for (const el of doc.querySelectorAll('*')) {
          for (const attr of attrs) {
            const value = el.getAttribute(attr);
            if (value && value.includes(needle)) found.push(`${el.tagName.toLowerCase()}[${attr}]`);
          }
          const style = el.getAttribute('style');
          if (style && style.includes('url(')) found.push(`${el.tagName.toLowerCase()}[style url(]`);
        }
      }
      return found;
    }, 'example.invalid');
    expect(
      frameLeaks,
      `a preview frame on /tools/${id} carries the visitor URL in a loading attribute or a style url(): ${frameLeaks.join(', ')}`,
    ).toEqual([]);
  });
}

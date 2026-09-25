import { test, expect, type Page } from '@playwright/test';

/**
 * curl-converter's own behavioural proof for success criterion 2 (D-90):
 * a request built from a pasted curl command or from fields is turned into
 * six code snippets, and the page never sends it. The `rel()` helper and
 * the network API wrapper below are copied from `e2e/nothing-sent.spec.ts`
 * (this plan's own `<action>` instruction), so this file needs no import
 * from that spec and stays readable on its own.
 */

const rel = (path: string) => path.replace(/^\//, '');

declare global {
  interface Window {
    __fodtNetCalls?: { type: string; target: string }[];
    __fodtNetArmed?: boolean;
  }
}

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

async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(200);
  try {
    await expect(page.locator('section[aria-label="Output"]')).toHaveAttribute('aria-busy', 'false', {
      timeout: 15_000,
    });
  } catch {
    // caught structurally by the assertions below.
  }
}

/** The `pre.output` inside the `.output-block` whose label text exactly equals `label` (a substring match would confuse "cURL" with "PHP curl"). */
function codeBlockByLabel(page: Page, label: string) {
  return page
    .locator('.output-block')
    .filter({ has: page.locator('.output-label span', { hasText: new RegExp(`^${label}$`) }) })
    .locator('pre.output');
}

async function armNetworkRecorders(page: Page): Promise<{ requestsAfterArm: string[]; setArmed: () => Promise<void> }> {
  const requestsAfterArm: string[] = [];
  let armed = false;
  page.on('request', (request) => {
    if (armed) requestsAfterArm.push(request.url());
  });
  return {
    requestsAfterArm,
    setArmed: async () => {
      armed = true;
      await page.evaluate(() => {
        window.__fodtNetArmed = true;
      });
    },
  };
}

test('curl-converter converts a pasted command into all six snippets and never calls a network API', async ({
  page,
}) => {
  await installNetworkTrap(page);
  const { requestsAfterArm, setArmed } = await armNetworkRecorders(page);

  await page.goto(rel('/tools/curl-converter'));
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  await setArmed();

  await page.locator('input[type="radio"][name="mode"][value="paste"]').check();
  await page
    .locator('#f-command')
    .fill(`curl -X POST 'https://example.invalid/api?x=1' -H 'Content-Type: application/json' -d '{"a":1}'`);

  await settle(page);
  await page.waitForTimeout(1200);
  await page.waitForLoadState('networkidle');

  const labels = ['cURL', 'JavaScript fetch', 'Python requests', 'Go net/http', 'PHP curl', 'HTTPie'];
  for (const label of labels) {
    await expect(codeBlockByLabel(page, label)).not.toHaveText('');
  }

  const fetchText = await codeBlockByLabel(page, 'JavaScript fetch').innerText();
  expect(fetchText).toContain('"https://example.invalid/api?x=1"');
  expect(fetchText).toContain('method: "POST"');

  const nonDataRequests = requestsAfterArm.filter((url) => !url.startsWith('data:') && !url.startsWith('blob:'));
  expect(nonDataRequests, `a request was made: ${nonDataRequests.join(', ')}`).toEqual([]);

  const netCalls = await page.evaluate(() => window.__fodtNetCalls ?? []);
  expect(netCalls, `a network API was called: ${JSON.stringify(netCalls)}`).toEqual([]);

  const leaks = await page.evaluate((needle) => {
    const attrs = ['src', 'href'];
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
  expect(leaks, `the visitor URL reached a loading attribute: ${leaks.join(', ')}`).toEqual([]);
});

test('curl-converter build mode with basic auth warns about the secret and redacts it on request', async ({ page }) => {
  await installNetworkTrap(page);
  const { requestsAfterArm, setArmed } = await armNetworkRecorders(page);

  await page.goto(rel('/tools/curl-converter'));
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  await setArmed();

  // mode=build is the page's own default.
  await page.locator('#f-url').fill('https://example.invalid/');
  await page.locator('#f-auth').selectOption('basic');
  await page.locator('#f-username').fill('alice');
  await page.locator('#f-password').fill('s3cret-value');

  await settle(page);

  await expect(page.locator('.note-warn')).toContainText('password or token');

  const curlBefore = await codeBlockByLabel(page, 'cURL').innerText();
  expect(curlBefore).toContain('s3cret-value');

  await page.locator('#f-redactSecrets').check();
  await settle(page);

  const labels = ['cURL', 'JavaScript fetch', 'Python requests', 'Go net/http', 'PHP curl', 'HTTPie'];
  for (const label of labels) {
    const text = await codeBlockByLabel(page, label).innerText();
    expect(text, `${label} still contains the real password`).not.toContain('s3cret-value');
    expect(text, `${label} has no placeholder`).toContain('YOUR_PASSWORD');
  }

  await page.waitForTimeout(1200);
  await page.waitForLoadState('networkidle');
  const nonDataRequests = requestsAfterArm.filter((url) => !url.startsWith('data:') && !url.startsWith('blob:'));
  expect(nonDataRequests, `a request was made: ${nonDataRequests.join(', ')}`).toEqual([]);
});

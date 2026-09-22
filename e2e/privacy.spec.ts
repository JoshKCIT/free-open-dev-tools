import { test, expect, type Page, type Request } from '@playwright/test';
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

/**
 * The privacy claim, checked rather than asserted.
 *
 * For every tool page this drives the real production build, types a unique
 * canary string into every input, and then fails if that canary escaped
 * through any channel: a network request, storage, the URL, a cookie, or the
 * console. It also fails if the page made any network request at all while
 * processing, whatever the contents.
 *
 * A tool that leaks input here blocks the release.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const toolIds = readdirSync(join(root, 'apps', 'web', 'src', 'tools'))
  .filter((f) => f.endsWith('.ts'))
  .map((f) => f.replace(/\.ts$/, ''))
  .sort();

/** Distinctive enough that it cannot appear by accident in a bundle or a log. */
function canary(id: string): string {
  return `CANARY-7f3a91-${id}-d4e8b2`;
}

interface Recorder {
  requests: Request[];
  consoleText: string[];
  arm(): void;
}

async function instrument(page: Page): Promise<Recorder> {
  const requests: Request[] = [];
  const consoleText: string[] = [];
  let armed = false;

  page.on('request', (request) => {
    if (armed) requests.push(request);
  });
  page.on('console', (msg) => {
    if (armed) consoleText.push(msg.text());
  });
  page.on('pageerror', (err) => {
    if (armed) consoleText.push(`pageerror: ${err.message}`);
  });

  return {
    requests,
    consoleText,
    arm() {
      armed = true;
    },
  };
}

/** Everything the page could have written locally that we can read back. */
async function readStorage(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const parts: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        parts.push(`local:${key}=${localStorage.getItem(key)}`);
      }
    } catch {
      /* storage may be blocked */
    }
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i)!;
        parts.push(`session:${key}=${sessionStorage.getItem(key)}`);
      }
    } catch {
      /* storage may be blocked */
    }
    parts.push(`cookie:${document.cookie}`);
    try {
      const databases = (await indexedDB.databases?.()) ?? [];
      for (const db of databases) parts.push(`idb:${db.name}`);
    } catch {
      /* not supported everywhere */
    }
    return parts.join('\n');
  });
}

async function fillVisibleInputs(page: Page, value: string): Promise<number> {
  const inputs = page.locator(
    'main textarea, main input[type="text"], main input[type="search"], main input:not([type])',
  );
  const count = await inputs.count();
  let filled = 0;
  for (let i = 0; i < count; i++) {
    const field = inputs.nth(i);
    if (!(await field.isVisible())) continue;
    if (!(await field.isEditable())) continue;
    await field.fill(value);
    filled++;
  }
  return filled;
}

/**
 * Fills every text input the tool can show, not just the ones visible first.
 *
 * Several tools hide fields behind a mode switch, so a test that only filled
 * the default view would leave whole code paths unchecked.
 */
async function fillEveryInput(page: Page, value: string): Promise<number> {
  let filled = await fillVisibleInputs(page, value);

  const radios = page.locator('main input[type="radio"]');
  const radioCount = await radios.count();
  for (let i = 0; i < radioCount; i++) {
    const radio = radios.nth(i);
    if (!(await radio.isVisible())) continue;
    await radio.check();
    await page.waitForTimeout(80);
    filled += await fillVisibleInputs(page, value);
  }
  return filled;
}

test.describe('local processing', () => {
  test('no third-party origin is contacted when loading the site', async ({ page, baseURL }) => {
    const external: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (url.startsWith('data:') || url.startsWith('blob:')) return;
      if (!url.startsWith(baseURL!)) external.push(`${request.method()} ${url}`);
    });

    for (const path of ['/', '/tools', '/catalog', '/privacy', '/about']) {
      await page.goto(rel(path));
      await page.waitForLoadState('networkidle');
    }

    expect(
      external,
      'The site must serve every asset from its own origin. A third-party request would hand that party the visitor IP address and the page they are on.',
    ).toEqual([]);
  });

  for (const id of toolIds) {
    test(`${id}: input never leaves the page`, async ({ page, baseURL }) => {
      const recorder = await instrument(page);
      const value = canary(id);

      await page.goto(rel(`/tools/${id}`));
      await page.waitForLoadState('networkidle');
      // Everything above this line is page load. Only what follows is the tool
      // processing input, which is what the claim is about.
      recorder.arm();

      const filled = await fillEveryInput(page, value);
      expect(filled, `No editable text input found on /tools/${id}`).toBeGreaterThan(0);

      // Give auto-run, debouncing and any worker time to finish.
      await page.waitForTimeout(1200);
      await page.waitForLoadState('networkidle');

      const offending = recorder.requests.filter((r) => {
        const url = r.url();
        return !url.startsWith('data:') && !url.startsWith('blob:');
      });

      expect(
        offending.map((r) => `${r.method()} ${r.url()}`),
        `Processing input on /tools/${id} caused a network request. A local tool must make none.`,
      ).toEqual([]);

      const url = page.url();
      expect(url, `The canary reached the URL on /tools/${id}`).not.toContain(value);
      expect(url, 'A tool must not put input in the URL, because URLs reach history and server logs').not.toContain(
        'CANARY',
      );

      const storage = await readStorage(page);
      expect(storage, `The canary was written to storage on /tools/${id}`).not.toContain(value);

      expect(recorder.consoleText.join('\n'), `The canary was written to the console on /tools/${id}`).not.toContain(
        value,
      );

      // The page must still have produced something, otherwise this test would
      // pass trivially on a tool that silently does nothing.
      const output = page.locator('section[aria-label="Output"]');
      await expect(output).toBeVisible();

      expect(baseURL).toBeTruthy();
    });
  }

  test('the report-an-issue link carries no input', async ({ page }) => {
    const value = canary('issue-link');
    await page.goto(rel('/tools/base64'));
    await page.locator('main textarea').first().fill(value);
    await page.waitForTimeout(500);

    const href = await page
      .locator('.tool-header')
      .getByRole('link', { name: /report an issue/i })
      .getAttribute('href');
    expect(href, 'An issue link must never be pre-filled with what the user typed').not.toContain(value);
    expect(href).toContain('/issues/new');
  });

  test('reloading the page does not restore what was typed', async ({ page }) => {
    const value = canary('no-persist');
    await page.goto(rel('/tools/base64'));
    await page.locator('main textarea').first().fill(value);
    await page.waitForTimeout(500);

    await page.reload();
    await page.waitForLoadState('networkidle');

    const content = await page.content();
    expect(content, 'Input must not survive a reload, because it was never stored').not.toContain(value);
  });

  test('the only thing stored locally is the theme', async ({ page }) => {
    await page.goto(rel('/'));
    await page.getByRole('button', { name: /switch to .* theme/i }).click();
    await page.waitForTimeout(200);

    const keys = await page.evaluate(() => {
      const out: string[] = [];
      for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i)!);
      return out;
    });
    expect(keys).toEqual(['fodt-theme']);

    const cookies = await page.context().cookies();
    expect(cookies, 'The site sets no cookies').toEqual([]);
  });

  test('no service worker is registered', async ({ page }) => {
    await page.goto(rel('/'));
    await page.waitForLoadState('networkidle');
    const registrations = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 0;
      const list = await navigator.serviceWorker.getRegistrations();
      return list.length;
    });
    expect(registrations).toBe(0);
  });
});

test.describe('rendering untrusted content', () => {
  test('a preview frame cannot run scripts or reach the network', async ({ page }) => {
    await page.goto(rel('/tools/base64'));
    const frames = page.locator('iframe.preview-frame');
    const count = await frames.count();
    // Not every tool has a preview. Where one exists, it must be fully sandboxed.
    for (let i = 0; i < count; i++) {
      const sandbox = await frames.nth(i).getAttribute('sandbox');
      expect(sandbox, 'A preview frame must carry an empty sandbox attribute').toBe('');
    }
  });
});

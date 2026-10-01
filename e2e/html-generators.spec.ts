import { test, expect, type Page } from '@playwright/test';

/**
 * The browser proof shared by the four HTML generator pages: hostile text typed
 * into a field comes out as text and runs nothing, an address the visitor types
 * is never requested and never reaches the preview, clicking inside a preview
 * requests nothing, and the control a page builds is found by its label.
 *
 * The helpers below are copied in shape from `e2e/meta-tags.spec.ts` and
 * `e2e/invoice-maker.spec.ts` and are not imported from any other file, so a
 * change elsewhere never re-runs this one. Each page appends its own top-level
 * tests, titled `<tool id>: ...` so that `-g "<tool id>"` selects them.
 */
const rel = (path: string) => path.replace(/^\//, '');

/** A value that would break out of an attribute and run script if it were ever interpreted. */
const HOSTILE = '"><img src=x onerror="top.__fodtXss=1"><script>top.__fodtXss=1</script>';

/** Clears the auto-run debounce, then waits for the Output section's own busy signal to clear. */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(200);
  await expect(page.locator('section[aria-label="Output"]')).toHaveAttribute('aria-busy', 'false', {
    timeout: 15_000,
  });
}

/** Every request made while `action` runs, other than data: and blob: addresses. */
async function withRequestRecorder(page: Page, action: () => Promise<void>): Promise<string[]> {
  const requests: string[] = [];
  const handler = (req: import('@playwright/test').Request) => {
    const url = req.url();
    if (!url.startsWith('data:') && !url.startsWith('blob:')) requests.push(`${req.method()} ${url}`);
  };
  page.on('request', handler);
  try {
    await action();
  } finally {
    page.off('request', handler);
  }
  return requests;
}

/** The srcdoc of every preview frame on the page. */
async function previewSrcdocs(page: Page): Promise<string[]> {
  const frames = page.locator('iframe.preview-frame');
  const count = await frames.count();
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push((await frames.nth(i).getAttribute('srcdoc')) ?? '');
  return out;
}

/**
 * Parses a preview's srcdoc with the browser's own parser and lists anything a
 * preview must not carry: a script element, an event handler attribute, and an
 * address attribute whose value is not a data: address.
 */
async function scanPreview(page: Page, srcdoc: string): Promise<string[]> {
  return page.evaluate((html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const bad: string[] = [];
    const addressAttributes = [
      'src',
      'href',
      'srcset',
      'poster',
      'action',
      'formaction',
      'data',
      'cite',
      'ping',
      'background',
    ];
    if (doc.querySelector('script')) bad.push('script element present');
    for (const element of Array.from(doc.querySelectorAll('*'))) {
      for (const attr of Array.from(element.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on')) bad.push(`${element.tagName.toLowerCase()} carries ${attr.name}`);
        if (addressAttributes.includes(name) && !attr.value.trim().toLowerCase().startsWith('data:')) {
          bad.push(`${element.tagName.toLowerCase()} carries ${attr.name}=${attr.value}`);
        }
      }
    }
    return bad;
  }, srcdoc);
}

test('form-field-builder: hostile text in the label comes out as text, runs nothing and requests nothing', async ({
  page,
}) => {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });

  await page.goto(rel('/tools/form-field-builder'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  const requests = await withRequestRecorder(page, async () => {
    await page.locator('#f-label').fill(HOSTILE);
    await page.locator('#f-name').fill('fn');
    await settle(page);
  });

  expect(dialogs, 'no dialog may be raised by rendering the markup or the preview').toEqual([]);
  const xssMark = await page.evaluate(() => (window as unknown as { __fodtXss?: unknown }).__fodtXss);
  expect(xssMark, 'nothing typed may reach or run in the top-level window').toBe(undefined);
  expect(requests, `no request may be made while typing: ${requests.join(', ')}`).toEqual([]);

  const frames = page.locator('iframe.preview-frame');
  const frameCount = await frames.count();
  expect(frameCount, 'the preview must render in a frame').toBeGreaterThan(0);
  for (let i = 0; i < frameCount; i++) {
    expect(await frames.nth(i).getAttribute('sandbox'), 'a preview frame must carry an empty sandbox attribute').toBe(
      '',
    );
  }
  for (const srcdoc of await previewSrcdocs(page)) {
    expect(await scanPreview(page, srcdoc)).toEqual([]);
  }

  const markup = await page.locator('section[aria-label="Output"] pre.output').first().innerText();
  expect(markup).toContain('&lt;script&gt;');
});

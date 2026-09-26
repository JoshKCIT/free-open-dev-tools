import { test, expect } from '@playwright/test';

/**
 * Proves, on all four browser projects, that the README preview renders
 * only inside the sandboxed frame, never loads an image (D-105: badges are
 * text, never an image), and runs nothing pasted into any field. Shaped
 * like `e2e/svg-optimizer.spec.ts` and `e2e/meta-tags.spec.ts`.
 */
const rel = (path: string) => path.replace(/^\//, '');

test('readme-generator: the preview renders in the sandboxed frame, loads no image and runs nothing', async ({
  page,
}) => {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });

  await page.goto(rel('/tools/readme-generator'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  const requestsAfterLoad: string[] = [];
  page.on('request', (request) => {
    requestsAfterLoad.push(request.url());
  });

  await page.locator('#f-name').fill('my-lib');
  await page.locator('#f-owner').fill('example');
  await page.locator('#f-repo').fill('project');
  await page.locator('#f-packageName').fill('my-lib');
  await page.locator('#f-workflowFile').fill('ci.yml');
  await page.locator('#f-badgeNpm').check();
  await page.locator('#f-badgeLicense').check();
  await page.locator('#f-description').fill('<img src=x onerror="top.__fodtXss=1">');
  await page.locator('#f-usage').fill('<script>top.__fodtXss=1</script>');
  await page.locator('#f-features').fill('<svg onload="top.__fodtXss=1">');
  await page.locator('#f-contributing').fill('Pull requests welcome.');

  // Clears the auto-run debounce, then waits for the Output section's own
  // busy signal to clear -- the same two-stage wait e2e/privacy.spec.ts uses.
  await page.waitForTimeout(200);
  await expect(page.locator('section[aria-label="Output"]')).toHaveAttribute('aria-busy', 'false', {
    timeout: 15_000,
  });

  expect(dialogs, 'no dialog should ever be raised by rendering the README preview').toEqual([]);

  const xssMark = await page.evaluate(() => (window as unknown as { __fodtXss?: unknown }).__fodtXss);
  expect(xssMark, 'the top-level window must never be reached by anything inside the sandboxed preview').toBe(
    undefined,
  );

  const nonDataRequests = requestsAfterLoad.filter((url) => !url.startsWith('data:') && !url.startsWith('blob:'));
  expect(
    nonDataRequests,
    `no network request may be made while previewing a README, including a badge image: ${nonDataRequests.join(', ')}`,
  ).toEqual([]);

  const frames = page.locator('iframe.preview-frame');
  const frameCount = await frames.count();
  expect(frameCount, 'the sanitised preview must render in a sandboxed frame').toBeGreaterThan(0);
  for (let i = 0; i < frameCount; i++) {
    const sandbox = await frames.nth(i).getAttribute('sandbox');
    expect(sandbox, 'a preview frame must carry an empty sandbox attribute (no allow-scripts)').toBe('');
  }

  for (let i = 0; i < frameCount; i++) {
    const frame = frames.nth(i);
    const result = await frame.evaluate((el) => {
      const srcdoc = (el as HTMLIFrameElement).getAttribute('srcdoc') ?? '';
      const doc = new DOMParser().parseFromString(srcdoc, 'text/html');
      const bad: string[] = [];
      if (doc.querySelector('img')) bad.push('img element present');
      if (doc.querySelector('script')) bad.push('script element present');
      if (doc.querySelector('iframe')) bad.push('iframe element present');
      if (doc.querySelector('object')) bad.push('object element present');
      for (const node of Array.from(doc.querySelectorAll('*'))) {
        for (const attr of Array.from(node.attributes)) {
          if (attr.name.toLowerCase().startsWith('on')) bad.push(`element carries ${attr.name}`);
        }
      }
      const hasBadgeText = Array.from(doc.querySelectorAll('code')).some((c) => (c.textContent ?? '').includes('npm'));
      return { bad, hasBadgeText };
    });
    expect(result.bad, `frame ${i}: ${result.bad.join(', ')}`).toEqual([]);
    expect(result.hasBadgeText, 'the npm badge must appear as text inside a code element').toBe(true);
  }
});

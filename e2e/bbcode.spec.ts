import { test, expect } from '@playwright/test';

/**
 * The sandbox-proof shape `svg-optimizer` established (`e2e/svg-optimizer.spec.ts`):
 * hostile input is driven through the page's real controls, and this file
 * proves the result renders only inside the sandboxed preview frame with the
 * sandbox attribute empty, no dialog is raised, no script runs, and no
 * network request is made -- on all four browser projects, per D-72 and
 * success criterion 3.
 */
const rel = (path: string) => path.replace(/^\//, '');

test('bbcode shows hostile BBCode only inside the sandboxed preview and nothing runs', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });

  await page.goto(rel('/tools/bbcode'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  const requestsAfterLoad: string[] = [];
  page.on('request', (request) => {
    requestsAfterLoad.push(request.url());
  });

  await page.locator('#f-to').selectOption('html');

  const hostileBbcode =
    '[url=javascript:top.__fodtXss = 1;]x[/url] ' +
    '[img]https://example.invalid/x.png[/img] ' +
    '[color=red;background:url(javascript:alert(1))]y[/color] ' +
    '<script>top.__fodtXss = 1;</script>';

  await page.locator('#f-input').fill(hostileBbcode);

  await page.waitForTimeout(200);
  await expect(page.locator('section[aria-label="Output"]')).toHaveAttribute('aria-busy', 'false', {
    timeout: 15_000,
  });

  expect(dialogs, 'no dialog should ever be raised by rendering hostile BBCode').toEqual([]);

  const xssMark = await page.evaluate(() => (window as unknown as { __fodtXss?: unknown }).__fodtXss);
  expect(xssMark, 'the top-level window must never be reached by anything inside the sandboxed preview').toBe(
    undefined,
  );

  const nonDataRequests = requestsAfterLoad.filter((url) => !url.startsWith('data:') && !url.startsWith('blob:'));
  expect(
    nonDataRequests,
    `no network request may be made while previewing hostile BBCode: ${nonDataRequests.join(', ')}`,
  ).toEqual([]);

  const frames = page.locator('iframe.preview-frame');
  const frameCount = await frames.count();
  expect(frameCount, 'the sanitised markup must render in a sandboxed preview frame').toBeGreaterThan(0);
  for (let i = 0; i < frameCount; i++) {
    const sandbox = await frames.nth(i).getAttribute('sandbox');
    expect(sandbox, 'a preview frame must carry an empty sandbox attribute').toBe('');
  }

  const srcDoc = (await frames.first().getAttribute('srcdoc')) ?? '';
  expect(srcDoc.toLowerCase()).not.toContain('<script');
  expect(srcDoc).not.toMatch(/\son\w+\s*=/i);
  expect(srcDoc).not.toContain('example.invalid');
  expect(srcDoc.toLowerCase()).not.toContain('javascript:');

  // Scoped to the Output section, not the whole page: the Input panel's own
  // textarea legitimately echoes back the visitor's pasted text (HTML-
  // entity-escaped, inert) verbatim, which would otherwise false-positive
  // on this same pattern.
  const outputHtml = await page.locator('section[aria-label="Output"]').innerHTML();
  expect(outputHtml.toLowerCase()).not.toMatch(/<script/);
  expect(outputHtml).not.toMatch(/\son\w+\s*=/i);
});

test('bbcode preview renders bold, links and lists for benign BBCode', async ({ page }) => {
  await page.goto(rel('/tools/bbcode'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  await page.locator('#f-to').selectOption('html');
  await page.locator('#f-input').fill('[b]bold[/b] [url=https://example.com]link[/url] [list][*]one[*]two[/list]');

  await page.waitForTimeout(200);
  await expect(page.locator('section[aria-label="Output"]')).toHaveAttribute('aria-busy', 'false', {
    timeout: 15_000,
  });

  const frame = page.locator('iframe.preview-frame').first();
  await expect(frame).toHaveCount(1);
  const srcDoc = (await frame.getAttribute('srcdoc')) ?? '';
  expect(srcDoc).toContain('<strong>bold</strong>');
  expect(srcDoc).toContain('href="https://example.com"');
  expect(srcDoc).toContain('<ul>');
});

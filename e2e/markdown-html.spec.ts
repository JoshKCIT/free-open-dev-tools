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

test('markdown-html shows hostile Markdown only inside the sandboxed preview and nothing runs', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });

  await page.goto(rel('/tools/markdown-html'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  const requestsAfterLoad: string[] = [];
  page.on('request', (request) => {
    requestsAfterLoad.push(request.url());
  });

  const hostileMarkdown =
    '<script>top.__fodtXss = 1;</script>\n\n' +
    '<img src=x onerror="top.__fodtXss = 1">\n\n' +
    '[a](javascript:alert(1))\n\n' +
    '![b](https://example.invalid/x.png)';

  await page.locator('#f-input').fill(hostileMarkdown);

  await page.waitForTimeout(200);
  await expect(page.locator('section[aria-label="Output"]')).toHaveAttribute('aria-busy', 'false', {
    timeout: 15_000,
  });

  expect(dialogs, 'no dialog should ever be raised by rendering hostile Markdown').toEqual([]);

  const xssMark = await page.evaluate(() => (window as unknown as { __fodtXss?: unknown }).__fodtXss);
  expect(xssMark, 'the top-level window must never be reached by anything inside the sandboxed preview').toBe(
    undefined,
  );

  const nonDataRequests = requestsAfterLoad.filter((url) => !url.startsWith('data:') && !url.startsWith('blob:'));
  expect(
    nonDataRequests,
    `no network request may be made while previewing hostile Markdown: ${nonDataRequests.join(', ')}`,
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

  // Scoped to the Output section, not the whole page: the Input panel's own
  // textarea legitimately echoes back the visitor's pasted text (HTML-
  // entity-escaped, inert) verbatim, which would otherwise false-positive
  // on this same pattern.
  const outputHtml = await page.locator('section[aria-label="Output"]').innerHTML();
  expect(outputHtml.toLowerCase()).not.toMatch(/<script/);
  expect(outputHtml).not.toMatch(/\son\w+\s*=/i);
});

test('markdown-html preview renders headings and a GFM table for benign Markdown', async ({ page }) => {
  await page.goto(rel('/tools/markdown-html'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  await page.locator('#f-input').fill('# Hi\n\n| foo | bar |\n| --- | --- |\n| baz | bim |');

  await page.waitForTimeout(200);
  await expect(page.locator('section[aria-label="Output"]')).toHaveAttribute('aria-busy', 'false', {
    timeout: 15_000,
  });

  const frame = page.locator('iframe.preview-frame').first();
  await expect(frame).toHaveCount(1);
  const srcDoc = (await frame.getAttribute('srcdoc')) ?? '';
  expect(srcDoc).toContain('<h1');
  expect(srcDoc).toContain('<table');
  expect(srcDoc).toContain('baz');
});

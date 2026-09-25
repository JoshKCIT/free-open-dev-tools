import { test, expect } from '@playwright/test';

/**
 * The sandbox-proof shape later sanitising plans (`markdown-html`, `bbcode`)
 * copy: a hostile piece of markup is driven through the tool page's real
 * input, and this file proves the result renders only inside the sandboxed
 * preview frame with the sandbox attribute empty, no dialog is raised, no
 * script runs, and no network request is made -- on all four browser
 * projects, per D-72 and success criterion 3.
 */
const rel = (path: string) => path.replace(/^\//, '');

test('svg-optimizer shows a hostile SVG only inside the sandboxed preview and nothing runs', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });

  await page.goto(rel('/tools/svg-optimizer'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  const requestsAfterLoad: string[] = [];
  page.on('request', (request) => {
    requestsAfterLoad.push(request.url());
  });

  const hostileSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
    '<rect width="10" height="10" onload="top.__fodtXss = 1"/>' +
    '<script>top.__fodtXss = 1;</script>' +
    '<image href="https://example.invalid/x.png"/>' +
    '</svg>';

  await page.locator('#f-input').fill(hostileSvg);

  // Clears the auto-run debounce, then waits for the Output section's own
  // busy signal to clear -- the same two-stage wait e2e/privacy.spec.ts uses.
  await page.waitForTimeout(200);
  await expect(page.locator('section[aria-label="Output"]')).toHaveAttribute('aria-busy', 'false', {
    timeout: 15_000,
  });

  expect(dialogs, 'no dialog should ever be raised by rendering a hostile SVG').toEqual([]);

  const xssMark = await page.evaluate(() => (window as unknown as { __fodtXss?: unknown }).__fodtXss);
  expect(xssMark, 'the top-level window must never be reached by anything inside the sandboxed preview').toBe(
    undefined,
  );

  const nonDataRequests = requestsAfterLoad.filter((url) => !url.startsWith('data:') && !url.startsWith('blob:'));
  expect(
    nonDataRequests,
    `no network request may be made while previewing a hostile SVG: ${nonDataRequests.join(', ')}`,
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
  expect(outputHtml.toLowerCase()).not.toMatch(/<svg[^>]*script|svg:script/);
  expect(outputHtml).not.toMatch(/\son\w+\s*=/i);
});

test('svg-optimizer preview renders the sanitised markup for a benign SVG', async ({ page }) => {
  await page.goto(rel('/tools/svg-optimizer'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  await page
    .locator('#f-input')
    .fill(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#00aa00"/></svg>',
    );

  await page.waitForTimeout(200);
  await expect(page.locator('section[aria-label="Output"]')).toHaveAttribute('aria-busy', 'false', {
    timeout: 15_000,
  });

  const frame = page.locator('iframe.preview-frame').first();
  await expect(frame).toHaveCount(1);
  const srcDoc = (await frame.getAttribute('srcdoc')) ?? '';
  // The optimiser's own preset-default converts basic shapes (rect, circle,
  // ...) to a <path>, so the shape survives as a path, not literally <rect>.
  expect(srcDoc.toLowerCase()).toContain('<path');
  expect(srcDoc).toContain('svg');
});

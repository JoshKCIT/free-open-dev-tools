import { test, expect } from '@playwright/test';

/**
 * Proves, on all four browser projects, that the social preview is built
 * only from the visitor's typed fields and never loads the image URL, runs
 * a script, or renders outside the sandboxed frame (D-92, success
 * criterion 4). Shaped like `e2e/svg-optimizer.spec.ts`.
 */
const rel = (path: string) => path.replace(/^\//, '');

test('meta-tags shows the social preview from typed fields only and never loads the image URL', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });

  await page.goto(rel('/tools/meta-tags'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  const requestsAfterLoad: string[] = [];
  page.on('request', (request) => {
    requestsAfterLoad.push(request.url());
  });

  await page.locator('#f-title').fill('"><img src=x onerror="top.__fodtXss=1">');
  await page.locator('#f-description').fill('<script>top.__fodtXss=1</script>');
  await page.locator('#f-imageUrl').fill('https://example.invalid/card.png');
  await page.locator('#f-canonical').fill('https://example.invalid/page');

  // Clears the auto-run debounce, then waits for the Output section's own
  // busy signal to clear -- the same two-stage wait e2e/privacy.spec.ts uses.
  await page.waitForTimeout(200);
  await expect(page.locator('section[aria-label="Output"]')).toHaveAttribute('aria-busy', 'false', {
    timeout: 15_000,
  });

  expect(dialogs, 'no dialog should ever be raised by rendering the social preview').toEqual([]);

  const xssMark = await page.evaluate(() => (window as unknown as { __fodtXss?: unknown }).__fodtXss);
  expect(xssMark, 'the top-level window must never be reached by anything inside the sandboxed preview').toBe(
    undefined,
  );

  const nonDataRequests = requestsAfterLoad.filter((url) => !url.startsWith('data:') && !url.startsWith('blob:'));
  expect(
    nonDataRequests,
    `no network request may be made while previewing the social cards: ${nonDataRequests.join(', ')}`,
  ).toEqual([]);

  const frames = page.locator('iframe.preview-frame');
  const frameCount = await frames.count();
  expect(frameCount, 'the sanitised preview must render in a sandboxed frame').toBeGreaterThan(0);
  for (let i = 0; i < frameCount; i++) {
    const sandbox = await frames.nth(i).getAttribute('sandbox');
    expect(sandbox, 'a preview frame must carry an empty sandbox attribute').toBe('');
  }

  for (let i = 0; i < frameCount; i++) {
    const frame = frames.nth(i);
    const violation = await frame.evaluate((el) => {
      const srcdoc = (el as HTMLIFrameElement).getAttribute('srcdoc') ?? '';
      const doc = new DOMParser().parseFromString(srcdoc, 'text/html');
      const bad: string[] = [];
      if (doc.querySelector('img')) bad.push('img element present');
      if (doc.querySelector('script')) bad.push('script element present');
      for (const el2 of Array.from(doc.querySelectorAll('*'))) {
        for (const attr of Array.from(el2.attributes)) {
          if (['src', 'href', 'srcset', 'poster'].includes(attr.name)) bad.push(`element carries ${attr.name}`);
          if (attr.name.toLowerCase().startsWith('on')) bad.push(`element carries ${attr.name}`);
        }
      }
      const bodyText = doc.body?.textContent ?? '';
      return { bad, hasCardUrl: bodyText.includes('example.invalid/card.png') };
    });
    expect(violation.bad, `frame ${i}: ${violation.bad.join(', ')}`).toEqual([]);
    expect(violation.hasCardUrl, 'the image URL must appear as text in the preview').toBe(true);
  }

  const mainOutsideFrames = page.locator('main');
  const mainHandles = await mainOutsideFrames.evaluateAll((mains) =>
    mains.flatMap((main) =>
      Array.from(main.querySelectorAll('[src],[href]'))
        .map((el) => el.getAttribute('src') ?? el.getAttribute('href') ?? '')
        .filter((v) => v.includes('example.invalid')),
    ),
  );
  expect(mainHandles, 'main outside the sandboxed frames must never carry example.invalid in a src or href').toEqual(
    [],
  );
});

test('meta-tags preview shows the typed title and description', async ({ page }) => {
  await page.goto(rel('/tools/meta-tags'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  await page.locator('#f-title').fill('The Rock');
  await page.locator('#f-description').fill('A story about a movie.');

  await page.waitForTimeout(200);
  await expect(page.locator('section[aria-label="Output"]')).toHaveAttribute('aria-busy', 'false', {
    timeout: 15_000,
  });

  const frame = page.locator('iframe.preview-frame').first();
  await expect(frame).toHaveCount(1);
  const srcDoc = (await frame.getAttribute('srcdoc')) ?? '';
  expect(srcDoc).toContain('The Rock');
  expect(srcDoc).toContain('A story about a movie.');
});

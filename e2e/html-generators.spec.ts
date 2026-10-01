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

/** A real-shaped address, typed into address fields to prove it is never requested. */
const VISITOR_URL = 'https://example.invalid/nothing-sent?q=1#f';

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

/** The roles Playwright can ask for by accessible name, for the controls whose role is unambiguous. */
const ROLE_OF: Record<string, string> = {
  text: 'textbox',
  checkbox: 'checkbox',
  select: 'combobox',
  number: 'spinbutton',
  range: 'slider',
  submit: 'button',
};

/** What the markup of a control must contain, so a run for the previous control is never mistaken for this one. */
function markupNeedle(kind: string): string {
  if (kind === 'textarea') return '<textarea';
  if (kind === 'select') return '<select';
  return `type="${kind}"`;
}

/** Selects a control on the form field page and fills the fields every control needs. */
async function chooseControl(page: Page, kind: string, extra: Record<string, string> = {}): Promise<void> {
  await page.locator('#f-control').selectOption(kind);
  const fields: Record<string, string> = { name: 'field1', ...extra };
  if (kind !== 'hidden') fields.label ??= 'Field label';
  if (kind === 'select' || kind === 'radio') fields.options ??= 'a | Alpha\nb | Beta';
  if (kind === 'image') {
    fields.src ??= 'button.png';
    fields.alt ??= 'Go';
  }
  for (const [field, value] of Object.entries(fields)) await page.locator(`#f-${field}`).fill(value);
  await expect(page.locator('section[aria-label="Output"] pre.output').first()).toContainText(markupNeedle(kind));
  await settle(page);
}

test('form-field-builder: every control the page builds gets its accessible name from its label in this browser', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(rel('/tools/form-field-builder'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
  const kinds = await page
    .locator('#f-control option')
    .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
  expect(kinds, 'the page offers the 24 controls').toHaveLength(24);

  const requests = await withRequestRecorder(page, async () => {
    for (const kind of kinds) {
      await chooseControl(page, kind);
      if (kind === 'hidden') {
        const output = await page.locator('section[aria-label="Output"]').innerText();
        const markup = await page.locator('section[aria-label="Output"] pre.output').first().innerText();
        expect(markup, 'a hidden input is not labelable, so it has no label').not.toContain('<label');
        expect(output, 'a note says why').toContain('labelable');
        continue;
      }
      const preview = page.frameLocator('iframe.preview-frame').first();
      if (kind === 'radio') {
        await expect(preview.getByLabel('Alpha', { exact: true }), kind).toHaveCount(1);
        await expect(preview.getByRole('group', { name: 'Field label', exact: true }), kind).toHaveCount(1);
        continue;
      }
      await expect(preview.getByLabel('Field label', { exact: true }), kind).toHaveCount(1);
      const role = ROLE_OF[kind];
      if (role)
        await expect(preview.getByRole(role as 'textbox', { name: 'Field label', exact: true }), kind).toHaveCount(1);
    }
  });
  expect(requests, `no request may be made while building the controls: ${requests.join(', ')}`).toEqual([]);
});

test('form-field-builder: an address typed into the image button source is never requested and never reaches the preview', async ({
  page,
}) => {
  await page.goto(rel('/tools/form-field-builder'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  const requests = await withRequestRecorder(page, async () => {
    // Every visible field whose syntax allows an address gets the visitor address; width, height and flags
    // only accept their own syntax, so they stay blank.
    await chooseControl(page, 'image', {
      label: VISITOR_URL,
      name: VISITOR_URL,
      id: VISITOR_URL,
      title: VISITOR_URL,
      src: VISITOR_URL,
      alt: 'Go',
    });
  });
  expect(requests, `an address typed into a field must never be requested: ${requests.join(', ')}`).toEqual([]);

  for (const srcdoc of await previewSrcdocs(page)) {
    expect(await scanPreview(page, srcdoc)).toEqual([]);
    expect(srcdoc, 'the preview carries a data placeholder in place of the address').toContain(
      'src="data:image/svg+xml,',
    );
  }
  const markup = await page.locator('section[aria-label="Output"] pre.output').first().innerText();
  expect(markup, 'the copyable markup keeps the address exactly as typed').toContain(`src="${VISITOR_URL}"`);
});

test('form-field-builder: clicking every control in the preview requests nothing and leaves the preview in place', async ({
  page,
}) => {
  await page.goto(rel('/tools/form-field-builder'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  for (const kind of ['submit', 'image', 'checkbox', 'select']) {
    await chooseControl(page, kind);
    const handle = await page.locator('iframe.preview-frame').first().elementHandle();
    const frame = await handle!.contentFrame();
    expect(frame, `the preview frame of ${kind} can be reached`).not.toBeNull();
    const countBefore = await frame!.evaluate(() => document.body.querySelectorAll('*').length);
    expect(countBefore, `${kind} preview holds elements`).toBeGreaterThan(0);

    const requests = await withRequestRecorder(page, async () => {
      const targets = frame!.locator('a, button, input, label, select');
      const total = await targets.count();
      expect(total, `${kind} preview has something to click`).toBeGreaterThan(0);
      for (let i = 0; i < total; i++) await targets.nth(i).click({ timeout: 5_000 });
      await page.waitForTimeout(300);
    });
    expect(requests, `clicking in the ${kind} preview must request nothing: ${requests.join(', ')}`).toEqual([]);
    expect(frame!.url(), `the ${kind} preview stays on its own document`).toBe('about:srcdoc');
    const countAfter = await frame!.evaluate(() => document.body.querySelectorAll('*').length);
    expect(countAfter, `the ${kind} preview still holds the same elements`).toBe(countBefore);
  }
});

test('link-builder: hostile text in every field comes out as text, runs nothing and requests nothing', async ({
  page,
}) => {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });

  await page.goto(rel('/tools/link-builder'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  const requests = await withRequestRecorder(page, async () => {
    await page.locator('#f-kind').selectOption('mailto');
    for (const field of ['text', 'to', 'body']) await page.locator(`#f-${field}`).fill(HOSTILE);
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

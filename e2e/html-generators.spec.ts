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

/**
 * The values each link-builder kind is typed with in the browser tests. A field that takes any text gets the hostile
 * value; a field whose syntax is checked (a phone number, an extension, a rel value, a recipient) gets a valid value, so
 * the page still builds a link and the markup can be read.
 */
const LINK_KINDS_UNDER_TEST: {
  kind: string;
  free: string[];
  valid: Record<string, string>;
  checks?: string[];
}[] = [
  { kind: 'web', free: ['text', 'href', 'downloadName'], valid: { relOther: 'license' }, checks: ['download'] },
  { kind: 'mailto', free: ['text', 'to', 'cc', 'bcc', 'subject', 'body'], valid: {} },
  { kind: 'tel', free: ['text'], valid: { phone: '+1-201-555-0123', ext: '12' } },
  { kind: 'sms', free: ['text', 'smsBody'], valid: { recipients: '+15105550101' } },
];

/** Selects a link type and fills its fields, then waits for the result to settle. */
async function buildLinkOnPage(
  page: Page,
  entry: (typeof LINK_KINDS_UNDER_TEST)[number],
  freeValue: string,
): Promise<void> {
  await page.locator('#f-kind').selectOption(entry.kind);
  for (const field of entry.checks ?? []) await page.locator(`#f-${field}`).check();
  for (const [field, value] of Object.entries(entry.valid)) await page.locator(`#f-${field}`).fill(value);
  for (const field of entry.free) await page.locator(`#f-${field}`).fill(freeValue);
  await settle(page);
}

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

  for (const entry of LINK_KINDS_UNDER_TEST) {
    const requests = await withRequestRecorder(page, async () => {
      await buildLinkOnPage(page, entry, HOSTILE);
    });

    expect(dialogs, `${entry.kind}: no dialog may be raised by rendering the markup or the preview`).toEqual([]);
    const xssMark = await page.evaluate(() => (window as unknown as { __fodtXss?: unknown }).__fodtXss);
    expect(xssMark, `${entry.kind}: nothing typed may reach or run in the top-level window`).toBe(undefined);
    expect(requests, `${entry.kind}: no request may be made while typing: ${requests.join(', ')}`).toEqual([]);

    const frames = page.locator('iframe.preview-frame');
    const frameCount = await frames.count();
    expect(frameCount, `${entry.kind}: the preview must render in a frame`).toBeGreaterThan(0);
    for (let i = 0; i < frameCount; i++) {
      expect(
        await frames.nth(i).getAttribute('sandbox'),
        `${entry.kind}: a preview frame must carry an empty sandbox attribute`,
      ).toBe('');
    }
    for (const srcdoc of await previewSrcdocs(page)) {
      expect(await scanPreview(page, srcdoc), `${entry.kind}: the preview must carry no address or handler`).toEqual(
        [],
      );
    }

    const markup = await page.locator('section[aria-label="Output"] pre.output').first().innerText();
    expect(markup, `${entry.kind}: the markup holds the text escaped`).toContain('&lt;script&gt;');
  }
});

test('link-builder: a web address typed into the link is never requested, never reaches the preview and is copied exactly as typed', async ({
  page,
}) => {
  await page.goto(rel('/tools/link-builder'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  const requests = await withRequestRecorder(page, async () => {
    await page.locator('#f-kind').selectOption('web');
    await page.locator('#f-download').check();
    await page.locator('#f-text').fill('Word');
    await page.locator('#f-relOther').fill('license');
    await page.locator('#f-downloadName').fill('report.pdf');
    await page.locator('#f-href').fill(VISITOR_URL);
    await settle(page);
    await expect(page.locator('section[aria-label="Output"] pre.output').first()).toContainText(VISITOR_URL);
  });
  expect(requests, `an address typed into a field must never be requested: ${requests.join(', ')}`).toEqual([]);

  const srcdocs = await previewSrcdocs(page);
  expect(srcdocs.length, 'the preview must render in a frame').toBeGreaterThan(0);
  for (const srcdoc of srcdocs) {
    expect(await scanPreview(page, srcdoc)).toEqual([]);
    expect(srcdoc, 'the preview holds no part of the typed address').not.toContain('example.invalid');
  }
  const markup = await page.locator('section[aria-label="Output"] pre.output').first().innerText();
  expect(markup, 'the copyable markup keeps the address exactly as typed').toContain(
    'href="https://example.invalid/nothing-sent?q=1#f"',
  );
  expect(markup.trim(), 'only the chosen attributes are written').toBe(
    '<a href="https://example.invalid/nothing-sent?q=1#f" rel="license" download="report.pdf">Word</a>',
  );
});

test('link-builder: clicking the link in the preview requests nothing and leaves the preview in place', async ({
  page,
}) => {
  await page.goto(rel('/tools/link-builder'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  for (const entry of LINK_KINDS_UNDER_TEST) {
    // A web link is built with a real-shaped address in its address field; the others take plain words.
    await buildLinkOnPage(page, entry, entry.kind === 'web' ? VISITOR_URL : 'plain');
    const handle = await page.locator('iframe.preview-frame').first().elementHandle();
    const frame = await handle!.contentFrame();
    expect(frame, `the ${entry.kind} preview frame can be reached`).not.toBeNull();
    const links = frame!.locator('a');
    const total = await links.count();
    expect(total, `the ${entry.kind} preview holds a link`).toBeGreaterThan(0);
    const countBefore = await frame!.evaluate(() => document.body.querySelectorAll('*').length);

    const requests = await withRequestRecorder(page, async () => {
      for (let i = 0; i < total; i++) await links.nth(i).click({ timeout: 5_000 });
      await page.waitForTimeout(300);
    });
    expect(requests, `clicking in the ${entry.kind} preview must request nothing: ${requests.join(', ')}`).toEqual([]);
    expect(frame!.url(), `the ${entry.kind} preview stays on its own document`).toBe('about:srcdoc');
    expect(await frame!.locator('a').count(), `the ${entry.kind} preview still holds its link`).toBe(total);
    const countAfter = await frame!.evaluate(() => document.body.querySelectorAll('*').length);
    expect(countAfter, `the ${entry.kind} preview still holds the same elements`).toBe(countBefore);
  }
});

/**
 * The values each semantic-html-builder element is typed with in the browser tests. A field that takes any text gets the
 * hostile value; a field whose syntax is checked (a date, a number, a keyword) gets a valid value, so the page still
 * builds an element and the markup can be read.
 */
const ELEMENTS_UNDER_TEST: { element: string; free: string[]; valid: Record<string, string> }[] = [
  { element: 'time', free: ['content'], valid: { datetime: '2011-11-18' } },
  { element: 'details', free: ['summary', 'paragraphs', 'group'], valid: {} },
  { element: 'dialog', free: ['paragraphs', 'closeLabel'], valid: { id: 'sure' } },
  { element: 'meter', free: ['label', 'title', 'content'], valid: { value: '0.5' } },
  { element: 'progress', free: ['label', 'content'], valid: { value: '5', max: '10' } },
  {
    element: 'blockquote',
    free: ['paragraphs', 'attribution', 'workTitle', 'citeUrl'],
    valid: {},
  },
  { element: 'figure', free: ['imageUrl', 'alt', 'caption'], valid: { width: '320', height: '200' } },
  { element: 'abbr', free: ['content', 'title'], valid: {} },
  { element: 'mark', free: ['before', 'content', 'after'], valid: {} },
  { element: 'sub', free: ['before', 'content', 'after'], valid: {} },
  { element: 'sup', free: ['before', 'content', 'after'], valid: {} },
  {
    element: 'del',
    free: ['before', 'content', 'after', 'citeUrl'],
    valid: { datetime: '2009-10-11T01:25-07:00' },
  },
  { element: 'ins', free: ['before', 'content', 'after', 'citeUrl'], valid: { datetime: '2005-03-16 00:00Z' } },
  { element: 'kbd', free: ['before', 'content', 'after'], valid: {} },
];

/** Selects an element and fills its fields, then waits for the result to settle. */
async function buildSemanticElementOnPage(
  page: Page,
  entry: (typeof ELEMENTS_UNDER_TEST)[number],
  freeValue: string,
): Promise<void> {
  await page.locator('#f-element').selectOption(entry.element);
  for (const [field, value] of Object.entries(entry.valid)) await page.locator(`#f-${field}`).fill(value);
  for (const field of entry.free) await page.locator(`#f-${field}`).fill(freeValue);
  await settle(page);
}

test('semantic-html-builder: hostile text in every field comes out as text, runs nothing and requests nothing', async ({
  page,
}) => {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });

  await page.goto(rel('/tools/semantic-html-builder'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  for (const entry of ELEMENTS_UNDER_TEST) {
    const requests = await withRequestRecorder(page, async () => {
      await buildSemanticElementOnPage(page, entry, HOSTILE);
    });

    expect(dialogs, `${entry.element}: no dialog may be raised by rendering the markup or the preview`).toEqual([]);
    const xssMark = await page.evaluate(() => (window as unknown as { __fodtXss?: unknown }).__fodtXss);
    expect(xssMark, `${entry.element}: nothing typed may reach or run in the top-level window`).toBe(undefined);
    expect(requests, `${entry.element}: no request may be made while typing: ${requests.join(', ')}`).toEqual([]);

    const frames = page.locator('iframe.preview-frame');
    const frameCount = await frames.count();
    expect(frameCount, `${entry.element}: the preview must render in a frame`).toBeGreaterThan(0);
    for (let i = 0; i < frameCount; i++) {
      expect(
        await frames.nth(i).getAttribute('sandbox'),
        `${entry.element}: a preview frame must carry an empty sandbox attribute`,
      ).toBe('');
    }
    for (const srcdoc of await previewSrcdocs(page)) {
      expect(await scanPreview(page, srcdoc), `${entry.element}: the preview must carry no address or handler`).toEqual(
        [],
      );
    }

    const markup = await page.locator('section[aria-label="Output"] pre.output').first().innerText();
    expect(markup, `${entry.element}: the markup holds the text escaped`).toContain('&lt;script&gt;');
  }
});

test('semantic-html-builder: a meter and a progress bar built by the page are found by role and label in this browser', async ({
  page,
}) => {
  await page.goto(rel('/tools/semantic-html-builder'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  const requests = await withRequestRecorder(page, async () => {
    await page.locator('#f-element').selectOption('meter');
    await page.locator('#f-label').fill('Disk usage');
    await page.locator('#f-value').fill('0.6');
    await page.locator('#f-content').fill('60 percent');
    await expect(page.locator('section[aria-label="Output"] pre.output').first()).toContainText('<meter');
    await settle(page);
    const meterFrame = page.frameLocator('iframe.preview-frame').first();
    await expect(meterFrame.getByRole('meter', { name: 'Disk usage', exact: true })).toHaveCount(1);
    await expect(meterFrame.getByLabel('Disk usage', { exact: true })).toHaveCount(1);

    await page.locator('#f-element').selectOption('progress');
    await page.locator('#f-label').fill('Upload');
    await page.locator('#f-value').fill('70');
    await page.locator('#f-max').fill('100');
    await expect(page.locator('section[aria-label="Output"] pre.output').first()).toContainText('<progress');
    await settle(page);
    const progressFrame = page.frameLocator('iframe.preview-frame').first();
    await expect(progressFrame.getByRole('progressbar', { name: 'Upload', exact: true })).toHaveCount(1);
    await expect(progressFrame.getByLabel('Upload', { exact: true })).toHaveCount(1);
  });
  expect(requests, `no request may be made while building the gauges: ${requests.join(', ')}`).toEqual([]);
});

test('semantic-html-builder: clicking the summary and the dialog close button in the preview requests nothing and leaves the preview in place', async ({
  page,
}, testInfo) => {
  await page.goto(rel('/tools/semantic-html-builder'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  // details: clicking the summary may open or close it, but the frame stays on its own document with its details.
  await page.locator('#f-element').selectOption('details');
  await page.locator('#f-summary').fill('More');
  await page.locator('#f-paragraphs').fill('Hidden text');
  await expect(page.locator('section[aria-label="Output"] pre.output').first()).toContainText('<details');
  await settle(page);
  let handle = await page.locator('iframe.preview-frame').first().elementHandle();
  let frame = await handle!.contentFrame();
  expect(frame, 'the details preview frame can be reached').not.toBeNull();
  let requests = await withRequestRecorder(page, async () => {
    await frame!.locator('summary').click({ timeout: 5_000 });
    await page.waitForTimeout(300);
  });
  expect(requests, `clicking the summary must request nothing: ${requests.join(', ')}`).toEqual([]);
  expect(frame!.url(), 'the details preview stays on its own document').toBe('about:srcdoc');
  expect(await frame!.locator('details').count(), 'the preview still holds its details').toBe(1);

  // dialog: the close button may close the dialog (some browsers) or do nothing, but never navigates or requests.
  await page.locator('#f-element').selectOption('dialog');
  await page.locator('#f-paragraphs').fill('Hello there');
  await expect(page.locator('section[aria-label="Output"] pre.output').first()).toContainText('<dialog');
  await settle(page);
  handle = await page.locator('iframe.preview-frame').first().elementHandle();
  frame = await handle!.contentFrame();
  expect(frame, 'the dialog preview frame can be reached').not.toBeNull();
  expect(await frame!.locator('dialog[open]').count(), 'the preview shows the dialog open').toBe(1);
  requests = await withRequestRecorder(page, async () => {
    await frame!.getByRole('button', { name: 'Close', exact: true }).click({ timeout: 5_000 });
    await page.waitForTimeout(300);
  });
  expect(requests, `clicking the close button must request nothing: ${requests.join(', ')}`).toEqual([]);
  expect(frame!.url(), 'the dialog preview stays on its own document').toBe('about:srcdoc');
  expect(await frame!.locator('dialog').count(), 'the preview still holds its dialog').toBe(1);
  const closed = (await frame!.locator('dialog[open]').count()) === 0;
  testInfo.annotations.push({
    type: 'dialog-closed-by-preview-button',
    description: `${testInfo.project.name}: ${closed}`,
  });
  console.log(`dialog-closed-by-preview-button ${testInfo.project.name}: ${closed}`);
});

test('semantic-html-builder: addresses typed into the citation and image fields are never requested and never reach the preview', async ({
  page,
}) => {
  await page.goto(rel('/tools/semantic-html-builder'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  const cases: { element: string; fields: Record<string, string>; needle: string; attribute: string }[] = [
    {
      element: 'blockquote',
      fields: { paragraphs: 'Quoted words', citeUrl: VISITOR_URL },
      needle: '<blockquote',
      attribute: 'cite',
    },
    {
      element: 'figure',
      fields: { imageUrl: VISITOR_URL, alt: 'A chart', caption: 'Sales' },
      needle: '<figure',
      attribute: 'src',
    },
    {
      element: 'del',
      fields: { content: 'old', citeUrl: VISITOR_URL },
      needle: '<del',
      attribute: 'cite',
    },
  ];

  for (const { element, fields, needle, attribute } of cases) {
    const requests = await withRequestRecorder(page, async () => {
      await page.locator('#f-element').selectOption(element);
      for (const [field, value] of Object.entries(fields)) await page.locator(`#f-${field}`).fill(value);
      await expect(page.locator('section[aria-label="Output"] pre.output').first()).toContainText(needle);
      await settle(page);
    });
    expect(
      requests,
      `${element}: an address typed into a field must never be requested: ${requests.join(', ')}`,
    ).toEqual([]);

    const srcdocs = await previewSrcdocs(page);
    expect(srcdocs.length, `${element}: the preview must render in a frame`).toBeGreaterThan(0);
    for (const srcdoc of srcdocs) {
      expect(await scanPreview(page, srcdoc), `${element}: the preview carries no address`).toEqual([]);
      expect(srcdoc, `${element}: the preview holds no part of the typed address`).not.toContain('example.invalid');
    }
    const markup = await page.locator('section[aria-label="Output"] pre.output').first().innerText();
    expect(markup, `${element}: the copyable markup keeps the address exactly as typed`).toContain(
      `${attribute}="${VISITOR_URL}"`,
    );
  }
});

/** Media kinds the media page is driven through, with the fields each one fills; `HOSTILE` stands for the free text. */
const MEDIA_UNDER_TEST: { kind: string; fields: Record<string, string>; needle: string }[] = [
  {
    kind: 'video',
    fields: {
      src: 'HOSTILE',
      poster: 'HOSTILE',
      width: '640',
      height: '360',
      tracks: 'brave.en.vtt | subtitles | en | HOSTILE',
      fallback: 'HOSTILE',
    },
    needle: '<video',
  },
  {
    kind: 'audio',
    fields: {
      src: '',
      mediaSources: 'HOSTILE | audio/ogg | HOSTILE',
      tracks: 'song.en.vtt | captions | en | HOSTILE',
      fallback: 'HOSTILE',
    },
    needle: '<audio',
  },
  {
    kind: 'image',
    fields: {
      imageSrc: 'HOSTILE',
      srcset: 'javascript:alert(1) 1x',
      sizes: '',
      alt: 'HOSTILE',
      width: '320',
      height: '200',
    },
    needle: '<img',
  },
  {
    kind: 'picture',
    fields: {
      imageSrc: 'HOSTILE',
      pictureSources: 'javascript:alert(1) 1x | image/webp | HOSTILE',
      srcset: '',
      sizes: '',
      alt: 'HOSTILE',
      width: '320',
      height: '200',
    },
    needle: '<picture',
  },
];

/** Selects a media kind and fills its fields, replacing HOSTILE with the given text, then waits for the result. */
async function buildMediaOnPage(
  page: Page,
  entry: (typeof MEDIA_UNDER_TEST)[number],
  freeValue: string,
): Promise<void> {
  await page.locator('#f-kind').selectOption(entry.kind);
  for (const [field, value] of Object.entries(entry.fields)) {
    await page.locator(`#f-${field}`).fill(value.split('HOSTILE').join(freeValue));
  }
  await expect(page.locator('section[aria-label="Output"] pre.output').first()).toContainText(entry.needle);
  await settle(page);
}

test('media-embed-builder: hostile text in every field comes out as text, runs nothing and requests nothing', async ({
  page,
}) => {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });

  await page.goto(rel('/tools/media-embed-builder'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  for (const entry of MEDIA_UNDER_TEST) {
    const requests = await withRequestRecorder(page, async () => {
      await buildMediaOnPage(page, entry, HOSTILE);
    });

    expect(dialogs, `${entry.kind}: no dialog may be raised by rendering the markup or the preview`).toEqual([]);
    const xssMark = await page.evaluate(() => (window as unknown as { __fodtXss?: unknown }).__fodtXss);
    expect(xssMark, `${entry.kind}: nothing typed may reach or run in the top-level window`).toBe(undefined);
    expect(requests, `${entry.kind}: no request may be made while typing: ${requests.join(', ')}`).toEqual([]);

    const frames = page.locator('iframe.preview-frame');
    const frameCount = await frames.count();
    expect(frameCount, `${entry.kind}: the preview must render in a frame`).toBeGreaterThan(0);
    for (let i = 0; i < frameCount; i++) {
      expect(
        await frames.nth(i).getAttribute('sandbox'),
        `${entry.kind}: a preview frame must carry an empty sandbox attribute`,
      ).toBe('');
    }
    for (const srcdoc of await previewSrcdocs(page)) {
      expect(await scanPreview(page, srcdoc), `${entry.kind}: the preview must carry no address or handler`).toEqual(
        [],
      );
    }

    const markup = await page.locator('section[aria-label="Output"] pre.output').first().innerText();
    expect(markup, `${entry.kind}: the markup holds the text escaped`).toContain('&lt;script&gt;');
  }
});

test('media-embed-builder: addresses typed into every video and audio field are never requested and never reach the preview', async ({
  page,
}) => {
  await page.goto(rel('/tools/media-embed-builder'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  const cases: { kind: string; fields: Record<string, string>; needle: string; poster: boolean }[] = [
    {
      kind: 'video',
      fields: {
        src: '',
        mediaSources: `${VISITOR_URL} | video/webm`,
        poster: VISITOR_URL,
        tracks: `${VISITOR_URL} | captions | en | English`,
      },
      needle: '<video',
      poster: true,
    },
    {
      kind: 'audio',
      fields: {
        src: '',
        mediaSources: `${VISITOR_URL} | audio/ogg`,
        tracks: `${VISITOR_URL} | captions | en | English`,
      },
      needle: '<audio',
      poster: false,
    },
  ];

  for (const { kind, fields, needle, poster } of cases) {
    const requests = await withRequestRecorder(page, async () => {
      await page.locator('#f-kind').selectOption(kind);
      for (const [field, value] of Object.entries(fields)) await page.locator(`#f-${field}`).fill(value);
      await expect(page.locator('section[aria-label="Output"] pre.output').first()).toContainText(needle);
      await settle(page);
    });
    expect(requests, `${kind}: an address typed into a field must never be requested: ${requests.join(', ')}`).toEqual(
      [],
    );

    const srcdocs = await previewSrcdocs(page);
    expect(srcdocs.length, `${kind}: the preview must render in a frame`).toBeGreaterThan(0);
    for (const srcdoc of srcdocs) {
      expect(await scanPreview(page, srcdoc), `${kind}: the preview carries no address`).toEqual([]);
      expect(srcdoc, `${kind}: the preview holds no part of the typed address`).not.toContain('example.invalid');
    }
    const markup = await page.locator('section[aria-label="Output"] pre.output').first().innerText();
    expect(markup, `${kind}: the copyable markup keeps the address exactly as typed`).toContain(VISITOR_URL);
    if (poster) expect(markup, `${kind}: the poster is copied as typed`).toContain(`poster="${VISITOR_URL}"`);
    expect(markup, `${kind}: the track address is copied as typed`).toContain(
      `<track kind="captions" src="${VISITOR_URL}"`,
    );

    const preview = page.frameLocator('iframe.preview-frame').first();
    await expect(
      preview.locator(`${kind}[controls]`),
      `${kind}: the preview holds the element with controls`,
    ).toHaveCount(1);
  }
});

test('media-embed-builder: addresses typed into every image and picture field are never requested and the preview shows a placeholder', async ({
  page,
}) => {
  await page.goto(rel('/tools/media-embed-builder'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  const cases: { kind: string; fields: Record<string, string>; needle: string; typed: string[] }[] = [
    {
      kind: 'image',
      fields: { imageSrc: VISITOR_URL, srcset: `${VISITOR_URL} 1x`, alt: 'A chart', width: '320', height: '200' },
      needle: '<img',
      typed: [`src="${VISITOR_URL}"`, `srcset="${VISITOR_URL} 1x"`],
    },
    {
      kind: 'picture',
      fields: {
        imageSrc: VISITOR_URL,
        pictureSources: `${VISITOR_URL} 1x | image/webp | (min-width: 1px)`,
        srcset: '',
        alt: 'A chart',
        width: '320',
        height: '200',
      },
      needle: '<picture',
      typed: [`src="${VISITOR_URL}"`, `<source srcset="${VISITOR_URL} 1x"`],
    },
  ];

  for (const { kind, fields, needle, typed } of cases) {
    const requests = await withRequestRecorder(page, async () => {
      await page.locator('#f-kind').selectOption(kind);
      for (const [field, value] of Object.entries(fields)) await page.locator(`#f-${field}`).fill(value);
      await expect(page.locator('section[aria-label="Output"] pre.output').first()).toContainText(needle);
      await settle(page);
    });
    expect(requests, `${kind}: an address typed into a field must never be requested: ${requests.join(', ')}`).toEqual(
      [],
    );

    const srcdocs = await previewSrcdocs(page);
    expect(srcdocs.length, `${kind}: the preview must render in a frame`).toBeGreaterThan(0);
    for (const srcdoc of srcdocs) {
      expect(await scanPreview(page, srcdoc), `${kind}: the preview carries no address`).toEqual([]);
      expect(srcdoc, `${kind}: the preview holds no part of the typed address`).not.toContain('example.invalid');
    }
    const markup = await page.locator('section[aria-label="Output"] pre.output').first().innerText();
    for (const part of typed) expect(markup, `${kind}: the markup keeps ${part} as typed`).toContain(part);

    const image = page.frameLocator('iframe.preview-frame').first().locator('img');
    await expect(image, `${kind}: the preview holds one img`).toHaveCount(1);
    expect(await image.getAttribute('src'), `${kind}: the preview img shows the placeholder`).toMatch(
      /^data:image\/svg\+xml/,
    );
    await expect
      .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth), {
        message: `${kind}: the placeholder has loaded in the frame`,
      })
      .toBeGreaterThan(0);
  }
});

test('media-embed-builder: clicking the media in the preview requests nothing and leaves the preview in place', async ({
  page,
}) => {
  await page.goto(rel('/tools/media-embed-builder'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  const cases: { kind: string; fields: Record<string, string>; needle: string; element: string }[] = [
    { kind: 'video', fields: { src: VISITOR_URL, width: '320', height: '200' }, needle: '<video', element: 'video' },
    { kind: 'audio', fields: { src: VISITOR_URL }, needle: '<audio', element: 'audio' },
    {
      kind: 'image',
      fields: { imageSrc: VISITOR_URL, alt: 'A chart', width: '320', height: '200' },
      needle: '<img',
      element: 'img',
    },
  ];

  for (const { kind, fields, needle, element } of cases) {
    await page.locator('#f-kind').selectOption(kind);
    for (const [field, value] of Object.entries(fields)) await page.locator(`#f-${field}`).fill(value);
    await expect(page.locator('section[aria-label="Output"] pre.output').first()).toContainText(needle);
    await settle(page);
    const handle = await page.locator('iframe.preview-frame').first().elementHandle();
    const frame = await handle!.contentFrame();
    expect(frame, `${kind}: the preview frame can be reached`).not.toBeNull();
    const requests = await withRequestRecorder(page, async () => {
      await frame!.locator(element).first().click({ timeout: 5_000 });
      await page.waitForTimeout(300);
    });
    expect(requests, `${kind}: clicking the media must request nothing: ${requests.join(', ')}`).toEqual([]);
    expect(frame!.url(), `${kind}: the preview stays on its own document`).toBe('about:srcdoc');
    expect(await frame!.locator(element).count(), `${kind}: the preview still holds its element`).toBe(1);
  }
});

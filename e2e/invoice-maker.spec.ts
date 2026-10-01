import { test, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

/**
 * The dedicated browser proof for the invoice and quote page: a real PDF is downloaded and read back with an
 * independent reader (the `pdfjs-dist` this tool's own folder declares, resolved with `createRequire` since it lives
 * only under that folder's `node_modules`, as `e2e/pdf-pages.spec.ts` does for the PDF page tools), nothing is sent,
 * nothing is stored, a reload starts empty, and a character the PDF fonts cannot write is refused by name. `rel()`,
 * the request recorder, `loadPdf`, `pageTextOf`, `outputOf` and `downloadAllBytes` are copied in shape from
 * `e2e/pdf-pages.spec.ts`.
 */
const rel = (path: string) => path.replace(/^\//, '');

const invoiceRequire = createRequire(new URL('../tools/invoice-maker/package.json', import.meta.url));
const PDFJS_PATH = invoiceRequire.resolve('pdfjs-dist/legacy/build/pdf.mjs');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsLibPromise: Promise<any> | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pdfjsLib(): Promise<any> {
  pdfjsLibPromise ??= import(pathToFileURL(PDFJS_PATH).href);
  return pdfjsLibPromise;
}

if (typeof (Promise as unknown as { try?: unknown }).try !== 'function') {
  (Promise as unknown as { try: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => Promise<unknown> }).try =
    function promiseTryPolyfill(fn, ...args) {
      return new Promise((resolve) => resolve(fn(...args)));
    };
}

async function loadPdf(bytes: Uint8Array): Promise<{
  doc: {
    numPages: number;
    getPage(n: number): Promise<{ getTextContent(): Promise<{ items: { str?: string }[] }> }>;
  };
  task: { destroy(): Promise<void> };
}> {
  const lib = await pdfjsLib();
  // A fresh, genuinely copied Uint8Array every call: PDF.js's own `data` option detaches the buffer it is given once
  // loading starts, and a Node `Buffer`'s own `.slice()` returns a view over the same memory, so `Uint8Array.from`.
  const task = lib.getDocument({ data: Uint8Array.from(bytes), useWorkerFetch: false, verbosity: 0 });
  const doc = await task.promise;
  return { doc, task };
}

async function pageTextOf(
  doc: { getPage(n: number): Promise<{ getTextContent(): Promise<{ items: { str?: string }[] }> }> },
  pageIndex: number,
): Promise<string> {
  const page = await doc.getPage(pageIndex + 1);
  const content = await page.getTextContent();
  return content.items.map((i) => i.str ?? '').join('');
}

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

function outputOf(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

async function downloadAllBytes(page: Page, count: number): Promise<Buffer[]> {
  const buttons = page.locator('section[aria-label="Output"] button', { hasText: 'Download' });
  const out: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    const downloadPromise = page.waitForEvent('download');
    await buttons.nth(i).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).not.toBeNull();
    out.push(readFileSync(path!));
  }
  return out;
}

/** The values the first-use fixture types: 2 x 19.99 and 1 x 5.00 with 10 percent off and 20 percent tax. */
const FIELDS: Record<string, string> = {
  number: '2026-001',
  issueDate: '2026-10-01',
  seller: 'Example Studio',
  buyer: 'Example Client',
  items: 'Widget | 2 | 19.99\nSetup | 1 | 5.00',
  discount: '10',
  taxRate: '20',
};

async function fillInvoice(page: Page, overrides: Record<string, string> = {}): Promise<void> {
  for (const [field, value] of Object.entries({ ...FIELDS, ...overrides })) {
    await page.locator(`#f-${field}`).fill(value);
  }
}

const downloadButtons = (page: Page) => page.locator('section[aria-label="Output"] button', { hasText: 'Download' });

test('invoice-maker: filling the form shows the totals and downloads a PDF whose text matches, with no request', async ({
  page,
}) => {
  await page.goto(rel('/tools/invoice-maker'));
  await page.waitForLoadState('networkidle');

  const requests = await withRequestRecorder(page, async () => {
    await fillInvoice(page);
    await expect(outputOf(page)).toContainText('48.58');
  });
  expect(requests).toEqual([]);
  for (const figure of ['44.98', '4.50', '8.10', '48.58']) await expect(outputOf(page)).toContainText(figure);
  await expect(downloadButtons(page)).toHaveCount(1);

  const downloadRequests = await withRequestRecorder(page, async () => {
    const [bytes] = await downloadAllBytes(page, 1);
    expect(bytes!.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const { doc, task } = await loadPdf(bytes!);
    expect(doc.numPages).toBe(1);
    const text = (await pageTextOf(doc, 0)).replace(/\s+/g, '');
    for (const wanted of ['ExampleStudio', 'ExampleClient', 'Widget', 'Setup', '48.58', 'Invoice2026-001']) {
      expect(text, `the PDF should contain ${wanted}`).toContain(wanted);
    }
    await task.destroy();
  });
  expect(downloadRequests).toEqual([]);
});

test('invoice-maker: nothing is stored and a reload starts empty', async ({ page }) => {
  await page.goto(rel('/tools/invoice-maker'));
  await page.waitForLoadState('networkidle');
  // Typed values that appear nowhere in the page's own placeholders and examples, so a leftover would be found.
  await fillInvoice(page, {
    number: 'ZX-4471',
    seller: 'Zebra Studio Ltd',
    buyer: 'Yak Client Inc',
    notes: 'Pay within 30 days',
    taxLabel: 'VAT',
    dueDate: '2026-10-31',
  });
  await page.locator('#f-currency').fill('EUR');
  await expect(outputOf(page)).toContainText('48.58');
  await downloadAllBytes(page, 1);

  const stored = await page.evaluate(() => {
    const local: string[] = [];
    for (let i = 0; i < localStorage.length; i++) local.push(localStorage.key(i)!);
    const session: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) session.push(sessionStorage.key(i)!);
    return { local, session, href: location.href };
  });
  // Nothing but the theme (which this page never touches) may be in local storage, and session storage stays empty.
  expect(stored.local.filter((key) => key !== 'fodt-theme')).toEqual([]);
  expect(stored.session).toEqual([]);
  expect(await page.context().cookies(), 'no cookie is set').toEqual([]);
  expect(stored.href, 'nothing typed goes in the address').not.toContain('ZX-4471');
  expect(stored.href).not.toContain('Zebra');

  await page.reload();
  await page.waitForLoadState('networkidle');

  // Every typed field is empty again; the only text field with a value is the currency, back at its default.
  const filled = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('main input[type="text"], main textarea')]
      .map((el) => ({ id: el.id, value: el.value }))
      .filter((el) => el.value !== ''),
  );
  expect(filled).toEqual([{ id: 'f-currency', value: 'USD' }]);
  const content = await page.content();
  for (const typed of ['Zebra Studio Ltd', 'Yak Client Inc', 'Pay within 30 days', 'ZX-4471']) {
    expect(content, `${typed} must not survive a reload`).not.toContain(typed);
  }
  await expect(downloadButtons(page)).toHaveCount(0);

  const after = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }));
  expect(after.session).toBe(0);
  expect(after.local).toBeLessThanOrEqual(1);
});

test('invoice-maker: a character outside WinAnsi is refused with its code point and no download is offered', async ({
  page,
}) => {
  await page.goto(rel('/tools/invoice-maker'));
  await page.waitForLoadState('networkidle');
  await fillInvoice(page);
  await expect(downloadButtons(page)).toHaveCount(1);

  const requests = await withRequestRecorder(page, async () => {
    await page.locator('#f-seller').fill('日本 Studio');
    await expect(outputOf(page)).toContainText('U+65E5');
  });
  expect(requests).toEqual([]);
  await expect(outputOf(page)).toContainText('Your name and address');
  await expect(outputOf(page)).toContainText('日');
  await expect(downloadButtons(page)).toHaveCount(0);
  // The totals of the refused run are not left on the page beside a file that was never built.
  await expect(outputOf(page)).not.toContainText('48.58');

  // Fixing the text brings the totals and the download back.
  await page.locator('#f-seller').fill('Example Studio');
  await expect(outputOf(page)).toContainText('48.58');
  await expect(downloadButtons(page)).toHaveCount(1);
});

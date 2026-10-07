import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { armCspProbe, describeFinding } from './csp-probe';

/**
 * The email viewer's own browser proofs (phase 18, WEB-05 and WEB-06, D-227), on all four projects.
 *
 * Why a spec of its own. The tool's page runs inside the privacy harness of e2e/privacy.spec.ts, which proves that nothing
 * the visitor types leaves the page. What that harness cannot see is what is specific to this tool, and each of those
 * things needs a real engine and the real production build:
 *  1. the message is read in a background worker that was started from a blob address, and the job is posted only after
 *     the worker has said it is ready (the worker is the one place a 25 MiB message is read);
 *  2. pressing Save on an attachment writes a file under its cleaned name whose bytes hash to the digest shown beside it;
 *  3. a hostile message makes no request outside the page's own files, raises no content policy violation, and a click on
 *     the text of its link leaves the closed preview where it was (about:srcdoc), because the link has no address left;
 *  4. a 26 MiB file is refused before any worker exists;
 *  5. pasted headers alone, with no body, still give the delivery hops and the authentication lines.
 *
 * The policy probe (e2e/csp-probe.ts) is armed before the page loads, as privacy.spec.ts does, and `bypassCSP` is never
 * set: a spec that switched the page's own policy off could not say anything about it. Messages are built here from
 * strings with CRLF line ends and handed to the page's own file input (pasted text uses plain line feeds); no message is
 * read from disk and nothing is uploaded. The one file the spec reads is the download its own Save click wrote.
 * The Worker wrapper below records, by composition, every construction and every message in either direction (the same
 * idea as e2e/dev-workers.spec.ts, copied in shape and never imported).
 */
const rel = (path: string) => path.replace(/^\//, '');

const CRLF = '\r\n';
/** Pasted text uses plain line feeds: one engine's text area keeps the line ends it is given and another changes them. */
const LF = '\n';
const message = (...lines: string[]): string => lines.join(CRLF) + CRLF;

/** The headers of the welcome message and nothing else: two Received lines, an Authentication-Results line and a signature. */
const HEADERS_ONLY = [
  'Received: from relay.example.net (relay.example.net [192.0.2.25])',
  '        by mx.example.org with ESMTPS id abc123',
  '        for <alice@example.org>; Tue, 06 Oct 2026 10:00:09 +0000',
  'Received: from sender.example.com (sender.example.com [192.0.2.10])',
  '        by relay.example.net with ESMTP id r1',
  '        for <alice@example.org>; Tue, 06 Oct 2026 10:00:03 +0000',
  'Authentication-Results: mx.example.org;',
  '        spf=pass smtp.mailfrom=example.com;',
  '        dkim=pass header.d=example.com header.s=sel1;',
  '        dmarc=pass header.from=example.com',
  'DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=example.com; s=sel1;',
  '        t=1791280800; x=1791367200; h=from:to:subject:date:message-id;',
  '        bh=47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=;',
  '        b=c2lnbmF0dXJlLW5vdC1yZWFs',
  'From: =?UTF-8?B?Sm9zw6kgQmFrZXI=?= <jose@example.com>',
  'To: Alice <alice@example.org>',
  'Subject: =?UTF-8?Q?Caf=C3=A9_menu?=',
  'Date: Tue, 06 Oct 2026 09:59:58 +0000',
  'Message-ID: <msg-1@example.com>',
].join(LF);

/** A small plain message, for the worker test. */
const PLAIN_MESSAGE = message(
  'From: Ann <ann@example.com>',
  'To: Bob <bob@example.org>',
  'Subject: Hello',
  'Date: Tue, 06 Oct 2026 09:00:00 +0000',
  'Message-ID: <plain-1@example.com>',
  'Received: from a.example by b.example; Tue, 06 Oct 2026 09:00:01 +0000',
  '',
  'Hello Bob.',
);

/** The bytes of the first attachment of the Save test, as Base64, and its file name. */
const REPORT_BASE64 = 'UXVhcnRlcmx5IGZpZ3VyZXM6IDQyIHVuaXRzIHNoaXBwZWQuCg==';
/** Twelve bytes, 0x00 to 0x0B, as Base64. */
const BINARY_BASE64 = 'AAECAwQFBgcICQoL';

/** Two attachments: a plain one, and one whose name holds a path, a colon and a question mark. */
const SAVE_MESSAGE = message(
  'From: Ann <ann@example.com>',
  'To: Bob <bob@example.org>',
  'Subject: Two attachments',
  'Date: Tue, 06 Oct 2026 09:00:00 +0000',
  'Message-ID: <save-1@example.com>',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="SAVE-1"',
  '',
  '--SAVE-1',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'See the files.',
  '--SAVE-1',
  'Content-Type: text/plain; name="report.txt"',
  'Content-Disposition: attachment; filename="report.txt"',
  'Content-Transfer-Encoding: base64',
  '',
  REPORT_BASE64,
  '--SAVE-1',
  'Content-Type: application/octet-stream',
  'Content-Disposition: attachment; filename="..\\..\\evil:name?.exe"',
  'Content-Transfer-Encoding: base64',
  '',
  BINARY_BASE64,
  '--SAVE-1--',
);

/** A message whose HTML body names a remote address in every way a body can, and holds a link with text and a ping. */
const HOSTILE_HTML =
  '<html><head><base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example/r">' +
  '<link rel="stylesheet" href="https://evil.example/a.css"><link rel="preload" href="https://evil.example/p" as="image">' +
  '<style>@import url(https://evil.example/i.css);body{background:url(https://evil.example/b.png)}</style></head>' +
  '<body background="https://evil.example/bg.gif"><img src="https://evil.example/1.png" srcset="https://evil.example/2.png 2x">' +
  '<picture><source srcset="https://evil.example/3.png"><img src="https://evil.example/4.png"></picture>' +
  '<input type="image" src="https://evil.example/5.png"><svg onload="alert(1)"><image href="https://evil.example/6.png"/>' +
  '<use xlink:href="https://evil.example/7.svg#a"/></svg>' +
  '<a href="https://evil.example/click" ping="https://evil.example/ping" target="_blank">Click me now</a> ' +
  '<a href="jav&#x61;script:alert(1)">entity scheme</a><a href="&#106;avascript:alert(1)">numeric entity</a>' +
  '<div style="background:url(\'https://evil.example/8.png\');width:expression(alert(1));-moz-binding:url(https://evil.example/x.xml#b)">css</div>' +
  '<div style="background-image:image-set(\'https://evil.example/9.png\' 1x)">set</div>' +
  '<audio src="https://evil.example/a.mp3"></audio><video poster="https://evil.example/v.png" src="https://evil.example/v.mp4"></video>' +
  '<iframe src="https://evil.example/frame"></iframe><object data="https://evil.example/o"></object><embed src="https://evil.example/e">' +
  '<form action="https://evil.example/post"><input name=q><button formaction="https://evil.example/f">go</button></form>' +
  '<script src="https://evil.example/s.js"></script><script>document.title="x"</script>' +
  '<table background="https://evil.example/t.gif"><tr><td background="https://evil.example/td.gif">x</td></tr></table>' +
  // Addresses that are only a fragment resolve against the page's own address, so they would load the page itself.
  '<img src="#x"><image src="#y"><img src=" #probe-fragment"><div style="background-image:url(#z)">fragment</div></body></html>';

const HOSTILE_MESSAGE = message(
  'From: Eve <eve@evil.example>',
  'To: victim@example.org',
  'Subject: Hostile markup',
  'Date: Tue, 06 Oct 2026 09:00:00 +0000',
  'Message-ID: <hostile-1@evil.example>',
  'MIME-Version: 1.0',
  'Content-Type: text/html; charset=utf-8',
  '',
  HOSTILE_HTML,
);

declare global {
  interface Window {
    /**
     * What the wrapper saw. `addresses` and `types` list every worker the page built, in construction order, by script
     * address and by the type option it asked for; `log` lists, in the order they happened, `new:<n>`, `in:<n>:<type>`
     * (a message the worker sent) and `out:<n>:<type>` (a message the page sent); `ended` lists the position of every
     * worker the page terminated.
     */
    __FODT_EML_WORKERS__?: { addresses: string[]; types: string[]; log: string[]; ended: number[] };
  }
}

/** Wraps the Worker constructor by composition, before any page script runs, and records what it sees. */
async function installWorkerWrapper(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    const state = { addresses: [] as string[], types: [] as string[], log: [] as string[], ended: [] as number[] };
    window.__FODT_EML_WORKERS__ = state;
    const typeOf = (data: unknown): string => {
      const type = (data as { type?: unknown } | null | undefined)?.type;
      return typeof type === 'string' ? type : '?';
    };
    class WrappedWorker {
      inner: Worker;
      index: number;
      constructor(scriptURL: string | URL, workerOptions?: WorkerOptions) {
        this.inner = new OriginalWorker(scriptURL, workerOptions);
        this.index = state.addresses.length;
        state.addresses.push(String(scriptURL));
        state.types.push(workerOptions?.type ?? 'classic');
        state.log.push(`new:${this.index}`);
        // Registered first, so it runs before any listener the page adds.
        this.inner.addEventListener('message', (event) => {
          state.log.push(`in:${this.index}:${typeOf((event as MessageEvent).data)}`);
        });
      }
      postMessage(...args: Parameters<Worker['postMessage']>): void {
        state.log.push(`out:${this.index}:${typeOf(args[0])}`);
        this.inner.postMessage(...args);
      }
      addEventListener(...args: Parameters<Worker['addEventListener']>): void {
        this.inner.addEventListener(...args);
      }
      removeEventListener(...args: Parameters<Worker['removeEventListener']>): void {
        this.inner.removeEventListener(...args);
      }
      terminate(): void {
        state.ended.push(this.index);
        this.inner.terminate();
      }
      dispatchEvent(event: Event): boolean {
        return this.inner.dispatchEvent(event);
      }
    }
    window.Worker = WrappedWorker as unknown as typeof Worker;
  });
}

/** Starts recording the address of every request the context makes from now on and returns the live list. */
function recordRequests(page: Page): string[] {
  const requests: string[] = [];
  page.context().on('request', (request) => requests.push(request.url()));
  return requests;
}

/** The requests that are not for the page's own files (its own origin, or a blob or data address the page made itself). */
function outsideRequests(requests: readonly string[], origin: string): string[] {
  return requests.filter((url) => {
    if (url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('about:')) return false;
    return new URL(url).origin !== origin;
  });
}

function outputArea(page: Page): Locator {
  return page.locator('section[aria-label="Output"]');
}

/** The block of the output whose label is `label`. */
function blockOf(page: Page, label: string): Locator {
  return outputArea(page).locator('.output-block', {
    has: page.locator('.output-label', { hasText: label }),
  });
}

async function openTool(page: Page): Promise<void> {
  await page.goto(rel('/tools/eml-viewer'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
}

function runButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Run', exact: true });
}

/**
 * Chooses the pasted-text source and fills the message. The page is prerendered, so a field filled in the first moments after
 * load can be cleared again when the page finishes starting; the fill is repeated until it holds.
 */
async function pasteMessage(page: Page, text: string): Promise<void> {
  await page.locator('input[name="source"][value="paste"]').click();
  const field = page.locator('#f-pasted');
  await expect(async () => {
    await field.fill(text);
    await expect(field).toHaveValue(text, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

/** Hands the page's own file input a message, as a visitor's file pick would. */
async function attachMessage(page: Page, name: string, content: string | Buffer): Promise<void> {
  const buffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  await page.locator('#f-file').setInputFiles({ name, mimeType: 'message/rfc822', buffer });
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

test('eml-viewer: the message is read in a background worker started from a blob address after it reports ready', async ({
  page,
}) => {
  await installWorkerWrapper(page);
  const requests = recordRequests(page);
  await openTool(page);
  await attachMessage(page, 'plain.eml', PLAIN_MESSAGE);
  await runButton(page).click();
  await expect(blockOf(page, 'Delivery hops, oldest first')).toBeVisible({ timeout: 20_000 });

  const seen = await page.evaluate(() => window.__FODT_EML_WORKERS__);
  expect(seen, 'the wrapper must have been installed before the page started').toBeDefined();
  // Exactly one worker, built from a blob address, as a module worker (every worker on the site is one).
  expect(seen?.addresses).toHaveLength(1);
  expect(seen?.addresses[0]?.startsWith('blob:')).toBe(true);
  expect(seen?.types).toEqual(['module']);
  // The job is posted only after the worker has said it is ready, and the answer comes after the job.
  const log = seen?.log ?? [];
  const ready = log.indexOf('in:0:eml-viewer-ready');
  const job = log.indexOf('out:0:eml-viewer-job');
  const done = log.indexOf('in:0:eml-viewer-done');
  expect(log[0]).toBe('new:0');
  expect(ready, `the worker never reported ready: ${log.join(' ')}`).toBeGreaterThan(0);
  expect(job, `the job was never posted: ${log.join(' ')}`).toBeGreaterThan(ready);
  expect(done, `the worker never answered: ${log.join(' ')}`).toBeGreaterThan(job);
  // The worker is stopped when the run is over.
  expect(seen?.ended).toEqual([0]);
  // The only requests are the page's own files.
  expect(outsideRequests(requests, new URL(page.url()).origin)).toEqual([]);
});

test('eml-viewer: Save gives the attachment under its cleaned name with the bytes the digest describes', async ({
  page,
}) => {
  await openTool(page);
  await attachMessage(page, 'save.eml', SAVE_MESSAGE);
  await runButton(page).click();

  // The table: the cleaned name first, then the name as received, the type, the size and the SHA-256 of the decoded bytes.
  const table = blockOf(page, 'Attachments');
  await expect(table).toBeVisible({ timeout: 20_000 });
  await expect(table.locator('tbody tr')).toHaveCount(2);
  const report = table.locator('tbody tr', { hasText: 'report.txt' });
  const reportBytes = Buffer.from(REPORT_BASE64, 'base64');
  await expect(report.locator('td').nth(4)).toHaveText(sha256(reportBytes));
  const hostile = table.locator('tbody tr').nth(1);
  const binaryBytes = Buffer.from(BINARY_BASE64, 'base64');
  await expect(hostile.locator('td').nth(0)).toHaveText('evil_name_.exe');
  await expect(hostile.locator('td').nth(4)).toHaveText(sha256(binaryBytes));

  // Save on report.txt: the file is named report.txt and its bytes are the ones the digest describes.
  const save = blockOf(page, 'Save');
  const [first] = await Promise.all([
    page.waitForEvent('download'),
    save.locator('li', { hasText: 'report.txt' }).getByRole('button', { name: 'Download' }).click(),
  ]);
  expect(first.suggestedFilename()).toBe('report.txt');
  const firstPath = await first.path();
  expect(sha256(readFileSync(firstPath))).toBe(sha256(reportBytes));

  // The hostile name is saved under its cleaned name, never under the path it asked for.
  const [second] = await Promise.all([
    page.waitForEvent('download'),
    save.locator('li', { hasText: 'evil_name_.exe' }).getByRole('button', { name: 'Download' }).click(),
  ]);
  expect(second.suggestedFilename()).toBe('evil_name_.exe');
  const secondPath = await second.path();
  expect(sha256(readFileSync(secondPath))).toBe(sha256(binaryBytes));
});

test('eml-viewer: a hostile message loads nothing and a click on its link text does not navigate the preview', async ({
  page,
}) => {
  const probe = await armCspProbe(page);
  const requests = recordRequests(page);
  await openTool(page);
  const opened = requests.length;
  await attachMessage(page, 'hostile.eml', HOSTILE_MESSAGE);
  await runButton(page).click();

  // Every remote reference is listed as text, and the body is shown in the closed frame.
  await expect(blockOf(page, 'Remote content that was blocked')).toBeVisible({ timeout: 20_000 });
  const frameElement = page.locator('iframe.preview-frame').first();
  await expect(frameElement).toBeVisible();
  expect(await frameElement.getAttribute('sandbox')).toBe('');
  const frame = page.frameLocator('iframe.preview-frame').first();
  const link = frame.locator('a', { hasText: 'Click me now' });
  await expect(link).toBeVisible();
  // The link keeps its words and has nothing to follow.
  expect(await link.getAttribute('href')).toBeNull();
  expect(await link.getAttribute('ping')).toBeNull();

  // A click on the link text does nothing: the frame is still about:srcdoc and the page has not moved.
  const pageUrl = page.url();
  await link.click();
  await page.waitForTimeout(700);
  const inner = await frameElement.elementHandle().then((handle) => handle?.contentFrame());
  expect(inner?.url()).toBe('about:srcdoc');
  expect(page.url()).toBe(pageUrl);

  // No request left the page's own files, and the page's policy raised no violation in the page, its frames or its workers.
  const outside = outsideRequests(requests, new URL(page.url()).origin);
  expect(outside, `requests outside the page's own files: ${outside.join(', ')}`).toEqual([]);
  expect(requests.filter((url) => url.includes('evil.example'))).toEqual([]);
  // Once the page is open it never asks for its own address again (an image with a fragment address would).
  const pagePath = new URL(page.url()).pathname;
  const again = requests.slice(opened).filter((url) => !url.startsWith('blob:') && new URL(url).pathname === pagePath);
  expect(again, `the page asked for its own address: ${again.join(', ')}`).toEqual([]);
  expect(probe.findings().map(describeFinding)).toEqual([]);
});

test('eml-viewer: a message over 25 MiB is refused before reading and no worker is left running', async ({ page }) => {
  test.setTimeout(120_000);
  await installWorkerWrapper(page);
  await openTool(page);
  // 26 MiB: one MiB over the limit. It is a plain buffer of letters; the page must refuse it by its size alone.
  await attachMessage(page, 'big.eml', Buffer.alloc(26 * 1024 * 1024, 0x61));
  await runButton(page).click();

  const problems = outputArea(page).locator('.issue-list');
  await expect(problems).toBeVisible({ timeout: 30_000 });
  await expect(problems).toContainText(
    'The file is 27,262,976 bytes. The limit is 26,214,400 (25 MiB), so it was not read.',
  );

  // No worker was built, so none is left running, and nothing was posted to one.
  const seen = await page.evaluate(() => window.__FODT_EML_WORKERS__);
  expect(seen?.addresses).toEqual([]);
  expect(seen?.log).toEqual([]);
  // Nothing was read into a result.
  await expect(blockOf(page, 'Summary')).toHaveCount(0);
});

test('eml-viewer: pasted headers alone show the delivery hops and the authentication lines', async ({ page }) => {
  await openTool(page);
  await pasteMessage(page, HEADERS_ONLY);
  await page.getByRole('button', { name: 'Run', exact: true }).click();

  // The hops are listed oldest first: the line at the bottom of the headers is the first hop, and the two stated dates are 6 s apart.
  const hops = blockOf(page, 'Delivery hops, oldest first');
  await expect(hops).toBeVisible({ timeout: 20_000 });
  const rows = hops.locator('tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('sender.example.com');
  await expect(rows.nth(1)).toContainText('relay.example.net');
  await expect(rows.nth(1)).toContainText('6 s');

  // The Authentication-Results header is in the list of headers.
  const headers = blockOf(page, 'Headers');
  await expect(headers.locator('tbody tr', { hasText: 'Authentication-Results' })).toHaveCount(1);

  // The parsed lines: what the server said, one row per result, never a verdict of the page's own.
  const auth = blockOf(page, 'Authentication-Results, as the server that wrote them said');
  await expect(auth).toBeVisible();
  const dkimResult = auth.locator('tbody tr', { hasText: 'dkim' });
  await expect(dkimResult).toHaveCount(1);
  await expect(dkimResult).toContainText('pass');
  await expect(dkimResult).toContainText('header.d=example.com');
  await expect(auth.locator('tbody tr')).toHaveCount(3);

  // The DKIM-Signature tags: the d tag is example.com, and the key lookup name is shown as text.
  const signature = blockOf(page, 'DKIM-Signature');
  await expect(signature).toBeVisible();
  const dTag = signature.locator('tbody tr', { has: page.locator('td:first-child', { hasText: /^d$/ }) });
  await expect(dTag).toHaveCount(1);
  await expect(dTag).toContainText('example.com');
  await expect(signature).toContainText('sel1._domainkey.example.com');

  // The page says nothing is verified.
  await expect(outputArea(page)).toContainText('nothing is verified');
});

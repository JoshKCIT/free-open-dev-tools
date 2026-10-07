import { test, expect, type Locator, type Page } from '@playwright/test';

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
 * strings with CRLF line ends; nothing is read from disk and nothing is uploaded.
 */
const rel = (path: string) => path.replace(/^\//, '');

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
].join('\r\n');

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

/**
 * Chooses the pasted-text source and fills the message. The page is prerendered, so a field filled in the first moments after
 * load can be cleared again when the page finishes starting; the fill is repeated until it holds.
 */
async function pasteMessage(page: Page, text: string): Promise<void> {
  await page.locator('input[name="source"][value="paste"]').click();
  const field = page.locator('#f-pasted');
  await expect(async () => {
    await field.fill(text);
    await expect(field).toHaveValue(text.replace(/\r\n/g, '\n'), { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

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

import { test, expect, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { armCspProbe, blobWorkerOutcome, namesDirective, describeFinding, PROBE_SCRIPT_PATH } from './csp-probe';

/**
 * Proof that every page's own content security policy refuses what it must, and that the instrument noticing a refusal
 * can fail. The shared probe lives in `e2e/csp-probe.ts` and is also armed inside the per-tool test of
 * `e2e/privacy.spec.ts`, so all 211 tool pages are driven through every control state with zero violations allowed.
 *
 * Page code for the controls is served by `page.route` from `__fodt-probe.js` (the path `PROBE_SCRIPT_PATH`) and loaded as a
 * script element, never run through `page.evaluate`: code run by `evaluate` is not subject to the page's `script-src`
 * and its `eval` and `Function` calls succeed even on a locked page, in all four engines.
 *
 * WHAT IS PROOF WHERE (measured in Chromium, Firefox, Windows WebKit and Linux WebKit while planning; trust no green
 * WebKit event assertion more than the table allows):
 *
 *   violation                               Chromium          Firefox            WebKit
 *   page fetch or image                     event + console   event + console    event + console
 *   page new Function with no grant         event             event + console    event
 *   page WebAssembly.compile, no grant      event             event + console    NO EVENT; the compile throws (behaviour)
 *   script-enabled frame (Mermaid) fetch    event + console   event + console    event + console
 *   sandbox="" preview frame (no scripts)   console only      event + console    console only
 *   blob worker fetch                       prefix event      prefix event       console only
 *   blob worker eval or WebAssembly         prefix event      prefix event       NOTHING; proof is the tool's run completing
 *
 * So on WebKit the proof for worker and WebAssembly violations is behavioural, and these tests assert behaviour there.
 * Never assert that eval is refused right after a WebAssembly compile on WebKit (it has a measured lapse); the
 * eval-refused control runs on a page with neither grant.
 *
 * The outside address is a local recording server (so a leak shows as a server hit) or, when E2E_BASE_URL points at a
 * deployed site, `https://example.invalid/` (an https page cannot reach a plain http server), and proof relies on
 * violations and behaviour alone.
 */

const rel = (path: string) => path.replace(/^\//, '');
const deployed = Boolean(process.env.E2E_BASE_URL);

/**
 * Runs `body` with the address of a local HTTP server that records every request it receives (or the never-resolving
 * `https://example.invalid/` when testing a deployed site), waits a moment for a stray request to land, and returns what
 * the server saw. Copied here from e2e/vision-mermaid.spec.ts on purpose: specs never import from each other.
 */
async function withOutsideAddress(body: (address: string) => Promise<void>): Promise<string[]> {
  if (deployed) {
    await body('https://example.invalid/');
    return [];
  }
  const seen: string[] = [];
  const server = createServer((request, response) => {
    seen.push(`${request.method} ${request.url}`);
    response.end('x');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await body(`http://127.0.0.1:${port}/`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  return seen;
}

async function openToolPage(page: Page, id: string): Promise<void> {
  await page.goto(rel(`/tools/${id}`));
  await page.waitForLoadState('networkidle');
}

test.describe('the violation probe sees what the policy refuses', () => {
  test('a blob worker that tries an outside fetch is recorded, refused and never reaches the server', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName === 'webkit', 'WebKit delivers no worker violation events; its worker proof is behavioural');
    const probe = await armCspProbe(page);
    await openToolPage(page, 'regex-tester');
    expect(probe.findings().map(describeFinding), 'the regex tester loads clean under its own policy').toEqual([]);

    const seen = await withOutsideAddress(async (outside) => {
      const worker = await blobWorkerOutcome(page, outside);
      expect(worker.outcome, `the regex tester allows a blob worker (${worker.detail})`).toBe('allowed');
      expect(worker.inner, `the worker's own outside fetch must fail (${worker.detail})`).toBe('failed');
      const fromWorker = worker.findings.filter(
        (finding) => finding.source === 'worker' && namesDirective(finding, 'connect-src'),
      );
      expect(
        fromWorker.length,
        `a violation raised inside the blob worker is recorded by the probe (${worker.findings.map(describeFinding).join(' | ')})`,
      ).toBeGreaterThan(0);
    });
    expect(seen, 'the recording server saw nothing from the worker').toEqual([]);
  });

  test('a blob worker that tries an outside fetch is refused and never reaches the server (every engine)', async ({
    page,
  }) => {
    const probe = await armCspProbe(page);
    await openToolPage(page, 'regex-tester');
    const seen = await withOutsideAddress(async (outside) => {
      const worker = await blobWorkerOutcome(page, outside);
      expect(worker.outcome, `the regex tester allows a blob worker (${worker.detail})`).toBe('allowed');
      expect(worker.inner, `the worker's own outside fetch must fail (${worker.detail})`).toBe('failed');
    });
    expect(seen, 'the recording server saw nothing from the worker').toEqual([]);
    expect(probe.findings().length, 'the refusal is visible somewhere (event or console line)').toBeGreaterThan(0);
  });

  test('the page own worker still runs with the probe armed and the policy in force', async ({ page }) => {
    const probe = await armCspProbe(page);
    await openToolPage(page, 'regex-tester');
    await page.locator('#f-pattern').fill('a+');
    await page.locator('#f-input').fill('baaab');
    await expect(page.locator('section[aria-label="Output"] table.output-table')).toContainText('aaa', {
      timeout: 10_000,
    });
    expect(probe.findings().map(describeFinding), 'the page worker raised a violation').toEqual([]);
  });

  test('a violation raised while the page loads is recorded (the probe is armed before navigation)', async ({
    page,
  }) => {
    const probe = await armCspProbe(page);
    await withOutsideAddress(async (outside) => {
      // Added when the document has been parsed (the policy meta is the first element of the head, so it is in force
      // by then) and before load settles: an outside image the policy must refuse. An image started earlier than the
      // meta element is not covered by it, in any engine.
      await page.addInitScript((address) => {
        document.addEventListener('DOMContentLoaded', () => {
          new Image().src = `${address}load-time.png`;
        });
      }, outside);
      await openToolPage(page, 'base64');
      await page.waitForTimeout(500);
    });
    // Which directive an engine names for an image started this early differs (Chromium says connect-src), so the
    // finding is recognised by the address it refused.
    const recorded = probe
      .findings()
      .filter((finding) => (finding.blocked ?? finding.text ?? '').includes('load-time.png'));
    expect(
      recorded.length,
      `the image refused during load is in the probe (${probe.findings().map(describeFinding).join(' | ')})`,
    ).toBeGreaterThan(0);
    expect(PROBE_SCRIPT_PATH).toBe('/__fodt-probe.js');
  });
});

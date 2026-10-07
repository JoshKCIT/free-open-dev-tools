import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { armCspProbe, describeFinding, namesDirective, wasmCompileOutcome, type CspFinding } from './csp-probe';

/**
 * The dedicated four-browser proof for the WebAssembly Module Inspector (19-04, INSP-03, D-232, D-235): the page reads a
 * module and shows what is in it; the module can never run, because the page declares no needs and its own policy holds
 * neither 'wasm-unsafe-eval' nor 'unsafe-eval', so a deliberate compile attempt on the page is refused by the browser; and
 * reading a module sends nothing anywhere.
 *
 * The module is the 329 byte fixture of the live fixture file (assembled by wabt 1.0.39 from a WAT text: an imported
 * function env.log and global env.limit, a memory, a table, a mutable global, the data segment "hello fixture", an element
 * segment, the exports memory, add, twice and counter, a start function and a name section). The compile attempt is the
 * shared probe's control (`wasmCompileOutcome`): page code served as a script element, so it is governed by the page's
 * policy exactly like page code, never run through `evaluate`, which no policy governs. The probe is armed before the page
 * loads. WebKit throws on a refused compile without recording a violation (the engine table in `csp.spec.ts`), so there the
 * refusal is the thrown error; Chromium and Firefox also record a script-src violation, which is required.
 *
 * The same spec runs against a deployed site when E2E_BASE_URL is set (plan 19-08): the compile refusal on the live site is
 * the recorded control the phase's third success criterion asks for. It edits no shared file.
 */
const here = dirname(fileURLToPath(import.meta.url));
const rel = (path: string) => path.replace(/^\//, '');

interface LiveFixture {
  steps: { action: string; files?: { name: string; mimeType: string; base64: string }[] }[];
}

/** The fixture module's bytes, read from the live fixture file so the two cannot disagree. */
function fixtureBytes(): Buffer {
  const live = JSON.parse(readFileSync(join(here, 'live-fixtures', 'wasm-inspector.json'), 'utf8')) as LiveFixture;
  const attach = live.steps.find((step) => step.action === 'attach');
  const base64 = attach?.files?.[0]?.base64;
  if (base64 === undefined) throw new Error('the live fixture has no module to attach');
  return Buffer.from(base64, 'base64');
}

function outputArea(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

/** Opens the inspector with the probe armed first, so a violation raised while the page loads is counted. */
async function openInspector(page: Page) {
  const probe = await armCspProbe(page);
  await page.goto(rel('/tools/wasm-inspector'));
  await page.waitForLoadState('networkidle');
  await page.locator('#f-file').waitFor({ state: 'attached' });
  return probe;
}

async function openModule(page: Page): Promise<void> {
  await page
    .locator('#f-file')
    .setInputFiles({ name: 'fixture.wasm', mimeType: 'application/wasm', buffer: fixtureBytes() });
  await expect(outputArea(page)).toContainText('hello fixture', { timeout: 30_000 });
}

const lines = (findings: CspFinding[]): string => findings.map(describeFinding).join(' | ') || 'none';

test('wasm-inspector: the module is read and its imports, exports and data text are shown', async ({ page }) => {
  test.setTimeout(120_000);
  const probe = await openInspector(page);
  await openModule(page);

  const output = outputArea(page);
  // What the WAT text says, as the page shows it: the import, the four exports, the data text, the name section.
  await expect(output).toContainText('It never compiles, validates or runs it');
  await expect(output.locator('table', { hasText: 'limit' }).first()).toContainText('env');
  for (const exported of ['memory', 'add', 'twice', 'counter']) await expect(output).toContainText(exported);
  await expect(output).toContainText('hello fixture');
  await expect(output).toContainText('Largest functions');
  await expect(output).toContainText('Module structure');
  await expect(output).toContainText('The module is not validated');
  expect(probe.findings(), `a violation was recorded while reading: ${lines(probe.findings())}`).toEqual([]);
});

test('wasm-inspector: a deliberate compile attempt on the page is refused by its own policy', async ({
  page,
  browserName,
}) => {
  test.setTimeout(120_000);
  const probe = await openInspector(page);
  await openModule(page);
  const before = probe.findings().length;

  // The empty module is the smallest thing a compile accepts; the page's policy must refuse it.
  const compiled = await wasmCompileOutcome(page);
  expect(compiled.outcome, `the compile attempt was allowed (${compiled.detail})`).toBe('refused');
  const raised = probe.findings().slice(before);
  if (browserName === 'webkit') {
    // WebKit throws without recording a violation: the refusal is behaviour, so the error itself is the proof.
    expect(compiled.detail, 'WebKit should throw').toContain('blocked');
  } else {
    expect(
      raised.some((finding) => namesDirective(finding, 'script-src')),
      `the refused compile was not recorded as a script-src violation (${lines(raised)})`,
    ).toBe(true);
  }
  // The page still shows what it read: the refusal did not disturb it.
  await expect(outputArea(page)).toContainText('hello fixture');
});

test('wasm-inspector: the served policy holds neither wasm-unsafe-eval nor unsafe-eval', async ({ page }) => {
  test.setTimeout(120_000);
  await openInspector(page);
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(policy, 'the page serves a policy in a meta element').not.toBeNull();
  expect(policy).not.toContain("'wasm-unsafe-eval'");
  expect(policy).not.toContain("'unsafe-eval'");
  // The script source is the site's own files and one hash, and nothing else.
  const script = (policy ?? '').split(';').find((part) => part.trim().startsWith('script-src')) ?? '';
  expect(script, 'script-src is present').toContain("'self'");
  expect(script).not.toMatch(/unsafe-/);
  expect(script).not.toContain('wasm');
});

test('wasm-inspector: reading a module sends no request', async ({ page }) => {
  test.setTimeout(120_000);
  const probe = await openInspector(page);
  // Everything after the page has loaded: the page, its scripts and its styles are already here.
  const requests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith('data:') && !url.startsWith('blob:')) requests.push(`${request.method()} ${url}`);
  });
  await openModule(page);
  // Give a stray request time to land before judging.
  await page.waitForTimeout(1500);
  expect(requests, 'a request was made while a module was read').toEqual([]);
  expect(probe.findings(), `a request was refused by the policy: ${lines(probe.findings())}`).toEqual([]);
});

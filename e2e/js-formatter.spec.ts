import { test, expect } from '@playwright/test';

/**
 * Behavioural proof of the page-side time limit (D-14/D-15/D-27, D-57) on
 * this page's own risky path: TypeScript + minify. That combination calls
 * `ts.transpileModule` the same way ts-to-js does, and 05-01 already
 * measured that call showing clear super-linear growth on a long chain of
 * string-literal `+` concatenation. Confirmed again directly against this
 * tool's own TypeScript minify path this session (10,000 terms ~840ms,
 * 20,000 ~2.2s). Beautify (either language) and JavaScript minify all
 * measured well under 1 second on a 200KB realistic input and never run in
 * the worker, so they carry no time limit and are not tested here.
 */
const rel = (path: string) => path.replace(/^\//, '');

/** A long chain of string-literal `+` concatenation: wide, not deep, and reliably exceeds the 1.5s limit. */
function pathologicalSource(): string {
  const parts = new Array(30_000).fill('"a"');
  return `const s: string = ${parts.join('+')};`;
}

test('a long TypeScript string-concatenation chain is stopped with the time-limit message when minifying, and the tab stays responsive', async ({
  page,
}) => {
  await page.goto(rel('/tools/js-formatter'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  await page.locator('input[type="radio"][name="language"][value="typescript"]').check();
  await page.locator('input[type="radio"][name="mode"][value="minify"]').check();
  await page.locator('#f-input').fill(pathologicalSource());

  // Sampled shortly after the debounced autoRun should have started the
  // worker, but well before this tool's own 1.5s time limit could have
  // fired -- proves the tab stays responsive while compiling is stuck on
  // the worker's own thread, not that compiling itself finished quickly.
  await page.waitForTimeout(300);
  const evalStart = Date.now();
  await page.evaluate(() => performance.now());
  expect(Date.now() - evalStart).toBeLessThan(500);

  await expect(page.locator('section[aria-label="Output"] .issue-list')).toContainText('Stopped after 1.5 seconds', {
    timeout: 10_000,
  });
});

test('after a long TypeScript minify input is stopped, the next input runs normally', async ({ page }) => {
  await page.goto(rel('/tools/js-formatter'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  await page.locator('input[type="radio"][name="language"][value="typescript"]').check();
  await page.locator('input[type="radio"][name="mode"][value="minify"]').check();
  await page.locator('#f-input').fill(pathologicalSource());
  await expect(page.locator('section[aria-label="Output"] .issue-list')).toContainText('Stopped after 1.5 seconds', {
    timeout: 10_000,
  });

  // Exported so terser's dead-code elimination keeps the declaration (and
  // its name, since toplevel mangling is off) rather than dropping it as
  // unreferenced.
  await page.locator('#f-input').fill('export function greet(name: string) { return name; }');
  await expect(page.locator('section[aria-label="Output"] pre.output')).toContainText('function greet(', {
    timeout: 10_000,
  });
});

test('a 200KB realistic TypeScript file minifies successfully through the worker', async ({ page }) => {
  await page.goto(rel('/tools/js-formatter'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  await page.locator('input[type="radio"][name="language"][value="typescript"]').check();
  await page.locator('input[type="radio"][name="mode"][value="minify"]').check();

  let src = '';
  for (let i = 0; i < 2000; i++) {
    src += `interface I${i} { a: number; b: string; }\nexport function f${i}(x: I${i}): number { return x.a; }\n`;
  }
  await page.locator('#f-input').fill(src);
  await expect(page.locator('section[aria-label="Output"] pre.output')).toContainText('function f0(', {
    timeout: 10_000,
  });
  await expect(page.locator('section[aria-label="Output"] .issue-list')).toHaveCount(0);
});

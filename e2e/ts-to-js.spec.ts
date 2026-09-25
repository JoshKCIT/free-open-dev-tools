import { test, expect } from '@playwright/test';

/**
 * Behavioural proof of the page-side time limit (D-14/D-15/D-27, D-57): a
 * pathological TypeScript input is stopped with a plain message instead of
 * freezing the tab, and the page keeps working normally afterwards.
 *
 * Measured this session (D-57, profile first): a 200KB realistic
 * TypeScript file (2000 small interfaces, each with a matching typed
 * function) transpiles in well under 1.5 seconds, both in Node
 * (`ts.transpileModule` directly, ~250ms) and through this exact page in
 * chromium -- normal-sized input is not the risk here. A long chain of
 * string-literal `+` concatenation is: TypeScript's own binary-expression
 * printer showed clear super-linear growth measured directly against the
 * installed compiler (5,000 terms ~260ms, 10,000 ~840ms, 20,000 ~2.2s,
 * 30,000 ~5.2s, 100,000 ~92 seconds) -- wide, not deep, so it is a genuine
 * slow path rather than the stack-overflow a very deeply *nested*
 * expression hits first. `transpileModule` is, once started, a single
 * synchronous, un-interruptible call, the same category of runaway
 * main-thread work `e2e/jsonpath.spec.ts`'s own time-limit spec covers.
 */
const rel = (path: string) => path.replace(/^\//, '');

/** A long chain of string-literal `+` concatenation: wide, not deep, and reliably exceeds the 1.5s limit. */
function pathologicalSource(): string {
  const parts = new Array(30_000).fill('"a"');
  return `const s = ${parts.join('+')};`;
}

test('a long chain of string concatenation is stopped with the time-limit message and the tab stays responsive', async ({
  page,
}) => {
  await page.goto(rel('/tools/ts-to-js'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  await page.locator('#f-input').fill(pathologicalSource());

  // Sampled shortly after the debounced autoRun should have started the
  // worker, but well before this tool's own 1.5s time limit could have
  // fired -- this evaluate() round trip runs on the PAGE's own event loop,
  // so it proves the tab stays responsive while compiling is stuck on the
  // worker's own thread, not that compiling itself finished quickly.
  await page.waitForTimeout(300);
  const evalStart = Date.now();
  await page.evaluate(() => performance.now());
  expect(Date.now() - evalStart).toBeLessThan(500);

  await expect(page.locator('section[aria-label="Output"] .issue-list')).toContainText('Stopped after 1.5 seconds', {
    timeout: 10_000,
  });
});

test('after a long input is stopped the next input runs normally', async ({ page }) => {
  await page.goto(rel('/tools/ts-to-js'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  await page.locator('#f-input').fill(pathologicalSource());
  await expect(page.locator('section[aria-label="Output"] .issue-list')).toContainText('Stopped after 1.5 seconds', {
    timeout: 10_000,
  });

  await page.locator('#f-input').fill('function greet(person: string) {}');
  await expect(page.locator('section[aria-label="Output"] pre.output')).toContainText('function greet(person)', {
    timeout: 10_000,
  });
});

test('a 200KB realistic TypeScript file compiles successfully through the worker', async ({ page }) => {
  await page.goto(rel('/tools/ts-to-js'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  let src = '';
  for (let i = 0; i < 2000; i++) {
    src += `interface I${i} { a: number; b: string; }\nfunction f${i}(x: I${i}): string { return x.a + x.b; }\n`;
  }
  await page.locator('#f-input').fill(src);
  await expect(page.locator('section[aria-label="Output"] pre.output')).toContainText('function f0(x)', {
    timeout: 10_000,
  });
  // Realistic-sized input must not hit the pathological-input time limit.
  await expect(page.locator('section[aria-label="Output"] .issue-list')).toHaveCount(0);
});

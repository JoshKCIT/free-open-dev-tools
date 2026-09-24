import { test, expect } from '@playwright/test';

/**
 * Behavioural proof of the page-side time limit (D-32, ROADMAP success
 * criterion 2): a pattern that would backtrack catastrophically is stopped
 * with a plain message instead of freezing the tab, and the page keeps
 * working normally afterwards. Lives in its own spec file per this phase's
 * `<shared_procedure>`, the same reason `e2e/hash-file.spec.ts` and
 * `e2e/bcrypt.spec.ts` each own their own worker-behaviour file.
 */
const rel = (path: string) => path.replace(/^\//, '');

/**
 * Catastrophic-backtracking vectors, quoted directly from OWASP's own
 * community page: "Evil regex examples: (a+)+$, ([a-zA-Z]+)*$, (a|aa)+$,
 * (a|a?)+$ ... All the above are susceptible to the input
 * aaaaaaaaaaaaaaaaaaaaaaaa!"
 * https://community.owasp.org/attacks/Regular_expression_Denial_of_Service_-_ReDoS
 *
 * One vector per engine family, not one for all three. Before writing this
 * file, this session timed every OWASP vector directly in each engine --
 * `new RegExp(pattern).test(input)`, timed with performance.now(), no
 * worker or time limit involved -- and found they do not behave alike:
 *
 * - `(a+)+$` genuinely runs away in V8 (chromium, and mobile-chrome, which
 *   also runs on Chromium) and in SpiderMonkey (firefox): multi-second
 *   hangs, measured directly.
 * - WebKit's own regex engine resolves `(a+)+$` in well under a second
 *   regardless of input length (a flat ~650ms across 41 and 61 characters,
 *   not the exponential growth the other two engines show), so it never
 *   reaches this tool's own 1.5 second time limit on that vector.
 * - `(a|a?)+$` is the vector that DOES reach it on WebKit: a flat
 *   ~1.7-1.8 seconds measured across 31-41 characters, read here as
 *   WebKit's own engine hitting an internal backtracking limit around
 *   that mark rather than true exponential growth -- but it is real,
 *   measured, unavoidable in-engine work, and it is over this tool's own
 *   limit either way, which is what this test needs.
 * - That same `(a|a?)+$` vector throws a native "too much recursion"
 *   RangeError almost immediately in both V8 and SpiderMonkey instead of
 *   hanging, so it cannot stand in for `(a+)+$` on those two engines.
 *
 * Precedent for asserting a browser's own measured behaviour rather than
 * forcing one vector to mean the same thing everywhere: D-30's cross-
 * browser time zone data divergence is handled the same way (D-42,
 * 03-CONTEXT.md: "if Playwright's browsers disagree with Node on a DST
 * fixture, the e2e test asserts the browser's own IANA answer for that
 * browser").
 */
function catastrophicVectorFor(browserName: string): { pattern: string; input: string } {
  if (browserName === 'webkit') {
    return { pattern: '(a|a?)+$', input: 'a'.repeat(35) + '!' };
  }
  return { pattern: '(a+)+$', input: 'a'.repeat(40) + '!' };
}

test('a catastrophically backtracking pattern is stopped with the time-limit message and the tab stays responsive', async ({
  page,
  browserName,
}) => {
  const { pattern, input } = catastrophicVectorFor(browserName);
  await page.goto(rel('/tools/regex-tester'));
  await page.locator('#f-pattern').fill(pattern);
  await page.locator('#f-input').fill(input);

  // Sampled shortly after the debounced autoRun should have started the
  // worker, but well before this tool's own 1.5s time limit could have
  // fired -- this evaluate() round trip runs on the PAGE's own event
  // loop, so it proves the tab stays responsive while the match is stuck
  // on the worker's own thread, not that the match itself finished
  // quickly.
  await page.waitForTimeout(300);
  const evalStart = Date.now();
  await page.evaluate(() => performance.now());
  expect(Date.now() - evalStart).toBeLessThan(500);

  await expect(page.locator('section[aria-label="Output"] .issue-list')).toContainText('Stopped after 1.5 seconds', {
    timeout: 10_000,
  });
});

test('after a pattern is stopped the next pattern runs normally', async ({ page, browserName }) => {
  const { pattern, input } = catastrophicVectorFor(browserName);
  await page.goto(rel('/tools/regex-tester'));
  await page.locator('#f-pattern').fill(pattern);
  await page.locator('#f-input').fill(input);
  await expect(page.locator('section[aria-label="Output"] .issue-list')).toContainText('Stopped after 1.5 seconds', {
    timeout: 10_000,
  });

  const aRun = input.slice(0, -1); // the run of "a" characters, without the trailing non-matching character
  await page.locator('#f-pattern').fill('a+');
  await expect(page.locator('section[aria-label="Output"] table.output-table')).toContainText(aRun, {
    timeout: 10_000,
  });
});

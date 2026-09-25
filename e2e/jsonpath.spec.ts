import { test, expect } from '@playwright/test';

/**
 * Behavioural proof of the page-side time limit (D-14/D-15/D-27, ROADMAP
 * success criterion 2): a match() filter pattern that would backtrack
 * catastrophically is stopped with a plain message instead of freezing the
 * tab, and the page keeps working normally afterwards. Lives in its own
 * spec file per this phase's `<shared_procedure>`, the same reason
 * `e2e/regex-tester.spec.ts` owns its own worker-behaviour file.
 */
const rel = (path: string) => path.replace(/^\//, '');

/**
 * jsonpath-rfc9535's match()/search() functions compile their I-Regexp
 * pattern to a native regular expression as `RegExp('^'+pattern+'$', 'u')`
 * and call `.test(value)` (its own construct-regex.js) -- a synchronous,
 * un-interruptible native engine call, exactly the same category of
 * runaway work `regex-tester`'s own time limit exists for (03-02).
 *
 * Before writing this file, this session measured that exact construction
 * -- `new RegExp('^'+pattern+'$', 'u').test(input)`, run inside a real
 * Worker with an external 2500ms terminate so a genuinely runaway pattern
 * could not hang the measurement session -- directly in chromium, firefox
 * and webkit, for OWASP's own `(a+)+` and `(a|a?)+` vectors
 * (https://community.owasp.org/attacks/Regular_expression_Denial_of_Service_-_ReDoS)
 * against a string of 31-41 "a" characters followed by "!":
 *
 * - `(a+)+`: genuinely runs away in chromium and firefox (still running
 *   past the 2500ms measurement cutoff at every length tested, 31-41).
 *   WebKit's own engine resolves it in a flat ~420-460ms regardless of
 *   input length -- not exponential -- so it never reaches this tool's
 *   1.5 second limit on that vector, matching 03-02's own finding for the
 *   same vector.
 * - `(a|a?)+`: unlike 03-02's finding for the SAME vector on a plain
 *   (non-Unicode-flagged) RegExp -- where it throws a native "too much
 *   recursion" RangeError almost immediately on V8 and SpiderMonkey --
 *   this session measured it genuinely running away past 2500ms on
 *   chromium AND firefox too, when compiled with the 'u' flag the way
 *   match()/search() always do here. On webkit it resolves in a flat
 *   ~1.87-2.0 seconds across 31-41 characters (over this tool's own 1.5
 *   second limit, the same register 03-02 found for webkit on this
 *   vector: an internal backtracking cap, not true exponential blowup,
 *   but real, measured, unavoidable work either way).
 *
 * Net effect: `(a|a?)+` alone exceeds the 1.5 second limit on all three
 * measured engines (so on chromium, firefox, webkit and mobile-chrome,
 * which shares chromium's engine) -- one vector suffices here, unlike
 * regex-tester's own per-engine split. `slowQueryFor` still takes
 * `browserName` and is still named for per-engine selection, in case a
 * future engine update changes this.
 */
function slowQueryFor(_browserName: string): { document: string; expression: string } {
  const value = 'a'.repeat(35) + '!';
  return { document: JSON.stringify([value]), expression: "$[?match(@, '(a|a?)+')]" };
}

test('a catastrophically backtracking match pattern is stopped with the time-limit message and the tab stays responsive', async ({
  page,
  browserName,
}) => {
  const { document: doc, expression } = slowQueryFor(browserName);
  await page.goto(rel('/tools/jsonpath'));
  await page.locator('#f-document').fill(doc);
  await page.locator('#f-expression').fill(expression);

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

test('after a query is stopped the next query runs normally', async ({ page, browserName }) => {
  const { document: doc, expression } = slowQueryFor(browserName);
  await page.goto(rel('/tools/jsonpath'));
  await page.locator('#f-document').fill(doc);
  await page.locator('#f-expression').fill(expression);
  await expect(page.locator('section[aria-label="Output"] .issue-list')).toContainText('Stopped after 1.5 seconds', {
    timeout: 10_000,
  });

  await page.locator('#f-document').fill('[1,2,3]');
  await page.locator('#f-expression').fill('$[0]');
  await expect(page.locator('section[aria-label="Output"] table.output-table')).toContainText('1', {
    timeout: 10_000,
  });
});

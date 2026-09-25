import { test, expect } from '@playwright/test';

/**
 * Behavioural proof of the page-side time limit (D-14/D-15/D-27, ROADMAP
 * success criterion 2): a schema pattern that would backtrack
 * catastrophically is stopped with a plain message instead of freezing the
 * tab, and the page keeps working normally afterwards. Lives in its own
 * spec file per this phase's `<shared_procedure>`, the same reason
 * `e2e/regex-tester.spec.ts` and `e2e/jsonpath.spec.ts` each own their own
 * worker-behaviour file.
 */
const rel = (path: string) => path.replace(/^\//, '');

/**
 * Ajv's own `pattern` keyword compiles to `new RegExp(pattern, 'u').test(value)`
 * by default (its `unicodeRegExp` option, quoted in
 * tools/json-schema-validator/test/index.test.ts, is on by default).
 *
 * Before writing this file, this session measured both OWASP-cited vectors
 * (https://community.owasp.org/attacks/Regular_expression_Denial_of_Service_-_ReDoS)
 * through this page's own real path -- filling the Schema and Data fields
 * on the built site and timing how long the Output section took to settle
 * -- in chromium, firefox and webkit, with schema
 * `{"type":"string","pattern":"^(a+)+$"}` or
 * `{"type":"string","pattern":"^(a|a?)+$"}` against data `"aaa...a!"` (38
 * "a" characters):
 *
 * - `^(a+)+$`: chromium and firefox both hit this tool's own 1.5 second
 *   limit (stopped after ~1.8-1.9s wall time including page overhead).
 *   webkit resolves it directly in ~1.1s, well under the limit -- the same
 *   "WebKit's own engine does not show exponential blowup on this vector"
 *   finding 03-02 and 04-03 both recorded for the plain and jsonpath-
 *   wrapped forms of the same pattern.
 * - `^(a|a?)+$`: hits the 1.5 second limit on ALL THREE measured engines
 *   (chromium, firefox AND webkit, ~1.8-1.9s wall time each) -- matching
 *   04-03's finding for `jsonpath-rfc9535`'s own always-'u'-flagged
 *   `match()`/`search()` construction, not 03-02's finding for a bare,
 *   non-Unicode-flagged `RegExp` (where this same vector throws a native
 *   RangeError almost immediately on V8/SpiderMonkey instead of hanging).
 *   Ajv's own `pattern` keyword uses the 'u' flag by default, so this
 *   tool's own measured behaviour follows jsonpath's precedent, not
 *   regex-tester's.
 *
 * Net effect: unlike regex-tester's per-engine vector split, ONE vector
 * (`^(a|a?)+$`) suffices here across all four browser projects (chromium,
 * firefox, webkit and mobile-chrome, which shares chromium's V8) -- the
 * same shape 04-03 found for jsonpath.
 */
function slowSchemaFor(_browserName: string): { schema: string; data: string } {
  const value = 'a'.repeat(38) + '!';
  return { schema: JSON.stringify({ type: 'string', pattern: '^(a|a?)+$' }), data: JSON.stringify(value) };
}

test('a catastrophically backtracking schema pattern is stopped with the time-limit message and the tab stays responsive', async ({
  page,
  browserName,
}) => {
  const { schema, data } = slowSchemaFor(browserName);
  await page.goto(rel('/tools/json-schema-validator'));
  await page.locator('#f-schema').fill(schema);
  await page.locator('#f-data').fill(data);

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

test('after a validation is stopped the next validation runs normally', async ({ page, browserName }) => {
  const { schema, data } = slowSchemaFor(browserName);
  await page.goto(rel('/tools/json-schema-validator'));
  await page.locator('#f-schema').fill(schema);
  await page.locator('#f-data').fill(data);
  await expect(page.locator('section[aria-label="Output"] .issue-list')).toContainText('Stopped after 1.5 seconds', {
    timeout: 10_000,
  });

  await page.locator('#f-schema').fill('{"type":"string"}');
  await page.locator('#f-data').fill('"ok"');
  await expect(page.locator('section[aria-label="Output"] .note')).toContainText('Valid against', {
    timeout: 10_000,
  });
});

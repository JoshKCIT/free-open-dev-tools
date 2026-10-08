import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The Glob & .gitignore Pattern Tester gains a CODEOWNERS file mode and keeps its two earlier modes (20-02, FLOW-05, D-237).
 *
 * Test 1 pastes the CODEOWNERS example GitHub documents in "About code owners" (re-typed in
 * tools/glob-tester/test/fixtures/codeowners/docs-example.json with the owners and deciding lines the documentation's
 * own comments describe, counted over every pasted line) and reads three of its answers off the page. Test 2 pastes lines
 * GitHub says do not work, and a line this page treats the same way, and checks they are listed and match nothing while a
 * path nothing matches is listed as having no owner. Test 3 repeats the answers the earlier unit tests state: with
 * *.log and !keep.log, .gitignore mode names line 1 and line 2 as the deciding lines, and glob mode names the first
 * matching line.
 *
 * Test 4 crosses the page's 5 second limit in CODEOWNERS mode and reads the sentence that mode gives
 * (20-REVIEW-A, A-WR-02): the glob tester's own time-limit sentence talks about one slow pattern and a .gitignore paste,
 * which is wrong for a CODEOWNERS file. As in e2e/dev-workers.spec.ts, the first worker never receives its job (as if it
 * were stuck inside one long call) and the page clock, not real time, crosses the limit, so the test never depends on how
 * fast the machine is.
 *
 * A spec of its own with helpers copied in shape from e2e/number-base-calculator.spec.ts, because a shared test helper would
 * make every importing spec run whole for every tool. It is read in four browser projects: chromium, firefox, webkit and
 * mobile-chrome. The page is driven only through its labelled controls, and matching runs in its background worker.
 */
const rel = (path: string) => path.replace(/^\//, '');

declare global {
  interface Window {
    /** What the wrapper of test 4 saw: `log` holds `out-swallowed:<n>:<type>` and `out:<n>:<type>`; `ended` the stopped workers. */
    __FODT_CODEOWNERS_WORKERS__?: { log: string[]; ended: number[] };
  }
}

/**
 * Wraps the global Worker constructor before any page script runs, so the first worker the page builds never receives the
 * job it is posted (as if the matcher were stuck inside one synchronous call), every later worker behaves normally, and
 * every message the page posts and every terminate() call is logged. A copy in shape of the wrapper in
 * e2e/dev-workers.spec.ts, kept to the one behaviour this spec needs.
 */
async function swallowFirstJob(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    const state = { log: [] as string[], ended: [] as number[] };
    window.__FODT_CODEOWNERS_WORKERS__ = state;
    let built = 0;
    const typeOf = (data: unknown): string => {
      const type = (data as { type?: unknown } | null | undefined)?.type;
      return typeof type === 'string' ? type : '?';
    };
    class WrappedWorker {
      inner: Worker;
      index: number;
      constructor(scriptURL: string | URL, workerOptions?: WorkerOptions) {
        this.inner = new OriginalWorker(scriptURL, workerOptions);
        this.index = built;
        built += 1;
      }
      postMessage(...args: Parameters<Worker['postMessage']>): void {
        if (this.index === 0) {
          state.log.push(`out-swallowed:${this.index}:${typeOf(args[0])}`);
          return;
        }
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

interface DocsExample {
  files: Record<'A' | 'B', string>;
}

const docs = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../tools/glob-tester/test/fixtures/codeowners/docs-example.json', import.meta.url)),
    'utf8',
  ),
) as DocsExample;

function outputArea(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

async function openTester(page: Page): Promise<void> {
  await page.goto(rel('/tools/glob-tester'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
}

/**
 * Fills a text field and checks the value stayed. The pages are prerendered, so a field filled in the first moments after
 * load can be cleared again when the page finishes starting; the fill is repeated until it holds.
 */
async function fillAndHold(page: Page, name: string, value: string): Promise<void> {
  const field = page.locator(`#f-${name}`);
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

/** Chooses a mode by its label and checks that it stuck. */
async function chooseMode(page: Page, label: string): Promise<void> {
  const radio = page.getByRole('radio', { name: label, exact: true });
  await expect(async () => {
    await radio.check();
    await expect(radio).toBeChecked({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

/** The text of every row of the result table, white space collapsed, keyed by the first cell (the path). */
async function tableRows(page: Page): Promise<Record<string, string>> {
  const rows = await outputArea(page).locator('table tbody tr').allInnerTexts();
  const byPath: Record<string, string> = {};
  for (const row of rows) {
    const text = row.replace(/\s+/g, ' ').trim();
    byPath[text.split(' ')[0] ?? ''] = text;
  }
  return byPath;
}

/** The output block that carries a label. */
function blockLabelled(page: Page, label: string): Locator {
  return outputArea(page)
    .locator('.output-block')
    .filter({ has: page.locator('.output-label', { hasText: label }) });
}

test('glob-tester: CODEOWNERS mode names the owners and deciding line of the documented example', async ({ page }) => {
  test.setTimeout(120_000);
  await openTester(page);
  await chooseMode(page, 'CODEOWNERS file');
  // The glob-only boxes are not part of this mode.
  await expect(page.locator('#f-dot')).toHaveCount(0);
  await expect(page.locator('#f-nocase')).toHaveCount(0);

  await fillAndHold(page, 'patterns', docs.files.A);
  await fillAndHold(page, 'paths', 'README.md\nbuild/logs/x.log\napps/github/readme.md');
  await expect.poll(async () => Object.keys(await tableRows(page)).length, { timeout: 15_000 }).toBe(3);
  const a = await tableRows(page);
  // "*       @global-owner1 @global-owner2" is line 2, after the comment line.
  expect(a['README.md']).toContain('@global-owner1 @global-owner2');
  expect(a['README.md']).toContain('line 2: *');
  // "**/logs @octocat" is later than "/build/logs/ @doctocat", and the last matching line wins.
  expect(a['build/logs/x.log']).toContain('@octocat');
  expect(a['build/logs/x.log']).toContain('line 11: **/logs');
  expect(a['build/logs/x.log']).not.toContain('@doctocat');
  // "/apps/github" names no owner: the path has no owner, and that line is the one that decided it.
  expect(a['apps/github/readme.md']).toContain('no owner');
  expect(a['apps/github/readme.md']).toContain('line 13: /apps/github');
  await expect(blockLabelled(page, 'Paths with no owner')).toContainText('apps/github/readme.md');
  // The page says what it cannot check.
  await expect(outputArea(page)).toContainText('cannot check that an owner exists');

  // The second documented file gives the same path to @doctocat.
  await fillAndHold(page, 'patterns', docs.files.B);
  await expect
    .poll(async () => (await tableRows(page))['apps/github/readme.md'] ?? '', { timeout: 15_000 })
    .toContain('@doctocat');
  expect((await tableRows(page))['apps/github/readme.md']).toContain('line 2: /apps/github');
});

test('glob-tester: CODEOWNERS mode lists unsupported lines and paths with no owner', async ({ page }) => {
  test.setTimeout(120_000);
  await openTester(page);
  await chooseMode(page, 'CODEOWNERS file');
  const file = ['!foo @negated', '/apps/[param]/file.ts @bracket', 'src/***/x @stars', '*.js @js-owner', ''].join('\n');
  await fillAndHold(page, 'patterns', file);
  await fillAndHold(page, 'paths', 'foo\napps/[param]/file.ts\nsrc/a/x\nsrc/app.js\nREADME.md');
  await expect.poll(async () => Object.keys(await tableRows(page)).length, { timeout: 15_000 }).toBe(5);

  // GitHub's page says a leading ! and [ ] do not work; those lines are listed with a reason and match nothing.
  const skipped = blockLabelled(page, 'Lines GitHub does not support or skipped');
  await expect(skipped).toContainText('line 1: !foo');
  await expect(skipped).toContainText('line 2: /apps/[param]/file.ts');
  // Three stars in a row are not documented by GitHub, and the list says so for that line only.
  const items = (await skipped.locator('li').allInnerTexts()).map((item) => item.replace(/\s+/g, ' '));
  expect(items).toHaveLength(3);
  expect(items[0]).not.toContain('not documented by GitHub');
  expect(items[1]).not.toContain('not documented by GitHub');
  expect(items[2]).toContain('line 3: src/***/x');
  expect(items[2]).toContain('not documented by GitHub');

  // Nothing the unsupported lines name is owned; only the ordinary line decides.
  const rows = await tableRows(page);
  expect(rows['foo']).toContain('no owner');
  expect(rows['apps/[param]/file.ts']).toContain('no owner');
  expect(rows['src/a/x']).toContain('no owner');
  expect(rows['src/app.js']).toContain('@js-owner');
  expect(rows['src/app.js']).toContain('line 4: *.js');
  const unowned = (await blockLabelled(page, 'Paths with no owner').locator('li').allInnerTexts()).map((item) =>
    item.trim(),
  );
  expect(unowned).toEqual(['foo', 'apps/[param]/file.ts', 'src/a/x', 'README.md']);
});

test('glob-tester: the gitignore and glob modes still give their earlier answers', async ({ page }) => {
  test.setTimeout(120_000);
  await openTester(page);
  // .gitignore is still the default mode, and the glob-only boxes are hidden in it.
  await expect(page.getByRole('radio', { name: '.gitignore rules', exact: true })).toBeChecked();
  await expect(page.locator('#f-dot')).toHaveCount(0);

  // The answer git gives (recorded in the earlier unit tests): *.log ignores debug.log by line 1, and !keep.log re-includes
  // keep.log by line 2.
  await fillAndHold(page, 'patterns', '*.log\n!keep.log');
  await fillAndHold(page, 'paths', 'debug.log\nkeep.log');
  await expect.poll(async () => Object.keys(await tableRows(page)).length, { timeout: 15_000 }).toBe(2);
  const ignore = await tableRows(page);
  expect(ignore['debug.log']).toContain('ignored line 1: *.log');
  expect(ignore['debug.log']).not.toContain('not ignored');
  expect(ignore['keep.log']).toContain('not ignored line 2: !keep.log');

  // Glob mode names the first matching line.
  await chooseMode(page, 'Glob patterns');
  await expect(page.locator('#f-dot')).toBeVisible();
  await fillAndHold(page, 'patterns', 'src/**/*.ts\n**/*.test.ts');
  await fillAndHold(page, 'paths', 'src/lib/util.ts\nsrc/lib/util.test.ts\ndocs/readme.md');
  await expect
    .poll(async () => (await tableRows(page))['docs/readme.md'] ?? '', { timeout: 15_000 })
    .toContain('not matched');
  const glob = await tableRows(page);
  expect(glob['src/lib/util.ts']).toContain('matched line 1: src/**/*.ts');
  expect(glob['src/lib/util.test.ts']).toContain('matched line 1: src/**/*.ts');
  expect(glob['src/lib/util.test.ts']).toContain('line 2');
});

test('glob-tester: a CODEOWNERS run past the 5 second limit stops with a sentence about the CODEOWNERS paste', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await swallowFirstJob(page);
  await page.clock.install();
  await openTester(page);
  await chooseMode(page, 'CODEOWNERS file');
  // The file is filled first and starts nothing (there are no paths yet); the run starts when the paths arrive.
  await fillAndHold(page, 'patterns', '* @global-owner\n*.js @js-owner');
  await fillAndHold(page, 'paths', 'src/app.js');
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  // The job has been posted (and swallowed), so the run's 5 second timer exists; page time then jumps past it.
  await expect
    .poll(() => page.evaluate(() => window.__FODT_CODEOWNERS_WORKERS__!.log.join(' ')), {
      timeout: 15_000,
      intervals: [50, 100],
    })
    .toContain('out-swallowed:0:glob-tester-job');
  await page.clock.fastForward(6_000);

  const issues = outputArea(page).locator('.issue-list');
  await expect(issues).toContainText('Stopped after 5 seconds', { timeout: 5_000 });
  const message = (await issues.innerText()).replace(/\s+/g, ' ').trim();
  expect(message).toContain(
    'Stopped after 5 seconds: this CODEOWNERS file and these paths take too long to match together. Try fewer paths or fewer rules.',
  );
  // Not the glob tester's own sentence, which blames one pattern and calls the paste a .gitignore paste.
  expect(message).not.toContain('a pattern took too long');
  expect(message).not.toContain('.gitignore');
  expect(await outputArea(page).locator('table').count()).toBe(0);
  expect(await page.evaluate(() => window.__FODT_CODEOWNERS_WORKERS__!.ended)).toEqual([0]);

  // The next run works, in a new worker, and the last matching line decides.
  await fillAndHold(page, 'paths', 'src/app.js\nREADME.md');
  await expect.poll(async () => Object.keys(await tableRows(page)).length, { timeout: 15_000 }).toBe(2);
  const rows = await tableRows(page);
  expect(rows['src/app.js']).toContain('@js-owner');
  expect(rows['src/app.js']).toContain('line 2: *.js');
  expect(rows['README.md']).toContain('@global-owner');
});

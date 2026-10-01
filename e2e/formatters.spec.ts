import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';

/**
 * Behavioural proof, shared by every code formatter that runs an engine in a
 * background worker (apps/web/src/lib/run-<id>-in-worker.ts): the engine runs
 * in a worker started from a blob address built into the page's own chunk,
 * nothing is requested while formatting, a run that never answers is stopped
 * with a plain message after 10 seconds of page clock and not before, Cancel
 * stops a run at once and no time-limit message follows, a syntax error shows
 * its line and column and no formatted code, and the page keeps answering
 * throughout.
 *
 * One table drives every page: a formatter adds its row to FORMATTERS and
 * gets every generated test below. A close copy in shape of
 * e2e/htaccess-generator.spec.ts's worker wrapper (composition, not a class
 * with a private field) and Cancel helpers, and of
 * e2e/markdown-formatter.spec.ts's time-limit check -- except that the limit
 * is crossed with the page clock (Playwright's page.clock) and a worker whose
 * job is swallowed, so no production hook exists and no genuinely slow input
 * is needed (a pathological input is slow in different ways in different
 * engines).
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rel = (path: string) => path.replace(/^\//, '');

declare global {
  interface Window {
    __FODT_FORMATTER_WORKERS__?: string[];
    /** The position (in construction order) of every worker the page has terminated, in the order it did so. */
    __FODT_FORMATTER_TERMINATED__?: number[];
    /** Replies of the held worker that were produced but not yet delivered; each entry delivers one reply. */
    __FODT_HELD_REPLIES__?: (() => void)[];
    /** Delivers every held reply, and every later one at once, to whatever listeners the page still has attached. */
    __FODT_RELEASE_HELD__?: () => void;
  }
}

function outputArea(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

function cancelButtonOf(page: Page) {
  return page.getByRole('button', { name: 'Cancel', exact: true });
}

/**
 * Installs a wrapper around the global Worker constructor, before any page
 * script runs, so every construction is recorded under its own global name and
 * every terminate() call is recorded by the position of the worker it ends.
 * With `swallowFirst`, the first worker built never receives its job (as if
 * the engine were stuck inside one synchronous call); every later worker
 * behaves normally, so the next run after a stop can be proven to format.
 * With `holdFirstReply`, the first worker does its job but its reply is held
 * back until the test calls `window.__FODT_RELEASE_HELD__()`: the reply then
 * goes to whatever listeners the page still has attached to that worker, which
 * is how a reply that arrives after a newer run has been shown is produced.
 */
async function installWorkerWrapper(
  page: Page,
  options: { swallowFirst: boolean; holdFirstReply?: boolean },
): Promise<void> {
  await page.addInitScript(
    (modes: { swallowFirst: boolean; holdFirstReply: boolean }) => {
      const OriginalWorker = window.Worker;
      window.__FODT_FORMATTER_WORKERS__ = [];
      window.__FODT_FORMATTER_TERMINATED__ = [];
      window.__FODT_HELD_REPLIES__ = [];
      let released = false;
      window.__FODT_RELEASE_HELD__ = () => {
        released = true;
        for (const deliver of window.__FODT_HELD_REPLIES__!.splice(0)) deliver();
      };

      class WrappedWorker {
        inner: Worker;
        index: number;
        swallow: boolean;
        hold: boolean;
        heldListeners = new Set<EventListenerOrEventListenerObject>();
        holdInstalled = false;
        constructor(scriptURL: string | URL, workerOptions?: WorkerOptions) {
          this.inner = new OriginalWorker(scriptURL, workerOptions);
          this.index = window.__FODT_FORMATTER_WORKERS__!.length;
          this.swallow = modes.swallowFirst && this.index === 0;
          this.hold = modes.holdFirstReply && this.index === 0;
          window.__FODT_FORMATTER_WORKERS__!.push(String(scriptURL));
        }
        postMessage(...args: Parameters<Worker['postMessage']>): void {
          if (this.swallow) return;
          this.inner.postMessage(...args);
        }
        addEventListener(...args: Parameters<Worker['addEventListener']>): void {
          const [type, listener] = args;
          if (this.hold && type === 'message') {
            this.heldListeners.add(listener as EventListenerOrEventListenerObject);
            if (!this.holdInstalled) {
              this.holdInstalled = true;
              this.inner.addEventListener('message', (event) => {
                const deliver = () => {
                  // Only the listeners the page still has attached when the reply is delivered receive it.
                  for (const held of [...this.heldListeners]) {
                    if (typeof held === 'function') held.call(this.inner, event);
                    else held.handleEvent(event);
                  }
                };
                if (released) deliver();
                else window.__FODT_HELD_REPLIES__!.push(deliver);
              });
            }
            return;
          }
          this.inner.addEventListener(...args);
        }
        removeEventListener(...args: Parameters<Worker['removeEventListener']>): void {
          const [type, listener] = args;
          if (this.hold && type === 'message') {
            this.heldListeners.delete(listener as EventListenerOrEventListenerObject);
            return;
          }
          this.inner.removeEventListener(...args);
        }
        terminate(): void {
          window.__FODT_FORMATTER_TERMINATED__!.push(this.index);
          this.inner.terminate();
        }
        dispatchEvent(event: Event): boolean {
          return this.inner.dispatchEvent(event);
        }
      }

      window.Worker = WrappedWorker as unknown as typeof Worker;
    },
    { swallowFirst: options.swallowFirst, holdFirstReply: options.holdFirstReply ?? false },
  );
}

/** The position of every worker the page has terminated so far, in order. */
async function terminatedWorkers(page: Page): Promise<number[]> {
  return page.evaluate(() => window.__FODT_FORMATTER_TERMINATED__ ?? []);
}

async function workerCount(page: Page): Promise<number> {
  return page.evaluate(() => (window.__FODT_FORMATTER_WORKERS__ ?? []).length);
}

/** Starts recording every request the page makes from now on, and returns the live list. */
function recordRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  return requests;
}

/**
 * One formatter page under test. `valid` holds the textarea, text and number
 * fields to fill (field name to value); `expectOutput` is text the formatted
 * result must contain (the page text is compared with whitespace collapsed);
 * `broken`, when present, is an input the engine refuses and the exact
 * `Line N, column M` text the issue list must show for it. `newest` is a pair
 * of small valid inputs, the first naming "alpha" and the second "beta", and the
 * text the formatted second one must contain: it drives the tests that a newer
 * input replaces an older one still in flight.
 */
interface FormatterCase {
  id: string;
  valid: Record<string, string>;
  expectOutput: string;
  broken?: { input: string; issue: string };
  newest: { first: string; second: string; expectSecond: string };
}

/** The input of a live fixture file, so the page is driven by the same published text its unit tests use. */
function liveFixtureInput(id: string): string {
  const file = JSON.parse(readFileSync(join(root, 'e2e', 'live-fixtures', `${id}.json`), 'utf8')) as {
    steps: { action: string; field?: string; value?: string }[];
  };
  const step = file.steps.find((s) => s.action === 'fill' && s.field === 'input');
  if (!step || typeof step.value !== 'string') throw new Error(`e2e/live-fixtures/${id}.json has no input step`);
  return step.value;
}

const FORMATTERS: FormatterCase[] = [
  {
    id: 'go-formatter',
    // Go's own gofmt testdata import.input, and a run of the sorted import block from import.golden (Go 1.25.5,
    // https://github.com/golang/go/tree/go1.25.5/src/cmd/gofmt/testdata, BSD-3-Clause).
    valid: { input: liveFixtureInput('go-formatter') },
    expectOutput: 'import ( "errors" "fmt" "io" "log" "math" )',
    // Counted by hand: line 1 package main, line 2 blank, line 3 func main() {, line 4 x := (tab, then the
    // operator, nothing after it), line 5 the lone closing brace where an operand must follow, column 1.
    broken: { input: 'package main\n\nfunc main() {\n\tx :=\n}\n', issue: 'Line 5, column 1' },
    newest: {
      first: 'package alpha\n\nfunc a(){}\n',
      second: 'package beta\n\nfunc b(){}\n',
      expectSecond: 'package beta',
    },
  },
  {
    id: 'python-formatter',
    // Ruff's own quote_style.py fixture, formatted with the default options (double quotes): a line of Output 2 of
    // format@quote_style.py.snap (Ruff 0.15.20, https://github.com/astral-sh/ruff/tree/0.15.20/crates/ruff_python_formatter,
    // MIT). The fixture's input is the one the live fixture types.
    valid: { input: liveFixtureInput('python-formatter') },
    expectOutput: 'rb"br double"',
    // Counted by hand: in `def f(:` the letters d, e, f, a space and f are columns 1 to 5, the opening parenthesis is
    // column 6 and the colon, where a parameter or the closing parenthesis must be, is column 7 on line 1.
    broken: { input: 'def f(:\n  pass\n', issue: 'Line 1, column 7' },
    newest: { first: 'def alpha():\n  pass\n', second: 'def beta():\n  pass\n', expectSecond: 'def beta():' },
  },
  {
    id: 'shell-formatter',
    // shfmt's own flags.txtar fixture (mvdan/sh v3.13.1, https://github.com/mvdan/sh/blob/v3.13.1/cmd/shfmt/testdata/script/flags.txtar,
    // BSD-3-Clause), formatted with the default dialect and indent: a line of the published output (the default differs
    // from the keep-padding golden only in the padding line).
    valid: { input: liveFixtureInput('shell-formatter') },
    expectOutput: 'space >redirs',
    // Counted by hand: the unfinished `if` starts the script, so it is line 1, column 1.
    broken: { input: 'if true; then\n  echo hi\n', issue: 'Line 1, column 1' },
    newest: { first: 'echo alpha\n', second: 'echo beta\n', expectSecond: 'echo beta' },
  },
  {
    id: 'c-family-formatter',
    // clang-format's own unit test FormatTest.SeparatesLogicalBlocks (FormatTest.cpp line 3745, llvmorg-23.1.1,
    // https://github.com/llvm/llvm-project/blob/llvmorg-23.1.1/clang/unittests/Format/FormatTest.cpp, Apache-2.0
    // WITH LLVM-exception), formatted with the default language, preset and indent width (C++, LLVM, the preset's own
    // width): a line of its expected output.
    valid: { input: 'class A {\npublic:\nvoid f();\nprivate:\nvoid g() {}\n// test\nprotected:\nint h;\n};' },
    expectOutput: 'private: void g() {} // test protected: int h; };',
    // No broken input: clang-format reports no syntax errors, it formats malformed code best effort.
    newest: { first: 'int alpha;\n', second: 'int beta;\n', expectSecond: 'int beta;' },
  },
  {
    id: 'dart-formatter',
    // dart_style's own import.unit case 'Wrap before "deferred".' (test/tall/top_level/import.unit, v3.1.4,
    // https://github.com/dart-lang/dart_style/blob/v3.1.4/test/tall/top_level/import.unit, BSD-3-Clause), whose
    // header sets a page width of 40: the second line of its expected output. The same input and width the live
    // fixture types.
    valid: { lineWidth: '40', input: liveFixtureInput('dart-formatter') },
    expectOutput: 'deferred as path;',
    // Counted by hand: two lines, each ended by a line break, and a closing brace that never comes, so the
    // formatter looks for it at the end of the input: line 3, column 1.
    broken: { input: 'void main() {\n  print(1);\n', issue: 'Line 3, column 1' },
    newest: { first: 'var alpha=1;\n', second: 'var beta=1;\n', expectSecond: 'var beta = 1;' },
  },
  {
    id: 'php-formatter',
    // The first case of the Prettier PHP plugin's own array snapshot (tests/array/__snapshots__/jsfmt.spec.mjs.snap,
    // case arrays.php 1, tag v0.25.0, https://github.com/prettier/plugin-php/tree/v0.25.0/tests/array, MIT),
    // printed with the default options (print width 80, indent width 4, double quotes, PHP version 8.5): a line of
    // its published output. The same input the live fixture types.
    valid: { input: liveFixtureInput('php-formatter') },
    expectOutput: '$other_test = [1, 2, 123.4324, $hi];',
    // Counted by hand: line 2 is `$a = ;`, the dollar sign is column 1 and the semicolon, where an expression must
    // be, is column 6 (the plugin counts from zero and says 5).
    broken: { input: '<?php\n$a = ;\n', issue: 'Line 2, column 6' },
    newest: { first: '<?php echo "alpha";\n', second: '<?php echo "beta";\n', expectSecond: 'echo "beta";' },
  },
];

/** A second valid input that differs from the first by one trailing line break, so it is a new run. */
function secondValid(valid: Record<string, string>): Record<string, string> {
  return { ...valid, input: `${valid.input ?? ''}\n` };
}

async function openFormatter(page: Page, id: string): Promise<void> {
  await page.goto(rel(`/tools/${id}`));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
}

async function fillFields(page: Page, fields: Record<string, string>): Promise<void> {
  for (const [name, value] of Object.entries(fields)) await page.locator(`#f-${name}`).fill(value);
}

/** Page time in milliseconds, read from the page itself so it follows the page clock. */
async function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => Date.now());
}

for (const c of FORMATTERS) {
  test(`${c.id}: formats in a background worker started from a blob address and requests nothing`, async ({ page }) => {
    await installWorkerWrapper(page, { swallowFirst: false });
    await openFormatter(page, c.id);

    // Recorded only after the page and its own chunk have loaded, so this
    // asserts nothing is requested while processing the visitor's own input
    // -- not that the page itself loaded with zero requests.
    const requests = recordRequests(page);

    await fillFields(page, c.valid);
    await expect(outputArea(page)).toContainText(c.expectOutput, { timeout: 15_000 });

    const workers = await page.evaluate(() => window.__FODT_FORMATTER_WORKERS__ ?? []);
    expect(workers.length).toBeGreaterThanOrEqual(1);
    for (const address of workers) expect(address.startsWith('blob:')).toBe(true);

    // A worker that finished its job is ended too: every worker the page built has been terminated.
    await expect.poll(async () => (await terminatedWorkers(page)).length).toBe(workers.length);

    const offending = requests.filter((url) => !url.startsWith('data:') && !url.startsWith('blob:'));
    expect(offending).toEqual([]);
  });

  test(`${c.id}: a run past the 10 second limit stops with a plain message, not before, and the page stays usable`, async ({
    page,
  }) => {
    // The first worker never receives its job, so the run stays in flight like a stuck engine, and the page
    // clock (not real time) crosses the limit.
    await installWorkerWrapper(page, { swallowFirst: true });
    await page.clock.install();
    await openFormatter(page, c.id);

    // Page time before the run is started: the run's own timer begins a little after this (the input debounce), so
    // no more than this much page time has passed on it at any moment measured from here.
    const before = await pageNow(page);
    await fillFields(page, c.valid);
    await expect(cancelButtonOf(page)).toBeVisible();

    // Real time, not page time: the run's debounce has fired and its limit timer exists before the clock moves.
    // Moving the clock first would let real seconds pass instead (the page's own timer would not exist yet).
    await page.waitForTimeout(800);

    // 8 seconds into a stuck run: still running, no stop message, and the stuck worker is not yet ended.
    await page.clock.fastForward(Math.max(0, before + 8_000 - (await pageNow(page))));
    await expect(cancelButtonOf(page)).toBeVisible();
    await expect(outputArea(page)).not.toContainText('Stopped after');
    expect(await terminatedWorkers(page)).toEqual([]);

    // 9.9 seconds in, at the most: still running. A limit that fired at 9 seconds would already have stopped it.
    await page.clock.fastForward(Math.max(0, before + 9_900 - (await pageNow(page))));
    await expect(cancelButtonOf(page)).toBeVisible();
    await expect(outputArea(page)).not.toContainText('Stopped after');
    expect(await terminatedWorkers(page)).toEqual([]);

    // 12 seconds in: stopped, with the plain message, and the timed-out worker has been terminated.
    await page.clock.fastForward(Math.max(0, before + 12_000 - (await pageNow(page))));
    await expect(outputArea(page).locator('.issue-list')).toContainText('Stopped after 10 seconds', {
      timeout: 15_000,
    });
    expect(await outputArea(page).locator('pre.output').count()).toBe(0);
    expect(await terminatedWorkers(page)).toEqual([0]);

    // The page still answers a script call within a second.
    const answerStart = Date.now();
    await page.evaluate(() => 1 + 1);
    expect(Date.now() - answerStart).toBeLessThan(1_000);

    // The next input formats normally, in a new worker.
    await fillFields(page, secondValid(c.valid));
    await expect(outputArea(page)).toContainText(c.expectOutput, { timeout: 15_000 });
    expect(await workerCount(page)).toBeGreaterThanOrEqual(2);
  });

  test(`${c.id}: Cancel stops a run at once, no time-limit message follows, and the next run formats`, async ({
    page,
  }) => {
    await installWorkerWrapper(page, { swallowFirst: true });
    await page.clock.install();
    await openFormatter(page, c.id);

    await fillFields(page, c.valid);
    await expect(cancelButtonOf(page)).toBeVisible();
    await page.waitForTimeout(800);
    expect(await terminatedWorkers(page)).toEqual([]);
    await cancelButtonOf(page).click();

    const note = outputArea(page).locator('.note-warn');
    await expect(note).toHaveText('Cancelled before finishing. No result was produced.');
    expect(await outputArea(page).locator('pre.output').count()).toBe(0);
    // The cancelled worker has been terminated, not just forgotten.
    expect(await terminatedWorkers(page)).toEqual([0]);

    // 11 seconds of page clock later the limit would have fired had Cancel not cleared it: it must not.
    await page.clock.fastForward(11_000);
    await page.waitForTimeout(300);
    await expect(outputArea(page)).not.toContainText('Stopped after');
    await expect(note).toHaveText('Cancelled before finishing. No result was produced.');

    // The next input formats normally.
    await fillFields(page, secondValid(c.valid));
    await expect(outputArea(page)).toContainText(c.expectOutput, { timeout: 15_000 });
  });

  if (c.broken) {
    const broken = c.broken;
    test(`${c.id}: a syntax error shows its line and column and no formatted code`, async ({ page }) => {
      await openFormatter(page, c.id);
      await fillFields(page, { ...c.valid, input: broken.input });
      await expect(outputArea(page).locator('.issue-list')).toContainText(broken.issue, { timeout: 15_000 });
      expect(await outputArea(page).locator('pre.output').count()).toBe(0);
    });
  }

  test(`${c.id}: blank input starts no worker and shows nothing`, async ({ page }) => {
    await installWorkerWrapper(page, { swallowFirst: false });
    await openFormatter(page, c.id);

    await page.locator('#f-input').fill('   \n');
    // Past the 140 ms auto-run debounce with room to spare.
    await page.waitForTimeout(1_500);

    expect(await workerCount(page)).toBe(0);
    expect(await outputArea(page).locator('pre.output').count()).toBe(0);
    expect(await outputArea(page).locator('.issue-list').count()).toBe(0);
    expect(await cancelButtonOf(page).count()).toBe(0);
  });

  test(`${c.id}: when the input changes during a run only the newest input is formatted`, async ({ page }) => {
    // The first worker never answers, so the first input is still in flight when the second arrives.
    await installWorkerWrapper(page, { swallowFirst: true });
    await openFormatter(page, c.id);

    await page.locator('#f-input').fill(c.newest.first);
    await expect(cancelButtonOf(page)).toBeVisible();
    await page.locator('#f-input').fill(c.newest.second);

    await expect(outputArea(page)).toContainText(c.newest.expectSecond, { timeout: 15_000 });
    await expect(outputArea(page)).not.toContainText('alpha');
    expect(await outputArea(page).locator('pre.output').count()).toBe(1);
    expect(await workerCount(page)).toBeGreaterThanOrEqual(2);
    // The replaced run's worker was ended as soon as the newer input arrived.
    expect(await terminatedWorkers(page)).toContain(0);
  });

  test(`${c.id}: a reply that arrives after a newer input has been shown does not change the shown result`, async ({
    page,
  }) => {
    // The first worker does its job, but its reply is held back by the test. By the time it is let through the page has
    // moved on to the second input, so the late reply meets whatever the page still has listening to that worker.
    await installWorkerWrapper(page, { swallowFirst: false, holdFirstReply: true });
    await openFormatter(page, c.id);

    await page.locator('#f-input').fill(c.newest.first);
    // The first worker has produced its reply (held), so there is something to arrive late.
    await expect
      .poll(async () => page.evaluate(() => (window.__FODT_HELD_REPLIES__ ?? []).length), { timeout: 15_000 })
      .toBe(1);

    await page.locator('#f-input').fill(c.newest.second);
    await expect(outputArea(page)).toContainText(c.newest.expectSecond, { timeout: 15_000 });
    await expect(outputArea(page)).not.toContainText('alpha');
    const shown = await outputArea(page).innerText();

    // Let the old worker's reply through, then give the page time to act on it.
    await page.evaluate(() => window.__FODT_RELEASE_HELD__?.());
    expect(await page.evaluate(() => (window.__FODT_HELD_REPLIES__ ?? []).length)).toBe(0);
    await page.waitForTimeout(500);

    await expect(outputArea(page)).not.toContainText('alpha');
    expect(await outputArea(page).innerText()).toBe(shown);
    expect(await outputArea(page).locator('pre.output').count()).toBe(1);
    expect(await terminatedWorkers(page)).toContain(0);
  });
}

test('shell-formatter: a mksh coprocess formats under mksh and is refused under bash in this browser', async ({
  page,
}) => {
  await openFormatter(page, 'shell-formatter');

  // flags.txtar (mvdan/sh v3.13.1) section input-mksh: `coprocess |&` is valid only in mksh. Counted by hand:
  // coprocess is nine letters, a space is column 10, so the `|&` that has no statement after it is column 11.
  await page.locator('#f-input').fill('coprocess |&\n');
  await page.locator('#f-dialect').selectOption('mksh');
  await expect(outputArea(page).locator('pre.output')).toContainText('coprocess |&', { timeout: 15_000 });
  expect(await outputArea(page).locator('.issue-list').count()).toBe(0);

  await page.locator('#f-dialect').selectOption('bash');
  await expect(outputArea(page).locator('.issue-list')).toContainText('Line 1, column 11', { timeout: 15_000 });
  expect(await outputArea(page).locator('pre.output').count()).toBe(0);
});

// One published two-argument case per language, taken from clang-format's own unit tests (llvmorg-23.1.1,
// https://github.com/llvm/llvm-project/tree/llvmorg-23.1.1/clang/unittests/Format, Apache-2.0 WITH LLVM-exception),
// each under the preset its test file uses with no option changed.
const SIX_LANGUAGE_CASES: { language: string; preset: string; source: string; input: string; expected: string }[] = [
  {
    // clang/unittests/Format/FormatTest.cpp line 3745, FormatTest.SeparatesLogicalBlocks
    language: 'cpp',
    preset: 'LLVM',
    source: 'FormatTest.SeparatesLogicalBlocks',
    input: 'class A {\npublic:\nvoid f();\nprivate:\nvoid g() {}\n// test\nprotected:\nint h;\n};',
    expected: 'class A {\npublic:\n  void f();\n\nprivate:\n  void g() {}\n  // test\nprotected:\n  int h;\n};',
  },
  {
    // clang/unittests/Format/FormatTest.cpp line 12267, FormatTest.UnderstandsNewAndDelete
    language: 'c',
    preset: 'LLVM',
    source: 'FormatTest.UnderstandsNewAndDelete',
    input: 'void new (link p);\nvoid delete (link p);',
    expected: 'void new(link p);\nvoid delete(link p);',
  },
  {
    // clang/unittests/Format/FormatTestCSharp.cpp line 1706, FormatTestCSharp.GotoCaseLabel
    language: 'csharp',
    preset: 'Microsoft',
    source: 'FormatTestCSharp.GotoCaseLabel',
    input: 'switch (i) {\ncase 0:\n  goto case 1;\ncase 1:\n  j = 0;\n  {\n    break;\n  }\n}',
    expected: 'switch (i)\n{\ncase 0:\n    goto case 1;\ncase 1:\n    j = 0;\n    {\n        break;\n    }\n}',
  },
  {
    // clang/unittests/Format/FormatTestJava.cpp line 851, FormatTestJava.TextBlock
    language: 'java',
    preset: 'Google',
    source: 'FormatTestJava.TextBlock',
    input: 'String foo="""\n    bar\n    \\\\""" ;',
    expected: 'String foo = """\n    bar\n    \\\\""";',
  },
  {
    // clang/unittests/Format/FormatTestObjC.cpp line 571, FormatTestObjC.FormatObjCMethodDeclarations
    language: 'objc',
    preset: 'LLVM',
    source: 'FormatTestObjC.FormatObjCMethodDeclarations',
    input: '/*\n */- (void)foo;',
    expected: '/*\n */\n- (void)foo;',
  },
  {
    // clang/unittests/Format/FormatTestProto.cpp line 197, FormatTestProto.DoesntWrapFileOptions
    language: 'proto',
    preset: 'Google',
    source: 'FormatTestProto.DoesntWrapFileOptions',
    input: 'option    java_package   =    "some.really.long.package.that.exceeds.the.column.limit";',
    expected: 'option java_package = "some.really.long.package.that.exceeds.the.column.limit";',
  },
];

test('c-family-formatter: each of the six languages formats in this browser', async ({ page }) => {
  await openFormatter(page, 'c-family-formatter');

  for (const c of SIX_LANGUAGE_CASES) {
    await page.locator('#f-language').selectOption(c.language);
    await page.locator('#f-preset').selectOption(c.preset);
    await page.locator('#f-input').fill(c.input);

    // The formatted block is exactly the unit test's expected text, whitespace included.
    const block = outputArea(page).locator('pre.output').first();
    await expect
      .poll(async () => (await block.textContent()) ?? '', { message: `${c.language} (${c.source})`, timeout: 15_000 })
      .toBe(c.expected);
    expect(await outputArea(page).locator('.issue-list').count()).toBe(0);
  }
});

test('dart-formatter: the line width decides where an import wraps in this browser', async ({ page }) => {
  await openFormatter(page, 'dart-formatter');
  const block = outputArea(page).locator('pre.output').first();

  // dart_style's own import.unit case 'Wrap before "deferred".' at the header's width of 40 wraps before
  // deferred; at the default width of 80 the same import stays on one line.
  await page.locator('#f-input').fill("import 'package:foo/foo.dart' deferred as path;\n");
  await page.locator('#f-lineWidth').fill('40');
  await expect
    .poll(async () => (await block.textContent()) ?? '', { timeout: 15_000 })
    .toBe("import 'package:foo/foo.dart'\n    deferred as path;\n");

  await page.locator('#f-lineWidth').fill('80');
  await expect
    .poll(async () => (await block.textContent()) ?? '', { timeout: 15_000 })
    .toBe("import 'package:foo/foo.dart' deferred as path;\n");
});

test('php-formatter: the single quote option and the trailing comma default reach the formatter in this browser', async ({
  page,
}) => {
  await openFormatter(page, 'php-formatter');
  const block = outputArea(page).locator('pre.output').first();

  // The Prettier PHP plugin's own test of the single quote option (tests/single-quote-api/jsfmt.spec.mjs, tag v0.25.0,
  // https://github.com/prettier/plugin-php/blob/v0.25.0/tests/single-quote-api/jsfmt.spec.mjs, MIT): its input, and its
  // expected output, which also shows the trailing comma the plugin prints by default.
  await page
    .locator('#f-input')
    .fill('<?php echo link_to_route("frontend.users.user.show", $users["name"], $users[\'_id\']); ?>');
  await page.locator('#f-singleQuote').check();
  await expect
    .poll(async () => (await block.textContent()) ?? '', { timeout: 15_000 })
    .toBe(
      "<?php echo link_to_route(\n    'frontend.users.user.show',\n    $users['name'],\n    $users['_id'],\n); ?>\n",
    );
});

test('php-formatter: source with no opening tag shows a note above the output, and source with one does not', async ({
  page,
}) => {
  await openFormatter(page, 'php-formatter');
  const note = outputArea(page).locator('.note-info');
  const block = outputArea(page).locator('pre.output').first();

  // Text outside PHP tags is inline HTML to the plugin: it comes back as it went in, and the page says why.
  await page.locator('#f-input').fill('echo   1;\n');
  await expect(note).toContainText('no <?php', { timeout: 15_000 });
  await expect.poll(async () => (await block.textContent()) ?? '', { timeout: 15_000 }).toBe('echo   1;\n');
  const noteBox = await note.boundingBox();
  const blockBox = await block.boundingBox();
  expect(noteBox!.y).toBeLessThan(blockBox!.y);

  // With an opening tag the code is formatted and there is no note.
  await page.locator('#f-input').fill('<?php echo   1;\n');
  await expect.poll(async () => (await block.textContent()) ?? '', { timeout: 15_000 }).toBe('<?php echo 1;\n');
  expect(await note.count()).toBe(0);

  // The short echo tag counts as an opening tag too.
  await page.locator('#f-input').fill('<p><?= $x ?></p>\n');
  await expect(block).toBeVisible({ timeout: 15_000 });
  expect(await note.count()).toBe(0);
});

/**
 * The canonical "never runs the pasted code" check (D-70). Test-only: never
 * imported by package source. Copied byte for byte into every tool whose
 * job is to parse, not run, JavaScript, TypeScript or markup that can carry
 * script. This header names no tool folder so it stays true wherever it lands.
 */

/**
 * A payload that a real evaluation path would visibly affect (sets a global,
 * then throws), but a syntax-tree-only parse never touches.
 */
export const NEVER_RUN_JS = `(function () {
  globalThis.__fodtNeverRun = 1;
  throw new Error('pasted code ran');
})();`;

/** The same payload with a type annotation and an interface in front, for a tool that accepts TypeScript. */
export const NEVER_RUN_TS = `interface FodtNeverRunFlag { armed: boolean }
(function (): void {
  const flag: FodtNeverRunFlag = { armed: true };
  (globalThis as unknown as { __fodtNeverRun?: number }).__fodtNeverRun = flag.armed ? 1 : 1;
  throw new Error('pasted code ran');
})();`;

/** The same payload as markup: a script element, plus an img whose error handler sets the same global. */
export const NEVER_RUN_MARKUP = `<script>${NEVER_RUN_JS}</script><img src="x" onerror="globalThis.__fodtNeverRun = 1">`;

type NeverRunGlobal = typeof globalThis & { __fodtNeverRun?: number };

/**
 * Runs `action`, then fails if any of three things happened: the never-run
 * global ended up set, the global evaluator (`eval`) was called, or `action`
 * threw an error whose message is exactly `pasted code ran` (the payload's
 * own throw, meaning it executed). Removes the global before and after, and
 * restores the real evaluator in a `finally`, so one call cannot affect the
 * next.
 */
export async function assertNeverRan(action: () => unknown | Promise<unknown>): Promise<void> {
  const g = globalThis as NeverRunGlobal;
  delete g.__fodtNeverRun;

  const realEval = g.eval;
  let evalWasCalled = false;
  g.eval = ((..._args: unknown[]) => {
    evalWasCalled = true;
    throw new Error('assertNeverRan: the global evaluator was called.');
  }) as typeof eval;

  try {
    let thrown: unknown;
    try {
      await action();
    } catch (err) {
      thrown = err;
    }

    if (g.__fodtNeverRun !== undefined) {
      throw new Error('assertNeverRan: the never-run global was set, so the pasted code ran.');
    }
    if (evalWasCalled) {
      throw new Error('assertNeverRan: the global evaluator was called.');
    }
    if (thrown instanceof Error && thrown.message === 'pasted code ran') {
      throw new Error("assertNeverRan: the action threw the payload's own error, meaning it executed the payload.");
    }
  } finally {
    g.eval = realEval;
    delete g.__fodtNeverRun;
  }
}

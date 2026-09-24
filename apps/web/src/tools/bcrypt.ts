import { meta, hashPassword, verifyPassword, estimateCostDuration, normaliseTag, COST_RANGE } from '@fodt/bcrypt';
import { bcryptInWorker } from '../lib/run-bcrypt-in-worker';
import { defineTool, str, num, type OutputBlock, type ToolResult } from '../lib/tool-ui';

/**
 * D-14: work above this cost runs on the worker so the tab stays
 * responsive; at or below it, calling the package directly is faster than
 * the round trip to a worker would be. Matches UI-SPEC Section 2 and the
 * warning threshold D-06 sets.
 */
const WORKER_THRESHOLD = 12;

/** A rough, plain-language rendering of the millisecond estimate `estimateCostDuration` returns. */
function formatDuration(ms: number): string {
  if (ms < 1000) return `about ${Math.max(1, Math.round(ms))} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `about ${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} seconds`;
  return `about ${(seconds / 60).toFixed(1)} minutes`;
}

/**
 * A test-only affordance, exposing `bcryptInWorker` directly so the
 * browser test suite can call it with a signal that was aborted before
 * the call was made. No real user interaction can reach that path:
 * `ToolRunner` always hands `run()` a freshly constructed, non-aborted
 * `AbortController` for every run, so the only way to exercise this
 * defensive branch honestly is a direct call. Same pattern
 * `apps/web/src/tools/hash-file.ts` (plan 02-10) uses for the same
 * reason. Unconditionally assigned, and a real visitor never reads or
 * calls it.
 */
declare global {
  interface Window {
    __FODT_BCRYPT_TEST_HOOKS__?: { bcryptInWorker: typeof bcryptInWorker };
  }
}
if (typeof window !== 'undefined') {
  window.__FODT_BCRYPT_TEST_HOOKS__ = { bcryptInWorker };
}

export default defineTool({
  id: 'bcrypt',
  // The second worker-backed page on this site: a slow cost factor is real
  // background work, so this waits for a deliberate Run press rather than
  // hashing on every keystroke, and offers a Cancel button while a
  // above-threshold run is in flight.
  autoRun: false,
  cancellable: true,
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'hash',
      options: [
        { value: 'hash', label: 'Hash a password' },
        { value: 'verify', label: 'Verify a password against a hash' },
      ],
    },
    {
      name: 'password',
      label: 'Password',
      type: 'text',
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      default: '',
    },
    {
      name: 'cost',
      label: 'Cost factor',
      type: 'range',
      default: COST_RANGE.default,
      min: COST_RANGE.min,
      max: COST_RANGE.max,
      step: 1,
      help: `${COST_RANGE.min} (fastest) to ${COST_RANGE.max} (slowest, and strongest). Verifying an existing hash reads its own cost and is not affected by this control.`,
      visible: (v) => v.mode !== 'verify',
    },
    {
      name: 'hash',
      label: 'Hash to verify against',
      type: 'textarea',
      rows: 2,
      mono: true,
      placeholder: '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
      visible: (v) => v.mode === 'verify',
    },
  ],
  examples: [
    { label: 'Hash at the default cost', values: { mode: 'hash', password: 'correct horse battery staple' } },
    {
      label: 'Verify a known hash',
      values: {
        mode: 'verify',
        password: 'password',
        hash: '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
      },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const mode = str(values, 'mode', 'hash');
    const password = str(values, 'password');
    if (!password) return { outputs: [] };

    if (mode === 'hash') {
      const cost = Math.round(num(values, 'cost', COST_RANGE.default));
      const aboveThreshold = cost > WORKER_THRESHOLD;

      let report;
      try {
        report = aboveThreshold
          ? await bcryptInWorker({ operation: 'hash', password, cost }, ctx)
          : await hashPassword(password, cost, { onProgress: ctx.onProgress, signal: ctx.signal });
      } catch (err) {
        // An abort rejection is let through rather than swallowed: the
        // runner's own cancellation note already owns that message.
        if (ctx.signal.aborted) throw err;
        // Not only BcryptError: a native worker failure crosses the worker
        // boundary as a plain Error (run-bcrypt-in-worker.ts's own fixed
        // messages), and its message is exactly as descriptive as a
        // BcryptError's. Checked here, not with `instanceof BcryptError`,
        // which would silently discard that message in favour of a vaguer
        // fallback -- found and fixed while writing this page's own
        // native-failure browser scenarios.
        return {
          outputs: [],
          errors: [{ message: err instanceof Error ? err.message : 'Could not hash this password.' }],
        };
      }

      const outputs: OutputBlock[] = [{ kind: 'code', label: 'Hash', value: report.hash }];
      // The cost warning is a note on the result, not a limits entry: it
      // depends on the cost the visitor just chose, while the truncation
      // statement below is always true and lives in the limits list.
      if (aboveThreshold) {
        outputs.push({
          kind: 'note',
          tone: 'warn',
          value: `Cost ${cost} takes ${formatDuration(estimateCostDuration(cost))} on typical current hardware.`,
        });
      }

      const stats: [string, string][] = [
        ['Cost', String(cost)],
        ['Tag', report.tag],
        [
          'Password length',
          report.truncation.truncated
            ? `truncated: bcrypt only used the first 72 of ${report.truncation.byteLength} bytes${
                report.truncation.splitsCharacter ? ' (the cut falls inside a multi-byte character)' : ''
              }`
            : `${report.truncation.byteLength} byte${report.truncation.byteLength === 1 ? '' : 's'}, not truncated`,
        ],
      ];

      return { outputs, stats };
    }

    // Verify mode.
    const hash = str(values, 'hash').trim();
    if (!hash) return { outputs: [] };

    // Read the cost out of the hash itself (unbounded, D-06) to decide
    // whether this run belongs on the worker. A malformed hash makes this
    // throw; swallowed here on purpose so the direct call below produces
    // the real, descriptive error instead of a generic worker failure.
    let aboveThreshold = false;
    try {
      aboveThreshold = normaliseTag(hash).cost > WORKER_THRESHOLD;
    } catch {
      aboveThreshold = false;
    }

    let report;
    try {
      report = aboveThreshold
        ? await bcryptInWorker({ operation: 'verify', password, hash }, ctx)
        : await verifyPassword(password, hash, { onProgress: ctx.onProgress, signal: ctx.signal });
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      // See the identical note in hash mode above: checked against Error,
      // not only BcryptError, so a native worker failure's own descriptive
      // message is not discarded in favour of a vaguer fallback.
      return {
        outputs: [],
        errors: [{ message: err instanceof Error ? err.message : 'Could not check this hash.' }],
      };
    }

    const outputs: OutputBlock[] = [];
    // An exhaustive switch over the three outcomes: a fourth value, or a
    // missing branch, fails typecheck via the `never` assignment in
    // `default`. No binary correct/incorrect mapping exists anywhere on
    // this page -- that is exactly what would turn `cannot-check` back
    // into the forbidden "Incorrect" answer.
    switch (report.outcome) {
      case 'correct':
        outputs.push({ kind: 'note', tone: 'success', value: 'Correct. This password matches the hash.' });
        break;
      case 'incorrect':
        outputs.push({ kind: 'note', tone: 'error', value: 'Incorrect. This password does not match the hash.' });
        break;
      case 'cannot-check':
        outputs.push({ kind: 'note', tone: 'warn', value: report.message ?? 'This tool cannot check this hash.' });
        break;
      default: {
        const exhaustiveCheck: never = report.outcome;
        throw new Error(`Unhandled verify outcome: ${String(exhaustiveCheck)}`);
      }
    }

    const stats: [string, string][] = [
      ['Cost (read from the hash)', String(report.cost)],
      ['Tag', report.tag],
    ];
    if (report.wasNormalised) {
      stats.push(['Normalised', 'yes, before verification (the library refuses this tag outright otherwise)']);
    }

    return { outputs, stats };
  },
});

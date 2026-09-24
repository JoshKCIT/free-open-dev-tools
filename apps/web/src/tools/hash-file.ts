import { meta, ALGORITHMS, digestsMatch, type OutputFormat } from '@fodt/hash-file';
import { hashFileInWorker } from '../lib/run-in-worker';
import {
  defineTool,
  bool,
  str,
  files,
  formatBytes,
  type Field,
  type OutputBlock,
  type ToolResult,
} from '../lib/tool-ui';

const algorithmFields: Field[] = ALGORITHMS.map((a) => ({
  name: `algo-${a.id}`,
  label: a.label,
  type: 'checkbox',
  // SHA-256 checked by default: the sensible general-purpose choice, and
  // what lets a visitor who only wants one answer press Run immediately.
  default: a.id === 'sha256',
}));

/**
 * A test-only affordance, read only when the browser test suite sets it
 * before the page loads. A correct implementation can finish hashing a
 * few-megabyte file in a single chunk at the production chunk size before
 * a browser test can ever observe an intermediate progress value or click
 * Cancel, which would make the progress and cancel scenarios flaky rather
 * than deterministic. This lets e2e/hash-file.spec.ts force a small file
 * to span many chunks instead of growing the file into the hundreds of
 * megabytes range just to slow it down. Absent -- which is every real
 * visit -- this changes nothing: hashFileInWorker's own default (the
 * production chunk size) applies exactly as it would without this check
 * existing at all.
 */
/**
 * A second test-only affordance, exposing hashFileInWorker itself so the
 * browser test suite can call it directly with a signal that was aborted
 * before the call was made. No real user interaction can reach that path:
 * ToolRunner always hands run() a freshly constructed, non-aborted
 * AbortController for every run, so the only way to observe this
 * defensive branch is a direct call carrying an already-aborted signal.
 * Assigning a function reference here costs a real visitor nothing --
 * nobody calls it outside a test.
 */
declare global {
  interface Window {
    __FODT_HASH_FILE_TEST_CHUNK_SIZE__?: number;
    __FODT_HASH_FILE_TEST_HOOKS__?: { hashFileInWorker: typeof hashFileInWorker };
  }
}
if (typeof window !== 'undefined') {
  window.__FODT_HASH_FILE_TEST_HOOKS__ = { hashFileInWorker };
}

export default defineTool({
  id: 'hash-file',
  // The first worker-backed page on this site: reading and hashing a large
  // file is real background work, so this waits for a deliberate Run press
  // rather than starting the moment a file is picked, and offers a Cancel
  // button while that work is in flight.
  autoRun: false,
  cancellable: true,
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    // No accept filter: any file works, which is the whole point.
    { name: 'file', label: 'File', type: 'file' },
    ...algorithmFields,
    {
      name: 'output',
      label: 'Show digests as',
      type: 'select',
      default: 'hex',
      options: [
        { value: 'hex', label: 'Lowercase hex' },
        { value: 'HEX', label: 'Uppercase hex' },
        { value: 'base64', label: 'Base64' },
        { value: 'base64url', label: 'Base64url' },
      ],
    },
    {
      name: 'expected',
      label: 'Compare against a checksum (optional)',
      type: 'text',
      placeholder: 'Paste a checksum to check it against the results above',
      mono: true,
    },
  ],
  examples: [{ label: 'Also check SHA-1', values: { 'algo-sha1': true } }],
  async run(values, ctx): Promise<ToolResult> {
    const picked = files(values, 'file');
    if (picked.length === 0) return { outputs: [] };
    const file = picked[0]!;

    const algorithms = ALGORITHMS.filter((a) => bool(values, `algo-${a.id}`)).map((a) => a.id);
    if (algorithms.length === 0) {
      return { outputs: [], errors: [{ message: 'Choose at least one algorithm.' }] };
    }

    const format = str(values, 'output', 'hex') as OutputFormat;

    let results;
    try {
      const testChunkSize = typeof window !== 'undefined' ? window.__FODT_HASH_FILE_TEST_CHUNK_SIZE__ : undefined;
      results =
        testChunkSize && testChunkSize > 0
          ? await hashFileInWorker(file, algorithms, format, ctx, testChunkSize)
          : await hashFileInWorker(file, algorithms, format, ctx);
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the
      // runner's own catch path plus the cancel handler already own the
      // single cancellation note, and returning nothing here would fail
      // the typecheck outright (run() must return ToolResult |
      // Promise<ToolResult>, and undefined satisfies neither). Producing a
      // second note here for the exact same cancel would give the visitor
      // two notes for one cancel, which is the one exception to catching
      // every rejection below.
      if (ctx.signal.aborted) throw err;
      return {
        outputs: [],
        errors: [{ message: `Could not read '${file.name}': ${err instanceof Error ? err.message : String(err)}` }],
      };
    }

    const outputs: OutputBlock[] = [];
    const expected = str(values, 'expected').trim();
    if (expected) {
      const matched = results.filter((r) => digestsMatch(r.digest, expected));
      if (matched.length > 0) {
        outputs.push({
          kind: 'note',
          tone: 'success',
          value: `That checksum matches ${matched.map((m) => m.label).join(' and ')} of this file.`,
        });
      } else {
        const normalizedExpectedLength = expected.replace(/[\s:_-]/g, '').length;
        const anyLengthMatches = results.some((r) => r.digest.length === normalizedExpectedLength);
        outputs.push({
          kind: 'note',
          tone: 'warn',
          value: anyLengthMatches
            ? 'That checksum does not match any selected algorithm for this file.'
            : "That checksum's length does not match any selected algorithm at the current output format. Check that you selected the right algorithm and output format.",
        });
      }
    }

    for (const r of results) {
      outputs.push({ kind: 'code', label: r.label, value: r.digest });
    }

    return {
      outputs,
      stats: [
        ['File', file.name],
        ['Size', file.size === 0 ? '0 B (empty file)' : formatBytes(file.size)],
        ['Algorithms', results.map((r) => r.label).join(', ')],
      ],
    };
  },
});

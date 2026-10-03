import {
  Base32Error,
  TimeError,
  TotpError,
  computeCodes,
  formatUtc,
  meta,
  parseTimeInput,
  secretHints,
  type OtpAlgorithm,
} from '@fodt/totp-generator';
import { defineTool, num, str, type ToolIssue, type ToolResult } from '../lib/tool-ui';

/** The one time in a run: this device's clock, read once, or the time the visitor typed. */
function secondsForRun(at: string): { seconds: number; typed: boolean } {
  if (at.trim() === '') return { seconds: Math.floor(Date.now() / 1000), typed: false };
  return { seconds: parseTimeInput(at), typed: true };
}

/** Maps what the package throws to a message for the visitor. Nothing else is shown, so no typed text can leak. */
function failure(err: unknown, secret: string): ToolResult {
  const issues: ToolIssue[] = [];
  if (err instanceof Base32Error) {
    issues.push({ message: err.message });
    for (const hint of secretHints(secret)) issues.push({ message: hint });
  } else if (err instanceof TimeError) {
    issues.push({ message: `At this time: ${err.message}` });
  } else if (err instanceof TotpError) {
    issues.push({ message: err.message });
  } else {
    issues.push({ message: 'The codes could not be made from these settings.' });
  }
  return { outputs: [], errors: issues };
}

export default defineTool({
  id: 'totp-generator',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'secret',
      label: 'Secret',
      type: 'text',
      mono: true,
      wide: true,
      help: 'Base32 text, as an authenticator app is given it. Upper or lower case, spaces and hyphens are fine.',
    },
    {
      name: 'algorithm',
      label: 'Algorithm',
      type: 'select',
      default: 'SHA1',
      options: [
        { value: 'SHA1', label: 'SHA-1 (works in every app)' },
        { value: 'SHA256', label: 'SHA-256' },
        { value: 'SHA512', label: 'SHA-512' },
      ],
    },
    {
      name: 'digits',
      label: 'Digits',
      type: 'select',
      default: '6',
      options: [
        { value: '6', label: '6 (works in every app)' },
        { value: '7', label: '7' },
        { value: '8', label: '8' },
      ],
    },
    {
      name: 'period',
      label: 'Period',
      type: 'number',
      default: 30,
      min: 1,
      max: 86400,
      step: 1,
      help: 'Seconds each code lasts, 1 to 86400. 30 works in every app.',
    },
    {
      name: 'at',
      label: 'At this time',
      type: 'text',
      mono: true,
      help: "Leave empty for this device's clock. Or Unix seconds, or a date such as 2009-02-13T23:31:30Z (UTC unless an offset is written).",
    },
  ],
  examples: [
    {
      label: 'RFC 6238 test: SHA-1 secret at time 59, 8 digits',
      values: { secret: 'GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ', algorithm: 'SHA1', digits: '8', at: '59' },
    },
  ],
  run(values, ctx): ToolResult {
    const secret = str(values, 'secret');
    // An empty secret starts nothing.
    if (secret.trim() === '') return { outputs: [] };
    try {
      const period = num(values, 'period', 30);
      const { seconds, typed } = secondsForRun(str(values, 'at'));
      const result = computeCodes({
        mode: 'totp',
        secret,
        algorithm: str(values, 'algorithm', 'SHA1') as OtpAlgorithm,
        digits: Number(str(values, 'digits', '6')),
        period,
        seconds,
      });
      return {
        outputs: [
          {
            kind: 'table',
            label: 'Codes',
            table: {
              headers: ['Step', 'Code', 'Starts (UTC)', 'Ends (UTC)'],
              rows: result.window.map((row) => [
                `${row.label} (step ${row.step})`,
                row.code,
                formatUtc(row.startSeconds),
                formatUtc(row.endSeconds),
              ]),
              mono: [1, 2, 3],
            },
          },
          {
            kind: 'note',
            tone: 'info',
            value: `${result.secondsLeft} of ${period} seconds were left in the current step when these codes were made. The page does not refresh by itself; edit any field for fresh codes.`,
          },
        ],
        warnings: result.warnings,
        stats: [
          ['Time used', `${formatUtc(seconds)} UTC (${typed ? 'the time you typed' : "this device's clock"})`],
          ['Unix seconds', String(seconds)],
          ['Secret size', `${result.secretBits} bits`],
        ],
      };
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      return failure(err, secret);
    }
  },
});

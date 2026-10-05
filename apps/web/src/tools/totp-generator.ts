import {
  Base32Error,
  TimeError,
  TotpError,
  computeCodes,
  formatUtc,
  meta,
  parseTimeInput,
  qrSvg,
  secretHints,
  type ComputeResult,
  type OtpAlgorithm,
} from '@fodt/totp-generator';
import { defineTool, num, str, type OutputBlock, type ToolIssue, type ToolResult } from '../lib/tool-ui';

/** The one time in a run: this device's clock (`nowMs`, read once by the caller), or the time the visitor typed. */
function secondsForRun(at: string, nowMs: number): { seconds: number; typed: boolean } {
  if (at.trim() === '') return { seconds: Math.floor(nowMs / 1000), typed: false };
  return { seconds: parseTimeInput(at), typed: true };
}

/** Base64 of text that is plain ASCII (the picture's markup is). */
function base64Of(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** The link and its QR code, drawn here from the link: nothing is fetched, and no block offers to save either. */
function linkBlocks(uri: string): OutputBlock[] {
  const blocks: OutputBlock[] = [
    {
      kind: 'note',
      tone: 'warn',
      value: 'The link and the QR code hold your secret. Anyone who can see them can make your codes.',
    },
    { kind: 'code', label: 'otpauth link', value: uri },
  ];
  try {
    blocks.push({
      kind: 'image',
      label: 'QR code for an authenticator app',
      src: `data:image/svg+xml;base64,${base64Of(qrSvg(uri))}`,
      alt: 'QR code of the otpauth link',
    });
  } catch (err) {
    if (!(err instanceof TotpError)) throw err;
    blocks.push({ kind: 'note', tone: 'warn', value: err.message });
  }
  return blocks;
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

/**
 * `live` is set only for codes made from this device's clock: it carries the end of the current step in device-clock
 * milliseconds. Codes for a typed time and counter based codes have none.
 */
function codeBlocks(result: ComputeResult, period: number, live: { endsAt: number } | null): OutputBlock[] {
  if (result.mode === 'hotp') {
    return [
      {
        kind: 'table',
        label: 'Codes',
        table: {
          headers: ['Counter', 'Code'],
          rows: result.counters.map((row) => [String(row.counter), row.code]),
          mono: [0, 1],
        },
      },
      {
        kind: 'note',
        tone: 'info',
        value:
          'Counter based codes do not depend on the time. An app moves to the next counter each time a code is used, so the codes below the first are the ones it will show next.',
      },
    ];
  }
  const blocks: OutputBlock[] = [
    {
      kind: 'table',
      label: 'Codes',
      table: {
        headers: ['Step', 'Code', 'Starts (UTC)', 'Ends (UTC)', "Starts (this device's time)"],
        rows: result.window.map((row) => [
          `${row.label} (step ${row.step})`,
          row.code,
          formatUtc(row.startSeconds),
          formatUtc(row.endSeconds),
          new Date(row.startSeconds * 1000).toLocaleString(),
        ]),
        mono: [1, 2, 3, 4],
      },
    },
  ];
  if (live) {
    blocks.push({
      kind: 'note',
      tone: 'info',
      value: "The codes refresh by themselves at the start of each step, from this device's clock.",
    });
    // The block counts down to the end of the current step on its own; it is not inside the codes and never announces.
    blocks.push({
      kind: 'countdown',
      label: 'Time left in the current step',
      endsAt: live.endsAt,
      periodMs: period * 1000,
    });
  } else {
    blocks.push({
      kind: 'note',
      tone: 'info',
      value: `${result.secondsLeft} of ${period} seconds were left in the current step at the time you typed. A typed time does not refresh.`,
    });
  }
  return blocks;
}

export default defineTool({
  id: 'totp-generator',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'totp',
      options: [
        { value: 'totp', label: 'TOTP: codes that change with the time' },
        { value: 'hotp', label: 'HOTP: codes that change with a counter' },
      ],
    },
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
        { value: '7', label: '7 (many apps do not accept it)' },
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
      visible: (values) => values.mode !== 'hotp',
    },
    {
      name: 'counter',
      label: 'Counter',
      type: 'number',
      default: 0,
      min: 0,
      max: 9007199254740991,
      step: 1,
      help: 'The first counter to show; the next four follow it.',
      visible: (values) => values.mode === 'hotp',
    },
    {
      name: 'at',
      label: 'At this time',
      type: 'text',
      mono: true,
      help: "Leave empty for this device's clock. Or Unix seconds, or a date such as 2009-02-13T23:31:30Z (UTC unless an offset is written).",
      visible: (values) => values.mode !== 'hotp',
    },
    {
      name: 'issuer',
      label: 'Issuer',
      type: 'text',
      help: 'The service the account belongs to. Used only for the link and QR code.',
    },
    {
      name: 'account',
      label: 'Account',
      type: 'text',
      help: 'The account name, such as an email address. Give one to get the link and QR code.',
    },
  ],
  examples: [
    {
      label: 'RFC 6238 test: SHA-1 secret at time 59, 8 digits',
      values: {
        mode: 'totp',
        secret: 'GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ',
        algorithm: 'SHA1',
        digits: '8',
        at: '59',
      },
    },
    {
      label: 'RFC 6238 test: SHA-256 with its 32 byte secret at time 1111111109, 8 digits',
      values: {
        mode: 'totp',
        secret: 'GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ GEZA ====',
        algorithm: 'SHA256',
        digits: '8',
        at: '1111111109',
      },
    },
    {
      label: 'RFC 4226 test: HOTP counters 0 to 4',
      values: {
        mode: 'hotp',
        secret: 'GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ',
        algorithm: 'SHA1',
        digits: '6',
        counter: 0,
      },
    },
    {
      label: 'Codes, link and QR code for an app',
      values: {
        mode: 'totp',
        secret: 'GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ',
        algorithm: 'SHA1',
        digits: '6',
        period: 30,
        at: '',
        issuer: 'Example',
        account: 'alice@example.com',
      },
    },
  ],
  run(values, ctx): ToolResult {
    const secret = str(values, 'secret');
    // An empty secret starts nothing.
    if (secret.trim() === '') return { outputs: [] };
    try {
      const mode = str(values, 'mode', 'totp') === 'hotp' ? 'hotp' : 'totp';
      const algorithm = str(values, 'algorithm', 'SHA1') as OtpAlgorithm;
      const digits = Number(str(values, 'digits', '6'));
      const issuer = str(values, 'issuer');
      const account = str(values, 'account');
      // Only the fields of the chosen mode are read; a hidden field keeps its value but is never looked at.
      // The device clock is read once for the whole run, so the codes and the wait for the next step agree.
      const nowMs = Date.now();
      let seconds = 0;
      let typed = false;
      let period = 30;
      let result: ComputeResult;
      if (mode === 'hotp') {
        result = computeCodes({ mode, secret, algorithm, digits, counter: num(values, 'counter', 0), issuer, account });
      } else {
        period = num(values, 'period', 30);
        ({ seconds, typed } = secondsForRun(str(values, 'at'), nowMs));
        result = computeCodes({ mode, secret, algorithm, digits, period, seconds, issuer, account });
      }
      // Steps are floor(unix seconds / period), so a boundary is a multiple of the period in epoch time. Only codes made
      // from this device's clock keep themselves current: a typed time and a counter never change by themselves.
      const live = mode === 'totp' && !typed ? { endsAt: nowMs - (nowMs % (period * 1000)) + period * 1000 } : null;
      const outputs: OutputBlock[] = codeBlocks(result, period, live);
      if (result.uri !== undefined) outputs.push(...linkBlocks(result.uri));
      for (const note of result.notes) outputs.push({ kind: 'note', tone: 'info', value: note });
      const stats: [string, string][] = [];
      if (mode === 'totp') {
        stats.push([
          'Time used',
          `${formatUtc(seconds)} UTC (${typed ? 'the time you typed' : "this device's clock"})`,
        ]);
        stats.push(['Unix seconds', String(seconds)]);
      }
      stats.push(['Secret size', `${result.secretBits} bits`]);
      // The 25 ms keeps the refresh just after the boundary, never before it.
      return {
        outputs,
        warnings: result.warnings,
        stats,
        ...(live ? { refreshAfterMs: live.endsAt - nowMs + 25 } : {}),
      };
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      return failure(err, secret);
    }
  },
});

import {
  meta,
  inspectCookies,
  parseUtcTime,
  visible,
  SetCookieInspectorError,
  type CookieReport,
  type CookieRow,
  type Outcome,
  type RequestContext,
} from '@fodt/set-cookie-inspector';
import { bool, defineTool, str, type OutputBlock, type ToolResult, type Values } from '../lib/tool-ui';

// Everything on this page is an invented example: addresses use the reserved .example names (RFC 2606) and the cookie
// values are placeholders, not credentials.

const PASTE_PLACEHOLDER = 'Type or paste here. Nothing leaves your browser.';

const LEAD =
  "Nothing is sent and nothing is read from or written to your browser's cookies. Each cookie is judged by draft-ietf-httpbis-rfc6265bis-22, a draft that browsers follow in part.";

const RESULT_TEXT: Record<Outcome, string> = {
  stored: 'Stored',
  'not-stored': 'Not stored',
  ignored: 'Ignored',
  'stored-then-deleted': 'Stored, then deleted at once',
};

const SHOWN_CELL = 200;

const CONTEXTS: ReadonlyArray<{ value: RequestContext; label: string }> = [
  { value: 'same-site', label: 'A request from the same site' },
  { value: 'top-level', label: 'A top-level navigation from another site' },
  {
    value: 'cross-site',
    label: 'A cross-site request that is not a navigation (image, frame, script or the fetch API)',
  },
];

function readContext(values: Values): RequestContext {
  const chosen = str(values, 'context', 'same-site');
  return chosen === 'top-level' || chosen === 'cross-site' ? chosen : 'same-site';
}

/** The moment the response arrives: the field when it holds a full UTC time, else this device's clock read once. */
function readNow(values: Values): number | string {
  const text = str(values, 'now').trim();
  if (text === '') return Math.floor(Date.now() / 1000) * 1000;
  const at = parseUtcTime(text);
  if (at === null) {
    return 'Time must be a full UTC time such as 2026-10-06T12:00:00Z, or empty to use this device clock.';
  }
  return at;
}

function nameCell(row: CookieRow): string {
  return row.name === '' ? '(no name)' : visible(row.name, SHOWN_CELL);
}

function blocksOf(report: CookieReport): OutputBlock[] {
  return [
    { kind: 'note', tone: 'info', value: LEAD },
    {
      kind: 'table',
      label: 'Cookies',
      table: {
        headers: ['#', 'Name', 'Value', 'Result', 'Why'],
        rows: report.cookies.map((row) => [
          row.line,
          nameCell(row),
          visible(row.valueShown, SHOWN_CELL),
          RESULT_TEXT[row.decision.outcome],
          row.decision.reason,
        ]),
        mono: [1, 2],
      },
    },
  ];
}

export default defineTool({
  id: 'set-cookie-inspector',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'lines',
      label: 'Set-Cookie lines',
      type: 'textarea',
      rows: 8,
      placeholder: PASTE_PLACEHOLDER,
      help: 'One line per cookie, with or without the Set-Cookie: prefix.',
      wide: true,
    },
    {
      name: 'requestUrl',
      label: 'Address of the response',
      type: 'text',
      default: 'https://www.example.com/account/login',
      help: 'The http or https address that sent the lines. Its host and path decide what a cookie may do.',
    },
    {
      name: 'context',
      label: 'How the request was made',
      type: 'select',
      default: 'same-site',
      options: CONTEXTS.map((entry) => ({ value: entry.value, label: entry.label })),
      help: 'The page cannot tell whether two sites are the same site, so you choose.',
    },
    {
      name: 'now',
      label: 'Time of the response (UTC)',
      type: 'text',
      placeholder: '2026-10-06T12:00:00Z',
      help: 'Optional, a full UTC time. Empty uses this device clock, read once for each run.',
    },
    {
      name: 'reveal',
      label: 'Show values',
      type: 'checkbox',
      default: false,
      help: 'Off: a value shows its first characters and its length. Reveal only on a trusted screen.',
    },
  ],
  examples: [
    {
      label: 'A __Host- cookie with a Domain is refused',
      values: {
        lines: 'Set-Cookie: __Host-SID=12345; Secure; Domain=site.example; Path=/',
        requestUrl: 'https://site.example/account/login',
        context: 'same-site',
        now: '2026-10-06T12:00:00Z',
        reveal: false,
      },
    },
    {
      label: 'A session and a language cookie',
      values: {
        lines:
          'Set-Cookie: SID=31d4d96e407aad42; Path=/; Secure; HttpOnly\nSet-Cookie: lang=en-US; Path=/; Domain=site.example',
        requestUrl: 'https://www.site.example/login',
        context: 'same-site',
        now: '2026-10-06T12:00:00Z',
        reveal: false,
      },
    },
  ],
  run(values): ToolResult {
    const lines = str(values, 'lines');
    if (lines.trim() === '') return { outputs: [] };
    const nowMs = readNow(values);
    if (typeof nowMs === 'string') return { outputs: [], errors: [{ message: nowMs }] };
    try {
      const report = inspectCookies({
        lines,
        requestUrl: str(values, 'requestUrl'),
        context: readContext(values),
        nowMs,
        reveal: bool(values, 'reveal'),
      });
      return { outputs: blocksOf(report) };
    } catch (err) {
      if (err instanceof SetCookieInspectorError) return { outputs: [], errors: [{ message: err.message }] };
      return { outputs: [], errors: [{ message: 'Could not inspect these lines.' }] };
    }
  },
});

import {
  meta,
  inspectCookies,
  parseUtcTime,
  visible,
  SetCookieInspectorError,
  type CookieReport,
  type CookieRow,
  type Outcome,
  withCommas,
  MAX_NAME_VALUE_OCTETS,
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
const SHOWN_LONG = 400;
const MAX_ROWS_SHOWN = 500;
const MAX_DETAILS = 25;
const MAX_ATTRIBUTES_SHOWN = 30;
const MAX_LISTED = 100;

const CLOSING =
  'Judged by draft-ietf-httpbis-rfc6265bis-22 (1 December 2025), which is still an Internet-Draft. A Stored result says what the draft says a browser would do with the text you gave, not what one browser will certainly do: browsers differ in the SameSite default, third-party cookie blocking, partitioning and size limits. The public suffix list is not consulted and the cookie store is not modelled, so replacing an existing cookie and per-domain limits are not checked. Partitioned and Priority are shown and not judged.';

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

/** The Lives until cell: the end of the cookie, or why there is none. */
function livesUntil(row: CookieRow): string {
  const lifetime = row.decision.lifetime;
  if (lifetime === null) return '-';
  if (lifetime.kind === 'session') return 'End of the browser session';
  if (lifetime.kind === 'deleted') return 'Deleted at once';
  return `${lifetime.until ?? ''}${lifetime.clamped ? ' (reduced to 400 days)' : ''}`;
}

function sentCell(row: CookieRow): string {
  return row.sentTo === '' ? '-' : visible(row.sentTo, SHOWN_LONG);
}

function yesNo(value: boolean | undefined): string {
  return value === true ? 'Yes' : 'No';
}

/** One `keyvalue` block for a cookie: everything the table has no room for. */
function detailsOf(row: CookieRow): OutputBlock {
  const decision = row.decision;
  const scope = decision.scope;
  const pairs: [string, string][] = [
    ['Name', nameCell(row)],
    ['Value', visible(row.valueShown, SHOWN_CELL)],
    [
      'Size in octets',
      `${withCommas(row.octets)} of ${withCommas(MAX_NAME_VALUE_OCTETS)} allowed for name and value together`,
    ],
  ];
  row.attributes.slice(0, MAX_ATTRIBUTES_SHOWN).forEach((attribute, index) => {
    const written = attribute.valueShown === '' ? '' : `=${visible(attribute.valueShown, 100)} `;
    pairs.push([
      `Attribute ${index + 1}: ${attribute.name === '' ? '(no name)' : visible(attribute.name, 40)}`,
      `${written}${attribute.use === 'used' ? 'Used' : 'Ignored'}. ${attribute.reason}`,
    ]);
  });
  if (row.attributes.length > MAX_ATTRIBUTES_SHOWN) {
    pairs.push(['More attributes', `and ${row.attributes.length - MAX_ATTRIBUTES_SHOWN} more are not listed here`]);
  }
  pairs.push(['Result', RESULT_TEXT[decision.outcome]], ['Why', decision.reason]);
  pairs.push([
    'Storage steps checked',
    decision.stepsApplied
      .map((step) => {
        const mark =
          step.result === 'fail' ? ' (stopped here)' : step.result === 'not-modelled' ? ' (not modelled)' : '';
        return `${step.section} step ${step.step}${mark}`;
      })
      .join(', '),
  ]);
  pairs.push(['Lifetime', decision.lifetime === null ? '-' : decision.lifetime.text]);
  pairs.push(['Domain handling', row.domainHandling === '' ? '-' : row.domainHandling]);
  pairs.push(['Path', row.pathHandling === '' ? '-' : row.pathHandling]);
  pairs.push(['Secure', scope === null ? '-' : yesNo(scope.secureOnly)]);
  pairs.push(['HttpOnly', scope === null ? '-' : yesNo(scope.httpOnly)]);
  pairs.push(['SameSite', row.sameSiteText === '' ? '-' : row.sameSiteText]);
  pairs.push(['Prefix rule', row.prefixRule]);
  return { kind: 'keyvalue', label: `Line ${row.line}: ${nameCell(row)}`, pairs };
}

function blocksOf(report: CookieReport): OutputBlock[] {
  const shown = report.cookies.slice(0, MAX_ROWS_SHOWN);
  const blocks: OutputBlock[] = [{ kind: 'note', tone: 'info', value: LEAD }];
  if (report.request?.trustedHost === true) {
    blocks.push({
      kind: 'note',
      tone: 'info',
      value:
        'This address is localhost or a loopback address. Browsers treat localhost as a secure connection, so a Secure cookie is accepted over http here; check your browser for the loopback addresses.',
    });
  }
  blocks.push({
    kind: 'table',
    label: 'Cookies',
    table: {
      headers: ['#', 'Name', 'Value', 'Result', 'Why', 'Lives until', 'Sent to'],
      rows: shown.map((row) => [
        row.line,
        nameCell(row),
        visible(row.valueShown, SHOWN_CELL),
        RESULT_TEXT[row.decision.outcome],
        visible(row.decision.reason, SHOWN_LONG),
        livesUntil(row),
        sentCell(row),
      ]),
      mono: [1, 2],
    },
  });
  if (report.cookies.length > shown.length) {
    blocks.push({
      kind: 'note',
      tone: 'info',
      value: `The table shows the first ${withCommas(shown.length)} cookies; ${withCommas(report.cookies.length - shown.length)} more are not listed.`,
    });
  }
  for (const row of shown.slice(0, MAX_DETAILS)) blocks.push(detailsOf(row));
  if (shown.length > MAX_DETAILS) {
    blocks.push({
      kind: 'note',
      tone: 'info',
      value: `Details are shown for the first ${MAX_DETAILS} cookies; the table above lists every one.`,
    });
  }
  if (report.sendOrder.length > 1) {
    const byLine = new Map(report.cookies.map((row) => [row.line, row]));
    blocks.push({
      kind: 'list',
      label:
        'Order a browser lists these cookies in a Cookie header for a request to this address (longer paths first)',
      ordered: true,
      items: report.sendOrder.slice(0, MAX_LISTED).map((line) => {
        const row = byLine.get(line);
        const path = row === undefined || row.pathShown === '' ? '/' : row.pathShown;
        return `Line ${line}: ${row === undefined ? '' : nameCell(row)} (path ${visible(path, 60)})`;
      }),
    });
  }
  if (report.worthALook.length > 0) {
    const items = report.worthALook.slice(0, MAX_LISTED).map((remark) => remark.text);
    if (report.worthALook.length > MAX_LISTED)
      items.push(`and ${withCommas(report.worthALook.length - MAX_LISTED)} more`);
    blocks.push({ kind: 'list', label: 'Worth a look', items });
  }
  blocks.push({ kind: 'note', tone: 'info', value: CLOSING });
  return blocks;
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

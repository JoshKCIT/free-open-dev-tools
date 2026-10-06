import { meta, checkCors, CorsCheckerError, type CorsReport, type CorsInput } from '@fodt/cors-checker';
import { defineTool, num, str, type OutputBlock, type Tone, type ToolResult, type Values } from '../lib/tool-ui';

// Everything on this page is an invented example: addresses use the reserved .example names (RFC 2606) and the
// Authorization value is a placeholder, not a credential.

const PASTE_PLACEHOLDER = 'Type or paste here. Nothing leaves your browser.';

const LEAD =
  'This page never contacts the server: it only applies the rules of the Fetch Standard to what you describe and paste.';

const STATUS_MIN = 100;
const STATUS_MAX = 599;

/** The tone of the verdict note. A blocked request is a result worth a warning, never an input error. */
function toneOf(report: CorsReport): Tone {
  switch (report.verdict) {
    case 'readable':
      return 'success';
    case 'blocked-preflight':
    case 'blocked-response':
    case 'refused-request':
      return 'warn';
    case 'same-origin':
    case 'opaque':
      return 'info';
  }
}

const RESULT_TEXT = { pass: 'Pass', fail: 'FAIL', skipped: 'Skipped', info: 'Info' } as const;

function requestPairs(report: CorsReport): [string, string][] {
  const { plan } = report;
  const pairs: [string, string][] = [
    ['Request origin', plan.requestOrigin],
    ['Target origin', plan.targetOrigin],
    ['Cross-origin', plan.crossOrigin ? 'Yes' : 'No'],
    ['Mode', plan.mode],
    ['Credentials mode', plan.credentials],
    ['Method as the browser sends it', plan.method],
    ['Preflight', plan.preflight.sent ? 'Sent' : 'Not sent'],
  ];
  if (plan.preflight.reasons.length > 0) pairs.push(['Why a preflight is sent', plan.preflight.reasons.join(' ')]);
  return pairs;
}

function blocksOf(report: CorsReport): OutputBlock[] {
  const blocks: OutputBlock[] = [
    { kind: 'note', tone: toneOf(report), value: `${LEAD} ${report.summary}` },
    { kind: 'keyvalue', label: 'The request', pairs: requestPairs(report) },
  ];
  if (report.preflightText !== null) {
    blocks.push({ kind: 'code', label: 'Preflight the browser would send', value: report.preflightText });
  }
  blocks.push({
    kind: 'table',
    label: 'Checks, in the order of the Fetch Standard',
    table: {
      headers: ['#', 'Where', 'Rule', 'Result', 'Detail'],
      rows: report.steps.map((step, index) => [
        index + 1,
        step.where,
        step.id === report.firstFailure?.id ? `${step.rule} (first failure)` : step.rule,
        RESULT_TEXT[step.result],
        step.detail,
      ]),
    },
  });
  return blocks;
}

/** A status field's whole number, or the sentence that refuses it. The field label and range are named, never the text. */
function readStatus(values: Values, name: string, label: string, fallback: number): number | string {
  const value = num(values, name, fallback);
  if (!Number.isInteger(value) || value < STATUS_MIN || value > STATUS_MAX) {
    return `${label} must be a whole number from ${STATUS_MIN} to ${STATUS_MAX}.`;
  }
  return value;
}

export default defineTool({
  id: 'cors-checker',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'pageOrigin',
      label: 'Page origin',
      type: 'text',
      default: 'https://app.example',
      help: 'The origin of the page whose script makes the request. Write null for a sandboxed page.',
    },
    {
      name: 'url',
      label: 'URL requested',
      type: 'text',
      default: 'https://api.example/items',
      help: 'An http or https address. Leave it empty to start over.',
    },
    {
      name: 'method',
      label: 'Method',
      type: 'text',
      default: 'GET',
      help: 'Any method name. delete and put are written in capitals as browsers do; patch stays as typed.',
    },
    {
      name: 'mode',
      label: 'Mode',
      type: 'select',
      default: 'cors',
      options: [
        { value: 'cors', label: 'cors' },
        { value: 'no-cors', label: 'no-cors' },
      ],
    },
    {
      name: 'credentials',
      label: 'Credentials mode',
      type: 'select',
      default: 'same-origin',
      options: [
        { value: 'same-origin', label: 'same-origin' },
        { value: 'omit', label: 'omit' },
        { value: 'include', label: 'include' },
      ],
      help: 'For a request to another origin, same-origin and omit send no cookies and behave the same.',
    },
    {
      name: 'requestHeaders',
      label: 'Request headers',
      type: 'textarea',
      rows: 5,
      placeholder: PASTE_PLACEHOLDER,
      help: 'The headers the page sets, one Name: value per line.',
    },
    {
      name: 'preflightStatus',
      label: 'Preflight status',
      type: 'number',
      default: 204,
      min: STATUS_MIN,
      max: STATUS_MAX,
      step: 1,
      help: 'The status of the server answer to the preflight.',
      visible: (values) => str(values, 'mode', 'cors') === 'cors',
    },
    {
      name: 'preflightHeaders',
      label: 'Preflight response headers',
      type: 'textarea',
      rows: 6,
      placeholder: PASTE_PLACEHOLDER,
      help: 'The headers the server answers the preflight with. Only read when a preflight is sent.',
      visible: (values) => str(values, 'mode', 'cors') === 'cors',
    },
    {
      name: 'responseStatus',
      label: 'Response status',
      type: 'number',
      default: 200,
      min: STATUS_MIN,
      max: STATUS_MAX,
      step: 1,
      help: 'Any status works: the CORS check does not look at it.',
    },
    {
      name: 'responseHeaders',
      label: 'Response headers',
      type: 'textarea',
      rows: 6,
      placeholder: PASTE_PLACEHOLDER,
      help: 'The headers the server answers the real request with.',
    },
  ],
  examples: [
    {
      label: 'Authorization is not covered by a wildcard',
      values: {
        pageOrigin: 'https://app.example',
        url: 'https://api.example/items',
        method: 'POST',
        mode: 'cors',
        credentials: 'same-origin',
        requestHeaders: 'Authorization: 123',
        preflightStatus: 204,
        preflightHeaders:
          'Access-Control-Allow-Origin: *\nAccess-Control-Allow-Methods: *\nAccess-Control-Allow-Headers: *',
        responseStatus: 200,
        responseHeaders: 'Access-Control-Allow-Origin: *',
      },
    },
  ],
  run(values): ToolResult {
    if (str(values, 'url').trim() === '') return { outputs: [] };
    const cors = str(values, 'mode', 'cors') !== 'no-cors';

    let preflightStatus = 204;
    if (cors) {
      const status = readStatus(values, 'preflightStatus', 'Preflight status', 204);
      if (typeof status === 'string') return { outputs: [], errors: [{ message: status }] };
      preflightStatus = status;
    }
    const responseStatus = readStatus(values, 'responseStatus', 'Response status', 200);
    if (typeof responseStatus === 'string') return { outputs: [], errors: [{ message: responseStatus }] };

    const credentials = str(values, 'credentials', 'same-origin');
    const input: CorsInput = {
      pageOrigin: str(values, 'pageOrigin'),
      url: str(values, 'url'),
      method: str(values, 'method', 'GET'),
      mode: cors ? 'cors' : 'no-cors',
      credentials: credentials === 'include' || credentials === 'omit' ? credentials : 'same-origin',
      requestHeaders: str(values, 'requestHeaders'),
      preflightStatus,
      preflightHeaders: cors ? str(values, 'preflightHeaders') : '',
      responseStatus,
      responseHeaders: cors ? str(values, 'responseHeaders') : '',
    };

    try {
      return { outputs: blocksOf(checkCors(input)) };
    } catch (err) {
      if (err instanceof CorsCheckerError) return { outputs: [], errors: [{ message: err.message }] };
      return { outputs: [], errors: [{ message: 'Could not check this request.' }] };
    }
  },
});
